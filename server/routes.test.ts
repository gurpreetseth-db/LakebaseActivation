/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any -- HTTP responses are intentionally loose in tests */
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { loadConfig, loadModules, loadQuestions } from './content/loader.js';
import type { Repo } from './db/repo.js';
import { registerRoutes, type RoutesContext } from './routes.js';

const config = loadConfig();
const questions = loadQuestions();
const ADMIN = config.program.adminEmails[0];
// The shipped config has certificates switched off; these tests exercise the feature when enabled.
const certConfig = { ...config, program: { ...config.program, certificate: { ...config.program.certificate, enabled: true } } };

function fakeRepo(over: Partial<Record<keyof Repo, unknown>> = {}): Repo {
  const base = {
    upsertPartner: vi.fn((p: unknown) => Promise.resolve(p)),
    getProgress: vi.fn(() => Promise.resolve({})),
    recordAttempt: vi.fn(() => Promise.resolve()),
    setLab: vi.fn(() => Promise.resolve()),
    getLabs: vi.fn(() => Promise.resolve({})),
    logAsk: vi.fn(() => Promise.resolve()),
    listPartners: vi.fn(() => Promise.resolve([])),
    allProgress: vi.fn(() => Promise.resolve([])),
    recentAsks: vi.fn(() => Promise.resolve([])),
    setLeaderboardOptIn: vi.fn(() => Promise.resolve(true)),
    issueCertificate: vi.fn(() => Promise.resolve({ id: '11111111-1111-4111-8111-111111111111', issuedAt: '2026-01-01T00:00:00.000Z' })),
    getCertificate: vi.fn(() => Promise.resolve(null)),
    deleteProgress: vi.fn(() => Promise.resolve()),
    ping: vi.fn(() => Promise.resolve(3)),
  };
  return { ...base, ...over } as unknown as Repo;
}

async function start(ctxOver: Partial<RoutesContext> = {}) {
  const app = express();
  app.use(express.json());
  const llm = vi.fn(() => Promise.resolve({ data: { choices: [{ message: { content: 'LLM ANSWER' } }] } }));
  const ctx: RoutesContext = {
    config,
    repo: fakeRepo(),
    dbError: '',
    knowledge: {
      ready: () => true,
      vector: () => true,
      stats: () => Promise.resolve({ total: 10, embedded: 10 }),
      retrieve: () => Promise.resolve({ mode: 'vector' as const, hits: [{ id: 'k', source: 'S', title: 'T', content: 'C', score: 1 }] }),
    },
    invokeLlm: llm,
    ...ctxOver,
  };
  registerRoutes(app, ctx);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* csv etc. */
    }
    return { status: res.status, json: json as Record<string, any>, text, res };
  };
  return { call, ctx, llm, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const allModules = (score: number) =>
  config.modules.map((m) => ({ email: 'p@x.co', moduleKey: m.key, score, attempts: 1, answers: {} }));
const partnerRow = { email: 'p@x.co', name: 'Pat Partner', org: 'Acme', createdAt: '2026-01-01', lastSeenAt: '2026-01-02', leaderboardOptIn: true };

describe('public content and config', () => {
  let t: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => (t = await start()));
  afterAll(() => t.close());

  test('config never exposes the admin allow-list', async () => {
    const r = await t.call('GET', '/api/config');
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(ADMIN);
    expect(r.json.program.adminEmails).toBeUndefined();
    expect(r.json.program.certificate.enabled).toBeDefined();
    // Internal Field Kit details stay server-side.
    expect(r.json.fieldkit).toEqual({ enabled: config.fieldkit.enabled });
    for (const reason of Object.values(config.fieldkit.heldSlides)) expect(r.text).not.toContain(reason);
  });

  test('Field Kit is served with approved slides only and no internal details', async () => {
    const r = await t.call('GET', '/api/content/fieldkit');
    expect(r.status).toBe(200);
    const sections = r.json.sections as { slides: { n: number }[] }[];
    const nums = sections.flatMap((s) => s.slides.map((x) => x.n));
    expect(nums.length).toBeGreaterThan(0);
    for (const held of Object.keys(config.fieldkit.heldSlides)) expect(nums).not.toContain(Number(held));
    expect(r.text).not.toContain('expectTitle');
    expect(r.json.pdf).toBe(`/${config.fieldkit.imageDir}/${config.fieldkit.pdfFile}`);
    expect(r.json.sections[0].slides[0].image).toBe(`/${config.fieldkit.imageDir}/slide-${String(r.json.sections[0].slides[0].n).padStart(2, '0')}.png`);
    // Must not share a name with the /fieldkit page route, or static serving would shadow it.
    expect(config.fieldkit.imageDir).not.toBe('fieldkit');
  });

  test('questions are served without answers or explanations', async () => {
    const r = await t.call('GET', '/api/content/questions');
    expect(r.json.questions).toHaveLength(questions.length);
    expect(r.text).not.toContain('correctAnswer');
    expect(r.text).not.toContain('explanation');
  });

  test('fit evaluation rejects incomplete answers', async () => {
    expect((await t.call('POST', '/api/fit/evaluate', { answers: {} })).status).toBe(400);
    expect((await t.call('POST', '/api/fit/evaluate', { nope: 1 })).status).toBe(400);
  });
});

