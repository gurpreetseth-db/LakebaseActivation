import type {
  AdminSummary,
  AppConfig,
  LeaderboardResponse,
  DemoContent,
  Fieldkit,
  FitContent,
  FitResult,
  GradeResponse,
  LabProgress,
  AskResponse,
  KnowledgeStatus,
  LakebaseStatus,
  ModulesContent,
  Learner,
  Pitfall,
  PricingContent,
  Progress,
  Question,
} from './types';
import { loadCode } from './storage';

/** The learner code is the only credential; it is sent as a header, never in a URL. */
function authHeaders(): Record<string, string> {
  const code = loadCode();
  return code ? { 'x-learner-code': code } : {};
}

const jsonAuth = (): Record<string, string> => ({ 'Content-Type': 'application/json', ...authHeaders() });

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
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

export async function fetchIsAdmin(): Promise<boolean> {
  const res = await fetch('/api/admin/me');
  return res.ok ? ((await res.json()) as { admin: boolean }).admin : false;
}

export function fetchAdminSummary(): Promise<AdminSummary> {
  return getJson<AdminSummary>('/api/admin/summary');
}

export function fetchLeaderboard(): Promise<LeaderboardResponse> {
  return getJson<LeaderboardResponse>('/api/leaderboard');
}

export async function setLeaderboardOptIn(optIn: boolean, nickname?: string): Promise<void> {
  const res = await fetch('/api/leaderboard/opt-in', {
    method: 'PUT',
    headers: jsonAuth(),
    body: JSON.stringify({ optIn, nickname }),
  });
  if (!res.ok) throw new Error(`Could not update leaderboard preference: ${res.status}`);
}

export function fetchPricing(): Promise<PricingContent> {
  return getJson<PricingContent>('/api/content/pricing');
}

export async function fetchPitfalls(): Promise<Pitfall[]> {
  return (await getJson<{ pitfalls: Pitfall[] }>('/api/content/pitfalls')).pitfalls;
}

export function fetchKnowledgeStatus(): Promise<KnowledgeStatus> {
  return getJson<KnowledgeStatus>('/api/knowledge/status');
}

export async function askLakebase(question: string): Promise<AskResponse> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: jsonAuth(),
    body: JSON.stringify({ question }),
  });
  const data = (await res.json()) as AskResponse & { error?: string };
  if (!res.ok) throw new Error(data.error || `Ask failed: ${res.status}`);
  return data;
}

export function fetchFieldkit(): Promise<Fieldkit> {
  return getJson<Fieldkit>('/api/content/fieldkit');
}

export function fetchDemo(): Promise<DemoContent> {
  return getJson<DemoContent>('/api/content/demo');
}

export function fetchFit(): Promise<FitContent> {
  return getJson<FitContent>('/api/content/fit');
}

export async function evaluateFit(answers: Record<string, string>): Promise<FitResult> {
  const res = await fetch('/api/fit/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) throw new Error(`Fit evaluation failed: ${res.status}`);
  return (await res.json()) as FitResult;
}

export async function fetchLabs(): Promise<LabProgress> {
  const data = await getJson<{ labs: LabProgress }>('/api/labs');
  return data.labs;
}

export async function saveLab(moduleKey: string, steps: number[]): Promise<void> {
  const res = await fetch('/api/labs', {
    method: 'PUT',
    headers: jsonAuth(),
    body: JSON.stringify({ moduleKey, steps }),
  });
  if (!res.ok) throw new Error(`Lab save failed: ${res.status}`);
}

export async function explainAnswer(questionId: string, given: string): Promise<string> {
  const res = await fetch('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, given }),
  });
  const data = (await res.json()) as { explanation?: string; error?: string };
  if (!res.ok) throw new Error(data.error || `Explanation failed: ${res.status}`);
  return data.explanation ?? '';
}

export function fetchLakebaseStatus(): Promise<LakebaseStatus> {
  return getJson<LakebaseStatus>('/api/lakebase/status');
}

export interface LearnerSession {
  learner: Learner;
  progress: Progress;
}

/** Signs up with a company (and optional nickname). The returned code is shown once and must be saved. */
export async function registerLearner(org: string, nickname: string): Promise<LearnerSession & { code: string }> {
  const res = await fetch('/api/learner/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ org, nickname: nickname || undefined }),
  });
  const data = (await res.json().catch(() => ({}))) as LearnerSession & { code: string; error?: string };
  if (!res.ok) throw new Error(data.error || `Sign-up failed: ${res.status}`);
  return data;
}

export class UnknownCodeError extends Error {}

/** Loads the profile and saved progress for a code (pass one to resume on a new device). */
export async function fetchLearner(code?: string): Promise<LearnerSession & { pendingErasure: boolean }> {
  const res = await fetch('/api/learner/me', { headers: code ? { 'x-learner-code': code } : authHeaders() });
  if (res.status === 401) throw new UnknownCodeError('That learner code was not recognised');
  if (!res.ok) throw new Error(`Sign-in failed: ${res.status}`);
  return (await res.json()) as LearnerSession & { pendingErasure: boolean };
}

export async function resetRemoteProgress(): Promise<void> {
  const res = await fetch('/api/progress', { method: 'DELETE', headers: authHeaders() });
  if (!res.ok && res.status !== 503 && res.status !== 401) throw new Error(`Reset failed: ${res.status}`);
}

/** Asks the program admin to erase everything held about this learner. */
export async function requestErasure(): Promise<void> {
  const res = await fetch('/api/data-request', { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error(`Could not send the request: ${res.status}`);
}

export async function eraseRequest(id: number): Promise<void> {
  const res = await fetch(`/api/admin/data-requests/${id}/erase`, { method: 'POST' });
  if (!res.ok) throw new Error(`Erase failed: ${res.status}`);
}

export async function gradeModule(moduleKey: string, answers: Record<string, string>): Promise<GradeResponse> {
  const res = await fetch('/api/quiz/grade', {
    method: 'POST',
    headers: jsonAuth(),
    body: JSON.stringify({
      moduleKey,
      answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer })),
    }),
  });
  if (!res.ok) throw new Error(`Grading failed: ${res.status}`);
  return (await res.json()) as GradeResponse;
}
