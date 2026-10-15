/**
 * Parameterised data access for partners, quiz progress, labs and the question log.
 * Every value is bound as a parameter; only the (validated) schema name is
 * interpolated. Identity is the lowercased email — there is no SSO yet, so this
 * is NOT a security boundary.
 */
import { assertIdentifier, type Queryable } from './schema.js';
import type { PartnerRecord, ProgressRecord } from '../program/admin.js';

export interface PartnerRow {
  name: string;
  email: string;
  org: string;
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

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createRepo(db: Queryable, schema: string) {
  const s = assertIdentifier(schema);

  return {
    async upsertPartner(p: PartnerRow): Promise<PartnerRow> {
      const email = normalizeEmail(p.email);
      const { rows } = await db.query(
        `INSERT INTO ${s}.partners (email, name, org)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE
           SET name = EXCLUDED.name, org = EXCLUDED.org, last_seen_at = NOW()
         RETURNING email, name, org`,
        [email, p.name.trim(), p.org.trim()],
      );
      return rows[0] as unknown as PartnerRow;
    },

    async getProgress(emailRaw: string): Promise<ProgressMap> {
      const { rows } = await db.query(
        `SELECT module_key, score, correct, total, answers, completed_at
           FROM ${s}.module_progress WHERE email = $1`,
        [normalizeEmail(emailRaw)],
      );
      const out: ProgressMap = {};
      for (const r of rows) {
        out[r.module_key as string] = {
          attempted: true,
          score: Number(r.score),
          correct: Number(r.correct),
          total: Number(r.total),
          answers: (r.answers ?? {}) as Record<string, string>,
          completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
        };
      }
      return out;
    },

    /** Stores the attempt and updates the partner's latest result for the module. */
    async recordAttempt(
      emailRaw: string,
      moduleKey: string,
      result: { score: number; correct: number; total: number; answers: Record<string, string> },
    ): Promise<void> {
      const email = normalizeEmail(emailRaw);
      const answers = JSON.stringify(result.answers);
      await db.query(
        `INSERT INTO ${s}.quiz_attempts (email, module_key, score, correct, total, answers)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [email, moduleKey, result.score, result.correct, result.total, answers],
      );
      await db.query(
        `INSERT INTO ${s}.module_progress (email, module_key, score, correct, total, answers)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (email, module_key) DO UPDATE
           SET score = EXCLUDED.score, correct = EXCLUDED.correct, total = EXCLUDED.total,
               answers = EXCLUDED.answers, completed_at = NOW(),
               attempts = ${s}.module_progress.attempts + 1`,
        [email, moduleKey, result.score, result.correct, result.total, answers],
      );
    },

    async setLab(emailRaw: string, moduleKey: string, steps: number[], total: number): Promise<void> {
      const status = total > 0 && steps.length >= total ? 'completed' : 'in-progress';
      await db.query(
        `INSERT INTO ${s}.lab_checks (email, module_key, status, detail)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (email, module_key) DO UPDATE
           SET status = EXCLUDED.status, detail = EXCLUDED.detail, checked_at = NOW()`,
        [normalizeEmail(emailRaw), moduleKey, status, JSON.stringify({ mode: 'self-attested', steps, total })],
      );
    },

    async getLabs(emailRaw: string): Promise<Record<string, { status: string; steps: number[] }>> {
      const { rows } = await db.query(
        `SELECT module_key, status, detail FROM ${s}.lab_checks WHERE email = $1`,
        [normalizeEmail(emailRaw)],
      );
      const out: Record<string, { status: string; steps: number[] }> = {};
      for (const r of rows) {
        const detail = (r.detail ?? {}) as { steps?: number[] };
        out[r.module_key as string] = { status: r.status as string, steps: detail.steps ?? [] };
      }
      return out;
    },

    async logAsk(email: string | null, question: string, answer: string, mode: string, sources: unknown): Promise<void> {
      await db.query(
        `INSERT INTO ${s}.ask_log (email, question, answer, mode, sources) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [email ? normalizeEmail(email) : null, question, answer, mode, JSON.stringify(sources)],
      );
    },

    async listPartners(): Promise<PartnerRecord[]> {
      const { rows } = await db.query(
        `SELECT email, name, org, created_at, last_seen_at, leaderboard_opt_in FROM ${s}.partners`,
      );
      return rows.map((r) => ({
        email: r.email as string,
        name: r.name as string,
        org: r.org as string,
        createdAt: new Date(r.created_at as string).toISOString(),
        lastSeenAt: new Date(r.last_seen_at as string).toISOString(),
        leaderboardOptIn: Boolean(r.leaderboard_opt_in),
      }));
    },

    async allProgress(): Promise<ProgressRecord[]> {
      const { rows } = await db.query(
        `SELECT email, module_key, score, attempts, answers FROM ${s}.module_progress`,
      );
      return rows.map((r) => ({
        email: r.email as string,
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
        createdAt: new Date(r.created_at as string).toISOString(),
      }));
    },

    async setLeaderboardOptIn(emailRaw: string, optIn: boolean): Promise<boolean> {
      const { rows } = await db.query(
        `UPDATE ${s}.partners SET leaderboard_opt_in = $2 WHERE email = $1 RETURNING email`,
        [normalizeEmail(emailRaw), optIn],
      );
      return rows.length > 0;
    },

    /** Keeps the original certificate id and issue date; refreshes the score on re-issue. */
    async issueCertificate(emailRaw: string, overall: number, level: string): Promise<{ id: string; issuedAt: string }> {
      const { rows } = await db.query(
        `INSERT INTO ${s}.certificates (email, overall_score, level) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET overall_score = EXCLUDED.overall_score, level = EXCLUDED.level
         RETURNING id, issued_at`,
        [normalizeEmail(emailRaw), overall, level],
      );
      return { id: rows[0].id as string, issuedAt: new Date(rows[0].issued_at as string).toISOString() };
    },

    async getCertificate(id: string): Promise<{
      id: string;
      name: string;
      org: string;
      overall: number;
      level: string;
      issuedAt: string;
    } | null> {
      const { rows } = await db.query(
        `SELECT c.id, p.name, p.org, c.overall_score, c.level, c.issued_at
           FROM ${s}.certificates c JOIN ${s}.partners p ON p.email = c.email WHERE c.id = $1`,
        [id],
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        id: r.id as string,
        name: r.name as string,
        org: r.org as string,
        overall: Number(r.overall_score),
        level: r.level as string,
        issuedAt: new Date(r.issued_at as string).toISOString(),
      };
    },

    async deleteProgress(emailRaw: string): Promise<void> {
      await db.query(`DELETE FROM ${s}.module_progress WHERE email = $1`, [normalizeEmail(emailRaw)]);
    },

    async ping(): Promise<number> {
      const t0 = Date.now();
      await db.query('SELECT 1');
      return Date.now() - t0;
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
