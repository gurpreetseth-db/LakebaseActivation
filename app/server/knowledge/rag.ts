import type { DocRef } from './chunks.js';
import type { Hit } from './store.js';

export interface Citation {
  n: number;
  title: string;
  source: string;
}

const MAX_LINKS = 5;

const SYSTEM =
  'You are the Lakebase Partner Readiness assistant for Databricks partners. ' +
  'Answer ONLY from the numbered context below. If the context does not contain the answer, say you do not know ' +
  'and suggest the official Lakebase documentation. Cite sources inline like [1] or [2]. ' +
  'Do not write URLs or link text yourself; documentation links are added separately. ' +
  'Be concise (under 200 words), practical and accurate; never invent limits, prices or features.';

export function buildAskPrompt(question: string, hits: Hit[]): string {
  const context = hits.map((h, i) => `[${i + 1}] ${h.title} (${h.source})\n${h.content}`).join('\n\n');
  return `${SYSTEM}\n\nContext:\n${context || '(no relevant context found)'}\n\nQuestion: ${question}\n\nAnswer:`;
}

export function citationsFor(hits: Hit[]): Citation[] {
  return hits.map((h, i) => ({ n: i + 1, title: h.title, source: h.source }));
}

/**
 * Documentation links for an answer: the docs attached to the retrieved passages, best match
 * first, de-duplicated by URL. Falls back to the documentation home so there is always a way on.
 */
export function docLinksFor(hits: Hit[], fallback: DocRef, max = MAX_LINKS): DocRef[] {
  const seen = new Set<string>();
  const out: DocRef[] = [];
  for (const h of hits) {
    for (const d of h.docs ?? []) {
      if (seen.has(d.url)) continue;
      seen.add(d.url);
      out.push(d);
      if (out.length >= max) return out;
    }
  }
  return out.length > 0 ? out : [fallback];
}
