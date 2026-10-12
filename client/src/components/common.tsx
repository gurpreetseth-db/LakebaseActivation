import { Badge } from '@databricks/appkit-ui/react';
import type { AppConfig } from '@/lib/types';
import { levelForScore } from '@/lib/scoring';

// Solid, high-contrast chips per maturity level so they read on both light cards and the dark hero.
const LEVEL_STYLES: Record<string, string> = {
  expert: 'border-transparent bg-emerald-500 text-white hover:bg-emerald-500',
  proficient: 'border-transparent bg-sky-500 text-white hover:bg-sky-500',
  developing: 'border-transparent bg-amber-400 text-amber-950 hover:bg-amber-400',
  novice: 'border-transparent bg-rose-500 text-white hover:bg-rose-500',
};

export function LevelBadge({ config, score }: { config: AppConfig; score: number }) {
  const level = levelForScore(config, score);
  return (
    <Badge variant="outline" className={`font-semibold ${LEVEL_STYLES[level.key] ?? LEVEL_STYLES.novice}`}>
      {level.label}
    </Badge>
  );
}

export function ScorePill({ score, total }: { score: number; total?: number }) {
  return (
    <span className="font-mono text-sm font-semibold text-foreground">
      {score}
      {total !== undefined ? `/${total}` : '/100'}
    </span>
  );
}
