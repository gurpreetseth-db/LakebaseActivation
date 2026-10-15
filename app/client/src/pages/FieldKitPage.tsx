import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from '@databricks/appkit-ui/react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  GalleryHorizontal,
  Info,
  Maximize2,
} from 'lucide-react';
import { fetchFieldkit } from '@/lib/api';
import type { Fieldkit, FieldkitSlide } from '@/lib/types';

function SlideView({ slide, onFull }: { slide: FieldkitSlide; onFull: () => void }) {
  // The parent renders this with key={slide.image}, so the error state resets for every slide.
  const [broken, setBroken] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {broken ? (
        <div className="flex aspect-video flex-col justify-center gap-2 bg-muted p-6 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Slide image not available yet
          </p>
          <p className="text-foreground">{slide.title}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={onFull}
          className="group relative block w-full"
          aria-label="View slide full screen"
        >
          <img
            src={slide.image}
            alt={`Slide ${slide.n}: ${slide.title}`}
            onError={() => setBroken(true)}
            className="aspect-video w-full bg-muted object-contain"
          />
          <span className="absolute right-3 top-3 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-4 w-4" />
          </span>
        </button>
      )}
    </div>
  );
}

export function FieldKitPage() {
  const { section: sectionKey } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const [kit, setKit] = useState<Fieldkit | null>(null);
  const [error, setError] = useState('');
  const [full, setFull] = useState(false);
  const [view, setView] = useState<'slides' | 'pdf'>('slides');
  const [pdfReady, setPdfReady] = useState(false);

  useEffect(() => {
    fetchFieldkit()
      .then(setKit)
      .catch((e: Error) => setError(e.message));
  }, []);

  // A missing file is answered with the app's HTML page, so check it is really a PDF before offering it.
  useEffect(() => {
    if (!kit) return;
    fetch(kit.pdf, { method: 'HEAD' })
      .then((r) => setPdfReady(r.ok && (r.headers.get('content-type') ?? '').includes('pdf')))
      .catch(() => setPdfReady(false));
  }, [kit]);

  const section = useMemo(() => kit?.sections.find((s) => s.key === sectionKey) ?? kit?.sections[0], [kit, sectionKey]);
  const slides = section?.slides ?? [];
  const wanted = Number(search.get('slide'));
  const index = Math.max(
    0,
    slides.findIndex((s) => s.n === wanted)
  );
  const slide = slides[index];

  const go = useCallback(
    (i: number) => {
      const target = slides[Math.min(Math.max(i, 0), slides.length - 1)];
      if (target) setSearch({ slide: String(target.n) }, { replace: true });
    },
    [slides, setSearch]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load the Field Kit</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!kit || !section) return <p className="animate-pulse text-center text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">
          {kit.deckTitle} <span className="text-base font-normal text-muted-foreground">· {kit.edition}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Selected slides from the Databricks Lakebase Field Kit. Where a slide differs from the current documentation,
          the documentation applies — affected slides carry a note.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="tablist" aria-label="View">
          <Button
            size="sm"
            variant={view === 'slides' ? 'default' : 'ghost'}
            role="tab"
            aria-selected={view === 'slides'}
            onClick={() => setView('slides')}
          >
            <GalleryHorizontal className="mr-1.5 h-4 w-4" />
            Slides
          </Button>
          <Button
            size="sm"
            variant={view === 'pdf' ? 'default' : 'ghost'}
            role="tab"
            aria-selected={view === 'pdf'}
            disabled={!pdfReady}
            title={pdfReady ? undefined : 'The PDF has not been published yet'}
            onClick={() => setView('pdf')}
          >
            <FileText className="mr-1.5 h-4 w-4" />
            PDF
          </Button>
        </div>
        {pdfReady ? (
          <Button asChild size="sm" variant="outline">
            <a href={kit.pdf} download>
              <Download className="mr-1.5 h-4 w-4" />
              Download PDF ({kit.sections.reduce((n, x) => n + x.slides.length, 0)} slides)
            </a>
          </Button>
        ) : null}
      </div>

      {view === 'pdf' && pdfReady ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <iframe
            src={`${kit.pdf}#view=FitH`}
            title={`${kit.deckTitle} — selected slides`}
            className="h-[75vh] w-full"
          />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <nav
            aria-label="Field Kit sections"
            className="nav-scroll flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
          >
            {kit.sections.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  void navigate(`/fieldkit/${s.key}`);
                }}
                className={`shrink-0 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  s.key === section.key
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'bg-card text-foreground hover:border-primary/50'
                }`}
              >
                <span className="block font-medium">{s.title}</span>
                <span
                  className={`text-xs ${s.key === section.key ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}
                >
                  {s.slides.length} slides
                </span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 space-y-5">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{section.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{section.summary}</p>
                <ul className="ml-5 list-disc space-y-1 text-foreground">
                  {section.takeaways.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {slide ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">
                    {slide.title} <span className="text-muted-foreground">· slide {slide.n}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {index + 1} of {slides.length}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      disabled={index === 0}
                      onClick={() => go(index - 1)}
                      aria-label="Previous slide"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      disabled={index === slides.length - 1}
                      onClick={() => go(index + 1)}
                      aria-label="Next slide"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <SlideView key={slide.image} slide={slide} onFull={() => setFull(true)} />

                {slide.note ? (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Note</AlertTitle>
                    <AlertDescription>{slide.note}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="nav-scroll flex gap-2 overflow-x-auto pb-1" aria-label="Slides in this section">
                  {slides.map((s, i) => (
                    <button
                      key={s.n}
                      type="button"
                      onClick={() => go(i)}
                      className={`shrink-0 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                        i === index
                          ? 'border-primary bg-accent text-accent-foreground'
                          : 'bg-card text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      <Badge variant="outline" className="mr-1.5">
                        {s.n}
                      </Badge>
                      {s.title}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {full && slide ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Slide ${slide.n}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setFull(false)}
        >
          <img
            src={slide.image}
            alt={`Slide ${slide.n}: ${slide.title}`}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}
