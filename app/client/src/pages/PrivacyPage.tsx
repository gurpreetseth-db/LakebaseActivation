import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { ArrowLeft, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { fetchLearner, requestErasure } from '@/lib/api';
import { loadCode } from '@/lib/storage';

export function PrivacyPage() {
  const { config, learner, signOut, resetProgress } = useAppData();
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasCode = Boolean(loadCode());

  useEffect(() => {
    if (!hasCode) return;
    fetchLearner()
      .then((r) => setPending(r.pendingErasure))
      .catch(() => undefined);
  }, [hasCode]);

  const requestDeletion = async () => {
    if (!confirm('Ask the program admin to permanently erase all data held about you?\n\nThis cannot be undone once approved.')) return;
    setBusy(true);
    setError('');
    try {
      await requestErasure();
      setPending(true);
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
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <ShieldCheck className="h-6 w-6" /> Privacy and your data
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What we hold about you</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Your company (<strong>{learner?.org ?? '—'}</strong>)
              {learner?.nickname ? (
                <>
                  {' '}
                  and nickname (<strong>{learner.nickname}</strong>)
                </>
              ) : null}
              .
            </li>
            <li>Your quiz scores and answers, lab progress and the questions you ask Ask Lakebase.</li>
            <li>A random learner id and a one-way hash of your learner code. Not your name, not your email.</li>
          </ul>
          <p>
            Used only to show your progress and to give the program team company-level counts. Learners inactive for{' '}
            {config.privacy.retentionDays} days are deleted automatically, and Ask Lakebase questions are deleted after{' '}
            {config.privacy.retentionDays} days. Please don&apos;t put personal data in your questions.
          </p>
          {!hasCode ? (
            <p>You are using this browser only, so nothing about you is stored on the server.</p>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {hasCode ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delete my data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {pending ? (
              <Alert>
                <AlertTitle>Deletion requested</AlertTitle>
                <AlertDescription>
                  The program admin has been asked to erase your data. Once approved, your learner code will stop working and you
                  will be signed out.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Sends a request to the program admin to erase everything held about you (profile, results, questions). Because
                  we hold no name or email, the request is matched using your learner id only.
                </p>
                <Button variant="destructive" disabled={busy} onClick={() => void requestDeletion()}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Request deletion of my data
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">On this device</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Button
            variant="secondary"
            onClick={() => {
              if (confirm('Delete your saved module results and lab progress? Your account stays.')) resetProgress();
            }}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Reset my results
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (confirm('Sign out of this device? You will need your learner code to come back.')) signOut();
            }}
          >
            <LogOut className="mr-1.5 h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
