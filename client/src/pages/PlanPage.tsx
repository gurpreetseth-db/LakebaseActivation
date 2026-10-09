import { useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { Markdown } from '@/lib/Markdown';
import { generatePlan } from '@/lib/api';
import { overallScore, levelForScore, completedCount, sortedModules } from '@/lib/scoring';

export function PlanPage() {
  const { config, partner, progress } = useAppData();
  const [plan, setPlan] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const overall = overallScore(config, progress);
  const level = levelForScore(config, overall);
  const done = completedCount(config, progress);
  const anyAttempted = done > 0;

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const markdown = await generatePlan({
        partner: { name: partner?.name ?? '', org: partner?.org ?? '' },
        overallScore: overall,
        overallLevel: level.label,
        modules: sortedModules(config).map((m) => {
          const mp = progress[m.key];
          return {
            title: m.title,
            score: mp?.attempted ? mp.score : 0,
            level: levelForScore(config, mp?.attempted ? mp.score : 0).label,
            attempted: Boolean(mp?.attempted),
          };
        }),
      });
      setPlan(markdown);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">{config.ai.planHeading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{config.ai.planDescription}</p>
      </div>

      {!config.ai.enabled ? (
        <Alert>
          <AlertTitle>AI plans are turned off</AlertTitle>
          <AlertDescription>Enable `ai.enabled` in app.config.json to generate adoption plans.</AlertDescription>
        </Alert>
      ) : !anyAttempted ? (
        <Empty>
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              Complete at least one module knowledge check to generate a personalized plan.
            </p>
            <Button asChild size="sm">
              <Link to="/">Go to modules</Link>
            </Button>
          </div>
        </Empty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Readiness: {overall}/100 ({level.label}) · {done}/{config.modules.length} modules completed
            </CardTitle>
            <CardDescription>
              Generated on behalf of your Databricks identity via {config.ai.endpointName}. AI-generated — verify before acting.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!plan && !loading ? (
              <Button onClick={() => void generate()}>
                <Sparkles className="mr-1.5 h-4 w-4" />
                Generate my plan
              </Button>
            ) : null}

            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Plan generation failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {plan && !loading ? (
              <>
                <div className="rounded-lg border bg-card p-5">
                  <Markdown text={plan} />
                </div>
                <Button variant="secondary" onClick={() => void generate()}>
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  Regenerate
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