describe('grading', () => {
  const mod = Object.keys(loadModules().modules)[0];
  const qs = questions.filter((q) => q.moduleKey === mod);
  const allRight = qs.map((q) => ({ questionId: q.id, answer: q.correctAnswer }));

  test('scores correctly and records the attempt for a known partner', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    const r = await t.call('POST', '/api/quiz/grade', { email: 'p@x.co', moduleKey: mod, answers: allRight });
    expect(r.json).toMatchObject({ score: 100, correct: qs.length, total: qs.length });
    expect(repo.recordAttempt).toHaveBeenCalledOnce();
    const none = await t.call('POST', '/api/quiz/grade', { moduleKey: mod, answers: [] });
    expect(none.json.score).toBe(0);
    await t.close();
  });

  test('a database failure never blocks feedback to the learner', async () => {
    const repo = fakeRepo({ recordAttempt: vi.fn(() => Promise.reject(new Error('db down'))) });
    const t = await start({ repo });
    const r = await t.call('POST', '/api/quiz/grade', { email: 'p@x.co', moduleKey: mod, answers: allRight });
    expect(r.status).toBe(200);
    expect(r.json.score).toBe(100);
    await t.close();
  });

  test('rejects unknown modules and malformed bodies', async () => {
    const t = await start({ repo: null, dbError: 'off' });
    expect((await t.call('POST', '/api/quiz/grade', { moduleKey: 'nope', answers: [] })).status).toBe(404);
    expect((await t.call('POST', '/api/quiz/grade', { answers: 'x' })).status).toBe(400);
    await t.close();
  });
});

describe('graceful degradation without Lakebase', () => {
  test('persistence routes answer 503 with the reason; status reports offline', async () => {
    const t = await start({ repo: null, dbError: 'Not initialised' });
    const p = await t.call('POST', '/api/partner', { name: 'A', email: 'a@x.co', org: 'O' });
    expect(p.status).toBe(503);
    expect(p.json.error).toContain('Not initialised');
    expect((await t.call('GET', '/api/leaderboard')).status).toBe(503);
    const s = await t.call('GET', '/api/lakebase/status');
    expect(s.json).toMatchObject({ connected: false, schema: config.lakebase.schema });
    expect((await t.call('GET', '/api/knowledge/status')).json.ready).toBe(false);
    await t.close();
  });

  test('partner registration validates input and returns saved progress', async () => {
    const t = await start();
    expect((await t.call('POST', '/api/partner', { name: '', email: 'bad', org: '' })).status).toBe(400);
    const ok = await t.call('POST', '/api/partner', { name: 'Pat', email: 'pat@x.co', org: 'Acme' });
    expect(ok.status).toBe(200);
    expect(ok.json.progress).toEqual({});
    await t.close();
  });
});

describe('admin access', () => {
  let t: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => (t = await start({ config: certConfig, repo: fakeRepo({ listPartners: vi.fn(() => Promise.resolve([partnerRow])), allProgress: vi.fn(() => Promise.resolve(allModules(90))) }) })));
  afterAll(() => t.close());

  test('requires the platform-injected identity to be on the allow-list', async () => {
    expect((await t.call('GET', '/api/admin/summary')).status).toBe(403);
    expect((await t.call('GET', '/api/admin/summary', undefined, { 'x-forwarded-email': 'someone@else.com' })).status).toBe(403);
    expect((await t.call('GET', '/api/admin/partners.csv')).status).toBe(403);
    expect((await t.call('GET', '/api/admin/me')).json.admin).toBe(false);
  });

  test('allow-listed admins get the summary and a CSV export', async () => {
    const h = { 'x-forwarded-email': ADMIN.toUpperCase() };
    expect((await t.call('GET', '/api/admin/me', undefined, h)).json.admin).toBe(true);
    const s = await t.call('GET', '/api/admin/summary', undefined, h);
    expect(s.status).toBe(200);
    expect(s.json.totals.partners).toBe(1);
    expect(s.json.totals.certified).toBe(1);
    const csv = await t.call('GET', '/api/admin/partners.csv', undefined, h);
    expect(csv.res.headers.get('content-type')).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toBe('name,email,organization,modules_completed,overall_score,level,certified,last_seen');
    expect(csv.text).toContain('pat@x.co'.replace('pat', 'p'));
  });
});

