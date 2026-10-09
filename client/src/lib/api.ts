import type { AppConfig, GradeResponse, ModulesContent, Question } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

export function fetchConfig(): Promise<AppConfig> {
  return getJson<AppConfig>('/api/config');
}

export async function fetchModules(): Promise<ModulesContent> {
  const data = await getJson<{ modules: ModulesContent }>('/api/content/modules');
  return data.modules;
}

export async function fetchQuestions(): Promise<Question[]> {
  const data = await getJson<{ questions: Question[] }>('/api/content/questions');
  return data.questions;
}

export async function gradeModule(
  moduleKey: string,
  answers: Record<string, string>,
): Promise<GradeResponse> {
  const res = await fetch('/api/quiz/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      moduleKey,
      answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer })),
    }),
  });
  if (!res.ok) throw new Error(`Grading failed: ${res.status}`);
  return (await res.json()) as GradeResponse;
}

export interface PlanModuleInput {
  title: string;
  score: number;
  level: string;
  attempted: boolean;
}

export async function generatePlan(input: {
  partner: { name: string; org: string };
  overallScore: number;
  overallLevel: string;
  modules: PlanModuleInput[];
}): Promise<string> {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { planMarkdown?: string; error?: string };
  if (!res.ok) throw new Error(data.error || `Plan generation failed: ${res.status}`);
  return data.planMarkdown ?? '';
}
