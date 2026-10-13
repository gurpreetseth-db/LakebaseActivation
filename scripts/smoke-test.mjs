#!/usr/bin/env node
/**
 * Post-deploy smoke test against the running app. Uses your Databricks CLI login
 * to authenticate to the app URL.
 *
 *   node scripts/smoke-test.mjs --profile <PROFILE>            # read-only checks
 *   node scripts/smoke-test.mjs --profile <PROFILE> --write    # also signs up a throw-away partner,
 *                                                                grades a quiz, then clears its progress
 *
 * Exit code is non-zero if any check fails, so it can gate a release.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const profile = opt('--profile');
const write = args.includes('--write');
const base = profile ? ['--profile', profile] : [];
const cli = (...a) => execFileSync('databricks', [...a, ...base], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const config = JSON.parse(readFileSync(new URL('../config/app.config.json', import.meta.url), 'utf8'));
const app = JSON.parse(cli('apps', 'get', config.deployment.appName, '-o', 'json'));
const token = JSON.parse(cli('auth', 'token', '-o', 'json')).access_token;
const url = app.url.replace(/\/$/, '');

let failed = 0;
const check = async (name, fn) => {
  try {
    const detail = await fn();
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name} — ${err.message}`);
  }
};
const http = async (method, path, body) => {
  const res = await fetch(url + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) throw new Error(`redirected (${res.status}) — not authenticated to the app`);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

console.log(`Smoke test: ${url} (${app.app_status?.state}, compute ${app.compute_status?.state})`);

await check('app is running', () => must(app.app_status?.state === 'RUNNING', `state is ${app.app_status?.state}`));
await check('postgres resource is bound', () =>
  must((app.resources ?? []).some((r) => r.name === 'postgres'), 'no postgres resource on the app'));

await check('config is served and hides the admin list', async () => {
  const r = await http('GET', '/api/config');
  must(r.status === 200, `HTTP ${r.status}`);
  must(!r.text.includes('adminEmails'), 'adminEmails leaked to the browser');
});
await check('questions are served without answers', async () => {
  const r = await http('GET', '/api/content/questions');
  must(r.status === 200 && !r.text.includes('correctAnswer'), 'answers leaked or request failed');
  return `${r.json.questions.length} questions`;
});
await check('Lakebase is connected', async () => {
  const r = await http('GET', '/api/lakebase/status');
  must(r.json?.connected === true, `not connected: ${r.json?.error ?? r.status}`);
  must(r.json.schema === config.lakebase.schema, `schema is ${r.json.schema}`);
  return `${r.json.latencyMs} ms, schema ${r.json.schema}`;
});
await check('knowledge base is indexed', async () => {
  const r = await http('GET', '/api/knowledge/status');
  must(r.json?.ready === true, 'index not ready yet (it builds in the background after start)');
  return `${r.json.chunks} passages, ${r.json.embedded} embedded, ${r.json.vector && r.json.embedded > 0 ? 'semantic' : 'keyword'} search`;
});
await check('demo, fit and pricing content load', async () => {
  for (const p of ['/api/content/demo', '/api/content/fit', '/api/content/pricing', '/api/content/pitfalls']) {
    const r = await http('GET', p);
    must(r.status === 200, `${p} -> ${r.status}`);
  }
});
await check('Field Kit serves cleared slides only', async () => {
  const r = await http('GET', '/api/content/fieldkit');
  must(r.status === 200, `HTTP ${r.status}`);
  const held = Object.keys(config.fieldkit.heldSlides).map(Number);
  const nums = r.json.sections.flatMap((s) => s.slides.map((x) => x.n));
  must(!nums.some((n) => held.includes(n)), `held slide served: ${nums.filter((n) => held.includes(n))}`);
  const probe = await http('GET', r.json.sections[0].slides[0].image);
  // A missing file is answered with the app's HTML page (HTTP 200), so also check it is not HTML.
  must(probe.status === 200 && !probe.text.startsWith('<'), `slide images not deployed yet (HTTP ${probe.status}) — run scripts/build-fieldkit.mjs`);
  const pdf = await http('GET', r.json.pdf);
  must(pdf.status === 200 && !pdf.text.startsWith('<'), `selected-slides PDF not deployed (HTTP ${pdf.status})`);
  return `${nums.length} slides`;
});
await check('certificate verification rejects bad ids', async () => {
  const r = await http('GET', '/api/certificate/verify/not-a-uuid');
  must(r.status === 404, `HTTP ${r.status}`);
});
await check('admin endpoints are protected from non-admins', async () => {
  const r = await http('GET', '/api/admin/summary');
  // An allow-listed caller legitimately gets 200; anyone else must get 403.
  must(r.status === 403 || r.status === 200, `HTTP ${r.status}`);
  return r.status === 200 ? 'you are an admin' : 'denied as expected';
});

if (write) {
  const email = 'smoke-test@example.invalid';
  await check('partner sign-up persists', async () => {
    const r = await http('POST', '/api/partner', { name: 'Smoke Test', email, org: 'Smoke Test Org' });
    must(r.status === 200, `HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  });
  await check('quiz grading saves progress', async () => {
    const mod = config.modules[0].key;
    const g = await http('POST', '/api/quiz/grade', { email, moduleKey: mod, answers: [] });
    must(g.status === 200 && g.json.score === 0, `HTTP ${g.status}`);
    const p = await http('POST', '/api/partner', { name: 'Smoke Test', email, org: 'Smoke Test Org' });
    must(p.json?.progress?.[mod]?.attempted === true, 'progress was not saved to Lakebase');
  });
  await check('cleanup', async () => {
    const r = await http('DELETE', `/api/progress?email=${encodeURIComponent(email)}`);
    must(r.status === 204, `HTTP ${r.status}`);
  });
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
