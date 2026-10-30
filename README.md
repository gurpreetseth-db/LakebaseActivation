# Lakebase Partner Readiness: Databricks Asset Bundle

A Databricks App that enables partners on **Databricks Lakebase**, deployed and managed entirely with a
[Databricks Asset Bundle](https://docs.databricks.com/dev-tools/bundles/). `databricks.yml` is the single source of
truth for every deployment setting; the app resource, its resource bindings, the app's runtime environment and the
post-deploy scripts are all derived from its `variables:` block. Nothing is configured anywhere else.

## Layout

```
databricks.yml   the bundle: the only deployment configuration
README.md
docs/            reference SQL and content notes
app/             the app's source root (uploaded and built on deploy)
  package.json, package-lock.json, appkit.plugins.json   npm dependencies, build/start scripts, AppKit plugin manifest
  tsconfig*.json, tsdown.server.config.ts, vitest.config.ts, eslint.config.js, .prettier*   build, test and lint tooling
  client/, server/   React frontend and Express backend
  config/            content (branding, modules, quiz, Field Kit)
  scripts/           smoke test, Lakehouse Sync, Field Kit build
```

## What the bundle contains

| Bundle element | Defined in `databricks.yml` | Purpose |
|---|---|---|
| `variables:` | App, Lakebase, admin, AI and Lakehouse Sync settings | The only place deployment settings live |
| `resources.apps.lakebase_partner_hub` | App name, description, start command, `source_code_path: ./app` | The Databricks App |
| `…config.env` | One environment variable per setting | Exports the variables to the running app |
| `…resources` | `postgres` (`CAN_CONNECT_AND_CREATE`), `embedding-endpoint` (`CAN_QUERY`) | Grants the app's service principal access |
| `sync.exclude` | `app/node_modules`, `app/dist`, `app/fieldkit-source` | Keeps build output and the internal Field Kit export out of the upload |
| `scripts.smoke_test` | Post-deploy checks | `bundle run smoke_test` |
| `scripts.enable_lakehouse_sync` | Optional Lakehouse Sync (Beta) | `bundle run enable_lakehouse_sync` |

## Prerequisites

- Databricks CLI with bundle `scripts:` support (v1.17 verified) and a profile for the target workspace
- Node.js 22+ and npm (the platform builds the app on deploy)
- An existing Lakebase (Autoscaling) project in that workspace
- Permission to create apps **outside a restricted space**: apps in a space that allows no resource types cannot
  attach the `postgres` resource

## Configuration

### Deployment settings: `variables:` in `databricks.yml`

| Variable | Controls |
|---|---|
| `app_name`, `app_description` | App name (lowercase, hyphenated, ≤ 30 chars, unique per workspace) and description |
| `lakebase_enabled` | `"false"` runs without a database; progress then stays in the browser |
| `lakebase_project`, `lakebase_branch` | Lakebase project and branch **ids** |
| `lakebase_database` | Database **resource id** (the final path segment, not necessarily the Postgres name) |
| `lakebase_endpoint` | Endpoint id (the deployed app gets it from the `postgres` resource) |
| `lakebase_schema` | Postgres schema the app owns; created on first start (lowercase letters, digits, underscores) |
| `admin_emails` | Comma-separated emails that see the Admin tab (never sent to the browser) |
| `retention_days` | Days of inactivity after which a learner (and any Ask Lakebase question older than this) is deleted automatically; default `30` |
| `pii_migrate` | One-time `true` to convert a database that still stores emails/names (see [Privacy](#privacy-and-gdpr)); keep `false` otherwise |
| `ai_endpoint_name` | Chat/LLM serving endpoint for the assistant |
| `ai_embedding_endpoint` | Embedding serving endpoint; the app is granted `CAN_QUERY` on it (without it the assistant uses keyword search) |
| `lakehouse_sync_catalog`, `lakehouse_sync_schema`, `lakehouse_sync_cdf_config_id` | Optional Lakehouse Sync target |

The workspace is the CLI profile you pass as `-p`. The host and credentials never live in the repo.

Change a value by editing its `default:`, by overriding it in a `targets:` entry, or per run:

```bash
databricks bundle deploy -t default -p <PROFILE> --var lakebase_project=my-project --var admin_emails=a@x.com
```

`app_name`, the Lakebase ids and the endpoints are used both to bind resources and, through `config.env`, by the
running app, so one edit keeps both in step. `app/server/content/loader.ts` validates the exported environment at startup
and fails loudly if a setting is missing or malformed.

### Content: `app/config/`

Branding, onboarding fields, scoring, modules, the quiz bank and Field Kit text are content, not deployment settings.
They live in `app/config/app.config.json` and `app/config/content/*.json` and ship with the bundle, so editing them and running
`bundle deploy` publishes the change.

## Deploy

### 1. Authenticate

```bash
databricks auth login --host https://<your-workspace>.cloud.databricks.com --profile <PROFILE>
databricks current-user me --profile <PROFILE>        # confirm it is the right workspace and user
```

### 2. Find your Lakebase ids

```bash
databricks postgres list-projects --profile <PROFILE>
databricks postgres list-branches projects/<project> --profile <PROFILE>
databricks postgres list-databases projects/<project>/branches/<branch> --profile <PROFILE>
```

Put the **ids** (not the full paths) in the `lakebase_*` variables. The bundle composes
`projects/<project>/branches/<branch>/...` itself.

### 3. Validate, deploy, start

```bash
databricks bundle validate --strict -t default -p <PROFILE>
databricks bundle deploy   -t default -p <PROFILE>                  # create app, bind resources, upload source
databricks bundle run lakebase_partner_hub -t default -p <PROFILE>  # start the app and deploy the uploaded source
```

What happens:

1. the app and its service principal are created **before first start**, so the principal creates and owns the schema,
2. the `postgres` and `embedding-endpoint` resources are bound,
3. the source is uploaded (files removed locally are deleted from the workspace copy) and the variables are exported
   to the app as environment variables.

### Adopting an app that already exists

If the app was created before the bundle, bind it once instead of recreating it:

```bash
databricks bundle deployment bind lakebase_partner_hub <app_name> -t default -p <PROFILE>
```

### Other targets and spaces

Add a `targets:` entry with its own `variables:` (and `workspace.root_path` if wanted) for another environment. To put
the app in a space, add `space: <name>` to `resources.apps.lakebase_partner_hub`.

## Verify

```bash
databricks bundle run smoke_test -t default -p <PROFILE>               # read-only checks
databricks bundle run smoke_test -t default -p <PROFILE> --var smoke_write=true   # also signs up a throw-away learner, files and approves its erasure
```

Checks: app running, `postgres` bound, config hides the admin list, answers not exposed, Lakebase connected,
knowledge base indexed (and whether search is semantic or keyword), content endpoints, Field Kit serves cleared slides
only, learner endpoints reject a missing or wrong code, admin endpoints protected. `smoke_write=true` signs up a
throw-away learner, grades a quiz, files a deletion request and (if you are an admin) approves it, so nothing is left
behind; for a non-admin the request stays pending in the Admin tab.

## Optional: Lakehouse Sync

Streams the app's Postgres schema into Unity Catalog as `lb_<table>_history` Delta tables (Beta). Set
`lakehouse_sync_catalog` and `lakehouse_sync_schema`, then:

```bash
databricks bundle run enable_lakehouse_sync -t default -p <PROFILE>              # print the plan only
databricks bundle run enable_lakehouse_sync -t default -p <PROFILE> --var lakehouse_sync_apply=true   # create the CDF config
```

The CDF config is immutable and replicates **every** table, including learner ids, companies and nicknames (no names or emails are stored), so review who can
read the target schema first. Rows erased in Postgres remain in the history tables until you delete them there too, so
note this in your erasure process. Sample queries: `docs/lakehouse-analytics.sql`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `permission denied for schema` (`42501`) | The schema was created by a user, not the app's service principal. Deploy the bundle before touching the schema with your own login |
| App fails to start with `Deployment settings missing or invalid` | A variable is empty or malformed; run `databricks bundle validate -o json` and check `resources.apps.*.config.env` |
| `bundle deploy` says the app already exists | Bind it first (see [Adopting an app that already exists](#adopting-an-app-that-already-exists)) |
| Cannot attach the `postgres` resource | The app is in a restricted space; deploy outside it (see Prerequisites) |

## Privacy and GDPR

The app stores as little personal data as it can.

- **Collected:** the learner's company, an optional nickname, quiz and lab results, and the questions they ask Ask
  Lakebase. **Not collected:** name, email, or anything else that identifies a person directly.
- **Identity:** at sign-up the learner gets a random **learner code** (shown once). The database keeps only a
  one-way hash of it, plus a random learner id. The code is the only credential: it resumes progress on another device
  and authorises the learner's own requests. It cannot be recovered; a lost code means starting again.
- **Admin view:** progress by **company** (learners, started, finished, average score). Individuals are never named.
  The CSV export is also per company.
- **Retention:** learners with no activity for `retention_days` (default 30) and Ask Lakebase questions older than that
  are deleted automatically (daily, and at startup). Only counts are logged.
- **Deletion requests:** a learner can use **Privacy and my data → Request deletion**. The request appears in the
  **Admin** tab; **Erase** removes the learner and all linked data (results, attempts, labs, questions) in one
  transaction. The request row stays as the erasure record (pseudonymous id, company, dates, approving admin) and holds
  no personal data. Because no name or email is held, a request can only be matched through the learner's own code.
- **Downstream copies:** erased rows can remain in the Lakebase point-in-time history window and, if Lakehouse Sync is
  enabled, in the `lb_*_history` tables. Include both in your erasure process.
- **Your side:** the lawful basis, privacy notice wording, retention period and processor agreements are for your
  privacy team to confirm. This README is not legal advice.

### Upgrading a database that still stores emails

Deploying this version against a schema created before it stops with a clear error and the app runs in browser-only
mode. To convert it **in place** (existing learners get new random ids, can no longer sign in, and must start again with
a new code; emails, names and certificates are dropped, irreversibly), take a Lakebase branch or backup first, then:

```bash
databricks bundle deploy -t default -p <PROFILE> --var pii_migrate=true
databricks bundle run lakebase_partner_hub -t default -p <PROFILE> --var pii_migrate=true
databricks bundle deploy -t default -p <PROFILE>        # back to the default (false)
databricks bundle run lakebase_partner_hub -t default -p <PROFILE>
```

## Data collection

To improve users' experience and this asset's quality, the app reports a usage event when a page is opened. This information is captured for product improvement only, not for marketing purposes, and doesn't contain PII: the email of Databricks users is hashed, and nobody else's is sent. By using this asset, you consent to this data collection. If you wish to disable it, set the environment variable `DBDEMOS_TRACKER_DISABLED=1` (e.g. add it to `resources.apps.lakebase_partner_hub.config.env` in `databricks.yml`).

## Tear down

```bash
databricks bundle destroy -t default -p <PROFILE>    # removes the app; the Lakebase project and schema are not deleted
```
