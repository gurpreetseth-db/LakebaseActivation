#!/usr/bin/env node
/**
 * OPTIONAL: stream the app's Postgres schema into Unity Catalog with Lakehouse Sync
 * (Beta) so program data can be analysed in the lakehouse. Run through the bundle, which
 * supplies auth and the settings from databricks.yml variables (lakehouse_sync_*, lakebase_*):
 *
 *   databricks bundle run enable_lakehouse_sync -t <TARGET> -p <PROFILE>            # plan only
 *   databricks bundle run enable_lakehouse_sync -t <TARGET> -p <PROFILE> -- --apply # create the CDF config
 *
 * The CDF config is immutable once created, and it replicates EVERY table in the
 * schema, including partner names and emails, into Unity Catalog. Review who can
 * read the target schema before applying.
 */
import { execFileSync } from 'node:child_process';

const apply = process.argv.slice(2).includes('--apply');
const need = (n) => process.env[n] || (console.error(`${n} is not set: run this through \`databricks bundle run enable_lakehouse_sync\``), process.exit(2));

const catalog = process.env.LAKEHOUSE_SYNC_CATALOG;
const schema = process.env.LAKEHOUSE_SYNC_SCHEMA;
const cdfConfigId = need('LAKEHOUSE_SYNC_CDF_CONFIG_ID');
const database = need('LAKEBASE_DATABASE');
const pgSchema = need('LAKEBASE_SCHEMA');

if (!catalog || !schema) {
  console.error('Set the lakehouse_sync_catalog and lakehouse_sync_schema variables in databricks.yml first.');
  process.exit(1);
}

const cmd = ['postgres', 'create-cdf-config', database, catalog, schema, pgSchema, '--cdf-config-id', cdfConfigId];

console.log(`Replicate Postgres schema "${pgSchema}" (${database})\n  -> Unity Catalog ${catalog}.${schema} as lb_<table>_history tables`);
console.log(`\ndatabricks ${cmd.join(' ')}\n`);
if (!apply) {
  console.log('Plan only. Re-run with --apply to create it.');
  process.exit(0);
}
console.log(execFileSync('databricks', cmd, { encoding: 'utf8' }));
