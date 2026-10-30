import type { Application } from 'express';
import { z } from 'zod';
import {
  loadConfig,
  loadDemo,
  loadFit,
  loadKnowledge,
  loadModules,
  loadPricing,
  loadQuestions,
  type AppConfig,
} from './content/loader.js';
import { evaluateFit } from './content/fit.js';
import { loadPublicFieldkit } from './content/fieldkit.js';
import type { Learner, Repo } from './db/repo.js';
import { buildAskPrompt, citationsFor, docLinksFor } from './knowledge/rag.js';
import { resolveDoc } from './knowledge/chunks.js';
import type { Hit, SearchMode } from './knowledge/store.js';
import { isAdmin, leaderboard, summarize, toCsv } from './program/admin.js';

const registerRequestSchema = z.object({
  org: z.string().trim().min(1).max(200),
  nickname: z.string().trim().max(40).optional(),
});

const gradeRequestSchema = z.object({
  moduleKey: z.string(),
  answers: z.array(z.object({ questionId: z.string(), answer: z.string() })),
});

const labRequestSchema = z.object({
  moduleKey: z.string(),
  steps: z.array(z.number().int().min(0).max(100)).max(100),
});

const explainRequestSchema = z.object({
  questionId: z.string(),
  given: z.string(),
});

const optInSchema = z.object({ optIn: z.boolean(), nickname: z.string().trim().max(40).optional() });

// Admin identity is the platform-injected x-forwarded-email (set by the Apps
// proxy, not by the visitor). Local dev can opt in with DEV_ADMIN_EMAIL.
function viewerEmail(req: { header: (n: string) => string | undefined }): string | undefined {
  const forwarded = req.header('x-forwarded-email');
  if (forwarded) return forwarded;
  return process.env.NODE_ENV === 'production' ? undefined : process.env.DEV_ADMIN_EMAIL;
}

const askRequestSchema = z.object({
  question: z.string().trim().min(3).max(500),
});

const fitRequestSchema = z.object({ answers: z.record(z.string(), z.string()) });

export function extractContent(response: unknown): string {
  // The serving plugin wraps the endpoint payload as { ok, data }. Unwrap it,
  // then read the OpenAI-style chat.completion content.
  const outer = response as { data?: unknown };
  const payload = (outer?.data ?? response) as {
    choices?: { message?: { content?: string } }[];
    predictions?: unknown;
  };
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (payload?.predictions)
    return typeof payload.predictions === 'string' ? payload.predictions : JSON.stringify(payload.predictions);
  return JSON.stringify(payload);
}

/** Everything the routes need from the outside world, so tests can inject fakes. */
export interface RoutesContext {
  config: AppConfig;
  /** null when Lakebase is disabled or unreachable (routes then degrade gracefully). */
  repo: Repo | null;
  dbError: string;
  knowledge: {
    ready: () => boolean;
    vector: () => boolean;
    stats: () => Promise<{ total: number; embedded: number }>;
    retrieve: (query: string, k: number) => Promise<{ mode: SearchMode; hits: Hit[] }>;
  };
  /** Calls the chat model on behalf of the signed-in user. */
  invokeLlm: (req: unknown, body: Record<string, unknown>) => Promise<unknown>;
}

