# Content source conflicts and decisions

The app's learning content was built from three sources. Where they disagree, this file records what the app says and why, so a reviewer can overrule it.

Source precedence used: (1) the `databricks-lakebase` agent skill for product facts, (2) the Databricks blog "Lakebase holiday update" where the skill is silent, (3) the internal Field Kit deck for positioning only. The deck is Databricks-internal; no internal-only material (seller notes, discount strategy, named people, Slack channels, roadmap) is used in partner-facing content.

| Topic | Skill | Blog | Deck | App says | Action for reviewer |
|---|---|---|---|---|---|
| Provisioned tier | Retired; Autoscaling only | Not mentioned | Still describes Provisioned (connection limit "1000 for Provisioned") | Autoscaling only | Confirm timing of the Provisioned migration before customer-facing claims |
| Max data size | 8 TB logical per branch | "up to 8TB" (was 2 TB) | 16 TB | 8 TB | Confirm; the deck figure looks outdated |
| Max connections | 4,000 cap at 32 CU+ | Not stated | 4,000 | 4,000 | None |
| Max autoscale compute | 32 CU, max-min spread ≤ 16 CU | Not stated | 32 CU | 32 CU, spread ≤ 16 | None |
| Postgres versions | 16 and 17 (default 17) | 16 and 17 | 16, 17 and 18 | 16 and 17 | Confirm whether 18 is generally available |
| Regions | Not listed | us-east-1, us-west-2, eu-west-1 only | AWS/Azure across AMER, EMEA, APJ; GCP beta | No region list; tells users to check current availability | Confirm AWS Sydney (ap-southeast-2) and Azure Australia Southeast availability |
| Scale-to-zero wake time | ~100 ms | "hundreds of milliseconds" | "sub-second" | "a fraction of a second" | None |
| PITR window | Not stated | "within seconds" restore | Up to 35 days | Not stated | Add the window once confirmed in public docs |
| Pricing | Not covered | Not covered | Per-second compute DBUs + monthly storage; promotions | Model only; links to the public pricing page; no rates stored | Rates were not readable (page renders them dynamically). Supply them only if you want an in-app estimator |
| Billing query | Not covered | Not covered | `billing_origin_product = DATABASE` | Shown on Pricing page with a "verify column names" note | Verify against current billing system-table docs |
| Identity sync to Postgres roles | Not covered | Not covered | Not auto-synced | Included as a pitfall | Confirm against current docs |

## Known gaps

- The sample usage query and the Postgres-role note come from the deck only.
- Lakehouse Sync is marked Beta per the skill; re-check before publishing.
