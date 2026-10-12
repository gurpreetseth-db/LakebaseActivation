import { Link } from 'react-router';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { ArrowLeft } from 'lucide-react';
import { useAppData } from '@/lib/AppData';

// Shows the live Lakebase target this app persists to. Every value is read from
// app.config.json via the server, so the page documents the real deployment.
export function LakebasePage() {
  const { config, lakebase } = useAppData();
  const t = lakebase ?? { ...config.lakebase, connected: false };
  const rows: [string, string][] = [
    ['Project', t.project],
    ['Branch', t.branch],
    ['Database', t.database],
    ['Schema', t.schema],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">How this app uses Lakebase</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your progress is stored in Lakebase Postgres, the same database you are learning about.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Live connection
            <Badge variant={t.connected ? 'default' : 'destructive'}>{t.connected ? 'Connected' : 'Offline'}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-all font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>
          {lakebase?.latencyMs !== undefined ? (
            <p className="text-muted-foreground">Round-trip query latency: {lakebase.latencyMs} ms</p>
          ) : null}
          {lakebase && !lakebase.connected ? (
            <Alert variant="destructive">
              <AlertTitle>Running in browser-only mode</AlertTitle>
              <AlertDescription>{lakebase.error ?? 'Lakebase is not reachable.'}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What is stored</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Tables in <code>{t.schema}</code>: <code>partners</code>, <code>module_progress</code>,{' '}
            <code>quiz_attempts</code>, <code>lab_checks</code> and <code>plans</code>.
          </p>
          <p>
            The app&apos;s service principal creates and owns the schema (deploy first), uses a pooled connection with automatic
            OAuth token refresh, and creates tables idempotently at startup.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
