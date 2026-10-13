/**
 * Loads and validates the externally-editable content files:
 *   - config/app.config.json      (single source of truth for all tunables)
 *   - config/content/modules.json (per-module learning collateral)
 *   - config/content/questions.json (the editable Q&A bank)
 *
 * Files are read at runtime from the project root so they can be edited and the
 * app republished without touching any TypeScript. All three are validated with
 * zod so a malformed edit fails loudly at startup instead of corrupting the UI.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const CONFIG_DIR = join(process.cwd(), 'config');

// ---------- Schemas ----------

const onboardingFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean(),
  placeholder: z.string().optional().default(''),
});

const maturityLevelSchema = z.object({
  key: z.string(),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  description: z.string(),
});

const moduleMetaSchema = z.object({
  key: z.string(),
  order: z.number(),
  title: z.string(),
  weight: z.number(),
  icon: z.string(),
  summary: z.string(),
  gating: z.boolean().default(false),
});

const questionTypeSchema = z.object({ label: z.string(), icon: z.string() });

// The schema name is interpolated into DDL/DML (identifiers can't be bound as
// parameters), so it is restricted to a safe Postgres identifier here.
const lakebaseSchema = z.object({
  enabled: z.boolean(),
  project: z.string(),
  branch: z.string(),
  database: z.string(),
  endpoint: z.string(),
  schema: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/, 'must be a lowercase Postgres identifier'),
});

export const appConfigSchema = z.object({
  lakebase: lakebaseSchema,
  fieldkit: z.object({
    enabled: z.boolean(),
    deckTitle: z.string(),
    edition: z.string(),
    /** Server-only: never sent to the browser. */
    deckId: z.string(),
    /** Slide numbers cleared for partners, e.g. "4-22,29-40". */
    approvedSlides: z.string().regex(/^\d+(-\d+)?(,\d+(-\d+)?)*$/, 'use numbers and ranges like "4-22,29-40"'),
    /** Server-only: slides inside the approved ranges that are withheld, with the reason. */
    heldSlides: z.record(z.string().regex(/^\d+$/), z.string()),
    imageDir: z.string().regex(/^[a-z0-9_-]+$/i),
  }),
  program: z.object({
    adminEmails: z.array(z.string().email()),
    leaderboard: z.object({ enabled: z.boolean(), topN: z.number().int().min(1).max(100) }),
    certificate: z.object({
      enabled: z.boolean(),
      requireAllModules: z.boolean(),
      title: z.string(),
      issuer: z.string(),
      signatory: z.string(),
    }),
    lakehouseSync: z.object({ catalog: z.string(), schema: z.string(), cdfConfigId: z.string() }),
  }),
  deployment: z.object({
    appName: z.string().regex(/^[a-z][a-z0-9-]{1,29}$/),
    description: z.string(),
    space: z.string(),
    sourcePath: z.string(),
  }),
  branding: z.object({
    appName: z.string(),
    shortName: z.string(),
    tagline: z.string(),
    org: z.string(),
    docsBaseUrl: z.string(),
  }),
  onboarding: z.object({
    enabled: z.boolean(),
    heading: z.string(),
    subheading: z.string(),
    fields: z.array(onboardingFieldSchema),
  }),
  scoring: z.object({
    passThreshold: z.number(),
    maturityLevels: z.array(maturityLevelSchema),
  }),
  ai: z.object({
    enabled: z.boolean(),
    endpointName: z.string(),
    embeddingEndpoint: z.string(),
    embeddingDimensions: z.number().int().min(8).max(4096),
    retrievalTopK: z.number().int().min(1).max(20),
    maxTokens: z.number(),
    temperature: z.number(),
  }),
  modules: z.array(moduleMetaSchema),
  questionTypes: z.record(z.string(), questionTypeSchema),
});

const docLinkSchema = z.object({ label: z.string(), path: z.string() });

const moduleContentSchema = z.object({
  objectives: z.array(z.string()),
  overview: z.array(z.string()),
  lab: z.object({
    title: z.string(),
    intro: z.string(),
    steps: z.array(z.string()),
  }),
  docLinks: z.array(docLinkSchema),
});

export const modulesContentSchema = z.object({
  modules: z.record(z.string(), moduleContentSchema),
});

const choiceSchema = z.object({ key: z.string(), text: z.string() });

const questionSchema = z.object({
  id: z.string(),
  moduleKey: z.string(),
  type: z.string(),
  prompt: z.string(),
  choices: z.array(choiceSchema),
  correctAnswer: z.string(),
  explanation: z.string(),
});

export const questionsSchema = z.object({ questions: z.array(questionSchema) });

