import type {
  AdminSummary,
  AppConfig,
  CertificateData,
  LeaderboardResponse,
  DemoContent,
  FitContent,
  FitResult,
  GradeResponse,
  LabProgress,
  AskResponse,
  KnowledgeStatus,
  LakebaseStatus,
  ModulesContent,
  Partner,
  Pitfall,
  PricingContent,
  Progress,
  Question,
} from './types';

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

export async function fetchIsAdmin(): Promise<boolean> {
  const res = await fetch('/api/admin/me');
  return res.ok ? ((await res.json()) as { admin: boolean }).admin : false;
}

export function fetchAdminSummary(): Promise<AdminSummary> {
  return getJson<AdminSummary>('/api/admin/summary');
}

export function fetchLeaderboard(email?: string): Promise<LeaderboardResponse> {
  return getJson<LeaderboardResponse>(`/api/leaderboard${email ? `?email=${encodeURIComponent(email)}` : ''}`);
}

export async function setLeaderboardOptIn(email: string, optIn: boolean): Promise<void> {
  const res = await fetch('/api/leaderboard/opt-in', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, optIn }),
  });
  if (!res.ok) throw new Error(`Could not update leaderboard preference: ${res.status}`);
}

export class NotEligibleError extends Error {
  reasons: string[];

  constructor(reasons: string[]) {
    super(reasons.join(' · '));
    this.reasons = reasons;
  }
}

export async function requestCertificate(email: string): Promise<CertificateData> {
  const res = await fetch('/api/certificate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = (await res.json()) as CertificateData & { error?: string; reasons?: string[] };
  if (res.status === 409) throw new NotEligibleError(data.reasons ?? [data.error ?? 'Not yet eligible']);
  if (!res.ok) throw new Error(data.error || `Certificate request failed: ${res.status}`);
  return data;
}

export async function verifyCertificate(id: string): Promise<(CertificateData & { valid: true }) | null> {
  const res = await fetch(`/api/certificate/verify/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Verification failed: ${res.status}`);
  return (await res.json()) as CertificateData & { valid: true };
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

export async function askLakebase(question: string, email?: string): Promise<AskResponse> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, email }),
  });
  const data = (await res.json()) as AskResponse & { error?: string };
  if (!res.ok) throw new Error(data.error || `Ask failed: ${res.status}`);
  return data;
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

export async function fetchLabs(email: string): Promise<LabProgress> {
  const data = await getJson<{ labs: LabProgress }>(`/api/labs?email=${encodeURIComponent(email)}`);
  return data.labs;
}

export async function saveLab(email: string, moduleKey: string, steps: number[]): Promise<void> {
  const res = await fetch('/api/labs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, moduleKey, steps }),
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

// Registers (or signs back in) a partner by email and returns saved progress.
export async function registerPartner(partner: Partner): Promise<{ partner: Partner; progress: Progress }> {
  const res = await fetch('/api/partner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partner),
  });
  if (!res.ok) throw new Error(`Partner sync failed: ${res.status}`);
  return (await res.json()) as { partner: Partner; progress: Progress };
}

export async function resetRemoteProgress(email: string): Promise<void> {
  const res = await fetch(`/api/progress?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 503) throw new Error(`Reset failed: ${res.status}`);
}

export async function gradeModule(
  moduleKey: string,
  answers: Record<string, string>,
  email?: string,
): Promise<GradeResponse> {
  const res = await fetch('/api/quiz/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
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
  partner: { name: string; email: string; org: string };
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
