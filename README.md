# Lakebase Partner Readiness: Databricks Asset Bundle

A Databricks App that enables partners on **Databricks Lakebase**, deployed and managed entirely with a
[Databricks Asset Bundle](https://docs.databricks.com/dev-tools/bundles/). `databricks.yml` is the single source of
truth for every deployment setting; the app resource, its resource bindings, the app's runtime environment and the
post-deploy scripts are all derived from its `variables:` block. Nothing is configured anywhere else.

## What the bundle contains

| Bundle element | Defined in `databricks.yml` | Purpose |
|---|---|---|
| `variables:` | App, Lakebase, admin, AI and Lakehouse Sync settings | The only place deployment settings live |
| `resources.apps.lakebase_partner_hub` | App name, description, start command | The Databricks App |
| `…config.env` | One environment variable per setting | Exports the variables to the running app |
| `…resources` | `postgres` (`CAN_CONNECT_AND_CREATE`), `embedding-endpoint` (`CAN_QUERY`) | Grants the app's service principal access |
| `sync.exclude` | `node_modules`, `dist`, `fieldkit-source` | Keeps build output and the internal Field Kit export out of the upload |
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
| `ai_endpoint_name` | Chat/LLM serving endpoint for the assistant |
| `ai_embedding_endpoint` | Embedding serving endpoint; the app is granted `CAN_QUERY` on it (without it the assistant uses keyword search) |
| `lakehouse_sync_catalog`, `lakehouse_sync_schema`, `lakehouse_sync_cdf_config_id` | Optional Lakehouse Sync target |

The workspace is the CLI profile you pass as `-p`. The host and credentials never live in the repo.

Change a value by editing its `default:`, by overriding it in a `targets:` entry, or per run:

```bash
databricks bundle deploy -t default -p <PROFILE> --var lakebase_project=my-project --var admin_emails=a@x.com
```

`app_name`, the Lakebase ids and the endpoints are used both to bind resources and, through `config.env`, by the
running app, so one edit keeps both in step. `server/content/loader.ts` validates the exported environment at startup
and fails loudly if a setting is missing or malformed.

### Content: `config/`

Branding, onboarding fields, scoring, modules, the quiz bank and Field Kit text are content, not deployment settings.
They live in `config/app.config.json` and `config/content/*.json` and ship with the bundle, so editing them and running
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
databricks bundle run smoke_test -t default -p <PROFILE> -- --write    # also signs up a throw-away partner
```

Checks: app running, `postgres` bound, config hides the admin list, answers not exposed, Lakebase connected,
knowledge base indexed (and whether search is semantic or keyword), content endpoints, Field Kit serves cleared slides
only, certificate verification rejects bad ids, admin endpoints protected. `--write` creates
`smoke-test@example.invalid`, grades a quiz, and clears its progress; the partner row itself remains and counts in admin
totals.

## Optional: Lakehouse Sync

Streams the app's Postgres schema into Unity Catalog as `lb_<table>_history` Delta tables (Beta). Set
`lakehouse_sync_catalog` and `lakehouse_sync_schema`, then:

```bash
databricks bundle run enable_lakehouse_sync -t default -p <PROFILE>              # print the plan only
databricks bundle run enable_lakehouse_sync -t default -p <PROFILE> -- --apply   # create the CDF config
```

The CDF config is immutable and replicates **every** table, including partner names and emails, so review who can
read the target schema first. Sample queries: `docs/lakehouse-analytics.sql`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `permission denied for schema` (`42501`) | The schema was created by a user, not the app's service principal. Deploy the bundle before touching the schema with your own login |
| App fails to start with `Deployment settings missing or invalid` | A variable is empty or malformed; run `databricks bundle validate -o json` and check `resources.apps.*.config.env` |
| `bundle deploy` says the app already exists | Bind it first (see [Adopting an app that already exists](#adopting-an-app-that-already-exists)) |
| Cannot attach the `postgres` resource | The app is in a restricted space; deploy outside it (see Prerequisites) |

## Tear down

```bash
databricks bundle destroy -t default -p <PROFILE>    # removes the app; the Lakebase project and schema are not deleted
```