describe('leaderboard', () => {
  test('shows only first name + last initial and flags the caller', async () => {
    const repo = fakeRepo({
      listPartners: vi.fn(() => Promise.resolve([partnerRow])),
      allProgress: vi.fn(() => Promise.resolve(allModules(80))),
    });
    const t = await start({ repo });
    const r = await t.call('GET', '/api/leaderboard?email=p@x.co');
    expect(r.json.entries[0]).toMatchObject({ rank: 1, name: 'Pat P.', org: 'Acme', isMe: true });
    expect(r.text).not.toContain('Partner"');
    expect(r.text).not.toContain('p@x.co');
    expect(r.json.optedIn).toBe(true);
    expect((await t.call('PUT', '/api/leaderboard/opt-in', { email: 'bad', optIn: true })).status).toBe(400);
    expect((await t.call('PUT', '/api/leaderboard/opt-in', { email: 'p@x.co', optIn: false })).status).toBe(200);
    await t.close();
  });

  test('opt-in for an unknown partner is a 404', async () => {
    const t = await start({ repo: fakeRepo({ setLeaderboardOptIn: vi.fn(() => Promise.resolve(false)) }) });
    expect((await t.call('PUT', '/api/leaderboard/opt-in', { email: 'x@x.co', optIn: true })).status).toBe(404);
    await t.close();
  });
});

describe('certificates', () => {
  test('are unavailable when switched off in config', async () => {
    const t = await start();
    expect(config.program.certificate.enabled).toBe(false);
    expect((await t.call('POST', '/api/certificate', { email: 'p@x.co' })).status).toBe(400);
    await t.close();
  });

  test('refuses ineligible partners with reasons, and does not issue', async () => {
    const repo = fakeRepo({
      listPartners: vi.fn(() => Promise.resolve([partnerRow])),
      allProgress: vi.fn(() => Promise.resolve(allModules(90).slice(0, 2))),
    });
    const t = await start({ config: certConfig, repo });
    const r = await t.call('POST', '/api/certificate', { email: 'p@x.co' });
    expect(r.status).toBe(409);
    expect(r.json.reasons.join(' ')).toMatch(/remaining modules/);
    expect(repo.issueCertificate).not.toHaveBeenCalled();
    await t.close();
  });

  test('issues for eligible partners using server-side scores', async () => {
    const repo = fakeRepo({
      listPartners: vi.fn(() => Promise.resolve([partnerRow])),
      allProgress: vi.fn(() => Promise.resolve(allModules(95))),
    });
    const t = await start({ config: certConfig, repo });
    const r = await t.call('POST', '/api/certificate', { email: 'P@X.co' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ name: 'Pat Partner', overall: 95, title: config.program.certificate.title });
    expect(repo.issueCertificate).toHaveBeenCalledWith('p@x.co', 95, expect.any(String));
    expect((await t.call('POST', '/api/certificate', { email: 'ghost@x.co' })).status).toBe(404);
    await t.close();
  });

  test('verification rejects malformed ids without touching the database', async () => {
    const repo = fakeRepo();
    const t = await start({ config: certConfig, repo });
    expect((await t.call('GET', '/api/certificate/verify/not-a-uuid')).status).toBe(404);
    expect((await t.call('GET', "/api/certificate/verify/1' OR '1'='1")).status).toBe(404);
    expect(repo.getCertificate).not.toHaveBeenCalled();
    expect((await t.call('GET', '/api/certificate/verify/11111111-1111-4111-8111-111111111111')).status).toBe(404);
    await t.close();
  });

  test('verification returns public details only', async () => {
    const repo = fakeRepo({
      getCertificate: vi.fn(() =>
        Promise.resolve({ id: '11111111-1111-4111-8111-111111111111', name: 'Pat Partner', org: 'Acme', overall: 95, level: 'Expert', issuedAt: '2026-01-01T00:00:00.000Z' }),
      ),
    });
    const t = await start({ config: certConfig, repo });
    const r = await t.call('GET', '/api/certificate/verify/11111111-1111-4111-8111-111111111111');
    expect(r.json).toMatchObject({ valid: true, name: 'Pat Partner', level: 'Expert' });
    expect(r.text).not.toContain('@');
    await t.close();
  });
});