export const fieldkitContentSchema = z.object({
  sections: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      summary: z.string(),
      takeaways: z.array(z.string()),
      modules: z.array(z.string()),
      slides: z.array(
        z.object({
          n: z.number().int().positive(),
          title: z.string(),
          expectTitle: z.string(),
          text: z.string(),
          note: z.string().optional(),
        }),
      ),
    }),
  ),
});

const demoSchema = z.object({
  title: z.string(),
  intro: z.string(),
  disclaimer: z.string(),
  links: z.array(z.object({ label: z.string(), url: z.string().url() })),
  sections: z.array(
    z.object({ key: z.string(), title: z.string(), body: z.array(z.string()), steps: z.array(z.string()) }),
  ),
});

const knowledgeSchema = z.object({
  /** doc path (relative to branding.docsBaseUrl) or absolute URL -> link label */
  docs: z.record(z.string(), z.string()),
  entries: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['fact', 'gotcha']),
      module: z.string(),
      title: z.string(),
      content: z.string(),
      docs: z.array(z.string()).default([]),
    }),
  ),
});

const pricingSchema = z.object({
  title: z.string(),
  intro: z.string(),
  pageUrl: z.string().url(),
  regions: z.array(z.object({ cloud: z.string(), region: z.string(), code: z.string() })),
  regionNote: z.string(),
  meters: z.array(z.object({ name: z.string(), unit: z.string(), detail: z.string() })),
  tips: z.array(z.string()),
  usageQuery: z.object({ title: z.string(), note: z.string(), sql: z.string() }),
});

const flagSchema = z.enum(['green', 'yellow', 'red']);

export const fitSchema = z.object({
  title: z.string(),
  intro: z.string(),
  questions: z.array(
    z.object({
      id: z.string(),
      prompt: z.string(),
      options: z.array(z.object({ key: z.string(), label: z.string(), flag: flagSchema, note: z.string() })).min(2),
    }),
  ),
  verdicts: z.object({
    good: z.object({ label: z.string(), summary: z.string() }),
    caution: z.object({ label: z.string(), summary: z.string(), yellowThreshold: z.number() }),
    notYet: z.object({ label: z.string(), summary: z.string() }),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type DemoContent = z.infer<typeof demoSchema>;
export type FieldkitContent = z.infer<typeof fieldkitContentSchema>;
export type FitContent = z.infer<typeof fitSchema>;
export type KnowledgeContent = z.infer<typeof knowledgeSchema>;
export type PricingContent = z.infer<typeof pricingSchema>;
export type ModulesContent = z.infer<typeof modulesContentSchema>;
export type Question = z.infer<typeof questionSchema>;

// ---------- Loading (cached) ----------

function readAndParse<T>(file: string, schema: z.ZodType<T>): T {
  const abs = join(CONFIG_DIR, file);
  let raw: string;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch {
    throw new Error(`Content file not found: ${abs}. It must ship with the app.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${file}: ${(err as Error).message}`);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new Error(`Validation failed for ${file}: ${result.error.message}`);
  }
  return result.data;
}

let configCache: AppConfig | null = null;
let modulesCache: ModulesContent | null = null;
let questionsCache: Question[] | null = null;
let demoCache: DemoContent | null = null;
let fitCache: FitContent | null = null;

let knowledgeCache: KnowledgeContent | null = null;
let pricingCache: PricingContent | null = null;

export function loadKnowledge(): KnowledgeContent {
  if (!knowledgeCache) knowledgeCache = readAndParse('content/knowledge.json', knowledgeSchema);
  return knowledgeCache;
}

export function loadPricing(): PricingContent {
  if (!pricingCache) pricingCache = readAndParse('content/pricing.json', pricingSchema);
  return pricingCache;
}

let fieldkitCache: FieldkitContent | null = null;

export function loadFieldkitRaw(): FieldkitContent {
  if (!fieldkitCache) fieldkitCache = readAndParse('content/fieldkit.json', fieldkitContentSchema);
  return fieldkitCache;
}

export function loadDemo(): DemoContent {
  if (!demoCache) demoCache = readAndParse('content/demo.json', demoSchema);
  return demoCache;
}

export function loadFit(): FitContent {
  if (!fitCache) fitCache = readAndParse('content/fit.json', fitSchema);
  return fitCache;
}

export function loadConfig(): AppConfig {
  if (!configCache) configCache = readAndParse('app.config.json', appConfigSchema);
  return configCache;
}

export function loadModules(): ModulesContent {
  if (!modulesCache) modulesCache = readAndParse('content/modules.json', modulesContentSchema);
  return modulesCache;
}

export function loadQuestions(): Question[] {
  if (!questionsCache) questionsCache = readAndParse('content/questions.json', questionsSchema).questions;
  return questionsCache;
}
