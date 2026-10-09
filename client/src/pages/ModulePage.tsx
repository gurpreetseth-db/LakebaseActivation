import { useMemo, useState } from 'react';
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
  Target,
  XCircle,
} from 'lucide-react';
import { useAppData } from '@/lib/AppData';
import { ModuleIcon } from '@/lib/icons';
import { Markdown } from '@/lib/Markdown';
import { LevelBadge } from '@/components/common';
import { gradeModule } from '@/lib/api';
import type { GradeResponse } from '@/lib/types';

export function ModulePage() {
  const { moduleKey = '' } = useParams();
  const { config, modules, questions, progress, recordModule } = useAppData();

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

  const retake = () => {
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
              {content.docLinks.length > 0 ? (
                <>
                  <Separator className="my-4" />
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Documentation</p>
                  <div className="flex flex-wrap gap-2">
                    {content.docLinks.map((d) => (
                      <a
                        key={d.path}
                        href={`${config.branding.docsBaseUrl}${d.path}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Badge variant="outline" className="gap-1">
                          {d.label}
                          <ExternalLink className="h-3 w-3" />
                        </Badge>
                      </a>
                    ))}
                  </div>
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
              <ol className="space-y-3">
                {content.lab.steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
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

          {moduleQuestions.map((q, idx) => {
            const r = resultById.get(q.id);
            const selected = answers[q.id];
            const tm = typeMeta(q.type);
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
                    {q.choices.map((c) => {
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
                            <span className="font-semibold">{c.key}.</span> {c.text}
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