describe('labs', () => {
  const mod = Object.keys(loadModules().modules)[0];
  const total = loadModules().modules[mod].lab.steps.length;

  test('keeps only valid, unique, sorted steps and reports completion', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    const all = Array.from({ length: total }, (_, i) => i);
    const r = await t.call('PUT', '/api/labs', { email: 'p@x.co', moduleKey: mod, steps: [...all, 0, 99, total] });
    expect(r.json).toEqual({ status: 'completed', steps: all });
    expect(repo.setLab).toHaveBeenCalledWith('p@x.co'.toLowerCase(), mod, all, total);
    expect((await t.call('PUT', '/api/labs', { email: 'p@x.co', moduleKey: mod, steps: [0] })).json.status).toBe('in-progress');
    expect((await t.call('PUT', '/api/labs', { email: 'p@x.co', moduleKey: mod, steps: [999] })).status).toBe(400);
    expect((await t.call('PUT', '/api/labs', { email: 'p@x.co', moduleKey: mod, steps: [-1] })).status).toBe(400);
    expect((await t.call('PUT', '/api/labs', { email: 'p@x.co', moduleKey: 'nope', steps: [0] })).status).toBe(400);
    expect((await t.call('GET', '/api/labs')).status).toBe(400);
    await t.close();
  });
});

describe('AI routes', () => {
  test('ask validates, retrieves, answers with citations and logs the question', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    expect((await t.call('POST', '/api/ask', { question: 'hi' })).status).toBe(400);
    expect((await t.call('POST', '/api/ask', { question: 'x'.repeat(501) })).status).toBe(400);
    const r = await t.call('POST', '/api/ask', { question: 'How does scale to zero work?', email: 'p@x.co' });
    expect(r.json).toMatchObject({ answer: 'LLM ANSWER', mode: 'vector', citations: [{ n: 1, title: 'T' }] });
    const prompt = (t.llm.mock.calls[0] as unknown as [unknown, { messages: { content: string }[] }])[1].messages[0].content;
    expect(prompt).toContain('Question: How does scale to zero work?');
    expect(prompt).toContain('[1] T');
    expect(repo.logAsk).toHaveBeenCalledOnce();
    await t.close();
  });

  test('answers include documentation links from the retrieved passages, or the docs home', async () => {
    const hit = (docs: { label: string; url: string }[]) => ({ id: 'k', source: 'S', title: 'T', content: 'C', score: 1, docs });
    const withDocs = await start({
      knowledge: {
        ready: () => true,
        vector: () => true,
        stats: () => Promise.resolve({ total: 1, embedded: 1 }),
        retrieve: () =>
          Promise.resolve({ mode: 'vector' as const, hits: [hit([{ label: 'Synced tables', url: 'https://docs.databricks.com/aws/en/oltp/projects/sync-tables/' }])] }),
      },
    });
    const r = await withDocs.call('POST', '/api/ask', { question: 'How do synced tables work?' });
    expect(r.json.links).toEqual([{ label: 'Synced tables', url: 'https://docs.databricks.com/aws/en/oltp/projects/sync-tables/' }]);
    await withDocs.close();

    const none = await start();
    const f = await none.call('POST', '/api/ask', { question: 'Something with no linked docs' });
    expect(f.json.links).toEqual([{ label: 'Lakebase documentation', url: `${config.branding.docsBaseUrl}/index/` }]);
    await none.close();
  });

  test('pitfalls come with resolved documentation links', async () => {
    const t = await start();
    const r = await t.call('GET', '/api/content/pitfalls');
    expect(r.json.pitfalls.length).toBeGreaterThan(0);
    for (const p of r.json.pitfalls) {
      expect(p.docs.length).toBeGreaterThan(0);
      expect(p.docs[0].url).toMatch(/^https:\/\//);
    }
    await t.close();
  });

  test('model failures surface as 502 instead of crashing', async () => {
    const t = await start({ invokeLlm: () => Promise.reject(new Error('endpoint down')) });
    const r = await t.call('POST', '/api/ask', { question: 'Anything about Lakebase' });
    expect(r.status).toBe(502);
    expect(r.json.error).toContain('endpoint down');
    await t.close();
  });

  test('explain only works for real questions', async () => {
    const t = await start();
    expect((await t.call('POST', '/api/explain', { questionId: 'nope', given: 'A' })).status).toBe(400);
    const q = questions[0];
    const ok = await t.call('POST', '/api/explain', { questionId: q.id, given: 'A' });
    expect(ok.json.explanation).toBe('LLM ANSWER');
    await t.close();
  });
});
