import type { Hit } from './store.js';

export interface Citation {
  n: number;
  title: string;
  source: string;
}

const SYSTEM =
  'You are the Lakebase Partner Readiness assistant for Databricks partners. ' +
  'Answer ONLY from the numbered context below. If the context does not contain the answer, say you do not know ' +
  'and suggest the official Lakebase documentation. Cite sources inline like [1] or [2]. ' +
  'Be concise (under 200 words), practical and accurate; never invent limits, prices or features.';

export function buildAskPrompt(question: string, hits: Hit[]): string {
  const context = hits.map((h, i) => `[${i + 1}] ${h.title} (${h.source})\n${h.content}`).join('\n\n');
  return `${SYSTEM}\n\nContext:\n${context || '(no relevant context found)'}\n\nQuestion: ${question}\n\nAnswer:`;
}

export function citationsFor(hits: Hit[]): Citation[] {
  return hits.map((h, i) => ({ n: i + 1, title: h.title, source: h.source }));
}
