# Deploy — Global Logistics Command Center

Re-creates the MedTranz Global logistics-exception demo (schema → raw data →
SDP pipeline → gold table + metric views → AI/BI dashboard → Genie space →
Command Center app on Lakebase) on any workspace from this bundle.

**Prerequisites**
- Databricks CLI **v0.283.0+** (dashboard `dataset_catalog`/`dataset_schema`
  rewriting). Verified with v1.17.0.
- A SQL warehouse ID in the target workspace (powers the dashboard, Genie, and
  the app's analytics).
- Auth via a CLI profile (`--profile <name>`); the bundle sets no host.

The `catalog`, `schema`, and all Lakebase/app vars have defaults in
`databricks.yml` (this project's own values); override with `--var` to deploy
elsewhere. Only `warehouse_id` has no default.

## The 5 commands

```bash
# 1. Lakebase DB (pre-deploy — the CLI can't declare a Postgres database)
./app/scripts/lakebase_setup_db.sh --db-name dbgen_glcc_e302b2

# 2. Create resource shells (schema, volume, pipeline, dashboard, app) + setup job
databricks bundle deploy \
  --var warehouse_id=<warehouse-id>

# 3. Run the setup job (data → pipeline → gold table + metric views → Genie →
#    app UC grants → export IDs)
databricks bundle run glcc_setup \
  --var warehouse_id=<warehouse-id>

# 4. Grant the app SP on the Lakebase (Postgres) schemas
./app/scripts/lakebase_grant_app_credential.sh \
  --app-name dbgen-glcc \
  --project-id dbdemos-asset-generator-6 \
  --db-name dbgen_glcc_e302b2

# 5. Harvest the resolved IDs → write app.yaml env → deploy the app
./app/scripts/finalize_app.sh
```

Steps 2 + 3 also accept `--var catalog=<cat> --var schema=<schema>` to target a
different location (defaults are `solution_builder` /
`demo_global_logistics_exception_cockpit_e302b2`).

After an **app content** change, re-run steps 2 + 5. After a **data/resource**
change, re-run 2 + 3 + 5. Re-runs are idempotent.

## ⚠️ dev-mode + the pipeline bronze paths

The default `dev` target prefixes the schema with `dev_<user>_`, but the SDP
bronze SQL (`src/pipeline/01_silver_shipments.sql`) reads the raw Volume via
literal `read_files('/Volumes/solution_builder/demo_global_logistics_exception_cockpit_e302b2/raw_data/...')`
paths (SDP `read_files` can't interpolate variables). For a dev-mode deploy,
either update those three paths to the prefixed schema, or deploy the `prod`
target (`-t prod`), which keeps the schema unprefixed and matches the paths.

## Teardown

```bash
databricks bundle destroy --auto-approve
```

Does not drop the Lakebase project/DB, the UC schema/tables/volume, or the Genie
space (the app has `prevent_destroy: true`).
