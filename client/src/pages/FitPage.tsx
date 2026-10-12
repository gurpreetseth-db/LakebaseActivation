import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
} from '@databricks/appkit-ui/react';
import { ArrowLeft } from 'lucide-react';
import { evaluateFit, fetchFit } from '@/lib/api';
import type { FitContent, FitResult, Flag } from '@/lib/types';

const flagStyle: Record<Flag, string> = {
  green: 'border-success/50 bg-success/10',
  yellow: 'border-warning/50 bg-warning/10',
  red: 'border-destructive/50 bg-destructive/10',
};

export function FitPage() {
  const [fit, setFit] = useState<FitContent | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<FitResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchFit()
      .then(setFit)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!fit) {
    return error ? (
      <div className="mx-auto max-w-3xl">
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load the fit-checker</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    ) : (
      <p className="animate-pulse text-center text-sm text-muted-foreground">Loading…</p>
    );
  }

  const complete = fit.questions.every((q) => answers[q.id]);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await evaluateFit(answers));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
        <h1 className="text-2xl font-bold text-foreground">{fit.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{fit.intro}</p>
      </div>

      {result ? (
        <>
          <Alert variant={result.verdict === 'notYet' ? 'destructive' : 'default'}>
            <AlertTitle className="flex items-center gap-2">
              {result.label}
              <Badge variant="secondary">
                {result.counts.green} green · {result.counts.yellow} yellow · {result.counts.red} red
              </Badge>
            </AlertTitle>
            <AlertDescription>{result.summary}</AlertDescription>
          </Alert>
          {result.findings
            .filter((f) => f.flag !== 'green')
            .map((f) => (
              <Card key={f.questionId} className={flagStyle[f.flag]}>
                <CardContent className="space-y-1 pt-4 text-sm">
                  <p className="font-semibold text-foreground">{f.prompt}</p>
                  <p className="text-muted-foreground">Your answer: {f.answer}</p>
                  <p className="text-foreground">{f.note}</p>
                </CardContent>
              </Card>
            ))}
          <Button
            variant="secondary"
            onClick={() => {
              setResult(null);
              setAnswers({});
            }}
          >
            Start over
          </Button>
        </>
      ) : (
        <>
          {fit.questions.map((q, idx) => (
            <Card key={q.id}>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Question {idx + 1} of {fit.questions.length}
                </CardTitle>
                <p className="pt-1 text-base font-semibold text-foreground">{q.prompt}</p>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={answers[q.id] ?? ''}
                  onValueChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                  className="space-y-2"
                >
                  {q.options.map((o) => (
                    <div key={o.key} className="flex items-start gap-3 rounded-md border p-3">
                      <RadioGroupItem value={o.key} id={`${q.id}-${o.key}`} className="mt-0.5" />
                      <Label htmlFor={`${q.id}-${o.key}`} className="flex-1 cursor-pointer font-normal leading-relaxed">
                        {o.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </CardContent>
            </Card>
          ))}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t evaluate</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button onClick={() => void run()} disabled={!complete || busy}>
            {busy ? 'Checking…' : `Check fit (${Object.keys(answers).length}/${fit.questions.length})`}
          </Button>
        </>
      )}
    </div>
  );
}
