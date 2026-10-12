import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { fetchPricing } from '@/lib/api';
import type { PricingContent } from '@/lib/types';

export function PricingPage() {
  const [p, setP] = useState<PricingContent | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPricing()
      .then(setP)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load pricing</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!p) return <p className="animate-pulse text-center text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">{p.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{p.intro}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current rates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">Rates change and differ by region, so this app does not copy them. Check your regions:</p>
          <div className="flex flex-wrap gap-2">
            {p.regions.map((r) => (
              <Badge key={r.code} variant="secondary">
                {r.cloud} · {r.region}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{p.regionNote}</p>
          <Button asChild>
            <a href={p.pageUrl} target="_blank" rel="noopener noreferrer">
              Open the official pricing page
              <ExternalLink className="ml-1.5 h-4 w-4" />
            </a>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {p.meters.map((m) => (
          <Card key={m.name}>
            <CardHeader>
              <CardTitle className="text-base">
                {m.name} <span className="text-xs font-normal text-muted-foreground">· {m.unit}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{m.detail}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Keeping costs down</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="ml-5 list-disc space-y-1.5 text-sm text-muted-foreground">
            {p.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{p.usageQuery.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{p.usageQuery.sql}</code>
          </pre>
          <p className="text-xs text-muted-foreground">{p.usageQuery.note}</p>
        </CardContent>
      </Card>
    </div>
  );
}
