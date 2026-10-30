import { useState } from 'react';
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
  Input,
  Label,
} from '@databricks/appkit-ui/react';
import { Copy, GraduationCap, KeyRound } from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { fetchLearner, registerLearner, type LearnerSession } from '@/lib/api';

type Mode = 'new' | 'resume';

export function Onboarding() {
  const { config, signIn, notice } = useAppData();
  const { onboarding, branding } = config;
  const [mode, setMode] = useState<Mode>('new');
  const [values, setValues] = useState<Record<string, string>>({});
  const [codeInput, setCodeInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set after sign-up: the learner must see and save the code before entering the app.
  const [issued, setIssued] = useState<(LearnerSession & { code: string }) | null>(null);
  const [saved, setSaved] = useState(false);

  const missingRequired = onboarding.fields.some((f) => f.required && !values[f.key]?.trim());

  const signUp = async () => {
    setTouched(true);
    if (missingRequired) return;
    setBusy(true);
    setError('');
    try {
      setIssued(await registerLearner(values.org?.trim() ?? '', values.nickname?.trim() ?? ''));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Server unavailable: keep working on this browser only, with no code and nothing stored remotely.
  const continueLocally = () =>
    signIn({ org: values.org?.trim() ?? '', nickname: values.nickname?.trim() || null }, null);

  const resume = async () => {
    setBusy(true);
    setError('');
    try {
      const { learner, progress } = await fetchLearner(codeInput.trim());
      signIn(learner, codeInput.trim(), progress);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="text-center">
      <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg">
        <GraduationCap className="h-7 w-7 text-primary-foreground" />
      </span>
      <h1 className="text-3xl font-bold text-foreground">{branding.appName}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{branding.tagline}</p>
    </div>
  );

  if (issued) {
    return (
      <div className="app-bg flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          {header}
          <Card className="border-t-4 border-t-primary shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" /> Save your learner code
              </CardTitle>
              <CardDescription>
                This code is how you come back and how you prove your progress is yours. We do not store your name or email, so
                it cannot be recovered or reissued.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
                <code className="select-all text-lg font-semibold tracking-wider">{issued.code}</code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void navigator.clipboard?.writeText(issued.code).catch(() => undefined)}
                >
                  <Copy className="mr-1.5 h-4 w-4" />
                  Copy
                </Button>
              </div>
              <label className="flex items-start gap-2 text-sm text-muted-foreground">
                <input type="checkbox" className="mt-0.5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                <span>I have saved my learner code somewhere safe (a password manager is ideal).</span>
              </label>
              <Button className="w-full" disabled={!saved} onClick={() => signIn(issued.learner, issued.code, issued.progress)}>
                Start learning
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="app-bg flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {header}
        <Card className="border-t-4 border-t-primary shadow-xl">
          <CardHeader>
            <CardTitle>{mode === 'new' ? onboarding.heading : 'Welcome back'}</CardTitle>
            <CardDescription>
              {mode === 'new' ? onboarding.subheading : 'Enter the learner code you saved when you signed up.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Sign up or sign in">
              {(
                [
                  ['new', 'I\u2019m new here'],
                  ['resume', 'I have a learner code'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => {
                    setMode(m);
                    setError('');
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {notice ? (
              <Alert>
                <AlertTitle>Signed out</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>{mode === 'new' ? 'Could not sign up' : 'Could not sign in'}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {mode === 'new' ? (
              <>
                <Alert>
                  <AlertTitle>Been here before?</AlertTitle>
                  <AlertDescription>
                    Choose &ldquo;I have a learner code&rdquo; to pick up your progress. Signing up again starts from zero and
                    leaves an unused record behind (deleted after {config.privacy.retentionDays} days).
                  </AlertDescription>
                </Alert>
                {onboarding.fields.map((field) => {
                  const showError = touched && field.required && !values[field.key]?.trim();
                  return (
                    <div key={field.key} className="space-y-1.5">
                      <Label htmlFor={field.key}>
                        {field.label}
                        {field.required ? <span className="text-destructive"> *</span> : null}
                      </Label>
                      <Input
                        id={field.key}
                        type={field.type}
                        placeholder={field.placeholder}
                        maxLength={field.key === 'nickname' ? 40 : 200}
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                        aria-invalid={showError}
                      />
                      {showError ? <p className="text-xs text-destructive">{field.label} is required.</p> : null}
                    </div>
                  );
                })}
                <Button className="w-full" onClick={() => void signUp()} disabled={busy || (touched && missingRequired)}>
                  {busy ? 'Creating…' : 'Start learning'}
                </Button>
                {error ? (
                  <Button className="w-full" variant="secondary" onClick={continueLocally} disabled={missingRequired}>
                    Continue on this browser only
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="code">Learner code</Label>
                  <Input
                    id="code"
                    autoComplete="off"
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                  />
                </div>
                <Button className="w-full" onClick={() => void resume()} disabled={busy || codeInput.trim().length < 16}>
                  {busy ? 'Checking…' : 'Continue'}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Lost your code? It can&apos;t be recovered because we hold no email or name. You&apos;ll need to sign up again.
                </p>
              </>
            )}

            <p className="text-center text-xs text-muted-foreground">
              We keep only your company, an optional nickname and your results. No name or email is collected. Inactive
              accounts are deleted after {config.privacy.retentionDays} days, and you can ask for deletion at any time from the
              Privacy page.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
