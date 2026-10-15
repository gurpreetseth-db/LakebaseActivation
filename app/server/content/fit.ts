import type { FitContent } from './loader.js';

export interface FitFinding {
  questionId: string;
  prompt: string;
  answer: string;
  flag: 'green' | 'yellow' | 'red';
  note: string;
}

export interface FitResult {
  verdict: 'good' | 'caution' | 'notYet';
  label: string;
  summary: string;
  counts: { green: number; yellow: number; red: number };
  findings: FitFinding[];
}

/** Any red is a blocker; enough yellows means proceed with care; otherwise a good fit. */
export function evaluateFit(fit: FitContent, answers: Record<string, string>): FitResult {
  const findings: FitFinding[] = [];
  for (const q of fit.questions) {
    const chosen = q.options.find((o) => o.key === answers[q.id]);
    if (!chosen) throw new Error(`Missing or invalid answer for ${q.id}`);
    findings.push({ questionId: q.id, prompt: q.prompt, answer: chosen.label, flag: chosen.flag, note: chosen.note });
  }
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const f of findings) counts[f.flag] += 1;
  const verdict =
    counts.red > 0 ? 'notYet' : counts.yellow >= fit.verdicts.caution.yellowThreshold ? 'caution' : 'good';
  const v = fit.verdicts[verdict];
  return { verdict, label: v.label, summary: v.summary, counts, findings };
}
