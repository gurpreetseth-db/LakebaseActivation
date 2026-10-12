import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '@databricks/appkit-ui/react';
import { verifyCertificate } from '@/lib/api';
import { CertificateView } from '@/pages/CertificatePage';
import type { CertificateData } from '@/lib/types';

// Public: anyone with the link can confirm a certificate is genuine (no sign-in).
export function VerifyPage() {
  const { id = '' } = useParams();
  const [state, setState] = useState<'loading' | 'valid' | 'invalid' | 'error'>('loading');
  const [cert, setCert] = useState<CertificateData | null>(null);

  useEffect(() => {
    verifyCertificate(id)
      .then((c) => {
        setCert(c);
        setState(c ? 'valid' : 'invalid');
      })
      .catch(() => setState('error'));
  }, [id]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      {state === 'loading' ? <p className="animate-pulse text-center text-sm text-muted-foreground">Verifying…</p> : null}
      {state === 'valid' && cert ? (
        <>
          <Alert>
            <AlertTitle>Valid certificate</AlertTitle>
            <AlertDescription>This certificate was issued by the program and is genuine.</AlertDescription>
          </Alert>
          <CertificateView cert={cert} />
        </>
      ) : null}
      {state === 'invalid' ? (
        <Alert variant="destructive">
          <AlertTitle>Certificate not found</AlertTitle>
          <AlertDescription>No certificate matches this ID.</AlertDescription>
        </Alert>
      ) : null}
      {state === 'error' ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t verify right now</AlertTitle>
          <AlertDescription>Please try again later.</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