export function registerRoutes(app: Application, ctx: RoutesContext): void {
  const { config, repo, dbError } = ctx;

  const requireRepo = (res: { status: (c: number) => { json: (b: unknown) => void } }): Repo | null => {
    if (!repo) {
      res.status(503).json({ error: `Lakebase unavailable: ${dbError}` });
      return null;
    }
    return repo;
  };

  // The learner code (x-learner-code header) is the only credential. It resolves to a learner id
  // server-side; the id and code never leave the database in clear.
  type HeaderReq = { header: (n: string) => string | undefined };
  const learnerOf = async (req: HeaderReq): Promise<Learner | null> => {
    if (!repo) return null;
    try {
      return await repo.authenticate(req.header('x-learner-code'));
    } catch {
      return null;
    }
  };
  const requireLearner = async (
    req: HeaderReq,
    res: { status: (c: number) => { json: (b: unknown) => void } },
  ): Promise<Learner | null> => {
    if (!requireRepo(res)) return null;
    const learner = await learnerOf(req);
    if (!learner) res.status(401).json({ error: 'Learner code missing or not recognised' });
    return learner;
  };
  const publicLearner = (l: Learner) => ({ org: l.org, nickname: l.nickname, leaderboardOptIn: l.leaderboardOptIn });

  // Sign-ups are anonymous, so cap them to stop someone flooding the database. The key is the LAST
  // x-forwarded-for hop, which the platform proxy appends; earlier hops are client-supplied and forgeable.
  const SIGNUPS_PER_CLIENT = 30;
  // A backstop far above real demand; the per-client limit is the main control. Hitting it is logged.
  const SIGNUPS_GLOBAL = 2000;
  const SIGNUP_WINDOW_MS = 3_600_000;
  const MAX_TRACKED_CLIENTS = 10_000;
  const signups = new Map<string, { count: number; resetAt: number }>();
  let globalSignups = { count: 0, resetAt: 0 };
  const clientKey = (req: HeaderReq & { ip?: string }): string => {
    const hops = (req.header('x-forwarded-for') ?? '').split(',').map((h) => h.trim()).filter(Boolean);
    return hops[hops.length - 1] || req.ip || 'unknown';
  };
  const signupAllowed = (key: string): boolean => {
    const now = Date.now();
    if (globalSignups.resetAt < now) globalSignups = { count: 0, resetAt: now + SIGNUP_WINDOW_MS };
    if (globalSignups.count >= SIGNUPS_GLOBAL) {
      if (globalSignups.count === SIGNUPS_GLOBAL) console.warn('[signup] global hourly sign-up ceiling reached; refusing new sign-ups');
      globalSignups.count += 1;
      return false;
    }
    // Keep the map bounded: drop expired entries once it grows, and refuse new clients if it is still full.
    if (signups.size >= MAX_TRACKED_CLIENTS) {
      for (const [k, v] of signups) if (v.resetAt < now) signups.delete(k);
      if (signups.size >= MAX_TRACKED_CLIENTS && !signups.has(key)) return false;
    }
    const e = signups.get(key);
    if (!e || e.resetAt < now) signups.set(key, { count: 1, resetAt: now + SIGNUP_WINDOW_MS });
    else if (e.count >= SIGNUPS_PER_CLIENT) return false;
    else e.count += 1;
    globalSignups.count += 1;
    return true;
  };

  // --- Lakebase connection status (target comes from config, never secrets) ---
  app.get('/api/lakebase/status', async (_req, res) => {
    const { enabled, project, branch, database, schema } = config.lakebase;
    const target = { enabled, project, branch, database, schema };
    if (!repo) {
      res.json({ ...target, connected: false, error: dbError });
      return;
    }
    try {
      res.json({ ...target, connected: true, latencyMs: await repo.ping() });
    } catch (err) {
      res.json({ ...target, connected: false, error: (err as Error).message });
    }
  });

  // --- Sign up: company (+ optional nickname) in, learner code out. The code is shown once. ---
  app.post('/api/learner/register', async (req, res) => {
    const parsed = registerRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please enter your company' });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    if (!signupAllowed(clientKey(req))) {
      res.status(429).json({ error: 'Too many sign-ups from this network; try again later' });
      return;
    }
    try {
      const { learner, code } = await r.register(parsed.data.org, parsed.data.nickname ?? null);
      res.set('Cache-Control', 'no-store').status(201).json({ learner: publicLearner(learner), code, progress: {} });
    } catch (err) {
      res.status(500).json({ error: `Could not sign up: ${(err as Error).message}` });
    }
  });

  // --- Resume with a learner code: profile, saved progress and whether a deletion is pending ---
  app.get('/api/learner/me', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner || !repo) return;
    try {
      const [progress, pendingErasure] = await Promise.all([repo.getProgress(learner.id), repo.hasPendingRequest(learner.id)]);
      res.set('Cache-Control', 'no-store').json({ learner: publicLearner(learner), progress, pendingErasure });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Reset the learner's own saved results (the learner record stays) ---
  app.delete('/api/progress', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner || !repo) return;
    try {
      await repo.deleteProgress(learner.id);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Ask the admin to erase everything held about this learner (GDPR erasure request) ---
  app.get('/api/data-request', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner || !repo) return;
    try {
      res.json({ pending: await repo.hasPendingRequest(learner.id) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.post('/api/data-request', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner || !repo) return;
    try {
      await repo.requestErasure(learner);
      res.status(202).json({ pending: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Single config (non-secret; safe to send to the browser) ---
  app.get('/api/config', (_req, res) => {
    // The admin allow-list is server-only.
    const { program, fieldkit, privacy, ...rest } = loadConfig();
    const { adminEmails: _admins, ...publicProgram } = program;
    // Deck id and held-slide reasons are internal; the browser only needs to know the tab exists.
    res.json({
      ...rest,
      program: publicProgram,
      fieldkit: { enabled: fieldkit.enabled },
      privacy: { retentionDays: privacy.retentionDays },
    });
  });

  // --- Admin: cohort progress, weak topics, exports (allow-listed platform identity) ---
  const adminOnly = (
    req: { header: (n: string) => string | undefined },
    res: { status: (c: number) => { json: (b: unknown) => void } },
  ): boolean => {
    if (isAdmin(viewerEmail(req), config.program.adminEmails)) return true;
    res.status(403).json({ error: 'Admin access required' });
    return false;
  };
  app.get('/api/admin/me', (req, res) => {
    res.json({ admin: isAdmin(viewerEmail(req), config.program.adminEmails) });
  });
  app.get('/api/admin/summary', async (req, res) => {
    if (!adminOnly(req, res)) return;
    const r = requireRepo(res);
    if (!r) return;
    try {
      const [learners, progress, asks, requests] = await Promise.all([
        r.listLearners(),
        r.allProgress(),
        r.recentAsks(20),
        r.listRequests(),
      ]);
      res.json({
        ...summarize({ config, questions: loadQuestions(), learners, progress }),
        recentQuestions: asks,
        requests,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  // Progress by company only: no individual rows leave the system.
  app.get('/api/admin/organizations.csv', async (req, res) => {
    if (!adminOnly(req, res)) return;
    const r = requireRepo(res);
    if (!r) return;
    try {
      const [learners, progress] = await Promise.all([r.listLearners(), r.allProgress()]);
      const s = summarize({ config, questions: loadQuestions(), learners, progress });
      res
        .type('text/csv')
        .set('Content-Disposition', 'attachment; filename="organizations.csv"')
        .send(
          toCsv(
            ['organization', 'learners', 'started', 'completed', 'avg_modules_done', 'avg_overall', 'level', 'last_active'],
            s.organizations.map((o) => [o.org, o.learners, o.started, o.completed, o.avgModulesDone, o.avgOverall, o.level, o.lastActiveAt]),
          ),
        );
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  // Approve a deletion request: removes the learner and everything linked to them, keeps an erasure record.
  app.post('/api/admin/data-requests/:id/erase', async (req, res) => {
    if (!adminOnly(req, res)) return;
    const id = Number(req.params.id);
    const admin = viewerEmail(req);
    if (!Number.isInteger(id) || id < 1 || !admin) {
      res.status(400).json({ error: 'Invalid request id' });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    try {
      const erased = await r.erase(id, admin);
      res.status(erased ? 200 : 404).json(erased ? { erased: true } : { error: 'No pending request with that id' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Leaderboard (opt-in only; self-chosen nickname + company) ---
  app.get('/api/leaderboard', async (req, res) => {
    if (!config.program.leaderboard.enabled) {
      res.status(404).json({ error: 'Leaderboard is disabled' });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    try {
      const [learners, progress, me] = await Promise.all([r.listLearners(), r.allProgress(), learnerOf(req)]);
      const ranked = leaderboard(config, learners, progress);
      const entries = ranked.slice(0, config.program.leaderboard.topN).map((e, i) => ({
        rank: i + 1,
        name: e.name,
        org: e.org,
        overall: e.overall,
        isMe: e.id === me?.id,
      }));
      res.json({ entries, optedIn: Boolean(me?.leaderboardOptIn), total: ranked.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.put('/api/leaderboard/opt-in', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner || !repo) return;
    const parsed = optInSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    try {
      await repo.setLeaderboardOptIn(learner.id, parsed.data.optIn, parsed.data.nickname);
      res.json({ optIn: parsed.data.optIn });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Ask Lakebase: retrieval-augmented answers with citations ---
  app.post('/api/ask', async (req, res) => {
    if (!config.ai.enabled) {
      res.status(503).json({ error: 'AI features are disabled in app.config.json' });
      return;
    }
    const parsed = askRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ask a question of 3 to 500 characters' });
      return;
    }
    const { question } = parsed.data;
    const learner = await learnerOf(req);
    try {
      const { mode, hits } = await ctx.knowledge.retrieve(question, config.ai.retrievalTopK);
      const response = await ctx.invokeLlm(req, {
          messages: [{ role: 'user', content: buildAskPrompt(question, hits) }],
          max_tokens: config.ai.maxTokens,
          temperature: config.ai.temperature,
        });
      const answer = extractContent(response);
      const citations = citationsFor(hits);
      if (repo) {
        repo.logAsk(learner?.id ?? null, question, answer, mode, citations).catch((e: Error) => {
          console.error(`[lakebase] could not log question: ${e.message}`);
        });
      }
      const links = docLinksFor(hits, {
        label: 'Lakebase documentation',
        url: resolveDoc(config.branding.docsBaseUrl, '/index/'),
      });
      res.json({ answer, citations, links, mode });
    } catch (err) {
      res.status(502).json({ error: `Could not answer: ${(err as Error).message}` });
    }
  });

  app.get('/api/knowledge/status', async (_req, res) => {
    if (!repo || !ctx.knowledge.ready()) {
      res.json({ ready: false, vector: ctx.knowledge.vector(), chunks: 0, embedded: 0 });
      return;
    }
    try {
      res.json({ ready: true, vector: ctx.knowledge.vector(), ...(await ctx.knowledge.stats()) });
    } catch (err) {
      res.json({ ready: false, vector: ctx.knowledge.vector(), chunks: 0, embedded: 0, error: (err as Error).message });
    }
  });

  app.get('/api/content/fieldkit', (_req, res) => {
    if (!config.fieldkit.enabled) {
      res.status(404).json({ error: 'Field Kit is disabled' });
      return;
    }
    // Slide text stays server-side (it feeds Ask Lakebase search); the tab shows the slide images.
    const kit = loadPublicFieldkit(config);
    res.json({
      ...kit,
      sections: kit.sections.map((s) => ({ ...s, slides: s.slides.map(({ text: _text, ...slide }) => slide) })),
    });
  });

  app.get('/api/content/pitfalls', (_req, res) => {
    const k = loadKnowledge();
    res.json({
      pitfalls: k.entries
        .filter((e) => e.kind === 'gotcha')
        .map((e) => ({
          ...e,
          docs: e.docs.map((p) => ({ label: k.docs[p] ?? p, url: resolveDoc(config.branding.docsBaseUrl, p) })),
        })),
    });
  });
  app.get('/api/content/pricing', (_req, res) => {
    res.json(loadPricing());
  });

  // --- Demo walkthrough + fit-checker content ---
  app.get('/api/content/demo', (_req, res) => {
    res.json(loadDemo());
  });
  app.get('/api/content/fit', (_req, res) => {
    res.json(loadFit());
  });
  app.post('/api/fit/evaluate', (req, res) => {
    const parsed = fitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid fit answers' });
      return;
    }
    try {
      res.json(evaluateFit(loadFit(), parsed.data.answers));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // --- Lab progress (self-attested; stored per partner) ---
  app.get('/api/labs', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner || !repo) return;
    try {
      res.json({ labs: await repo.getLabs(learner.id) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.put('/api/labs', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner || !repo) return;
    const parsed = labRequestSchema.safeParse(req.body);
    const total = parsed.success ? loadModules().modules[parsed.data.moduleKey]?.lab.steps.length : undefined;
    if (!parsed.success || total === undefined) {
      res.status(400).json({ error: 'Invalid lab update' });
      return;
    }
    try {
      const steps = [...new Set(parsed.data.steps.filter((n) => n < total))].sort((a, b) => a - b);
      await repo.setLab(learner.id, parsed.data.moduleKey, steps, total);
      res.json({ status: steps.length >= total ? 'completed' : 'in-progress', steps });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Per-module learning collateral ---
  app.get('/api/content/modules', (_req, res) => {
    res.json(loadModules());
  });

  // --- Questions WITHOUT answers/explanations (grading is server-side) ---
  app.get('/api/content/questions', (_req, res) => {
    const questions = loadQuestions().map(({ correctAnswer: _c, explanation: _e, ...rest }) => rest);
    res.json({ questions });
  });

  // --- Grade a module's quiz; return correctness + explanations ---
  app.post('/api/quiz/grade', async (req, res) => {
    const parsed = gradeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid grade request' });
      return;
    }
    const { moduleKey, answers } = parsed.data;
    const moduleQuestions = loadQuestions().filter((q) => q.moduleKey === moduleKey);
    if (moduleQuestions.length === 0) {
      res.status(404).json({ error: `Unknown module: ${moduleKey}` });
      return;
    }
    const byId = new Map(answers.map((a) => [a.questionId, a.answer]));
    const results = moduleQuestions.map((q) => {
      const given = byId.get(q.id) ?? null;
      return {
        questionId: q.id,
        given,
        correct: given === q.correctAnswer,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      };
    });
    const correctCount = results.filter((r) => r.correct).length;
    const score = Math.round((correctCount / moduleQuestions.length) * 100);
    const learner = await learnerOf(req);
    if (repo && learner) {
      // Persistence must never block feedback to the learner.
      try {
        await repo.recordAttempt(learner.id, moduleKey, {
          score,
          correct: correctCount,
          total: moduleQuestions.length,
          answers: Object.fromEntries(byId),
        });
      } catch (err) {
        console.error(`[lakebase] could not record attempt: ${(err as Error).message}`);
      }
    }
    res.json({ moduleKey, total: moduleQuestions.length, correct: correctCount, score, results });
  });

  // --- AI explanation of a missed quiz question (OBO model serving) ---
  app.post('/api/explain', async (req, res) => {
    const cfg = loadConfig();
    const parsed = explainRequestSchema.safeParse(req.body);
    const q = parsed.success ? loadQuestions().find((x) => x.id === parsed.data.questionId) : undefined;
    if (!cfg.ai.enabled || !parsed.success || !q) {
      res.status(400).json({ error: 'Explanation unavailable for this question' });
      return;
    }
    const label = (key: string) => q.choices.find((c) => c.key === key)?.text ?? key;
    const prompt =
      'You are a Databricks Lakebase enablement coach. A partner answered a quiz question incorrectly. ' +
      'In under 120 words, explain plainly why their choice is wrong and why the correct answer is right, ' +
      'and give one practical tip to remember it. Do not invent product facts beyond the reference explanation.\n\n' +
      `Question: ${q.prompt}\nTheir answer: ${label(parsed.data.given)}\n` +
      `Correct answer: ${label(q.correctAnswer)}\nReference explanation: ${q.explanation}`;
    try {
      const response = await ctx.invokeLlm(req, {
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 400,
          temperature: cfg.ai.temperature,
        });
      res.json({ explanation: extractContent(response) });
    } catch (err) {
      res.status(502).json({ error: `Explanation failed: ${(err as Error).message}` });
    }
  });
}
