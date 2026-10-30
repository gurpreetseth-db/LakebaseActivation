import { Link } from 'react-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@databricks/appkit-ui/react';
import { ArrowLeft, BookOpen, ExternalLink, Send } from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { askLakebase, fetchKnowledgeStatus, fetchPitfalls } from '@/lib/api';
import { Markdown } from '@/lib/Markdown';
import type { AskResponse, KnowledgeStatus, Pitfall } from '@/lib/types';

interface Turn {
  question: string;
  answer?: AskResponse;
  error?: string;
}

const SUGGESTIONS = [
  'How does scale to zero work and what is the default timeout?',
  'When should I use synced tables versus Lakehouse Sync?',
  'Why do I get permission denied for my app schema?',
  'What workloads is Lakebase not a good fit for?',
];

export function AskPage() {
  const { config } = useAppData();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [pitfalls, setPitfalls] = useState<Pitfall[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchKnowledgeStatus()
      .then(setStatus)
      .catch(() => undefined);
    fetchPitfalls()
      .then(setPitfalls)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    setInput('');
    setBusy(true);
    setTurns((t) => [...t, { question: q }]);
    try {
      const answer = await askLakebase(q);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, answer } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: (e as Error).message } : x)));
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
        <h1 className="text-2xl font-bold text-foreground">Ask Lakebase</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Answers come from this app&apos;s modules, labs and curated Lakebase reference, retrieved from pgvector in Lakebase
          and cited so you can check them.
        </p>
        {status ? (
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={status.ready ? 'secondary' : 'outline'}>
              {status.ready ? `${status.chunks ?? status.total ?? 0} passages indexed` : 'Index warming up'}
            </Badge>
            <Badge variant="outline">{status.vector && status.embedded > 0 ? 'Semantic search' : 'Keyword search'}</Badge>
          </p>
        ) : null}
      </div>

      {!config.ai.enabled ? (
        <Alert>
          <AlertTitle>AI is turned off</AlertTitle>
          <AlertDescription>Enable `ai.enabled` in app.config.json to use Ask Lakebase.</AlertDescription>
        </Alert>
      ) : (
        <>
          {turns.length === 0 ? (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => void ask(s)}>
                  {s}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="space-y-4">
            {turns.map((t, i) => (
              <div key={`${i}-${t.question}`} className="space-y-2">
                <div className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {t.question}
                </div>
                <Card>
                  <CardContent className="pt-4">
                    {t.error ? (
                      <p className="text-sm text-destructive">{t.error}</p>
                    ) : t.answer ? (
                      <div className="space-y-3">
                        <Markdown text={t.answer.answer} />
                        {t.answer.citations.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 border-t pt-2">
                            <span className="mr-1 text-xs text-muted-foreground">Sources</span>
                            {t.answer.citations.map((c) => (
                              <Badge key={c.n} variant="outline" title={c.source}>
                                [{c.n}] {c.title}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                        {t.answer.links.length > 0 ? (
                          <div className="rounded-lg bg-accent/60 p-3">
                            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-accent-foreground">
                              <BookOpen className="h-3.5 w-3.5" />
                              Read more in the documentation
                            </p>
                            <ul className="space-y-1">
                              {t.answer.links.map((l) => (
                                <li key={l.url}>
                                  {l.url.startsWith('/') ? (
                                    <Link
                                      to={l.url}
                                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
                                    >
                                      {l.label}
                                    </Link>
                                  ) : (
                                    <a
                                      href={l.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
                                    >
                                      {l.label}
                                      <ExternalLink className="h-3 w-3" aria-hidden />
                                    </a>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="animate-pulse text-sm text-muted-foreground">Searching and thinking…</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about Lakebase…"
              maxLength={500}
              aria-label="Your question"
            />
            <Button type="submit" disabled={busy || input.trim().length < 3}>
              <Send className="mr-1.5 h-4 w-4" />
              Ask
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">AI-generated from the cited passages — verify before acting.</p>
        </>
      )}

      {pitfalls.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Common pitfalls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pitfalls.map((p) => (
              <details key={p.id} className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium text-foreground">{p.title}</summary>
                <p className="mt-2 text-sm text-muted-foreground">{p.content}</p>
                {p.docs.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {p.docs.map((d) => (
                      <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer">
                        <Badge variant="outline" className="gap-1">
                          {d.label}
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </Badge>
                      </a>
                    ))}
                  </div>
                ) : null}
              </details>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
