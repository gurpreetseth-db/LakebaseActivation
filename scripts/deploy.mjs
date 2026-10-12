#!/usr/bin/env node
/**
 * Config-driven deploy: creates the app if missing, binds the Lakebase `postgres`
 * resource, uploads the source, and deploys. Everything comes from
 * config/app.config.json (deployment.* and lakebase.*).
 *
 *   node scripts/deploy.mjs --profile <PROFILE> [--dry-run] [--skip-create]
 *
 * Order matters: the app (and so its service principal) is created and bound
 * BEFORE first start, so the SP creates and owns the Lakebase schema.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const profile = opt('--profile');
const dryRun = args.includes('--dry-run');

const config = JSON.parse(readFileSync(new URL('../config/app.config.json', import.meta.url), 'utf8'));
const { appName, description, space, sourcePath } = config.deployment;
const { branch, database } = config.lakebase;

const base = profile ? ['--profile', profile] : [];
const dbx = (...a) => execFileSync('databricks', [...a, ...base], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const step = (msg) => console.log(`\n==> ${msg}`);

const me = JSON.parse(dbx('current-user', 'me', '-o', 'json')).userName;
const target = sourcePath || `/Workspace/Users/${me}/apps/${appName}`;

let exists = true;
try {
  dbx('apps', 'get', appName, '-o', 'json');
} catch {
  exists = false;
}

const plan = [
  exists ? `app ${appName} exists` : `create app ${appName}${space ? ` in space ${space}` : ' (no space)'}`,
  `bind postgres resource -> ${branch} / ${database}`,
  `grant CAN_QUERY on embedding endpoint ${config.ai.embeddingEndpoint} (non-fatal)`,
  `sync source -> ${target}`,
  `deploy ${appName}`,
];
console.log(plan.map((p, i) => `${i + 1}. ${p}`).join('\n'));
if (dryRun) process.exit(0);

if (!exists && !args.includes('--skip-create')) {
  step('Creating app');
  console.log(
    dbx(
      'apps',
      'create',
      appName,
      '--description',
      description,
      ...(space ? ['--space', space] : []),
      '--no-compute',
      '--no-wait', // a compute-less app never reaches ACTIVE; we start it before deploying
    ),
  );
}

// update_mask=resources REPLACES the list, so always read-merge-write by name.
function bindResource(resource) {
  const current = JSON.parse(dbx('apps', 'get', appName, '-o', 'json'));
  const resources = [...(current.resources ?? []).filter((r) => r.name !== resource.name), resource];
  const file = join(mkdtempSync(join(tmpdir(), 'deploy-')), 'update.json');
  writeFileSync(file, JSON.stringify({ update_mask: 'resources', app: { resources } }));
  return dbx('apps', 'create-update', appName, '--json', `@${file}`);
}

step('Binding Lakebase resource');
console.log(bindResource({ name: 'postgres', postgres: { branch, database, permission: 'CAN_CONNECT_AND_CREATE' } }));

// The app's own identity embeds the knowledge base. Optional: without it the
// assistant falls back to keyword search, so a failure here must not stop the deploy.
if (config.ai.enabled && config.ai.embeddingEndpoint) {
  step(`Granting the app CAN_QUERY on ${config.ai.embeddingEndpoint}`);
  try {
    console.log(
      bindResource({
        name: 'embedding-endpoint',
        serving_endpoint: { name: config.ai.embeddingEndpoint, permission: 'CAN_QUERY' },
      }),
    );
  } catch (err) {
    console.warn(`WARNING: could not bind the embedding endpoint (${String(err.stderr ?? err.message).trim()}).`);
    console.warn('Ask Lakebase will use keyword search until the app can query that endpoint.');
  }
}

step('Uploading source');
console.log(dbx('sync', '.', target, '--full'));

const compute = JSON.parse(dbx('apps', 'get', appName, '-o', 'json')).compute_status?.state;
if (compute === 'STOPPED') {
  step('Starting app compute');
  console.log(dbx('apps', 'start', appName));
}

step('Deploying');
console.log(dbx('apps', 'deploy', appName, '--source-code-path', target));
console.log(`\nDone. Open: ${JSON.parse(dbx('apps', 'get', appName, '-o', 'json')).url}`);
