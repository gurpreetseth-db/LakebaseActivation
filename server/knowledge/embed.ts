import { WorkspaceClient } from '@databricks/sdk-experimental';

export type Embedder = (texts: string[]) => Promise<number[][]>;

const BATCH = 16;

/**
 * Embeds text with a Databricks embedding endpoint using the app's own identity
 * (service principal in Databricks Apps). Failures propagate so callers can fall
 * back to keyword search.
 */
export function createEmbedder(endpoint: string, dimensions: number): Embedder {
  const client = new WorkspaceClient({});
  return async (texts) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const res = await client.servingEndpoints.query({ name: endpoint, input: texts.slice(i, i + BATCH) });
      const data = [...(res.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (data.length !== texts.slice(i, i + BATCH).length) throw new Error('Embedding endpoint returned an unexpected count');
      for (const d of data) {
        const v = d.embedding ?? [];
        if (v.length !== dimensions) {
          throw new Error(`Embedding has ${v.length} dimensions but config expects ${dimensions}`);
        }
        out.push(v);
      }
    }
    return out;
  };
}
