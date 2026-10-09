import { Badge } from '@databricks/appkit-ui/react';
import type { AppConfig } from '@/lib/types';
import { levelForScore } from '@/lib/scoring';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

// Maturity level → badge variant. Uses semantic variants only (no raw colors).
function variantForLevel(levelKey: string): BadgeVariant {
  switch (levelKey) {
    case 'expert':
      return 'default';
    case 'proficient':
      return 'secondary';
    case 'developing':
      return 'outline';
    default:
      return 'destructive';
  }
}

export function LevelBadge({ config, score }: { config: AppConfig; score: number }) {
  const level = levelForScore(config, score);
  return <Badge variant={variantForLevel(level.key)}>{level.label}</Badge>;
}

export function ScorePill({ score, total }: { score: number; total?: number }) {
  return (
    <span className="font-mono text-sm font-semibold text-foreground">
      {score}
      {total !== undefined ? `/${total}` : '/100'}
    </span>
  );
}
