/** Server-side mirror of client/src/lib/scoring.ts so grades, the leaderboard and certificates agree. */
import type { AppConfig } from '../content/loader.js';

export type ScoreMap = Record<string, number>;

export function overallScore(config: AppConfig, scores: ScoreMap): number {
  const totalWeight = config.modules.reduce((sum, m) => sum + m.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = config.modules.reduce((sum, m) => sum + (scores[m.key] ?? 0) * m.weight, 0);
  return Math.round(weighted / totalWeight);
}

export function levelLabel(config: AppConfig, score: number): string {
  const levels = config.scoring.maturityLevels;
  return (levels.find((l) => score >= l.min && score < l.max) ?? levels[0]).label;
}

export interface Eligibility {
  eligible: boolean;
  overall: number;
  level: string;
  reasons: string[];
}

/** Certificate rules come only from config: pass threshold and (optionally) every module attempted. */
export function certificateEligibility(config: AppConfig, scores: ScoreMap): Eligibility {
  const overall = overallScore(config, scores);
  const reasons: string[] = [];
  if (config.program.certificate.requireAllModules) {
    const missing = config.modules.filter((m) => scores[m.key] === undefined).map((m) => m.title);
    if (missing.length > 0) reasons.push(`Complete the remaining modules: ${missing.join(', ')}`);
  }
  if (overall < config.scoring.passThreshold) {
    reasons.push(`Overall score ${overall} is below the ${config.scoring.passThreshold} pass threshold`);
  }
  return { eligible: reasons.length === 0, overall, level: levelLabel(config, overall), reasons };
}

/** "Jordan Rivera" -> "Jordan R." so the leaderboard never shows full surnames. */
export function displayName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Partner';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
