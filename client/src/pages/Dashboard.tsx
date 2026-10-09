import { Link } from 'react-router';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
} from '@databricks/appkit-ui/react';
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { ModuleIcon } from '@/lib/icons';
import { overallScore, completedCount, levelForScore, sortedModules } from '@/lib/scoring';
import { LevelBadge, ScorePill } from '@/components/common';

export function Dashboard() {
  const { config, partner, progress } = useAppData();
  const modules = sortedModules(config);
  const overall = overallScore(config, progress);
  const level = levelForScore(config, overall);
  const done = completedCount(config, progress);
  const total = modules.length;
  const anyAttempted = done > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Readiness summary */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">
                {partner?.name ? `Welcome back, ${partner.name.split(' ')[0]}` : 'Your Lakebase readiness'}
              </CardTitle>
              <CardDescription className="mt-1">{config.branding.tagline}</CardDescription>
            </div>
            <LevelBadge config={config} score={overall} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-end justify-between">
              <span className="text-sm text-muted-foreground">Overall readiness (weighted)</span>
              <ScorePill score={overall} />
            </div>
            <Progress value={overall} />
            <p className="mt-1.5 text-xs text-muted-foreground">{level.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              {done} of {total} modules completed
            </span>
            <Button asChild size="sm" variant={anyAttempted ? 'default' : 'secondary'} disabled={!anyAttempted}>
              <Link to="/plan">
                <Sparkles className="mr-1.5 h-4 w-4" />
                Generate adoption plan
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Module grid */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Learning modules</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map((m) => {
            const mp = progress[m.key];
            const attempted = Boolean(mp?.attempted);
            return (
              <Link key={m.key} to={`/module/${m.key}`} className="group">
                <Card className="h-full transition-colors group-hover:border-primary/50">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <ModuleIcon name={m.icon} className="h-5 w-5 text-foreground" />
                        </span>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Module {m.order} · weight {m.weight}
                          </p>
                          <CardTitle className="text-base">{m.title}</CardTitle>
                        </div>
                      </div>
                      {attempted ? (
                        <LevelBadge config={config} score={mp.score} />
                      ) : (
                        <Badge variant="outline">Not started</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">{m.summary}</p>
                    <div className="flex items-center justify-between text-sm">
                      {attempted ? (
                        <span className="text-muted-foreground">
                          Quiz: <ScorePill score={mp.correct} total={mp.total} /> correct
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Learn, lab, then test your knowledge</span>
                      )}
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        {attempted ? 'Review' : 'Start'}
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
