// Scoring derived entirely from values in app.config.json (no literals here).
import type { AppConfig, ModuleMeta, Progress } from './types';

export interface MaturityLevel {
  key: string;
  label: string;
  min: number;
  max: number;
  description: string;
}

export function levelForScore(config: AppConfig, score: number): MaturityLevel {
  const levels = config.scoring.maturityLevels;
  const match = levels.find((l) => score >= l.min && score < l.max);
  return match ?? levels[0];
}

// Weighted overall across ALL modules; unattempted modules contribute 0,
// so the overall score reflects both correctness and coverage.
export function overallScore(config: AppConfig, progress: Progress): number {
  const totalWeight = config.modules.reduce((sum, m) => sum + m.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = config.modules.reduce((sum, m) => {
    const score = progress[m.key]?.attempted ? progress[m.key].score : 0;
    return sum + score * m.weight;
  }, 0);
  return Math.round(weighted / totalWeight);
}

export function completedCount(config: AppConfig, progress: Progress): number {
  return config.modules.filter((m) => progress[m.key]?.attempted).length;
}

export function sortedModules(config: AppConfig): ModuleMeta[] {
  return [...config.modules].sort((a, b) => a.order - b.order);
}
