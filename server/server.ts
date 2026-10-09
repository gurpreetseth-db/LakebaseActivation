import { createApp, server, serving } from '@databricks/appkit';
import { z } from 'zod';
import { loadConfig, loadModules, loadQuestions } from './content/loader.js';

// Load config once at startup. Bridge the AI endpoint name from the single
// config file into the env var the serving plugin reads, UNLESS the platform
// already set it (app.yaml / platform env always wins). This keeps the endpoint
// name a config-file variable while still allowing an ops override.
const config = loadConfig();
if (!process.env.DATABRICKS_SERVING_ENDPOINT_NAME && config.ai.endpointName) {
  process.env.DATABRICKS_SERVING_ENDPOINT_NAME = config.ai.endpointName;
}

const gradeRequestSchema = z.object({
  moduleKey: z.string(),
  answers: z.array(z.object({ questionId: z.string(), answer: z.string() })),
});

const planRequestSchema = z.object({
  partner: z.object({
    name: z.string().optional().default(''),
    org: z.string().optional().default(''),
  }),
  overallScore: z.number(),
  overallLevel: z.string(),
  modules: z.array(
    z.object({
      title: z.string(),
      score: z.number(),
      level: z.string(),
      attempted: z.boolean(),
    }),
  ),
});

function extractContent(response: unknown): string {
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

await createApp({
  plugins: [server(), serving()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      // --- Single config (non-secret; safe to send to the browser) ---
      app.get('/api/config', (_req, res) => {
        res.json(loadConfig());
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
      app.post('/api/quiz/grade', (req, res) => {
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
        res.json({ moduleKey, total: moduleQuestions.length, correct: correctCount, score, results });
      });

      // --- AI-generated personalized adoption plan (OBO model serving) ---
      app.post('/api/plan', async (req, res) => {
        const cfg = loadConfig();
        if (!cfg.ai.enabled) {
          res.status(503).json({ error: 'AI plan generation is disabled in app.config.json' });
          return;
        }
        const parsed = planRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid plan request' });
          return;
        }
        const { partner, overallScore, overallLevel, modules } = parsed.data;

        const moduleLines = modules
          .map((m) => `- ${m.title}: ${m.attempted ? `${m.score}/100 (${m.level})` : 'not yet attempted'}`)
          .join('\n');

        const systemPrompt =
          'You are a Databricks Lakebase enablement coach for partners. ' +
          'Given a partner\'s readiness scores across Lakebase learning modules, write a concise, ' +
          'actionable, personalized adoption plan in Markdown. Be specific and encouraging. ' +
          'Use these sections: "## Where you stand", "## Priority focus areas" (bullet list, hardest/lowest modules first, ' +
          'with one concrete next action each), "## Suggested 30-day path" (numbered), and "## Resources". ' +
          'Reference the actual Lakebase capabilities the weak modules cover. Keep it under 400 words.';

        const userPrompt =
          `Partner: ${partner.name || 'Unknown'}${partner.org ? ` (${partner.org})` : ''}\n` +
          `Overall readiness: ${overallScore}/100 (${overallLevel}).\n` +
          `Module scores:\n${moduleLines}\n\n` +
          'Write the personalized Lakebase adoption plan now.';

        try {
          const response = await appkit
            .serving()
            .asUser(req)
            .invoke({
              messages: [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }],
              max_tokens: cfg.ai.maxTokens,
              temperature: cfg.ai.temperature,
            });
          res.json({ planMarkdown: extractContent(response) });
        } catch (err) {
          res.status(502).json({ error: `Plan generation failed: ${(err as Error).message}` });
        }
      });
    });
  },
}).catch(console.error);
