# Lakebase Partner Readiness

A Databricks App that enables partners on **Databricks Lakebase** (serverless Postgres): guided modules with
hands-on labs, knowledge checks, an AI assistant grounded in Lakebase documentation, a qualification tool, a
program dashboard for the Databricks team, and verifiable certificates.

The app is itself built on Lakebase — progress, quiz attempts, lab status, certificates, the question log and the
vector knowledge base all live in a Postgres schema in a Lakebase project — so the thing partners learn about is the
thing they are using.

## What partners get

| Page | What it does |
|---|---|
| **Dashboard** | 8 learning modules with weighted readiness score and maturity level |
| **Module** | Concept notes, a hands-on lab with a self-reported step checklist, and a shuffled quiz with an AI "explain why I was wrong" |
| **Ask Lakebase** (`/ask`) | RAG assistant with citations, answering only from the app's content and curated reference (pgvector in Lakebase; falls back to keyword search) |
| **Field Kit** (`/fieldkit`) | Cleared slides from the Databricks Lakebase Field Kit in a slide viewer, grouped into seven sections with summaries and takeaways; slide text is searchable through Ask Lakebase, and modules link to related sections |
| **Demo** (`/demo`) | Guided walkthrough of the Brickhouse inventory demo on Databricks Apps + Lakebase |
| **Fit-checker** (`/fit`) | Eight-question qualification tool: blockers (red), risks (yellow), verdict |
| **Pricing** (`/pricing`) | The billing model and a link to the official pricing page (no rates are copied) |
| **Leaderboard** (`/leaderboard`) | Opt-in only; shows first name, last initial and organization |
| **Certificate** (`/certificate`) | Off by default (`program.certificate.enabled`). When on: eligibility is decided on the server from saved scores; printable; publicly verifiable at `/verify/<id>` |
| **Lakebase** (`/lakebase`) | Live connection status, target project/branch/database/schema, latency |
| **Admin** (`/admin`) | Allow-listed admins only: cohort totals, per-module averages and pass rates, hardest questions, recent assistant questions, CSV export |

Identity is the partner's email (no SSO). See [Security notes](#security-notes).

## Architecture

```
React + TypeScript (Vite)  ──►  Express (AppKit)  ──►  Lakebase Postgres  (project/branch/database from config)
   client/                        server/                 schema: partner_activation
                                    │                       partners · module_progress · quiz_attempts
                                    │                       lab_checks · ask_log · certificates
                                    │                       knowledge_chunks (pgvector + full-text)
                                    ├──► Model Serving (chat, on behalf of the user)
                                    └──► Model Serving (embeddings, app identity)
```

- `server/server.ts` — startup wiring only: schema, background knowledge indexing, plugins.
- `server/routes.ts` — every HTTP route, built from an injected context so it is testable without a database.
- `server/db/` — idempotent schema creation (`schema.ts`) and parameterised data access (`repo.ts`).
- `server/knowledge/` — chunking, embedding, pgvector store, retrieval prompts.
- `server/program/` — scoring, admin aggregation, leaderboard, CSV.
- `client/src/pages/` — one file per page.
- `config/` — all editable configuration and content (below).

Persistence is best-effort: if Lakebase is unreachable the app keeps working with browser-local progress, the header
badge shows **Browser only**, and persistence routes return `503` with the reason.

## Configuration

Everything tunable is in files, not code. Edit, redeploy, done.

