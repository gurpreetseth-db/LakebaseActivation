import { describe, expect, test } from 'vitest';
import { createRepo, normalizeEmail } from './repo.js';
import { assertIdentifier, ensureSchema, schemaStatements, type Queryable } from './schema.js';

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
    expect(calls[0].text).toMatch(/CREATE SCHEMA/);
    expect(calls.length).toBe(schemaStatements('my_schema').length);
  });
});

describe('repo', () => {
  test('normalizes email and binds values as parameters', async () => {
    const { db, calls } = fakeDb();
    const repo = createRepo(db, 'my_schema');
    expect(normalizeEmail('  Jo@Partner.COM ')).toBe('jo@partner.com');
    await repo.upsertPartner({ name: ' Jo ', email: ' Jo@Partner.COM ', org: ' Acme ' });
    expect(calls[0].params).toEqual(['jo@partner.com', 'Jo', 'Acme']);
    expect(calls[0].text).not.toContain('Acme');
  });

  test('recordAttempt writes the attempt then upserts latest progress', async () => {
    const { db, calls } = fakeDb();
    await createRepo(db, 'my_schema').recordAttempt('a@b.co', 'fundamentals', {
      score: 80,
      correct: 4,
      total: 5,
      answers: { '1.1': 'B' },
    });
    expect(calls.map((c) => c.text.includes('quiz_attempts') || c.text.includes('module_progress'))).toEqual([true, true]);
    expect(calls[1].text).toMatch(/ON CONFLICT \(email, module_key\)/);
  });

  test('refuses an unsafe schema name', () => {
    expect(() => createRepo(fakeDb().db, 'x; drop')).toThrow();
  });
});
