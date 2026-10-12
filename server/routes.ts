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
import type { Repo } from './db/repo.js';
import { buildAskPrompt, citationsFor, docLinksFor } from './knowledge/rag.js';
import { resolveDoc } from './knowledge/chunks.js';
import type { Hit, SearchMode } from './knowledge/store.js';
import { isAdmin, leaderboard, scoresByEmail, summarize, toCsv } from './program/admin.js';
import { certificateEligibility, displayName } from './program/scoring.js';

const partnerRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  org: z.string().trim().min(1).max(200),
});

const gradeRequestSchema = z.object({
  email: z.string().trim().email().max(320).optional(),
  moduleKey: z.string(),
  answers: z.array(z.object({ questionId: z.string(), answer: z.string() })),
});

const labRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  moduleKey: z.string(),
  steps: z.array(z.number().int().min(0).max(100)).max(100),
});

const explainRequestSchema = z.object({
  questionId: z.string(),
  given: z.string(),
});

const optInSchema = z.object({ email: z.string().trim().email().max(320), optIn: z.boolean() });
const certRequestSchema = z.object({ email: z.string().trim().email().max(320) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Admin identity is the platform-injected x-forwarded-email (set by the Apps
// proxy, not by the visitor). Local dev can opt in with DEV_ADMIN_EMAIL.
function viewerEmail(req: { header: (n: string) => string | undefined }): string | undefined {
  const forwarded = req.header('x-forwarded-email');
  if (forwarded) return forwarded;
  return process.env.NODE_ENV === 'production' ? undefined : process.env.DEV_ADMIN_EMAIL;
}

const askRequestSchema = z.object({
  question: z.string().trim().min(3).max(500),
  email: z.string().trim().email().max(320).optional(),
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

  // --- Register / sign in a partner by email and return saved progress ---
  app.post('/api/partner', async (req, res) => {
    const parsed = partnerRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid partner details' });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    try {
      const partner = await r.upsertPartner(parsed.data);
      res.json({ partner, progress: await r.getProgress(partner.email) });
    } catch (err) {
      res.status(500).json({ error: `Could not save partner: ${(err as Error).message}` });
    }
  });

  // --- Reset a partner's saved progress ---
  app.delete('/api/progress', async (req, res) => {
    const email = z.string().email().safeParse(req.query.email);
    if (!email.success) {
      res.status(400).json({ error: 'email query parameter required' });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    try {
      await r.deleteProgress(email.data);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Single config (non-secret; safe to send to the browser) ---
  app.get('/api/config', (_req, res) => {
    // The admin allow-list is server-only.
    const { program, ...rest } = loadConfig();
    const { adminEmails: _admins, ...publicProgram } = program;
    res.json({ ...rest, program: publicProgram });
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
      const [partners, progress, asks] = await Promise.all([r.listPartners(), r.allProgress(), r.recentAsks(20)]);
      res.json({ ...summarize({ config, questions: loadQuestions(), partners, progress }), recentQuestions: asks });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.get('/api/admin/partners.csv', async (req, res) => {
    if (!adminOnly(req, res)) return;
    const r = requireRepo(res);
    if (!r) return;
    try {
      const [partners, progress] = await Promise.all([r.listPartners(), r.allProgress()]);
      const s = summarize({ config, questions: loadQuestions(), partners, progress });
      res
        .type('text/csv')
        .set('Content-Disposition', 'attachment; filename="partners.csv"')
        .send(
          toCsv(
            ['name', 'email', 'organization', 'modules_completed', 'overall_score', 'level', 'certified', 'last_seen'],
            s.partners.map((p) => [p.name, p.email, p.org, p.modulesDone, p.overall, p.level, p.certified, p.lastSeenAt]),
          ),
        );
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Leaderboard (opt-in only; first name + last initial + organization) ---
  app.get('/api/leaderboard', async (req, res) => {
    if (!config.program.leaderboard.enabled) {
      res.status(404).json({ error: 'Leaderboard is disabled' });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    try {
      const [partners, progress] = await Promise.all([r.listPartners(), r.allProgress()]);
      const ranked = leaderboard(config, partners, progress);
      const me = z.string().email().safeParse(req.query.email);
      const myEmail = me.success ? me.data.trim().toLowerCase() : null;
      const entries = ranked.slice(0, config.program.leaderboard.topN).map((e, i) => ({
        rank: i + 1,
        name: displayName(e.name),
        org: e.org,
        overall: e.overall,
        isMe: e.email === myEmail,
      }));
      const mine = partners.find((p) => p.email === myEmail);
      res.json({ entries, optedIn: Boolean(mine?.leaderboardOptIn), total: ranked.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.put('/api/leaderboard/opt-in', async (req, res) => {
    const parsed = optInSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    try {
      const ok = await r.setLeaderboardOptIn(parsed.data.email, parsed.data.optIn);
      res.status(ok ? 200 : 404).json(ok ? { optIn: parsed.data.optIn } : { error: 'Partner not found' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Certificate: eligibility is decided on the server from saved scores ---
  app.post('/api/certificate', async (req, res) => {
    const cert = config.program.certificate;
    const parsed = certRequestSchema.safeParse(req.body);
    if (!cert.enabled || !parsed.success) {
      res.status(400).json({ error: 'Certificates are unavailable or the request is invalid' });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    try {
      const email = parsed.data.email.trim().toLowerCase();
      const partner = (await r.listPartners()).find((p) => p.email === email);
      if (!partner) {
        res.status(404).json({ error: 'Partner not found' });
        return;
      }
      const scores = scoresByEmail(await r.allProgress()).get(email) ?? {};
      const elig = certificateEligibility(config, scores);
      if (!elig.eligible) {
        res.status(409).json({ error: 'Not yet eligible', reasons: elig.reasons, overall: elig.overall });
        return;
      }
      const issued = await r.issueCertificate(email, elig.overall, elig.level);
      res.json({
        id: issued.id,
        name: partner.name,
        org: partner.org,
        overall: elig.overall,
        level: elig.level,
        issuedAt: issued.issuedAt,
        title: cert.title,
        issuer: cert.issuer,
        signatory: cert.signatory,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.get('/api/certificate/verify/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) {
      res.status(404).json({ valid: false });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    try {
      const c = await r.getCertificate(req.params.id);
      if (!c) {
        res.status(404).json({ valid: false });
        return;
      }
      const cert = config.program.certificate;
      res.json({ valid: true, ...c, title: cert.title, issuer: cert.issuer });
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
    const { question, email } = parsed.data;
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
        repo.logAsk(email ?? null, question, answer, mode, citations).catch((e: Error) => {
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
    const email = z.string().email().safeParse(req.query.email);
    if (!email.success) {
      res.status(400).json({ error: 'email query parameter required' });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    try {
      res.json({ labs: await r.getLabs(email.data) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.put('/api/labs', async (req, res) => {
    const parsed = labRequestSchema.safeParse(req.body);
    const total = parsed.success ? loadModules().modules[parsed.data.moduleKey]?.lab.steps.length : undefined;
    if (!parsed.success || total === undefined) {
      res.status(400).json({ error: 'Invalid lab update' });
      return;
    }
    const r = requireRepo(res);
    if (!r) return;
    try {
      const steps = [...new Set(parsed.data.steps.filter((n) => n < total))].sort((a, b) => a - b);
      await r.setLab(parsed.data.email, parsed.data.moduleKey, steps, total);
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
    const { email, moduleKey, answers } = parsed.data;
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
    if (repo && email) {
      // Persistence must never block feedback to the learner.
      try {
        await repo.recordAttempt(email, moduleKey, {
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