| File | Controls |
|---|---|
| `databricks.yml` `variables:` | **Every deployment setting**: app name, Lakebase target, admin emails, AI endpoints, Lakehouse Sync target (see [Deploy](#deploy-to-your-own-workspace)) |
| `config/app.config.json` | Branding, onboarding fields, scoring bands and pass threshold, modules and weights, AI limits (tokens, temperature, top-k), leaderboard and certificate rules, Field Kit |
| `config/content/modules.json` | Per-module objectives, overview, lab steps, doc links with a hand-written bullet `summary` each, and `docsCheckedOn` (the date the pages were last read; update it when you re-check them) |
| `config/content/questions.json` | Quiz bank (answers and explanations stay server-side) |
| `config/content/knowledge.json` | Curated reference entries for the assistant; `kind: "gotcha"` entries also appear as common pitfalls |
| `config/content/demo.json` | Demo walkthrough |
| `config/content/fieldkit.json` | Field Kit sections, summaries and per-slide text/notes (cleared slides only) |
| `config/content/fit.json` | Fit-checker questions, flags, verdict rules |
| `config/content/pricing.json` | Pricing explainer, regions, usage query |

All files are validated with zod at startup, so a bad edit fails loudly instead of corrupting the UI. Tests also
check that module weights sum to 100, every question's answer is a valid choice, and the Lakebase paths are consistent.

The platform-injected `LAKEBASE_ENDPOINT` (from the `postgres` app resource) always wins over `lakebase.endpoint`;
`DATABRICKS_SERVING_ENDPOINT_NAME` likewise wins over `ai.endpointName`.

## Prerequisites

- Node.js 22+ and npm
- Databricks CLI ≥ 0.294 (bundle `scripts:` need a recent release; 1.17 verified) with a profile for the target workspace
- An existing Lakebase (Autoscaling) project; its ids go in the `lakebase_*` variables in `databricks.yml`
- Permission to create apps **outside a restricted space** — apps in a space that allows no resource types cannot
  attach the `postgres` resource

## Deploy to your own workspace

Deployment is **Databricks Asset Bundles only**. `databricks.yml` is the single source of truth for every deployment
setting; the app resource, its Lakebase and serving-endpoint bindings, the app's runtime environment and the
post-deploy scripts are all derived from its `variables:` block. Nothing is configured anywhere else.

| What | Variable in `databricks.yml` |
|---|---|
| App name, description | `app_name`, `app_description` |
| Lakebase target | `lakebase_enabled`, `lakebase_project`, `lakebase_branch`, `lakebase_database`, `lakebase_endpoint`, `lakebase_schema` |
| Who sees the Admin tab | `admin_emails` (comma-separated) |
| AI endpoints | `ai_endpoint_name`, `ai_embedding_endpoint` |
| Lakehouse Sync (optional) | `lakehouse_sync_catalog`, `lakehouse_sync_schema`, `lakehouse_sync_cdf_config_id` |
| **Workspace** | The CLI profile you pass as `-p`; the host and credentials never live in the repo |

Content (branding, modules, scoring, quiz, Field Kit) stays in `config/*.json` and is not a deployment setting.

### 1. Point the CLI at the target workspace

```bash
databricks auth login --host https://<your-workspace>.cloud.databricks.com --profile <PROFILE>
databricks current-user me --profile <PROFILE>        # confirm it is the right workspace and user
```

### 2. Find your Lakebase resource ids

The project must already exist in that workspace:

```bash
databricks postgres list-projects --profile <PROFILE>
databricks postgres list-branches projects/<project> --profile <PROFILE>
databricks postgres list-databases projects/<project>/branches/<branch> --profile <PROFILE>
```

Set the **ids** (not the full paths; the bundle composes `projects/<project>/branches/<branch>/...`) as variable
defaults in `databricks.yml`, or per target / per run. `lakebase_schema` is created on first start (lowercase letters,
digits and underscores). Set `lakebase_enabled` to `"false"` to run without a database: progress then stays in the
browser.

### 3. Deploy

```bash
databricks bundle validate --strict -t default -p <PROFILE>
databricks bundle deploy   -t default -p <PROFILE>                  # create app, bind resources, upload source
databricks bundle run lakebase_partner_hub -t default -p <PROFILE>  # start the app and deploy the uploaded source
```

Override any variable without editing the file: `--var lakebase_project=my-project --var admin_emails=a@x.com`. For a
second environment add a `targets:` entry with its own `variables:` (and `workspace.root_path` if wanted). To put the
app in a space add `space: <name>` to the app resource. Removed files are deleted from the workspace copy
automatically. `databricks bundle destroy` removes the app.

The bundle:

1. creates the app and its service principal **before first start**, so the principal creates and owns the schema,
2. binds the `postgres` resource (`CAN_CONNECT_AND_CREATE`) and grants `CAN_QUERY` on the embedding endpoint (without
   it the assistant uses keyword search),
3. exports the variables to the app as environment variables (`resources.apps.*.config.env`), which
   `server/content/loader.ts` validates at startup and fails loudly if anything is missing.

**Deploy before running locally.** If you run locally first, your user owns the schema and the deployed app hits
`permission denied for schema` (`42501`).

### Verify a deployment

```bash
databricks bundle run smoke_test -t default -p <PROFILE>               # read-only checks
databricks bundle run smoke_test -t default -p <PROFILE> -- --write    # also signs up a throw-away partner
```

Checks: app running, `postgres` bound, config hides the admin list, answers not exposed, Lakebase connected,
knowledge base indexed (and whether search is semantic or keyword), content endpoints, certificate verification
rejects bad ids, admin endpoints protected. `--write` creates `smoke-test@example.invalid`, grades a quiz, and clears
its progress; the partner row itself remains and counts in admin totals.

## Develop

```bash
cp .env.example .env     # set DATABRICKS_HOST and the deployment settings (mirror databricks.yml)
npm run dev
```

| Command | Purpose |
|---|---|
| `npm run typecheck` | Server and client type checks |
| `npm run lint` | ESLint (0 errors expected; a few React key-style warnings exist) |
| `npm test` | Vitest — content validation, scoring, admin aggregation, knowledge store, and **HTTP-level route tests** with injected fakes |
| `npm run build` | Production build (`dist/server.js`, `client/dist/`) |

Local admin access: the Apps proxy supplies `x-forwarded-email` in production. For local development only, set
`DEV_ADMIN_EMAIL` to an address in `ADMIN_EMAILS`. It is ignored when `NODE_ENV=production`.

## Knowledge base

At startup (in the background) the app builds passages from `knowledge.json`, modules, labs, quiz explanations, fit
guidance and the demo; embeds them with `ai.embeddingEndpoint` (default `databricks-gte-large-en`, 1024 dimensions,
set `ai.embeddingDimensions` to match your model); and upserts them into `knowledge_chunks`. Unchanged passages
(by content hash) are not re-embedded and removed passages are deleted. Search is cosine distance when embeddings
exist, otherwise Postgres full-text. `GET /api/knowledge/status` and the Ask page badge show which is active.

Every answer also returns **documentation links**. Each curated entry in `knowledge.json` lists doc paths (declared once in
its `docs` catalog, relative to `branding.docsBaseUrl` or absolute); module, lab and quiz passages reuse the module's
`docLinks`. Links come from the retrieved passages, best match first, de-duplicated and capped at five, with the docs home as
a fallback. The model is told not to write URLs, so every link shown comes from this configuration. Tests check each entry
has docs declared in the catalog; verify a new URL resolves before adding it.

When changing the embedding model's dimensions, drop `knowledge_chunks` so it is recreated with the new vector size.

## Field Kit slides

The Field Kit tab shows selected slides from an internal Databricks deck to external partners, so it is **allow-list
only**. `fieldkit.approvedSlides` (for example `"1-33"`) lists the cleared pages of the curated deck PDF and `fieldkit.heldSlides`
removes individual pages inside that range, each with the reason (currently the cover, two section dividers and a blank page).
Slide numbers are page numbers in that PDF, so renumber them if you re-export a different cut of the deck. A slide is served, indexed for Ask Lakebase and built into the
images and PDF only if it is cleared and not held; held-slide reasons are server-only and never sent to the browser.
Tests fail if `fieldkit.json` contains a slide that is not cleared. Speaker notes are never read or shown.

Slide images and a PDF are built locally from a PDF export of the deck, so no Google API access is needed:

1. In Google Slides choose **File → Download → PDF document (.pdf)**.
2. Save it as `fieldkit-source/deck.pdf`. That folder is git-ignored: the full deck contains slides that are not cleared
   and must never be committed or uploaded.
3. Install poppler once (`brew install poppler`), then run:

```bash
node scripts/build-fieldkit.mjs --dry-run   # verify each cleared page matches the expected slide
node scripts/build-fieldkit.mjs             # render PNGs and the cleared-slides PDF
```

4. Review `client/public/fieldkit-slides/` (one `slide-NN.png` per cleared slide plus
   `lakebase-field-kit-selected-slides.pdf`), commit it, and redeploy.

Only cleared pages are rendered or copied. The script compares each page's text with `expectTitle` in `fieldkit.json`
and skips any page that does not match (the deck was reordered; `--force` overrides after checking), and it deletes
files for slides that are no longer cleared. The tab offers a slide viewer and an embedded PDF with a download button.
Until the files exist, the viewer shows only the slide title and the PDF option is disabled. Slide text is not displayed or sent to the browser; it is kept server-side only so Ask Lakebase can search and cite slides. Where a slide conflicts with
current documentation it carries a `note` (see `docs/content-conflicts.md`).

## Optional: Lakehouse Sync

`databricks bundle run enable_lakehouse_sync` (`scripts/enable-lakehouse-sync.mjs`) streams the app schema into Unity Catalog as `lb_<table>_history` Delta tables
(Beta). It prints a plan unless `-- --apply` is passed and refuses to run until `lakehouse_sync_catalog` and
`lakehouse_sync_schema` are set in `databricks.yml`. The CDF config is immutable and replicates **every** table, including partner names and emails, so review
who can read the target schema first. Sample queries: `docs/lakehouse-analytics.sql`.

## Security notes

- **Partner identity is an email the visitor types.** Anyone who knows a partner's email can view or change that
  partner's progress, leaderboard preference, and claim a certificate if the saved scores qualify. Certificates prove
  quiz results, not who the person is. Add SSO before using them for anything contractual.
- **Admin access does not rely on typed email.** It uses the Apps-proxy `x-forwarded-email` matched against
  `admin_emails`. The list is never sent to the browser.
- The leaderboard is opt-in; the CSV export neutralises spreadsheet-formula injection.
- All SQL values are bound parameters; the only interpolated identifier is the schema name, restricted to
  `^[a-z_][a-z0-9_]{0,62}$` in config validation and again at use.
- Quiz answers and explanations are never sent to the browser before grading.
- Internal-only Databricks material is not used in partner-facing content. `docs/content-conflicts.md` records where
  the sources disagree and which one the app follows.

## Known limits

- Labs are self-reported. Server-side verification needs partners to have workspace access.
- Pricing rates are not stored (they change by region); the page links to the official pricing page.
- Region availability for Lakebase must be confirmed separately from the pricing page.
- The usage query on the Pricing page comes from internal material — verify column names before relying on it.
