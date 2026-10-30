/**
 * Parameterised data access for learners, quiz progress, labs, the question log and deletion requests.
 * Every value is bound as a parameter; only the (validated) schema name is
 * interpolated. A learner is identified by a random id and authenticated by the hash of their
 * learner code; no email or personal name is ever stored.
 */
import { assertIdentifier, type Queryable } from './schema.js';
import { generateLearnerCode, hashLearnerCode, isWellFormedCode } from './learner-code.js';
import type { LearnerRecord, ProgressRecord } from '../program/admin.js';

export interface Learner {
  id: string;
  org: string;
  nickname: string | null;
  leaderboardOptIn: boolean;
}

export interface ProgressRow {
  attempted: true;
  score: number;
  correct: number;
  total: number;
  answers: Record<string, string>;
  completedAt: string | null;
}

export type ProgressMap = Record<string, ProgressRow>;

export interface DataRequest {
  id: number;
  learnerId: string;
  org: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  completedBy: string | null;
}

const iso = (v: unknown): string => new Date(v as string).toISOString();

export function createRepo(db: Queryable, schema: string) {
  const s = assertIdentifier(schema);

  return {
    /** Creates a learner and returns the code, which is shown once and never stored in clear. */
    async register(org: string, nickname: string | null): Promise<{ learner: Learner; code: string }> {
      const code = generateLearnerCode();
      const { rows } = await db.query(
        `INSERT INTO ${s}.learners (code_hash, org, nickname) VALUES ($1, $2, $3)
         RETURNING id, org, nickname, leaderboard_opt_in`,
        [hashLearnerCode(code), org.trim(), nickname?.trim() || null],
      );
      return { learner: toLearner(rows[0]), code };
    },

    /** Resolves a learner code to the learner and records activity (drives the inactivity purge). */
    async authenticate(code: string | undefined): Promise<Learner | null> {
      if (!code || !isWellFormedCode(code)) return null;
      const { rows } = await db.query(
        `UPDATE ${s}.learners SET last_seen_at = NOW() WHERE code_hash = $1
         RETURNING id, org, nickname, leaderboard_opt_in`,
        [hashLearnerCode(code)],
      );
      return rows.length ? toLearner(rows[0]) : null;
    },

    async getProgress(learnerId: string): Promise<ProgressMap> {
      const { rows } = await db.query(
        `SELECT module_key, score, correct, total, answers, completed_at
           FROM ${s}.module_progress WHERE learner_id = $1`,
        [learnerId],
      );
      const out: ProgressMap = {};
      for (const r of rows) {
        out[r.module_key as string] = {
          attempted: true,
          score: Number(r.score),
          correct: Number(r.correct),
          total: Number(r.total),
          answers: (r.answers ?? {}) as Record<string, string>,
          completedAt: r.completed_at ? iso(r.completed_at) : null,
        };
      }
      return out;
    },

    /** Stores the attempt and updates the learner's latest result for the module. */
    async recordAttempt(
      learnerId: string,
      moduleKey: string,
      result: { score: number; correct: number; total: number; answers: Record<string, string> },
    ): Promise<void> {
      const answers = JSON.stringify(result.answers);
      await db.query(
        `INSERT INTO ${s}.quiz_attempts (learner_id, module_key, score, correct, total, answers)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [learnerId, moduleKey, result.score, result.correct, result.total, answers],
      );
      await db.query(
        `INSERT INTO ${s}.module_progress (learner_id, module_key, score, correct, total, answers)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (learner_id, module_key) DO UPDATE
           SET score = EXCLUDED.score, correct = EXCLUDED.correct, total = EXCLUDED.total,
               answers = EXCLUDED.answers, completed_at = NOW(),
               attempts = ${s}.module_progress.attempts + 1`,
        [learnerId, moduleKey, result.score, result.correct, result.total, answers],
      );
    },

    async setLab(learnerId: string, moduleKey: string, steps: number[], total: number): Promise<void> {
      const status = total > 0 && steps.length >= total ? 'completed' : 'in-progress';
      await db.query(
        `INSERT INTO ${s}.lab_checks (learner_id, module_key, status, detail)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (learner_id, module_key) DO UPDATE
           SET status = EXCLUDED.status, detail = EXCLUDED.detail, checked_at = NOW()`,
        [learnerId, moduleKey, status, JSON.stringify({ mode: 'self-attested', steps, total })],
      );
    },

    async getLabs(learnerId: string): Promise<Record<string, { status: string; steps: number[] }>> {
      const { rows } = await db.query(`SELECT module_key, status, detail FROM ${s}.lab_checks WHERE learner_id = $1`, [
        learnerId,
      ]);
      const out: Record<string, { status: string; steps: number[] }> = {};
      for (const r of rows) {
        const detail = (r.detail ?? {}) as { steps?: number[] };
        out[r.module_key as string] = { status: r.status as string, steps: detail.steps ?? [] };
      }
      return out;
    },

    async logAsk(learnerId: string | null, question: string, answer: string, mode: string, sources: unknown): Promise<void> {
      await db.query(
        `INSERT INTO ${s}.ask_log (learner_id, question, answer, mode, sources) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [learnerId, question, answer, mode, JSON.stringify(sources)],
      );
    },

    async listLearners(): Promise<LearnerRecord[]> {
      const { rows } = await db.query(
        `SELECT id, org, nickname, created_at, last_seen_at, leaderboard_opt_in FROM ${s}.learners`,
      );
      return rows.map((r) => ({
        id: r.id as string,
        org: r.org as string,
        nickname: (r.nickname as string | null) ?? null,
        createdAt: iso(r.created_at),
        lastSeenAt: iso(r.last_seen_at),
        leaderboardOptIn: Boolean(r.leaderboard_opt_in),
      }));
    },

    async allProgress(): Promise<ProgressRecord[]> {
      const { rows } = await db.query(`SELECT learner_id, module_key, score, attempts, answers FROM ${s}.module_progress`);
      return rows.map((r) => ({
        learnerId: r.learner_id as string,
        moduleKey: r.module_key as string,
        score: Number(r.score),
        attempts: Number(r.attempts),
        answers: (r.answers ?? {}) as Record<string, string>,
      }));
    },

    async recentAsks(limit: number): Promise<{ question: string; mode: string; createdAt: string }[]> {
      const { rows } = await db.query(
        `SELECT question, mode, created_at FROM ${s}.ask_log ORDER BY created_at DESC LIMIT $1`,
        [Math.max(1, Math.min(limit, 100))],
      );
      return rows.map((r) => ({
        question: r.question as string,
        mode: r.mode as string,
        createdAt: iso(r.created_at),
      }));
    },

    /** Sets the leaderboard preference; the nickname is replaced only when one is given. */
    async setLeaderboardOptIn(learnerId: string, optIn: boolean, nickname?: string | null): Promise<boolean> {
      const { rows } = await db.query(
        `UPDATE ${s}.learners
            SET leaderboard_opt_in = $2, nickname = CASE WHEN $3::boolean THEN $4 ELSE nickname END
          WHERE id = $1 RETURNING id`,
        [learnerId, optIn, nickname !== undefined, nickname?.trim() || null],
      );
      return rows.length > 0;
    },

    /** Learner-initiated reset of their own results; the learner record itself stays. */
    async deleteProgress(learnerId: string): Promise<void> {
      await db.query(`DELETE FROM ${s}.module_progress WHERE learner_id = $1`, [learnerId]);
      await db.query(`DELETE FROM ${s}.quiz_attempts WHERE learner_id = $1`, [learnerId]);
      await db.query(`DELETE FROM ${s}.lab_checks WHERE learner_id = $1`, [learnerId]);
    },

    /** Files a deletion request for the admin. One pending request per learner. */
    async requestErasure(learner: Learner): Promise<void> {
      await db.query(
        `INSERT INTO ${s}.data_requests (learner_id, org) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [learner.id, learner.org],
      );
    },

    async hasPendingRequest(learnerId: string): Promise<boolean> {
      const { rows } = await db.query(
        `SELECT 1 FROM ${s}.data_requests WHERE learner_id = $1 AND status = 'pending'`,
        [learnerId],
      );
      return rows.length > 0;
    },

    async listRequests(): Promise<DataRequest[]> {
      const { rows } = await db.query(
        `SELECT id, learner_id, org, status, requested_at, completed_at, completed_by
           FROM ${s}.data_requests ORDER BY (status = 'pending') DESC, requested_at DESC LIMIT 200`,
      );
      return rows.map((r) => ({
        id: Number(r.id),
        learnerId: r.learner_id as string,
        org: r.org as string,
        status: r.status as string,
        requestedAt: iso(r.requested_at),
        completedAt: r.completed_at ? iso(r.completed_at) : null,
        completedBy: (r.completed_by as string | null) ?? null,
      }));
    },

    /**
     * Admin erasure of one request: deleting the learner cascades to progress, attempts, labs and the
     * Ask log; the request row stays as the erasure record. Returns false for an unknown or closed request.
     */
    async erase(requestId: number, adminEmail: string): Promise<boolean> {
      const { rows } = await db.query(
        `SELECT learner_id FROM ${s}.data_requests WHERE id = $1 AND status = 'pending'`,
        [requestId],
      );
      if (rows.length === 0) return false;
      await db.query(`DELETE FROM ${s}.learners WHERE id = $1`, [rows[0].learner_id]);
      await db.query(
        `UPDATE ${s}.data_requests SET status = 'erased', completed_at = NOW(), completed_by = $2 WHERE id = $1`,
        [requestId, adminEmail],
      );
      return true;
    },

    /** Retention: drops inactive learners (cascading) and old Ask log rows. Returns counts only. */
    async purgeExpired(retentionDays: number): Promise<{ learners: number; asks: number }> {
      const days = Math.max(1, Math.floor(retentionDays));
      const learners = await db.query(
        `DELETE FROM ${s}.learners WHERE last_seen_at < NOW() - make_interval(days => $1) RETURNING id`,
        [days],
      );
      const asks = await db.query(
        `DELETE FROM ${s}.ask_log WHERE created_at < NOW() - make_interval(days => $1) RETURNING id`,
        [days],
      );
      return { learners: learners.rows.length, asks: asks.rows.length };
    },

    async ping(): Promise<number> {
      const t0 = Date.now();
      await db.query('SELECT 1');
      return Date.now() - t0;
    },
  };
}

function toLearner(r: Record<string, unknown>): Learner {
  return {
    id: r.id as string,
    org: r.org as string,
    nickname: (r.nickname as string | null) ?? null,
    leaderboardOptIn: Boolean(r.leaderboard_opt_in),
  };
}

export type Repo = ReturnType<typeof createRepo>;
