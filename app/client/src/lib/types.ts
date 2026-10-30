// Shapes returned by the server content APIs. Kept in sync with the zod schemas
// in server/content/loader.ts and the JSON files under config/.

export interface LakebaseTarget {
  enabled: boolean;
  project: string;
  branch: string;
  database: string;
  schema: string;
}

export interface LakebaseStatus extends LakebaseTarget {
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

export interface AppConfig {
  lakebase: LakebaseTarget & { endpoint: string };
  fieldkit: { enabled: boolean };
  program: {
    leaderboard: { enabled: boolean; topN: number };
  };
  privacy: { retentionDays: number };
  branding: { appName: string; shortName: string; tagline: string; org: string; docsBaseUrl: string };
  onboarding: {
    enabled: boolean;
    heading: string;
    subheading: string;
    fields: { key: string; label: string; type: string; required: boolean; placeholder: string }[];
  };
  scoring: {
    passThreshold: number;
    maturityLevels: { key: string; label: string; min: number; max: number; description: string }[];
  };
  ai: {
    enabled: boolean;
    endpointName: string;
    maxTokens: number;
    temperature: number;
  };
  modules: ModuleMeta[];
  questionTypes: Record<string, { label: string; icon: string }>;
}

export interface ModuleMeta {
  key: string;
  order: number;
  title: string;
  weight: number;
  icon: string;
  summary: string;
  gating: boolean;
}

export interface ModuleContent {
  objectives: string[];
  overview: string[];
  lab: { title: string; intro: string; steps: string[] };
  docLinks: { label: string; path: string; summary: string[] }[];
  docsCheckedOn?: string;
}

export type ModulesContent = Record<string, ModuleContent>;

// Question as sent to the browser (answer + explanation stripped).
export interface Question {
  id: string;
  moduleKey: string;
  type: string;
  prompt: string;
  choices: { key: string; text: string }[];
}

export interface GradeResultItem {
  questionId: string;
  given: string | null;
  correct: boolean;
  correctAnswer: string;
  explanation: string;
}

export interface GradeResponse {
  moduleKey: string;
  total: number;
  correct: number;
  score: number;
  results: GradeResultItem[];
}

export interface DemoContent {
  title: string;
  intro: string;
  disclaimer: string;
  links: { label: string; url: string }[];
  sections: { key: string; title: string; body: string[]; steps: string[] }[];
}

export type Flag = 'green' | 'yellow' | 'red';

export interface FitContent {
  title: string;
  intro: string;
  questions: { id: string; prompt: string; options: { key: string; label: string; flag: Flag; note: string }[] }[];
}

export interface FitResult {
  verdict: 'good' | 'caution' | 'notYet';
  label: string;
  summary: string;
  counts: Record<Flag, number>;
  findings: { questionId: string; prompt: string; answer: string; flag: Flag; note: string }[];
}

export type LabProgress = Record<string, { status: string; steps: number[] }>;

export interface Citation {
  n: number;
  title: string;
  source: string;
}

export interface DocLink {
  label: string;
  url: string;
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
  links: DocLink[];
  mode: 'vector' | 'keyword';
}

export interface KnowledgeStatus {
  ready: boolean;
  vector: boolean;
  chunks?: number;
  total?: number;
  embedded: number;
}

export interface Pitfall {
  id: string;
  title: string;
  content: string;
  module: string;
  docs: DocLink[];
}

export interface PricingContent {
  title: string;
  intro: string;
  pageUrl: string;
  regions: { cloud: string; region: string; code: string }[];
  regionNote: string;
  meters: { name: string; unit: string; detail: string }[];
  tips: string[];
  usageQuery: { title: string; note: string; sql: string };
}

export interface DataRequest {
  id: number;
  learnerId: string;
  org: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  completedBy: string | null;
}

export interface AdminSummary {
  totals: { learners: number; organizations: number; active: number; completed: number; avgOverall: number };
  modules: { key: string; title: string; learners: number; avgScore: number | null; passRate: number | null; retakes: number }[];
  hardestQuestions: { id: string; moduleKey: string; prompt: string; asked: number; accuracy: number | null }[];
  organizations: {
    org: string;
    learners: number;
    started: number;
    completed: number;
    avgModulesDone: number;
    avgOverall: number;
    level: string;
    lastActiveAt: string;
  }[];
  recentQuestions: { question: string; mode: string; createdAt: string }[];
  requests: DataRequest[];
}

export interface LeaderboardResponse {
  entries: { rank: number; name: string; org: string; overall: number; isMe: boolean }[];
  optedIn: boolean;
  total: number;
}

export interface FieldkitSlide {
  n: number;
  title: string;
  note?: string;
  image: string;
}

export interface FieldkitSection {
  key: string;
  title: string;
  summary: string;
  takeaways: string[];
  modules: string[];
  slides: FieldkitSlide[];
}

export interface Fieldkit {
  deckTitle: string;
  edition: string;
  pdf: string;
  sections: FieldkitSection[];
}

/** What the browser knows about the learner: no name, no email. The code lives in storage.ts. */
export interface Learner {
  org: string;
  nickname: string | null;
  leaderboardOptIn?: boolean;
}

export interface ModuleProgress {
  attempted: boolean;
  score: number;
  correct: number;
  total: number;
  answers: Record<string, string>;
  completedAt: string | null;
}

export type Progress = Record<string, ModuleProgress>;
