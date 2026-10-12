#!/usr/bin/env node
/**
 * OPTIONAL: stream the app's Postgres schema into Unity Catalog with Lakehouse Sync
 * (Beta) so program data can be analysed in the lakehouse. Target comes from
 * config/app.config.json -> program.lakehouseSync and lakebase.*.
 *
 *   node scripts/enable-lakehouse-sync.mjs --profile <PROFILE>            # plan only
 *   node scripts/enable-lakehouse-sync.mjs --profile <PROFILE> --apply    # create the CDF config
 *
 * The CDF config is immutable once created, and it replicates EVERY table in the
 * schema — including partner names and emails — into Unity Catalog. Review who can
 * read the target schema before applying.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const profile = opt('--profile');
const apply = args.includes('--apply');

const config = JSON.parse(readFileSync(new URL('../config/app.config.json', import.meta.url), 'utf8'));
const { catalog, schema, cdfConfigId } = config.program.lakehouseSync;
const { database, schema: pgSchema } = config.lakebase;

if (!catalog || !schema) {
  console.error('Set program.lakehouseSync.catalog and .schema in config/app.config.json first.');
  process.exit(1);
}

const cmd = ['postgres', 'create-cdf-config', database, catalog, schema, pgSchema, '--cdf-config-id', cdfConfigId];
if (profile) cmd.push('--profile', profile);

console.log(`Replicate Postgres schema "${pgSchema}" (${database})\n  -> Unity Catalog ${catalog}.${schema} as lb_<table>_history tables`);
console.log(`\ndatabricks ${cmd.join(' ')}\n`);
if (!apply) {
  console.log('Plan only. Re-run with --apply to create it.');
  process.exit(0);
}
console.log(execFileSync('databricks', cmd, { encoding: 'utf8' }));
