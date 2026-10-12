import { describe, expect, test } from 'vitest';
import { loadConfig, loadDemo, loadFit, loadKnowledge, loadModules, loadPricing, loadQuestions } from '../content/loader.js';
import { buildChunks, splitText } from './chunks.js';
import { buildAskPrompt, buildPlanNotes, citationsFor } from './rag.js';
import { search, syncChunks, toVector } from './store.js';
import type { Queryable } from '../db/schema.js';

const chunks = buildChunks({
  config: loadConfig(),
  modules: loadModules(),
  questions: loadQuestions(),
  fit: loadFit(),
  demo: loadDemo(),
  knowledge: loadKnowledge(),
});

function fakeDb(existing: { id: string; content_hash: string; has_vec: boolean }[] = []) {
  const calls: { text: string; params?: unknown[] }[] = [];
  const db: Queryable = {
    query(text, params) {
      calls.push({ text, params });
      if (text.includes('SELECT id, content_hash')) return Promise.resolve({ rows: existing });
      return Promise.resolve({ rows: [] });
    },
  };
  return { db, calls };
}

describe('chunks', () => {
  test('ids are unique and every chunk has content', () => {
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of chunks) {
      expect(c.content.length).toBeGreaterThan(0);
      expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('covers curated knowledge, modules, labs and quiz content', () => {
    const prefixes = new Set(chunks.map((c) => c.id.split(':')[0]));
    for (const p of ['kb', 'mod', 'lab', 'qa', 'fit', 'demo']) expect(prefixes.has(p)).toBe(true);
  });

  test('splitText keeps paragraphs whole and respects the limit', () => {
    const parts = splitText('a'.repeat(700) + '\n\n' + 'b'.repeat(700), 1000);
    expect(parts).toHaveLength(2);
    expect(splitText('short', 1000)).toEqual(['short']);
  });

  test('knowledge entries only reference real modules', () => {
    const keys = new Set(loadConfig().modules.map((m) => m.key));
    for (const e of loadKnowledge().entries) expect(keys.has(e.module), e.id).toBe(true);
  });

  test('pricing content never stores rates and links to the public page', () => {
    const p = loadPricing();
    expect(p.pageUrl).toMatch(/databricks\.com\/product\/pricing\/lakebase/);
    expect(JSON.stringify(p)).not.toMatch(/\$\s?\d/);
    expect(p.regions.length).toBeGreaterThan(0);
  });
});

describe('store', () => {
  test('unchanged chunks are not rewritten and stale ones are removed', async () => {
    const first = chunks[0];
    const { db, calls } = fakeDb([
      { id: first.id, content_hash: first.hash, has_vec: false },
      { id: 'kb:gone', content_hash: 'x', has_vec: false },
    ]);
    const res = await syncChunks(db, 'my_schema', chunks, null, false);
    expect(res.updated).toBe(chunks.length - 1);
    expect(res.removed).toBe(1);
    expect(calls.some((c) => c.text.includes('DELETE FROM') && (c.params?.[0] as string[]).includes('kb:gone'))).toBe(true);
    expect(calls.filter((c) => c.text.startsWith('INSERT')).length).toBe(chunks.length - 1);
  });

  test('embeds only the chunks that changed, in order', async () => {
    const { db, calls } = fakeDb(chunks.slice(2).map((c) => ({ id: c.id, content_hash: c.hash, has_vec: true })));
    const seen: string[][] = [];
    const embed = (texts: string[]) => {
      seen.push(texts);
      return Promise.resolve(texts.map(() => [0.1, 0.2]));
    };
    const res = await syncChunks(db, 'my_schema', chunks, embed, true);
    expect(res.embedded).toBe(true);
    expect(seen[0]).toHaveLength(2);
    const inserts = calls.filter((c) => c.text.startsWith('INSERT'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params?.[5]).toBe(toVector([0.1, 0.2]));
  });

  test('falls back to keyword rows when embedding fails', async () => {
    const { db, calls } = fakeDb();
    const embed = () => Promise.reject(new Error('boom'));
    const res = await syncChunks(db, 'my_schema', chunks.slice(0, 2), embed, true);
    expect(res.embedded).toBe(false);
    expect(calls.filter((c) => c.text.startsWith('INSERT'))[0].text).not.toContain('embedding');
  });

  test('search uses vectors when given and keywords otherwise; refuses bad schema', async () => {
    const rows = [{ id: 'a', source: 's', title: 't', content: 'c', score: 0.9 }];
    const db: Queryable = { query: () => Promise.resolve({ rows }) };
    expect((await search(db, 'my_schema', 'q', [1, 2], 3)).mode).toBe('vector');
    expect((await search(db, 'my_schema', 'q', null, 3)).mode).toBe('keyword');
    await expect(search(db, 'x; drop', 'q', null, 3)).rejects.toThrow();
  });

  test('empty vector results fall through to keyword search', async () => {
    let n = 0;
    const db: Queryable = {
      query: () => Promise.resolve({ rows: n++ === 0 ? [] : [{ id: 'a', source: 's', title: 't', content: 'c', score: 1 }] }),
    };
    expect((await search(db, 'my_schema', 'q', [1], 3)).mode).toBe('keyword');
  });
});

describe('rag', () => {
  const hits = [
    { id: 'a', source: 'Lakebase reference', title: 'Scale to zero', content: 'Default 5 minutes.', score: 1 },
    { id: 'b', source: 'Module: X', title: 'X', content: 'More.', score: 0.5 },
  ];

  test('prompt numbers the context and carries the question', () => {
    const p = buildAskPrompt('How long until it suspends?', hits);
    expect(p).toContain('[1] Scale to zero');
    expect(p).toContain('[2] X');
    expect(p).toContain('Question: How long until it suspends?');
    expect(citationsFor(hits)).toEqual([
      { n: 1, title: 'Scale to zero', source: 'Lakebase reference' },
      { n: 2, title: 'X', source: 'Module: X' },
    ]);
  });

  test('an empty context is stated explicitly rather than invented', () => {
    expect(buildAskPrompt('q', [])).toContain('(no relevant context found)');
  });

  test('plan notes are empty without hits and bounded otherwise', () => {
    expect(buildPlanNotes([{ module: 'M', hits: [] }])).toBe('');
    expect(buildPlanNotes([{ module: 'M', hits: [{ ...hits[0], content: 'z'.repeat(1000) }] }]).length).toBeLessThan(600);
  });
});
