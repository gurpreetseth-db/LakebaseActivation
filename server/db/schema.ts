/**
 * Idempotent schema bootstrap for the partner-activation data, owned by the app
 * service principal (deploy first, so the SP creates and owns the schema).
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
    `CREATE TABLE IF NOT EXISTS ${s}.partners (
       email         TEXT PRIMARY KEY,
       name          TEXT NOT NULL,
       org           TEXT NOT NULL,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    // Added after the first release; opt-in keeps partner names private by default.
    `ALTER TABLE ${s}.partners ADD COLUMN IF NOT EXISTS leaderboard_opt_in BOOLEAN NOT NULL DEFAULT FALSE`,
    `CREATE TABLE IF NOT EXISTS ${s}.certificates (
       id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       email         TEXT NOT NULL UNIQUE REFERENCES ${s}.partners(email) ON DELETE CASCADE,
       overall_score INTEGER NOT NULL,
       level         TEXT NOT NULL,
       issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.module_progress (
       email         TEXT NOT NULL REFERENCES ${s}.partners(email) ON DELETE CASCADE,
       module_key    TEXT NOT NULL,
       score         INTEGER NOT NULL,
       correct       INTEGER NOT NULL,
       total         INTEGER NOT NULL,
       answers       JSONB NOT NULL DEFAULT '{}',
       attempts      INTEGER NOT NULL DEFAULT 1,
       completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (email, module_key)
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.quiz_attempts (
       id            BIGSERIAL PRIMARY KEY,
       email         TEXT NOT NULL REFERENCES ${s}.partners(email) ON DELETE CASCADE,
       module_key    TEXT NOT NULL,
       score         INTEGER NOT NULL,
       correct       INTEGER NOT NULL,
       total         INTEGER NOT NULL,
       answers       JSONB NOT NULL DEFAULT '{}',
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS quiz_attempts_email_module_idx
       ON ${s}.quiz_attempts (email, module_key, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS ${s}.lab_checks (
       email         TEXT NOT NULL REFERENCES ${s}.partners(email) ON DELETE CASCADE,
       module_key    TEXT NOT NULL,
       status        TEXT NOT NULL,
       detail        JSONB NOT NULL DEFAULT '{}',
       checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (email, module_key)
     )`,
    `CREATE TABLE IF NOT EXISTS ${s}.ask_log (
       id            BIGSERIAL PRIMARY KEY,
       email         TEXT,
       question      TEXT NOT NULL,
       answer        TEXT NOT NULL,
       mode          TEXT NOT NULL,
       sources       JSONB NOT NULL DEFAULT '[]',
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  ];
}

/** Creates the schema and tables if missing. Safe to run on every startup. */
export async function ensureSchema(db: Queryable, schema: string): Promise<void> {
  for (const statement of schemaStatements(schema)) {
    await db.query(statement);
  }
}
