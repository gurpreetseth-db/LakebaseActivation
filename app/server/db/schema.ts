/**
 * Idempotent schema bootstrap for the partner-activation data, owned by the app
 * service principal (deploy first, so the SP creates and owns the schema).
 *
 * Privacy by design: no email, no personal name. A learner is a random id plus the company they named,
 * an optional self-chosen nickname, and the hash of a learner code (see learner-code.ts). Every other
 * table hangs off `learners(id) ON DELETE CASCADE`, so erasing one row erases the person everywhere.
 *
 * The schema name comes from config (lakebase.schema), validated in loader.ts to
 * be a safe lowercase identifier, because identifiers cannot be bound as params.
 */

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function assertIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid Postgres identifier: ${name}`);
  return name;
}

export function schemaStatements(schema: string): string[] {
  const s = assertIdentifier(schema);
  return [
    `CREATE SCHEMA IF NOT EXISTS ${s}`,
    `CREATE TABLE IF NOT EXISTS ${s}.learners (
       id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       code_hash          TEXT NOT NULL UNIQUE,
       org                TEXT NOT NULL,
       nickname           TEXT,
       leaderboard_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
       created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.module_progress (
       learner_id    TEXT NOT NULL REFERENCES ${s}.learners(id) ON DELETE CASCADE,
       module_key    TEXT NOT NULL,
       score         INTEGER NOT NULL,
       correct       INTEGER NOT NULL,
       total         INTEGER NOT NULL,
       answers       JSONB NOT NULL DEFAULT '{}',
       attempts      INTEGER NOT NULL DEFAULT 1,
       completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (learner_id, module_key)
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.quiz_attempts (
       id            BIGSERIAL PRIMARY KEY,
       learner_id    TEXT NOT NULL REFERENCES ${s}.learners(id) ON DELETE CASCADE,
       module_key    TEXT NOT NULL,
       score         INTEGER NOT NULL,
       correct       INTEGER NOT NULL,
       total         INTEGER NOT NULL,
       answers       JSONB NOT NULL DEFAULT '{}',
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS quiz_attempts_learner_module_idx
       ON ${s}.quiz_attempts (learner_id, module_key, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS ${s}.lab_checks (
       learner_id    TEXT NOT NULL REFERENCES ${s}.learners(id) ON DELETE CASCADE,
       module_key    TEXT NOT NULL,
       status        TEXT NOT NULL,
       detail        JSONB NOT NULL DEFAULT '{}',
       checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (learner_id, module_key)
     )`,
    // Free text can contain personal data, so rows are short-lived (retention purge) and
    // are deleted with the learner.
    `CREATE TABLE IF NOT EXISTS ${s}.ask_log (
       id            BIGSERIAL PRIMARY KEY,
       learner_id    TEXT REFERENCES ${s}.learners(id) ON DELETE CASCADE,
       question      TEXT NOT NULL,
       answer        TEXT NOT NULL,
       mode          TEXT NOT NULL,
       sources       JSONB NOT NULL DEFAULT '[]',
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    // Deletion requests go to the admin. No FK: the row outlives the learner as the erasure record
    // (pseudonymous id, dates, approving admin; no personal data about the learner).
    `CREATE TABLE IF NOT EXISTS ${s}.data_requests (
       id            BIGSERIAL PRIMARY KEY,
       learner_id    TEXT NOT NULL,
       org           TEXT NOT NULL,
       status        TEXT NOT NULL DEFAULT 'pending',
       requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       completed_at  TIMESTAMPTZ,
       completed_by  TEXT
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS data_requests_one_pending_idx
       ON ${s}.data_requests (learner_id) WHERE status = 'pending'`,
  ];
}

/**
 * Converts a database created before PII minimisation (partners keyed by email, with names and
 * certificates) in place: each partner gets a random learner id and an unusable code hash, all
 * progress is re-keyed to it, then email, name and certificates are dropped. Sent as ONE multi-statement
 * simple query, which Postgres runs as a single implicit transaction (all or nothing). Run only when PII_MIGRATE=true.
 */
export function legacyMigrationSql(schema: string): string {
  const s = assertIdentifier(schema);
  const children = ['module_progress', 'quiz_attempts', 'lab_checks', 'ask_log'];
  return [
    `ALTER TABLE ${s}.partners ADD COLUMN learner_id TEXT`,
    `ALTER TABLE ${s}.partners ADD COLUMN code_hash TEXT`,
    // No learner can present this hash, so migrated learners must start again with a new code.
    `UPDATE ${s}.partners SET learner_id = gen_random_uuid()::text,
       code_hash = encode(sha256(gen_random_uuid()::text::bytea), 'hex')`,
    ...children.flatMap((t) => [
      `ALTER TABLE ${s}.${t} ADD COLUMN learner_id TEXT`,
      `UPDATE ${s}.${t} c SET learner_id = p.learner_id FROM ${s}.partners p WHERE p.email = c.email`,
      // Dropping email also drops the foreign key and any primary key that included it.
      `ALTER TABLE ${s}.${t} DROP COLUMN email CASCADE`,
    ]),
    `DROP TABLE IF EXISTS ${s}.certificates`,
    `ALTER TABLE ${s}.partners DROP COLUMN email CASCADE`,
    `ALTER TABLE ${s}.partners DROP COLUMN name`,
    `ALTER TABLE ${s}.partners ADD COLUMN nickname TEXT`,
    `ALTER TABLE ${s}.partners RENAME COLUMN learner_id TO id`,
    `ALTER TABLE ${s}.partners ALTER COLUMN id SET DEFAULT gen_random_uuid()::text`,
    `ALTER TABLE ${s}.partners ALTER COLUMN code_hash SET NOT NULL`,
    `ALTER TABLE ${s}.partners ADD PRIMARY KEY (id)`,
    `ALTER TABLE ${s}.partners ADD CONSTRAINT learners_code_hash_key UNIQUE (code_hash)`,
    `ALTER TABLE ${s}.partners RENAME TO learners`,
    `DELETE FROM ${s}.module_progress WHERE learner_id IS NULL`,
    `DELETE FROM ${s}.quiz_attempts WHERE learner_id IS NULL`,
    `DELETE FROM ${s}.lab_checks WHERE learner_id IS NULL`,
    `ALTER TABLE ${s}.module_progress ALTER COLUMN learner_id SET NOT NULL`,
    `ALTER TABLE ${s}.quiz_attempts ALTER COLUMN learner_id SET NOT NULL`,
    `ALTER TABLE ${s}.lab_checks ALTER COLUMN learner_id SET NOT NULL`,
    `ALTER TABLE ${s}.module_progress ADD PRIMARY KEY (learner_id, module_key)`,
    `ALTER TABLE ${s}.lab_checks ADD PRIMARY KEY (learner_id, module_key)`,
    ...children.map(
      (t) => `ALTER TABLE ${s}.${t} ADD FOREIGN KEY (learner_id) REFERENCES ${s}.learners(id) ON DELETE CASCADE`,
    ),
  ].join(';\n');
}

async function hasLegacyPartners(db: Queryable, s: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'partners' AND column_name = 'email'`,
    [s],
  );
  return rows.length > 0;
}

/**
 * Creates the schema and tables if missing. Safe to run on every startup. A legacy (email-keyed) schema
 * is never touched silently: it is converted only with `migrateLegacy`, otherwise startup fails with
 * instructions and the app keeps working in browser-local mode.
 */
export async function ensureSchema(db: Queryable, schema: string, opts: { migrateLegacy?: boolean } = {}): Promise<void> {
  const s = assertIdentifier(schema);
  if (await hasLegacyPartners(db, s)) {
    if (!opts.migrateLegacy) {
      throw new Error(
        `Schema ${s} still stores emails and names. Back it up if needed, then deploy once with the bundle variable ` +
          'pii_migrate=true to convert it to learner codes (existing learners will need a new code), and set it back to false.',
      );
    }
    await db.query(legacyMigrationSql(s));
  }
  for (const statement of schemaStatements(s)) {
    await db.query(statement);
  }
}
