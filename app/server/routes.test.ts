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
const CODE = 'ABCD-EFGH-JKMN-PQRS';
const learner = { id: 'l-1', org: 'Acme', nickname: 'Pat', leaderboardOptIn: true };
const withCode = { 'x-learner-code': CODE };

function fakeRepo(over: Partial<Record<keyof Repo, unknown>> = {}): Repo {
  const base = {
    register: vi.fn((org: string, nickname: string | null) => Promise.resolve({ learner: { ...learner, org, nickname }, code: CODE })),
    authenticate: vi.fn((code?: string) => Promise.resolve(code === CODE ? learner : null)),
    getProgress: vi.fn(() => Promise.resolve({})),
    recordAttempt: vi.fn(() => Promise.resolve()),
    setLab: vi.fn(() => Promise.resolve()),
    getLabs: vi.fn(() => Promise.resolve({})),
    logAsk: vi.fn(() => Promise.resolve()),
    listLearners: vi.fn(() => Promise.resolve([])),
    allProgress: vi.fn(() => Promise.resolve([])),
    recentAsks: vi.fn(() => Promise.resolve([])),
    setLeaderboardOptIn: vi.fn(() => Promise.resolve(true)),
    deleteProgress: vi.fn(() => Promise.resolve()),
    requestErasure: vi.fn(() => Promise.resolve()),
    hasPendingRequest: vi.fn(() => Promise.resolve(false)),
    listRequests: vi.fn(() => Promise.resolve([])),
    erase: vi.fn(() => Promise.resolve(true)),
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
  config.modules.map((m) => ({ learnerId: 'l-1', moduleKey: m.key, score, attempts: 1, answers: {} }));
const learnerRow = { id: 'l-1', org: 'Acme', nickname: 'Pat', createdAt: '2026-01-01', lastSeenAt: '2026-01-02', leaderboardOptIn: true };

describe('public content and config', () => {
  let t: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => (t = await start()));
  afterAll(() => t.close());

  test('config never exposes the admin allow-list', async () => {
    const r = await t.call('GET', '/api/config');
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(ADMIN);
    expect(r.json.program.adminEmails).toBeUndefined();
    expect(r.json.privacy).toEqual({ retentionDays: config.privacy.retentionDays });
    expect(r.text).not.toContain('migrateLegacy');
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
    // Raw slide text is not sent to the browser (it is only used for Ask Lakebase search).
    expect(r.json.sections[0].slides[0].text).toBeUndefined();
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

  test('scores correctly and records the attempt only for a recognised learner', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    const r = await t.call('POST', '/api/quiz/grade', { moduleKey: mod, answers: allRight }, withCode);
    expect(r.json).toMatchObject({ score: 100, correct: qs.length, total: qs.length });
    expect(repo.recordAttempt).toHaveBeenCalledWith('l-1', mod, expect.objectContaining({ score: 100 }));
    const anon = await t.call('POST', '/api/quiz/grade', { moduleKey: mod, answers: [] });
    expect(anon.json.score).toBe(0);
    const wrongCode = await t.call('POST', '/api/quiz/grade', { moduleKey: mod, answers: allRight }, { 'x-learner-code': 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
    expect(wrongCode.status).toBe(200);
    expect(repo.recordAttempt).toHaveBeenCalledOnce();
    await t.close();
  });

  test('a database failure never blocks feedback to the learner', async () => {
    const repo = fakeRepo({ recordAttempt: vi.fn(() => Promise.reject(new Error('db down'))) });
    const t = await start({ repo });
    const r = await t.call('POST', '/api/quiz/grade', { moduleKey: mod, answers: allRight }, withCode);
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

describe('learner sign-up and sign-in', () => {
  test('degrades with the reason when Lakebase is unavailable', async () => {
    const t = await start({ repo: null, dbError: 'Not initialised' });
    const p = await t.call('POST', '/api/learner/register', { org: 'Acme' });
    expect(p.status).toBe(503);
    expect(p.json.error).toContain('Not initialised');
    expect((await t.call('GET', '/api/leaderboard')).status).toBe(503);
    const s = await t.call('GET', '/api/lakebase/status');
    expect(s.json).toMatchObject({ connected: false, schema: config.lakebase.schema });
    expect((await t.call('GET', '/api/knowledge/status')).json.ready).toBe(false);
    await t.close();
  });

  test('registers with a company only and returns the code once, with no personal data in or out', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    expect((await t.call('POST', '/api/learner/register', { org: '' })).status).toBe(400);
    // Extra personal fields are never read or stored.
    const ok = await t.call('POST', '/api/learner/register', { org: ' Acme ', nickname: 'Pat', email: 'pat@x.co', name: 'Pat Partner' });
    expect(ok.status).toBe(201);
    expect(ok.json.code).toBe(CODE);
    expect(ok.res.headers.get('cache-control')).toBe('no-store');
    expect(repo.register).toHaveBeenCalledWith('Acme', 'Pat');
    expect(ok.text).not.toContain('pat@x.co');
    expect(ok.text).not.toContain('l-1');
    await t.close();
  });

  test('sign-ups are rate limited per client', async () => {
    const t = await start();
    let last = 201;
    for (let i = 0; i < 31; i++) last = (await t.call('POST', '/api/learner/register', { org: 'Acme' }, { 'x-forwarded-for': '203.0.113.9' })).status;
    expect(last).toBe(429);
    await t.close();
  });

  test('a valid code resumes progress; a missing or wrong one is 401', async () => {
    const repo = fakeRepo({ hasPendingRequest: vi.fn(() => Promise.resolve(true)) });
    const t = await start({ repo });
    const me = await t.call('GET', '/api/learner/me', undefined, withCode);
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ learner: { org: 'Acme', nickname: 'Pat' }, progress: {}, pendingErasure: true });
    expect(me.json.learner.id).toBeUndefined();
    expect((await t.call('GET', '/api/learner/me')).status).toBe(401);
    expect((await t.call('GET', '/api/learner/me', undefined, { 'x-learner-code': 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' })).status).toBe(401);
    await t.close();
  });

  test('resetting progress needs the learner code (no anonymous delete)', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    expect((await t.call('DELETE', '/api/progress')).status).toBe(401);
    expect((await t.call('DELETE', '/api/progress?email=victim@x.co')).status).toBe(401);
    expect(repo.deleteProgress).not.toHaveBeenCalled();
    expect((await t.call('DELETE', '/api/progress', undefined, withCode)).status).toBe(204);
    expect(repo.deleteProgress).toHaveBeenCalledWith('l-1');
    await t.close();
  });
});

describe('deletion requests', () => {
  const adminHeaders = { 'x-forwarded-email': ADMIN };

  test('a learner files a request with their code; it is idempotent and reports pending', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    expect((await t.call('POST', '/api/data-request')).status).toBe(401);
    const r = await t.call('POST', '/api/data-request', undefined, withCode);
    expect(r.status).toBe(202);
    expect(repo.requestErasure).toHaveBeenCalledWith(learner);
    expect((await t.call('GET', '/api/data-request', undefined, withCode)).json).toEqual({ pending: false });
    await t.close();
  });

  test('only an allow-listed admin can erase, by request id', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    expect((await t.call('POST', '/api/admin/data-requests/7/erase')).status).toBe(403);
    expect((await t.call('POST', '/api/admin/data-requests/7/erase', undefined, withCode)).status).toBe(403);
    expect(repo.erase).not.toHaveBeenCalled();
    expect((await t.call('POST', '/api/admin/data-requests/abc/erase', undefined, adminHeaders)).status).toBe(400);
    const ok = await t.call('POST', '/api/admin/data-requests/7/erase', undefined, adminHeaders);
    expect(ok.json).toEqual({ erased: true });
    expect(repo.erase).toHaveBeenCalledWith(7, ADMIN);
    await t.close();
  });

  test('erasing an unknown or already-closed request is a 404', async () => {
    const t = await start({ repo: fakeRepo({ erase: vi.fn(() => Promise.resolve(false)) }) });
    expect((await t.call('POST', '/api/admin/data-requests/9/erase', undefined, { 'x-forwarded-email': ADMIN })).status).toBe(404);
    await t.close();
  });
});

describe('admin access', () => {
  let t: Awaited<ReturnType<typeof start>>;
  beforeAll(
    async () =>
      (t = await start({
        repo: fakeRepo({
          listLearners: vi.fn(() => Promise.resolve([learnerRow])),
          allProgress: vi.fn(() => Promise.resolve(allModules(90))),
          listRequests: vi.fn(() => Promise.resolve([{ id: 1, learnerId: 'l-1', org: 'Acme', status: 'pending', requestedAt: '2026-01-03T00:00:00.000Z', completedAt: null, completedBy: null }])),
        }),
      })),
  );
  afterAll(() => t.close());

  test('requires the platform-injected identity to be on the allow-list', async () => {
    expect((await t.call('GET', '/api/admin/summary')).status).toBe(403);
    expect((await t.call('GET', '/api/admin/summary', undefined, { 'x-forwarded-email': 'someone@else.com' })).status).toBe(403);
    expect((await t.call('GET', '/api/admin/organizations.csv')).status).toBe(403);
    expect((await t.call('GET', '/api/admin/me')).json.admin).toBe(false);
  });

  test('admins get progress by company and deletion requests, with no names or emails', async () => {
    const h = { 'x-forwarded-email': ADMIN.toUpperCase() };
    expect((await t.call('GET', '/api/admin/me', undefined, h)).json.admin).toBe(true);
    const s = await t.call('GET', '/api/admin/summary', undefined, h);
    expect(s.status).toBe(200);
    expect(s.json.totals).toMatchObject({ learners: 1, organizations: 1, completed: 1 });
    expect(s.json.organizations[0]).toMatchObject({ org: 'Acme', learners: 1, started: 1, completed: 1 });
    expect(s.json.requests[0]).toMatchObject({ id: 1, status: 'pending' });
    expect(s.json.partners).toBeUndefined();
    expect(s.text).not.toContain('Pat');
    const csv = await t.call('GET', '/api/admin/organizations.csv', undefined, h);
    expect(csv.res.headers.get('content-type')).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toBe('organization,learners,started,completed,avg_modules_done,avg_overall,level,last_active');
    expect(csv.text).toContain('Acme,1,1,1');
    expect(csv.text).not.toContain('l-1');
    expect((await t.call('GET', '/api/admin/partners.csv', undefined, h)).status).toBe(404);
  });
});

describe('leaderboard', () => {
  test('shows only the self-chosen nickname and company, and flags the caller', async () => {
    const repo = fakeRepo({
      listLearners: vi.fn(() => Promise.resolve([learnerRow, { ...learnerRow, id: 'l-2', nickname: null }])),
      allProgress: vi.fn(() => Promise.resolve([...allModules(80), ...allModules(70).map((p) => ({ ...p, learnerId: 'l-2' }))])),
    });
    const t = await start({ repo });
    const r = await t.call('GET', '/api/leaderboard', undefined, withCode);
    expect(r.json.entries[0]).toMatchObject({ rank: 1, name: 'Pat', org: 'Acme', isMe: true });
    expect(r.json.entries[1]).toMatchObject({ name: 'Anonymous learner', isMe: false });
    expect(r.text).not.toContain('l-1');
    expect(r.json.optedIn).toBe(true);
    const anon = await t.call('GET', '/api/leaderboard');
    expect(anon.json.optedIn).toBe(false);
    expect(anon.json.entries.every((e: { isMe: boolean }) => !e.isMe)).toBe(true);
    await t.close();
  });

  test('opt-in needs the learner code and saves the nickname', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    expect((await t.call('PUT', '/api/leaderboard/opt-in', { optIn: true })).status).toBe(401);
    expect((await t.call('PUT', '/api/leaderboard/opt-in', { optIn: 'yes' }, withCode)).status).toBe(400);
    expect((await t.call('PUT', '/api/leaderboard/opt-in', { optIn: true, nickname: 'Rocket' }, withCode)).status).toBe(200);
    expect(repo.setLeaderboardOptIn).toHaveBeenCalledWith('l-1', true, 'Rocket');
    await t.close();
  });
});

describe('certificates are gone', () => {
  test('the old certificate endpoints no longer exist', async () => {
    const t = await start();
    expect((await t.call('POST', '/api/certificate', { email: 'p@x.co' })).status).toBe(404);
    expect((await t.call('GET', '/api/certificate/verify/11111111-1111-4111-8111-111111111111')).status).toBe(404);
    await t.close();
  });
});

describe('labs', () => {
  const mod = Object.keys(loadModules().modules)[0];
  const total = loadModules().modules[mod].lab.steps.length;

  test('keeps only valid, unique, sorted steps and reports completion', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    const put = (body: unknown) => t.call('PUT', '/api/labs', body, withCode);
    const all = Array.from({ length: total }, (_, i) => i);
    const r = await put({ moduleKey: mod, steps: [...all, 0, 99, total] });
    expect(r.json).toEqual({ status: 'completed', steps: all });
    expect(repo.setLab).toHaveBeenCalledWith('l-1', mod, all, total);
    expect((await put({ moduleKey: mod, steps: [0] })).json.status).toBe('in-progress');
    expect((await put({ moduleKey: mod, steps: [999] })).status).toBe(400);
    expect((await put({ moduleKey: mod, steps: [-1] })).status).toBe(400);
    expect((await put({ moduleKey: 'nope', steps: [0] })).status).toBe(400);
    expect((await t.call('PUT', '/api/labs', { moduleKey: mod, steps: [0] })).status).toBe(401);
    expect((await t.call('GET', '/api/labs')).status).toBe(401);
    expect((await t.call('GET', '/api/labs', undefined, withCode)).status).toBe(200);
    await t.close();
  });
});

describe('AI routes', () => {
  test('ask validates, retrieves, answers with citations and logs the question', async () => {
    const repo = fakeRepo();
    const t = await start({ repo });
    expect((await t.call('POST', '/api/ask', { question: 'hi' })).status).toBe(400);
    expect((await t.call('POST', '/api/ask', { question: 'x'.repeat(501) })).status).toBe(400);
    const r = await t.call('POST', '/api/ask', { question: 'How does scale to zero work?' }, withCode);
    expect(r.json).toMatchObject({ answer: 'LLM ANSWER', mode: 'vector', citations: [{ n: 1, title: 'T' }] });
    const prompt = (t.llm.mock.calls[0] as unknown as [unknown, { messages: { content: string }[] }])[1].messages[0].content;
    expect(prompt).toContain('Question: How does scale to zero work?');
    expect(prompt).toContain('[1] T');
    expect(repo.logAsk).toHaveBeenCalledWith('l-1', 'How does scale to zero work?', 'LLM ANSWER', 'vector', expect.anything());
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
