import { describe, expect, test } from 'vitest';
import { createRepo } from './repo.js';
import { generateLearnerCode, hashLearnerCode, isWellFormedCode, normalizeLearnerCode } from './learner-code.js';
import { assertIdentifier, ensureSchema, legacyMigrationSql, schemaStatements, type Queryable } from './schema.js';

function fakeDb() {
  const calls: { text: string; params?: unknown[] }[] = [];
  const db: Queryable = {
    query(text, params) {
      calls.push({ text, params });
      return Promise.resolve({ rows: [] });
    },
  };
  return { db, calls };
}

describe('schema', () => {
  test('rejects unsafe identifiers', () => {
    expect(() => assertIdentifier('partner_activation')).not.toThrow();
    for (const bad of ['Robert; DROP TABLE x', 'a-b', '1abc', '', 'UPPER', 'a'.repeat(64)]) {
      expect(() => assertIdentifier(bad)).toThrow();
    }
  });

  test('every statement is idempotent and scoped to the configured schema', () => {
    for (const stmt of schemaStatements('my_schema')) {
      expect(stmt).toMatch(/IF NOT EXISTS/);
      expect(stmt).toMatch(/my_schema/);
    }
  });

  test('ensureSchema issues the schema before any table', async () => {
    const { db, calls } = fakeDb();
    await ensureSchema(db, 'my_schema');
    // First call is the legacy-schema probe, then the schema and tables.
    expect(calls[1].text).toMatch(/CREATE SCHEMA/);
    expect(calls.length).toBe(schemaStatements('my_schema').length + 1);
  });

  test('stores no email or personal name anywhere', () => {
    const ddl = schemaStatements('my_schema').join('\n');
    expect(ddl).not.toMatch(/\bemail\b/i);
    expect(ddl).not.toMatch(/\bname\b\s+TEXT/i);
    expect(ddl).not.toMatch(/certificates/i);
    // Everything hangs off learners with cascade, so one delete erases a person.
    expect(ddl.match(/REFERENCES my_schema\.learners\(id\) ON DELETE CASCADE/g)).toHaveLength(4);
  });

  test('a legacy email-keyed schema is never converted silently', async () => {
    const db: Queryable = { query: () => Promise.resolve({ rows: [{ '?column?': 1 }] }) };
    await expect(ensureSchema(db, 'my_schema')).rejects.toThrow(/pii_migrate=true/);
  });

  test('with the migration flag it converts atomically, then ensures the new schema', async () => {
    const calls: string[] = [];
    let probed = false;
    const db: Queryable = {
      query(text) {
        calls.push(text);
        const first = !probed && text.includes('information_schema');
        if (first) probed = true;
        return Promise.resolve({ rows: first ? [{ x: 1 }] : [] });
      },
    };
    await ensureSchema(db, 'my_schema', { migrateLegacy: true });
    expect(calls[1]).toBe(legacyMigrationSql('my_schema'));
    expect(calls[2]).toMatch(/CREATE SCHEMA/);
  });

  test('the migration drops email and name and uses no explicit transaction control', () => {
    const sql = legacyMigrationSql('my_schema');
    expect(sql).toMatch(/DROP COLUMN email CASCADE/);
    expect(sql).toMatch(/DROP COLUMN name/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS my_schema\.certificates/);
    expect(sql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
  });
});

describe('learner codes', () => {
  test('are 16 unambiguous characters in groups of four, and unique', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateLearnerCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
      expect(c).not.toMatch(/[ILO01]/);
      expect(isWellFormedCode(c)).toBe(true);
    }
  });

  test('hash ignores case and separators, and the hash does not contain the code', () => {
    const c = generateLearnerCode();
    expect(hashLearnerCode(c.toLowerCase().replace(/-/g, ' '))).toBe(hashLearnerCode(c));
    expect(hashLearnerCode(c)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLearnerCode(c)).not.toContain(normalizeLearnerCode(c));
  });

  test('rejects malformed codes before they reach the database', () => {
    for (const bad of ['', 'short', 'ABCD-EFGH-JKMN-PQRS-TUVW', 'ABCD-EFGH-JKMN-PQR!', 'IIII-OOOO-0000-1111']) {
      expect(isWellFormedCode(bad)).toBe(false);
    }
  });
});

