import { Link } from 'react-router';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from '@databricks/appkit-ui/react';
import { ArrowLeft, Award, Printer } from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { NotEligibleError, requestCertificate } from '@/lib/api';
import { completedCount, levelForScore, overallScore } from '@/lib/scoring';
import type { CertificateData } from '@/lib/types';

export function CertificateView({ cert }: { cert: CertificateData }) {
  return (
    <div className="rounded-lg border-4 border-double border-primary bg-card p-8 text-center shadow-sm print:border-black print:shadow-none">
      <Award className="mx-auto h-10 w-10 text-primary" />
      <p className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">{cert.issuer}</p>
      <h2 className="mt-2 text-2xl font-bold text-foreground">{cert.title}</h2>
      <p className="mt-6 text-sm text-muted-foreground">This certifies that</p>
      <p className="mt-1 text-3xl font-semibold text-foreground">{cert.name}</p>
      <p className="text-sm text-muted-foreground">{cert.org}</p>
      <p className="mt-4 text-sm text-foreground">
        achieved an overall readiness of <strong>{cert.overall}/100</strong> ({cert.level}) across all Lakebase modules.
      </p>
      <p className="mt-6 text-xs text-muted-foreground">
        Issued {new Date(cert.issuedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
      </p>
      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
        Certificate ID {cert.id} · verify at {window.location.origin}/verify/{cert.id}
      </p>
    </div>
  );
}

export function CertificatePage() {
  const { config, partner, progress } = useAppData();
  const [cert, setCert] = useState<CertificateData | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const overall = overallScore(config, progress);
  const done = completedCount(config, progress);

  const claim = async () => {
    if (!partner) return;
    setBusy(true);
    setError('');
    setReasons([]);
    try {
      setCert(await requestCertificate(partner.email));
    } catch (e) {
      if (e instanceof NotEligibleError) setReasons(e.reasons);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!config.program.certificate.enabled) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert>
          <AlertTitle>Certificates are turned off</AlertTitle>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="print:hidden">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Your certificate</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Earn it by completing {config.program.certificate.requireAllModules ? 'every module' : 'the modules'} with an overall
          score of at least {config.scoring.passThreshold}. Eligibility is checked on the server from your saved results.
        </p>
      </div>

      {cert ? (
        <>
          <CertificateView cert={cert} />
          <Button className="print:hidden" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" />
            Print or save as PDF
          </Button>
        </>
      ) : (
        <Card className="print:hidden">
          <CardContent className="space-y-3 pt-4 text-sm">
            <p className="text-muted-foreground">
              Progress: {done} of {config.modules.length} modules · overall {overall}/100 ({levelForScore(config, overall).label})
            </p>
            <Button onClick={() => void claim()} disabled={busy}>
              <Award className="mr-1.5 h-4 w-4" />
              {busy ? 'Checking…' : 'Claim my certificate'}
            </Button>
            {reasons.length > 0 ? (
              <Alert>
                <AlertTitle>Not yet eligible</AlertTitle>
                <AlertDescription>
                  <ul className="ml-4 list-disc">
                    {reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Couldn&apos;t issue the certificate</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
