import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
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
  Progress,
  RadioGroup,
  RadioGroupItem,
  Label,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@databricks/appkit-ui/react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  ListChecks,
  Presentation,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { ModuleIcon } from '@/lib/icons';
import { Markdown } from '@/lib/Markdown';
import { LevelBadge } from '@/components/common';
import { explainAnswer, fetchFieldkit, fetchLabs, gradeModule, saveLab } from '@/lib/api';
import { loadCode, loadLabsLocal, saveLabLocal } from '@/lib/storage';
import { shuffle } from '@/lib/shuffle';
import type { FieldkitSection, GradeResponse } from '@/lib/types';

export function ModulePage() {
  const { moduleKey = '' } = useParams();
  const { config, modules, questions, progress, learner, recordModule } = useAppData();

  const meta = config.modules.find((m) => m.key === moduleKey);
  const content = modules[moduleKey];
  const moduleQuestions = useMemo(
    () => questions.filter((q) => q.moduleKey === moduleKey),
    [questions, moduleKey],
  );
  const existing = progress[moduleKey];

  const [answers, setAnswers] = useState<Record<string, string>>(existing?.answers ?? {});
  const [graded, setGraded] = useState<GradeResponse | null>(null);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState('');
  // Bumped on every retake so question and choice order change between attempts.
  const [attempt, setAttempt] = useState(0);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [explaining, setExplaining] = useState('');
  const [labSteps, setLabSteps] = useState<number[]>(() => loadLabsLocal()[moduleKey] ?? []);
  const [labNote, setLabNote] = useState('');
  const [kitSections, setKitSections] = useState<FieldkitSection[]>([]);

  // Labs sync to the server only when signed in with a learner code.
  const synced = Boolean(learner) && Boolean(loadCode());
  useEffect(() => {
    if (!config.fieldkit.enabled) return;
    fetchFieldkit()
      .then((kit) => setKitSections(kit.sections.filter((s) => s.modules.includes(moduleKey))))
      .catch(() => setKitSections([]));
  }, [config.fieldkit.enabled, moduleKey]);

  useEffect(() => {
    if (!synced) return;
    fetchLabs()
      .then((labs) => {
        const remote = labs[moduleKey]?.steps;
        if (remote) setLabSteps(remote);
      })
      .catch(() => undefined);
  }, [synced, moduleKey]);

  const orderedQuestions = useMemo(
    () => (attempt === 0 ? moduleQuestions : shuffle(moduleQuestions, attempt * 7919 + moduleKey.length)),
    [moduleQuestions, attempt, moduleKey],
  );

  if (!meta || !content) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert variant="destructive">
          <AlertTitle>Module not found</AlertTitle>
          <AlertDescription>
            No module with key “{moduleKey}”. <Link className="underline" to="/">Back to dashboard</Link>.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const allAnswered = moduleQuestions.every((q) => answers[q.id]);

  const submit = async () => {
    setGrading(true);
    setError('');
    try {
      const result = await gradeModule(moduleKey, answers);
      setGraded(result);
      recordModule(moduleKey, {
        attempted: true,
        score: result.score,
        correct: result.correct,
        total: result.total,
        answers,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGrading(false);
    }
  };

  const toggleLabStep = (i: number) => {
    const next = labSteps.includes(i) ? labSteps.filter((n) => n !== i) : [...labSteps, i].sort((a, b) => a - b);
    setLabSteps(next);
    saveLabLocal(moduleKey, next);
    setLabNote('');
    if (synced) saveLab(moduleKey, next).catch(() => setLabNote('Saved on this device only.'));
  };

  const explain = async (questionId: string, given: string) => {
    setExplaining(questionId);
    try {
      const text = await explainAnswer(questionId, given);
      setExplanations((e) => ({ ...e, [questionId]: text }));
    } catch (err) {
      setExplanations((e) => ({ ...e, [questionId]: `Couldn’t generate an explanation: ${(err as Error).message}` }));
    } finally {
      setExplaining('');
    }
  };

  const retake = () => {
    setAttempt((n) => n + 1);
    setExplanations({});
    setGraded(null);
    setAnswers({});
    setError('');
  };

  const resultById = new Map(graded?.results.map((r) => [r.questionId, r]) ?? []);
  const typeMeta = (type: string) => config.questionTypes[type];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted">
            <ModuleIcon name={meta.icon} className="h-6 w-6 text-foreground" />
          </span>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Module {meta.order}</p>
            <h1 className="text-2xl font-bold text-foreground">{meta.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{meta.summary}</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="concept">
        <TabsList>
          <TabsTrigger value="concept">
            <BookOpen className="mr-1.5 h-4 w-4" /> Concept
          </TabsTrigger>
          <TabsTrigger value="lab">
            <FlaskConical className="mr-1.5 h-4 w-4" /> Hands-on lab
          </TabsTrigger>
          <TabsTrigger value="quiz">
            <ListChecks className="mr-1.5 h-4 w-4" /> Knowledge check
          </TabsTrigger>
        </TabsList>

        {/* Concept */}
        <TabsContent value="concept" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4" /> Learning objectives
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="ml-5 list-disc space-y-1.5 text-sm text-muted-foreground">
                {content.objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Overview</CardTitle>
            </CardHeader>
            <CardContent>
              {content.overview.map((p, i) => (
                <Markdown key={i} text={p} />
              ))}
              {kitSections.length > 0 ? (
                <>
                  <Separator className="my-4" />
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Field Kit slides</p>
                  <div className="flex flex-wrap gap-2">
                    {kitSections.map((s) => (
                      <Link key={s.key} to={`/fieldkit/${s.key}`}>
                        <Badge variant="secondary" className="gap-1">
                          <Presentation className="h-3 w-3" />
                          {s.title} · {s.slides.length} slides
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </>
              ) : null}
              {content.docLinks.length > 0 ? (
                <>
                  <Separator className="my-4" />
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Documentation at a glance</p>
                  <div className="space-y-4">
                    {content.docLinks.map((d) => (
                      <div key={d.path}>
                        <a
                          href={`${config.branding.docsBaseUrl}${d.path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          {d.label}
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                        {d.summary.length > 0 ? (
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {d.summary.map((b) => (
                              <li key={b}>{b}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {content.docsCheckedOn ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Summarised from the linked pages on {content.docsCheckedOn}. The documentation is the source of truth.
                    </p>
                  ) : null}
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Lab */}
        <TabsContent value="lab">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{content.lab.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{content.lab.intro}</p>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {labSteps.length} of {content.lab.steps.length} steps done (self-reported)
                  </span>
                  {labSteps.length === content.lab.steps.length ? <Badge>Lab complete</Badge> : null}
                </div>
                <Progress value={(labSteps.length / content.lab.steps.length) * 100} />
                {labNote ? <p className="mt-1 text-xs text-muted-foreground">{labNote}</p> : null}
              </div>
              <ol className="space-y-3">
                {content.lab.steps.map((step, i) => (
                  <li key={step} className="flex gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Mark step ${i + 1} done`}
                      checked={labSteps.includes(i)}
                      onChange={() => toggleLabStep(i)}
                      className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                    />
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    <div className="pt-0.5 text-sm text-muted-foreground">
                      <Markdown text={step} className="space-y-0" />
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Quiz */}
        <TabsContent value="quiz" className="space-y-5">
          {graded ? (
            <Alert variant={graded.score >= config.scoring.passThreshold ? 'default' : 'destructive'}>
              <AlertTitle className="flex items-center gap-2">
                Score: {graded.score}/100 ({graded.correct}/{graded.total} correct)
                <LevelBadge config={config} score={graded.score} />
              </AlertTitle>
              <AlertDescription>
                {graded.score >= config.scoring.passThreshold
                  ? 'Great work — you cleared the pass threshold for this module.'
                  : `Below the ${config.scoring.passThreshold} pass threshold. Review the explanations and retake.`}
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn’t grade the quiz</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {orderedQuestions.map((q, idx) => {
            const r = resultById.get(q.id);
            const selected = answers[q.id];
            const tm = typeMeta(q.type);
            const choices = attempt === 0 ? q.choices : shuffle(q.choices, attempt * 104729 + idx);
            return (
              <Card key={q.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Question {idx + 1} of {moduleQuestions.length}
                    </CardTitle>
                    {tm ? (
                      <Badge variant={q.type === 'gotcha' ? 'destructive' : 'secondary'}>{tm.label}</Badge>
                    ) : null}
                  </div>
                  <p className="pt-1 text-base font-semibold text-foreground">{q.prompt}</p>
                </CardHeader>
                <CardContent>
                  <RadioGroup
                    value={selected ?? ''}
                    onValueChange={(v) => !graded && setAnswers((a) => ({ ...a, [q.id]: v }))}
                    disabled={Boolean(graded)}
                    className="space-y-2"
                  >
                    {choices.map((c, ci) => {
                      const isCorrect = graded && r?.correctAnswer === c.key;
                      const isWrongPick = graded && r?.given === c.key && !r?.correct;
                      return (
                        <div
                          key={c.key}
                          className={`flex items-start gap-3 rounded-md border p-3 ${
                            isCorrect
                              ? 'border-success/50 bg-success/10'
                              : isWrongPick
                                ? 'border-destructive/50 bg-destructive/10'
                                : 'border-border'
                          }`}
                        >
                          <RadioGroupItem value={c.key} id={`${q.id}-${c.key}`} className="mt-0.5" />
                          <Label htmlFor={`${q.id}-${c.key}`} className="flex-1 cursor-pointer font-normal leading-relaxed">
                            <span className="font-semibold">{String.fromCharCode(65 + ci)}.</span> {c.text}
                          </Label>
                          {isCorrect ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : null}
                          {isWrongPick ? <XCircle className="mt-0.5 h-4 w-4 text-destructive" /> : null}
                        </div>
                      );
                    })}
                  </RadioGroup>
                  {graded && r ? (
                    <div className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">Explanation. </span>
                      {r.explanation}
                      {!r.correct && config.ai.enabled && r.given ? (
                        <div className="mt-2">
                          {explanations[q.id] ? (
                            <div className="rounded-md border bg-card p-3">
                              <Markdown text={explanations[q.id]} />
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={explaining === q.id}
                              onClick={() => void explain(q.id, r.given as string)}
                            >
                              <Sparkles className="mr-1.5 h-4 w-4" />
                              {explaining === q.id ? 'Thinking…' : 'Explain why I was wrong'}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}

          <div className="flex items-center gap-3">
            {graded ? (
              <>
                <Button onClick={retake} variant="secondary">
                  Retake quiz
                </Button>
                <Button asChild>
                  <Link to="/">Back to dashboard</Link>
                </Button>
              </>
            ) : (
              <Button onClick={() => void submit()} disabled={!allAnswered || grading}>
                {grading ? 'Grading…' : `Submit answers (${Object.keys(answers).length}/${moduleQuestions.length})`}
              </Button>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
