import type { AppConfig, Question } from '../content/loader.js';
import { levelLabel, overallScore, type ScoreMap } from './scoring.js';

/** A learner as the admin sees them: pseudonymous (random id), never a name or email. */
export interface LearnerRecord {
  id: string;
  org: string;
  nickname: string | null;
  createdAt: string;
  lastSeenAt: string;
  leaderboardOptIn: boolean;
}

export interface ProgressRecord {
  learnerId: string;
  moduleKey: string;
  score: number;
  attempts: number;
  answers: Record<string, string>;
}

export function isAdmin(email: string | undefined, admins: string[]): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return admins.some((a) => a.trim().toLowerCase() === e);
}

export function scoresByLearner(progress: ProgressRecord[]): Map<string, ScoreMap> {
  const out = new Map<string, ScoreMap>();
  for (const p of progress) {
    const m = out.get(p.learnerId) ?? {};
    m[p.moduleKey] = p.score;
    out.set(p.learnerId, m);
  }
  return out;
}

export function summarize(input: {
  config: AppConfig;
  questions: Question[];
  learners: LearnerRecord[];
  progress: ProgressRecord[];
}) {
  const { config, questions, learners, progress } = input;
  const byLearner = scoresByLearner(progress);
  const moduleCount = config.modules.length;

  // Per company: how many learners, how many started, how many finished every module, and how far along.
  const orgMap = new Map<string, { org: string; learners: LearnerRecord[] }>();
  for (const l of learners) {
    const key = l.org.trim().toLowerCase();
    const entry = orgMap.get(key) ?? { org: l.org.trim(), learners: [] };
    entry.learners.push(l);
    orgMap.set(key, entry);
  }
  const organizations = [...orgMap.values()]
    .map(({ org, learners: ls }) => {
      const scored = ls.map((l) => ({ l, scores: byLearner.get(l.id) ?? {} }));
      const started = scored.filter((x) => Object.keys(x.scores).length > 0);
      const completed = started.filter((x) => Object.keys(x.scores).length >= moduleCount);
      const overalls = started.map((x) => overallScore(config, x.scores));
      const avgOverall = overalls.length ? Math.round(overalls.reduce((a, b) => a + b, 0) / overalls.length) : 0;
      return {
        org,
        learners: ls.length,
        started: started.length,
        completed: completed.length,
        avgModulesDone: started.length
          ? Math.round((started.reduce((sum, x) => sum + Object.keys(x.scores).length, 0) / started.length) * 10) / 10
          : 0,
        avgOverall,
        level: levelLabel(config, avgOverall),
        lastActiveAt: ls.map((l) => l.lastSeenAt).sort().reverse()[0] ?? '',
      };
    })
    .sort((a, b) => b.completed - a.completed || b.started - a.started || a.org.localeCompare(b.org));

  const modules = config.modules.map((m) => {
    const rowsFor = progress.filter((p) => p.moduleKey === m.key);
    const avg = rowsFor.length ? Math.round(rowsFor.reduce((s, r) => s + r.score, 0) / rowsFor.length) : null;
    const passed = rowsFor.filter((r) => r.score >= config.scoring.passThreshold).length;
    return {
      key: m.key,
      title: m.title,
      learners: rowsFor.length,
      avgScore: avg,
      passRate: rowsFor.length ? Math.round((passed / rowsFor.length) * 100) : null,
      retakes: rowsFor.reduce((s, r) => s + Math.max(0, r.attempts - 1), 0),
    };
  });

  // Question-level accuracy from each learner's latest answers.
  const stats = new Map<string, { asked: number; correct: number }>();
  for (const q of questions) stats.set(q.id, { asked: 0, correct: 0 });
  for (const p of progress) {
    for (const [qid, given] of Object.entries(p.answers)) {
      const s = stats.get(qid);
      const q = questions.find((x) => x.id === qid);
      if (!s || !q) continue;
      s.asked += 1;
      if (given === q.correctAnswer) s.correct += 1;
    }
  }
  const hardest = questions
    .map((q) => {
      const s = stats.get(q.id)!;
      return { id: q.id, moduleKey: q.moduleKey, prompt: q.prompt, asked: s.asked, accuracy: s.asked ? Math.round((s.correct / s.asked) * 100) : null };
    })
    .filter((q) => q.asked >= 1 && q.accuracy !== null)
    .sort((a, b) => (a.accuracy as number) - (b.accuracy as number) || b.asked - a.asked)
    .slice(0, 10);

  const overallScores = learners
    .filter((l) => byLearner.has(l.id))
    .map((l) => overallScore(config, byLearner.get(l.id)!));

  return {
    totals: {
      learners: learners.length,
      organizations: organizations.length,
      active: overallScores.length,
      completed: organizations.reduce((sum, o) => sum + o.completed, 0),
      avgOverall: overallScores.length ? Math.round(overallScores.reduce((a, b) => a + b, 0) / overallScores.length) : 0,
    },
    modules,
    hardestQuestions: hardest,
    organizations,
  };
}

/** Opted-in learners only, shown by self-chosen nickname (never a real name) and company. */
export function leaderboard(config: AppConfig, learners: LearnerRecord[], progress: ProgressRecord[]) {
  const byLearner = scoresByLearner(progress);
  return learners
    .filter((l) => l.leaderboardOptIn && byLearner.has(l.id))
    .map((l) => ({
      id: l.id,
      name: l.nickname?.trim() || 'Anonymous learner',
      org: l.org,
      overall: overallScore(config, byLearner.get(l.id)!),
    }))
    .sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name));
}

/** Neutralises spreadsheet formula injection and quotes fields for CSV export. */
export function csvCell(value: string | number | boolean): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | boolean)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
