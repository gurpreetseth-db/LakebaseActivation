/** Server-side mirror of client/src/lib/scoring.ts so grades and the leaderboard agree. */
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
