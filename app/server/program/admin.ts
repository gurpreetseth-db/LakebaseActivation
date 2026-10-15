import type { AppConfig, Question } from '../content/loader.js';
import { certificateEligibility, overallScore, type ScoreMap } from './scoring.js';

export interface PartnerRecord {
  email: string;
  name: string;
  org: string;
  createdAt: string;
  lastSeenAt: string;
  leaderboardOptIn: boolean;
}

export interface ProgressRecord {
  email: string;
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

export function scoresByEmail(progress: ProgressRecord[]): Map<string, ScoreMap> {
  const out = new Map<string, ScoreMap>();
  for (const p of progress) {
    const m = out.get(p.email) ?? {};
    m[p.moduleKey] = p.score;
    out.set(p.email, m);
  }
  return out;
}

export function summarize(input: {
  config: AppConfig;
  questions: Question[];
  partners: PartnerRecord[];
  progress: ProgressRecord[];
}) {
  const { config, questions, partners, progress } = input;
  const byEmail = scoresByEmail(progress);

  const rows = partners.map((p) => {
    const scores = byEmail.get(p.email) ?? {};
    const elig = certificateEligibility(config, scores);
    return {
      name: p.name,
      email: p.email,
      org: p.org,
      modulesDone: Object.keys(scores).length,
      overall: elig.overall,
      level: elig.level,
      certified: config.program.certificate.enabled && elig.eligible,
      lastSeenAt: p.lastSeenAt,
    };
  });

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

  const orgs = new Set(partners.map((p) => p.org.trim().toLowerCase()));
  const overallScores = rows.filter((r) => r.modulesDone > 0).map((r) => r.overall);

  return {
    totals: {
      partners: partners.length,
      organizations: orgs.size,
      active: rows.filter((r) => r.modulesDone > 0).length,
      avgOverall: overallScores.length ? Math.round(overallScores.reduce((a, b) => a + b, 0) / overallScores.length) : 0,
      certified: rows.filter((r) => r.certified).length,
    },
    modules,
    hardestQuestions: hardest,
    partners: rows.sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name)),
  };
}

export function leaderboard(config: AppConfig, partners: PartnerRecord[], progress: ProgressRecord[]) {
  const byEmail = scoresByEmail(progress);
  return partners
    .filter((p) => p.leaderboardOptIn && byEmail.has(p.email))
    .map((p) => ({ email: p.email, name: p.name, org: p.org, overall: overallScore(config, byEmail.get(p.email)!) }))
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
