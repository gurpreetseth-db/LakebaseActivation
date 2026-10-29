import { createApp, lakebase, server, serving } from '@databricks/appkit';
import { loadConfig, loadDemo, loadFit, loadKnowledge, loadModules, loadQuestions } from './content/loader.js';
import { ensureSchema } from './db/schema.js';
import { createRepo, type Repo } from './db/repo.js';
import { buildChunks } from './knowledge/chunks.js';
import { createEmbedder, type Embedder } from './knowledge/embed.js';
import { ensureKnowledgeSchema, search, stats, syncChunks } from './knowledge/store.js';
import { loadPublicFieldkit } from './content/fieldkit.js';
import { registerRoutes } from './routes.js';
import { registerTracker } from './tracker.js';

// Load config once at startup: content from config/app.config.json, deployment settings from the
// environment (exported by the bundle from the databricks.yml variables). The serving plugin reads
// its endpoint from DATABRICKS_SERVING_ENDPOINT_NAME, so bridge the configured name into it.
const config = loadConfig();
process.env.DATABRICKS_SERVING_ENDPOINT_NAME = config.ai.endpointName;

await createApp({
  plugins: [server(), serving(), ...(config.lakebase.enabled ? [lakebase()] : [])],
  async onPluginsReady(appkit) {
    // Lakebase persistence is best-effort: if the database is unreachable the
    // app keeps working in browser-local mode and /api/lakebase/status says why.
    let repo: Repo | null = null;
    let dbError = config.lakebase.enabled ? 'Not initialised' : 'Disabled (lakebase_enabled=false in databricks.yml)';
    if (config.lakebase.enabled) {
      try {
        const db = appkit.lakebase;
        await ensureSchema(db, config.lakebase.schema);
        repo = createRepo(db, config.lakebase.schema);
        dbError = '';
      } catch (err) {
        dbError = (err as Error).message;
        console.error(`[lakebase] schema init failed: ${dbError}`);
      }
    }

    // --- Knowledge base (pgvector). Built in the background so startup never waits on embeddings. ---
    const corpus = buildChunks({
      config,
      modules: loadModules(),
      questions: loadQuestions(),
      fit: loadFit(),
      demo: loadDemo(),
      knowledge: loadKnowledge(),
      fieldkit: config.fieldkit.enabled ? loadPublicFieldkit(config) : undefined,
    });
    let embedder: Embedder | null = null;
    let vectorEnabled = false;
    let knowledgeReady = false;
    if (repo && config.ai.enabled) {
      try {
        embedder = createEmbedder(config.ai.embeddingEndpoint, config.ai.embeddingDimensions);
      } catch (err) {
        console.error(`[knowledge] embedder unavailable: ${(err as Error).message}`);
      }
      const db = appkit.lakebase;
      void (async () => {
        vectorEnabled = await ensureKnowledgeSchema(db, config.lakebase.schema, config.ai.embeddingDimensions);
        const result = await syncChunks(db, config.lakebase.schema, corpus, embedder, vectorEnabled);
        knowledgeReady = true;
        console.log(`[knowledge] ready: ${JSON.stringify({ ...result, vectorEnabled })}`);
      })().catch((err: Error) => console.error(`[knowledge] sync failed: ${err.message}`));
    }

    // Docs are looked up from the in-memory corpus by chunk id (they are not stored in Postgres).
    const docsById = new Map(corpus.map((c) => [c.id, c.docs]));

    appkit.server.extend((app) => {
      registerTracker(app);
      registerRoutes(app, {
        config,
        repo,
        dbError,
        knowledge: {
          ready: () => knowledgeReady,
          vector: () => vectorEnabled,
          stats: () => stats(appkit.lakebase, config.lakebase.schema, vectorEnabled),
          // Vector search when possible, keyword otherwise.
          retrieve: async (query, k) => {
            if (!knowledgeReady) return { mode: 'keyword' as const, hits: [] };
            let qv: number[] | null = null;
            if (embedder && vectorEnabled) {
              try {
                [qv] = await embedder([query]);
              } catch {
                qv = null;
              }
            }
            const found = await search(appkit.lakebase, config.lakebase.schema, query, qv, k);
            return { ...found, hits: found.hits.map((h) => ({ ...h, docs: docsById.get(h.id) ?? [] })) };
          },
        },
        invokeLlm: (req, body) => appkit.serving().asUser(req as never).invoke(body as never),
      });
    });
  },
}).catch(console.error);
