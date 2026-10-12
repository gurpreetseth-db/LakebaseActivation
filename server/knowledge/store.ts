/**
 * pgvector-backed knowledge store inside the app's own Lakebase schema.
 * Search uses cosine distance when embeddings exist and falls back to Postgres
 * full-text search so the assistant still works if embedding is unavailable.
 */
import { assertIdentifier, type Queryable } from '../db/schema.js';
import type { Chunk } from './chunks.js';
import type { Embedder } from './embed.js';

export interface Hit {
  id: string;
  source: string;
  title: string;
  content: string;
  score: number;
}

export type SearchMode = 'vector' | 'keyword';

export function toVector(v: number[]): string {
  return `[${v.join(',')}]`;
}

export async function ensureKnowledgeSchema(db: Queryable, schema: string, dimensions: number): Promise<boolean> {
  const s = assertIdentifier(schema);
  if (!Number.isInteger(dimensions) || dimensions < 1) throw new Error('Invalid embedding dimensions');
  let vector = true;
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (err) {
    // 42501 = insufficient privilege: the extension is usually already installed.
    if ((err as { code?: string }).code !== '42501') throw err;
  }
  try {
    await db.query(`SELECT '[1]'::vector`);
  } catch {
    vector = false;
  }
  await db.query(`CREATE TABLE IF NOT EXISTS ${s}.knowledge_chunks (
      id           TEXT PRIMARY KEY,
      source       TEXT NOT NULL,
      title        TEXT NOT NULL,
      content      TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      ${vector ? `embedding vector(${dimensions}),` : ''}
      tsv          tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content)) STORED,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS knowledge_chunks_tsv_idx ON ${s}.knowledge_chunks USING GIN (tsv)`);
  return vector;
}

/** Upserts changed chunks (embedding them when possible) and removes stale ones. */
export async function syncChunks(
  db: Queryable,
  schema: string,
  chunks: Chunk[],
  embed: Embedder | null,
  vectorEnabled: boolean,
): Promise<{ total: number; updated: number; removed: number; embedded: boolean }> {
  const s = assertIdentifier(schema);
  const { rows } = await db.query(
    `SELECT id, content_hash, ${vectorEnabled ? '(embedding IS NOT NULL)' : 'FALSE'} AS has_vec FROM ${s}.knowledge_chunks`,
  );
  const existing = new Map(rows.map((r) => [r.id as string, { hash: r.content_hash as string, hasVec: Boolean(r.has_vec) }]));
  const wantVec = Boolean(embed && vectorEnabled);

  const todo = chunks.filter((c) => {
    const e = existing.get(c.id);
    return !e || e.hash !== c.hash || (wantVec && !e.hasVec);
  });

  let vectors: number[][] | null = null;
  if (wantVec && todo.length > 0) {
    try {
      vectors = await embed!(todo.map((c) => `${c.title}\n${c.content}`));
    } catch (err) {
      console.error(`[knowledge] embedding failed, using keyword search only: ${(err as Error).message}`);
    }
  }

  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    if (vectors && vectorEnabled) {
      await db.query(
        `INSERT INTO ${s}.knowledge_chunks (id, source, title, content, content_hash, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)
         ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, title = EXCLUDED.title, content = EXCLUDED.content,
           content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding, updated_at = NOW()`,
        [c.id, c.source, c.title, c.content, c.hash, toVector(vectors[i])],
      );
    } else {
      await db.query(
        `INSERT INTO ${s}.knowledge_chunks (id, source, title, content, content_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, title = EXCLUDED.title, content = EXCLUDED.content,
           content_hash = EXCLUDED.content_hash, updated_at = NOW()`,
        [c.id, c.source, c.title, c.content, c.hash],
      );
    }
  }

  const keep = new Set(chunks.map((c) => c.id));
  const stale = [...existing.keys()].filter((id) => !keep.has(id));
  if (stale.length > 0) await db.query(`DELETE FROM ${s}.knowledge_chunks WHERE id = ANY($1::text[])`, [stale]);

  return { total: chunks.length, updated: todo.length, removed: stale.length, embedded: Boolean(vectors) };
}

export async function search(
  db: Queryable,
  schema: string,
  query: string,
  queryEmbedding: number[] | null,
  k: number,
): Promise<{ mode: SearchMode; hits: Hit[] }> {
  const s = assertIdentifier(schema);
  const limit = Math.max(1, Math.min(k, 20));
  if (queryEmbedding) {
    const { rows } = await db.query(
      `SELECT id, source, title, content, 1 - (embedding <=> $1::vector) AS score
         FROM ${s}.knowledge_chunks WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector LIMIT $2`,
      [toVector(queryEmbedding), limit],
    );
    if (rows.length > 0) return { mode: 'vector', hits: rows.map(toHit) };
  }
  const { rows } = await db.query(
    `SELECT id, source, title, content, ts_rank(tsv, q) AS score
       FROM ${s}.knowledge_chunks, websearch_to_tsquery('english', $1) q
      WHERE tsv @@ q ORDER BY score DESC LIMIT $2`,
    [query, limit],
  );
  return { mode: 'keyword', hits: rows.map(toHit) };
}

export async function stats(db: Queryable, schema: string, vectorEnabled: boolean) {
  const s = assertIdentifier(schema);
  const { rows } = await db.query(
    `SELECT COUNT(*) AS total, ${vectorEnabled ? 'COUNT(embedding)' : '0'} AS embedded FROM ${s}.knowledge_chunks`,
  );
  return { total: Number(rows[0]?.total ?? 0), embedded: Number(rows[0]?.embedded ?? 0) };
}

function toHit(r: Record<string, unknown>): Hit {
  return {
    id: r.id as string,
    source: r.source as string,
    title: r.title as string,
    content: r.content as string,
    score: Number(r.score),
  };
}