describe('repo', () => {
  test('register stores only the code hash, company and nickname, and returns the clear code once', async () => {
    const calls: { text: string; params?: unknown[] }[] = [];
    const db: Queryable = {
      query(text, params) {
        calls.push({ text, params });
        return Promise.resolve({ rows: [{ id: 'l-1', org: 'Acme', nickname: null, leaderboard_opt_in: false }] });
      },
    };
    const { learner, code } = await createRepo(db, 'my_schema').register(' Acme ', '  ');
    expect(isWellFormedCode(code)).toBe(true);
    expect(calls[0].params).toEqual([hashLearnerCode(code), 'Acme', null]);
    expect(JSON.stringify(calls)).not.toContain(normalizeLearnerCode(code));
    expect(learner).toMatchObject({ id: 'l-1', org: 'Acme' });
  });

  test('authenticate skips the database for malformed codes and hashes the rest', async () => {
    const { db, calls } = fakeDb();
    const repo = createRepo(db, 'my_schema');
    expect(await repo.authenticate(undefined)).toBeNull();
    expect(await repo.authenticate('nope')).toBeNull();
    expect(calls).toHaveLength(0);
    expect(await repo.authenticate('abcd-efgh-jkmn-pqrs')).toBeNull();
    expect(calls[0].params).toEqual([hashLearnerCode('ABCDEFGHJKMNPQRS')]);
    expect(calls[0].text).toMatch(/last_seen_at = NOW\(\)/);
  });

  test('recordAttempt writes the attempt then upserts latest progress', async () => {
    const { db, calls } = fakeDb();
    await createRepo(db, 'my_schema').recordAttempt('l-1', 'fundamentals', {
      score: 80,
      correct: 4,
      total: 5,
      answers: { '1.1': 'B' },
    });
    expect(calls.map((c) => c.text.includes('quiz_attempts') || c.text.includes('module_progress'))).toEqual([true, true]);
    expect(calls[1].text).toMatch(/ON CONFLICT \(learner_id, module_key\)/);
  });

  test('resetting progress clears results but not the learner', async () => {
    const { db, calls } = fakeDb();
    await createRepo(db, 'my_schema').deleteProgress('l-1');
    expect(calls.map((c) => c.text).join('\n')).not.toMatch(/FROM my_schema\.learners/);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => (c.params as unknown[])[0] === 'l-1')).toBe(true);
  });

  test('erase deletes the learner (cascading) and keeps a pseudonymous record of who approved it', async () => {
    const calls: { text: string; params?: unknown[] }[] = [];
    const db: Queryable = {
      query(text, params) {
        calls.push({ text, params });
        return Promise.resolve({ rows: text.startsWith('SELECT') ? [{ learner_id: 'l-9' }] : [] });
      },
    };
    expect(await createRepo(db, 'my_schema').erase(5, 'admin@x.com')).toBe(true);
    expect(calls[1].text).toMatch(/DELETE FROM my_schema\.learners WHERE id = \$1/);
    expect(calls[1].params).toEqual(['l-9']);
    expect(calls[2].text).toMatch(/status = 'erased'/);
    expect(calls[2].params).toEqual([5, 'admin@x.com']);
  });

  test('erase does nothing for an unknown or already-closed request', async () => {
    const { db, calls } = fakeDb();
    expect(await createRepo(db, 'my_schema').erase(5, 'admin@x.com')).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test('retention purges inactive learners and old Ask log rows with bound day counts', async () => {
    const { db, calls } = fakeDb();
    await createRepo(db, 'my_schema').purgeExpired(30);
    expect(calls[0].text).toMatch(/DELETE FROM my_schema\.learners WHERE last_seen_at < NOW\(\) - make_interval\(days => \$1\)/);
    expect(calls[1].text).toMatch(/DELETE FROM my_schema\.ask_log WHERE created_at/);
    expect(calls.map((c) => c.params)).toEqual([[30], [30]]);
  });

  test('refuses an unsafe schema name', () => {
    expect(() => createRepo(fakeDb().db, 'x; drop')).toThrow();
  });
});
