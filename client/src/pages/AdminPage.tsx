import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { ArrowLeft, Download } from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { fetchAdminSummary } from '@/lib/api';
import type { AdminSummary } from '@/lib/types';

const stat = (label: string, value: number | string) => (
  <Card key={label}>
    <CardContent className="pt-4">
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </CardContent>
  </Card>
);

export function AdminPage() {
  const { isAdmin, config } = useAppData();
  const [s, setS] = useState<AdminSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    fetchAdminSummary()
      .then(setS)
      .catch((e: Error) => setError(e.message));
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert variant="destructive">
          <AlertTitle>Admin access required</AlertTitle>
          <AlertDescription>Your signed-in Databricks identity is not on the program admin list.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Dashboard
            </Link>
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Program admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">Cohort progress, weak topics and learner questions.</p>
        </div>
        <Button asChild variant="secondary">
          <a href="/api/admin/partners.csv">
            <Download className="mr-1.5 h-4 w-4" />
            Export CSV
          </a>
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load admin data</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {s ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
            {stat('Partners', s.totals.partners)}
            {stat('Organizations', s.totals.organizations)}
            {stat('Active learners', s.totals.active)}
            {stat('Average readiness', `${s.totals.avgOverall}/100`)}
            {config.program.certificate.enabled ? stat('Certified', s.totals.certified) : null}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Modules</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Module</th>
                    <th className="pr-3">Learners</th>
                    <th className="pr-3">Avg score</th>
                    <th className="pr-3">Pass rate</th>
                    <th>Retakes</th>
                  </tr>
                </thead>
                <tbody>
                  {s.modules.map((m) => (
                    <tr key={m.key} className="border-t">
                      <td className="py-1.5 pr-3">{m.title}</td>
                      <td className="pr-3">{m.learners}</td>
                      <td className="pr-3">{m.avgScore ?? '—'}</td>
                      <td className="pr-3">{m.passRate === null ? '—' : `${m.passRate}%`}</td>
                      <td>{m.retakes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Hardest questions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {s.hardestQuestions.length === 0 ? (
                  <p className="text-muted-foreground">No quiz data yet.</p>
                ) : (
                  s.hardestQuestions.map((q) => (
                    <div key={q.id} className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">
                        <span className="font-mono text-xs">{q.id}</span> {q.prompt}
                      </span>
                      <Badge variant={(q.accuracy ?? 100) < 50 ? 'destructive' : 'secondary'}>{q.accuracy}%</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent questions to Ask Lakebase</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm text-muted-foreground">
                {s.recentQuestions.length === 0 ? <p>None yet.</p> : s.recentQuestions.map((q) => <p key={q.createdAt + q.question}>• {q.question}</p>)}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Partners</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Name</th>
                    <th className="pr-3">Organization</th>
                    <th className="pr-3">Modules</th>
                    <th className="pr-3">Overall</th>
                    <th className="pr-3">Level</th>
                    <th>Certified</th>
                  </tr>
                </thead>
                <tbody>
                  {s.partners.map((p) => (
                    <tr key={p.email} className="border-t">
                      <td className="py-1.5 pr-3">
                        {p.name}
                        <span className="block text-xs text-muted-foreground">{p.email}</span>
                      </td>
                      <td className="pr-3">{p.org}</td>
                      <td className="pr-3">{p.modulesDone}</td>
                      <td className="pr-3">{p.overall}</td>
                      <td className="pr-3">{p.level}</td>
                      <td>{p.certified ? <Badge>Yes</Badge> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
