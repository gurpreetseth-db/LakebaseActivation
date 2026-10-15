import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { fetchDemo } from '@/lib/api';
import { Markdown } from '@/lib/Markdown';
import type { DemoContent } from '@/lib/types';

export function DemoPage() {
  const [demo, setDemo] = useState<DemoContent | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDemo()
      .then(setDemo)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load the demo</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!demo) return <p className="animate-pulse text-center text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">{demo.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{demo.intro}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {demo.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
              <Badge variant="outline" className="gap-1">
                {l.label}
                <ExternalLink className="h-3 w-3" />
              </Badge>
            </a>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{demo.disclaimer}</p>
      </div>

      {demo.sections.map((s) => (
        <Card key={s.key}>
          <CardHeader>
            <CardTitle className="text-base">{s.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {s.body.map((p) => (
              <Markdown key={p} text={p} />
            ))}
            {s.steps.length > 0 ? (
              <ol className="space-y-3">
                {s.steps.map((step, i) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    <div className="pt-0.5 text-sm text-muted-foreground">
                      <Markdown text={step} className="space-y-0" />
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
