// Shapes returned by the server content APIs. Kept in sync with the zod schemas
// in server/content/loader.ts and the JSON files under config/.

export interface AppConfig {
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
    planHeading: string;
    planDescription: string;
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
  docLinks: { label: string; path: string }[];
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

export interface Partner {
  name: string;
  email: string;
  org: string;
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
