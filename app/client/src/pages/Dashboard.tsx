import { Link } from 'react-router';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Progress } from '@databricks/appkit-ui/react';
import { ArrowRight, CheckCircle2, Target } from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { ModuleIcon } from '@/lib/icons';
import { overallScore, completedCount, levelForScore, sortedModules } from '@/lib/scoring';
import { LevelBadge, ScorePill } from '@/components/common';

// One accent per module so the grid is easy to scan. Full class names (not built
// dynamically) so Tailwind can see them.
const ACCENTS = [
  { icon: 'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300', bar: 'before:bg-orange-500' },
  { icon: 'bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300', bar: 'before:bg-sky-500' },
  { icon: 'bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300', bar: 'before:bg-violet-500' },
  { icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300', bar: 'before:bg-emerald-500' },
  { icon: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300', bar: 'before:bg-amber-500' },
  { icon: 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300', bar: 'before:bg-rose-500' },
  { icon: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300', bar: 'before:bg-cyan-500' },
  { icon: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300', bar: 'before:bg-indigo-500' },
];

export function Dashboard() {
  const { config, learner, progress } = useAppData();
  const modules = sortedModules(config);
  const overall = overallScore(config, progress);
  const level = levelForScore(config, overall);
  const done = completedCount(config, progress);
  const total = modules.length;
  const anyAttempted = done > 0;
  const next = modules.find((m) => !progress[m.key]?.attempted);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Hero */}
      <section className="app-chrome relative overflow-hidden rounded-2xl p-6 shadow-lg md:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <div className="space-y-3">
            <p className="text-sm font-medium text-white/70">
              {learner ? `Welcome back, ${learner.nickname || learner.org}` : 'Your Lakebase readiness'}
            </p>
            <h1 className="text-2xl font-bold text-white md:text-3xl">{config.branding.tagline}</h1>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <LevelBadge config={config} score={overall} />
              <span className="inline-flex items-center gap-1.5 text-sm text-white/80">
                <CheckCircle2 className="h-4 w-4" />
                {done} of {total} modules completed
              </span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {next ? (
                <Button asChild>
                  <Link to={`/module/${next.key}`}>
                    <Target className="mr-1.5 h-4 w-4" />
                    {anyAttempted ? 'Continue' : 'Start'}: {next.title}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl bg-white/10 p-5 text-white ring-1 ring-white/15 backdrop-blur md:w-72">
            <div className="flex items-end justify-between">
              <span className="text-xs uppercase tracking-wide text-white/70">Overall readiness</span>
              <span className="text-4xl font-bold leading-none">
                {overall}
                <span className="text-lg font-medium text-white/60">/100</span>
              </span>
            </div>
            <Progress value={overall} className="mt-3 h-2.5 bg-white/20" />
            <p className="mt-2 text-xs text-white/75">{level.description}</p>
          </div>
        </div>
      </section>

      {/* Module grid */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Learning modules</h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m, i) => {
            const mp = progress[m.key];
            const attempted = Boolean(mp?.attempted);
            const accent = ACCENTS[i % ACCENTS.length];
            return (
              <Link key={m.key} to={`/module/${m.key}`} className="group">
                <Card
                  className={`relative h-full overflow-hidden border-border/80 shadow-sm transition-all before:absolute before:inset-y-0 before:left-0 before:w-1.5 ${accent.bar} group-hover:-translate-y-0.5 group-hover:shadow-lg`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accent.icon}`}>
                        <ModuleIcon name={m.icon} className="h-5 w-5" />
                      </span>
                      {attempted ? (
                        <LevelBadge config={config} score={mp.score} />
                      ) : (
                        <Badge variant="outline">Not started</Badge>
                      )}
                    </div>
                    <div className="pt-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Module {m.order} · weight {m.weight}
                      </p>
                      <CardTitle className="text-base">{m.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm leading-relaxed text-muted-foreground">{m.summary}</p>
                    <div className="flex items-center justify-between border-t pt-3 text-sm">
                      {attempted ? (
                        <span className="text-muted-foreground">
                          Quiz: <ScorePill score={mp.correct} total={mp.total} /> correct
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Learn · lab · quiz</span>
                      )}
                      <span className="inline-flex items-center gap-1 font-semibold text-primary">
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
