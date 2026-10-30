import { Link } from 'react-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { ArrowLeft, Trophy } from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { fetchLeaderboard, setLeaderboardOptIn } from '@/lib/api';
import { loadCode } from '@/lib/storage';
import type { LeaderboardResponse } from '@/lib/types';

export function LeaderboardPage() {
  const { config, learner } = useAppData();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [nickname, setNickname] = useState(learner?.nickname ?? '');
  const signedIn = Boolean(loadCode());

  const load = useCallback(() => {
    fetchLeaderboard()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const toggle = async () => {
    if (!signedIn || !data) return;
    setSaving(true);
    try {
      await setLeaderboardOptIn(!data.optedIn, nickname.trim());
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
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
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Trophy className="h-6 w-6" /> Leaderboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Top {config.program.leaderboard.topN} partners by weighted readiness. Only learners who opt in appear, shown by a nickname
          of their choice and their company. No real names are stored.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Leaderboard unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {data ? (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm">
              <span className="text-muted-foreground">
                {data.optedIn ? 'You are visible on the leaderboard.' : 'You are hidden from the leaderboard.'}
              </span>
              {!data.optedIn ? (
                <input
                  aria-label="Nickname"
                  className="h-8 w-44 rounded-md border bg-background px-2 text-sm"
                  placeholder="Nickname (optional)"
                  maxLength={40}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              ) : null}
              <Button size="sm" variant={data.optedIn ? 'secondary' : 'default'} disabled={saving || !signedIn} onClick={() => void toggle()}>
                {data.optedIn ? 'Hide me' : 'Show me on the leaderboard'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{data.total} partner(s) ranked</CardTitle>
            </CardHeader>
            <CardContent>
              {data.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody has opted in yet. Complete a module and be the first.</p>
              ) : (
                <ol className="divide-y">
                  {data.entries.map((e) => (
                    <li key={e.rank} className={`flex items-center gap-3 py-2 text-sm ${e.isMe ? 'font-semibold' : ''}`}>
                      <span className="w-8 text-muted-foreground">#{e.rank}</span>
                      <span className="flex-1">
                        {e.name} <span className="text-muted-foreground">· {e.org}</span>
                        {e.isMe ? <Badge className="ml-2">You</Badge> : null}
                      </span>
                      <span className="font-mono">{e.overall}/100</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
