import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { ArrowLeft, Download } from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { eraseRequest, fetchAdminSummary } from '@/lib/api';
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
  const { isAdmin } = useAppData();
  const [s, setS] = useState<AdminSummary | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    fetchAdminSummary()
      .then(setS)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin]);

  const erase = async (id: number, org: string) => {
    if (!confirm(`Permanently erase the learner from ${org} and everything linked to them? This cannot be undone.`)) return;
    try {
      await eraseRequest(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

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
          <p className="mt-1 text-sm text-muted-foreground">Progress by company, weak topics and deletion requests. Individuals are not identified.</p>
        </div>
        <Button asChild variant="secondary">
          <a href="/api/admin/organizations.csv">
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
            {stat('Learners', s.totals.learners)}
            {stat('Organizations', s.totals.organizations)}
            {stat('Active learners', s.totals.active)}
            {stat('Finished all modules', s.totals.completed)}
            {stat('Average readiness', `${s.totals.avgOverall}/100`)}
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
              <CardTitle className="text-base">Progress by organization</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Organization</th>
                    <th className="pr-3">Learners</th>
                    <th className="pr-3">Started</th>
                    <th className="pr-3">Finished all</th>
                    <th className="pr-3">Avg modules</th>
                    <th className="pr-3">Avg overall</th>
                    <th>Level</th>
                  </tr>
                </thead>
                <tbody>
                  {s.organizations.map((o) => (
                    <tr key={o.org} className="border-t">
                      <td className="py-1.5 pr-3">{o.org}</td>
                      <td className="pr-3">{o.learners}</td>
                      <td className="pr-3">{o.started}</td>
                      <td className="pr-3">{o.completed}</td>
                      <td className="pr-3">{o.avgModulesDone}</td>
                      <td className="pr-3">{o.avgOverall}</td>
                      <td>{o.level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Data deletion requests</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto text-sm">
              {s.requests.length === 0 ? (
                <p className="text-muted-foreground">No requests.</p>
              ) : (
                <table className="w-full">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Requested</th>
                      <th className="pr-3">Organization</th>
                      <th className="pr-3">Learner id</th>
                      <th className="pr-3">Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.requests.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="py-1.5 pr-3">{new Date(r.requestedAt).toLocaleDateString()}</td>
                        <td className="pr-3">{r.org}</td>
                        <td className="pr-3 font-mono text-xs">{r.learnerId.slice(0, 8)}…</td>
                        <td className="pr-3">
                          {r.status === 'pending' ? (
                            <Badge variant="destructive">Pending</Badge>
                          ) : (
                            <Badge variant="secondary">
                              Erased {r.completedAt ? new Date(r.completedAt).toLocaleDateString() : ''}
                            </Badge>
                          )}
                        </td>
                        <td className="text-right">
                          {r.status === 'pending' ? (
                            <Button size="sm" variant="destructive" onClick={() => void erase(r.id, r.org)}>
                              Erase
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Erasing removes the learner and all their results and questions. The request row stays as the erasure record
                (pseudonymous id, dates, approving admin).
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
