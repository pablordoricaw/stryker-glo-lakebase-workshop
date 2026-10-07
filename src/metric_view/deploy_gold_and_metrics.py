# Databricks notebook source
"""
Post-pipeline build: gold_exception_resolution + the two UC metric views.

These three objects are NOT declarable in the SDP pipeline:
  • gold_exception_resolution is a plain `CREATE OR REPLACE TABLE` (it stands in
    for the Lakebase CDF → lakehouse stream, built directly from gold_shipments).
    DLT only accepts MATERIALIZED VIEW / STREAMING TABLE / APPLY CHANGES / SET.
  • mv_delivery_sla and mv_exception_resolution are UC metric views
    (`CREATE OR REPLACE VIEW … WITH METRICS LANGUAGE YAML`), which have no
    PySpark API and don't belong in a pipeline.

So they run here, after run_pipeline has produced gold_shipments +
gold_delivery_performance. Each committed .sql was authored against this
project's catalog.schema; we literal-replace that qualifier with the deployed
one (same trick as deploy_genie.py) so the SAME SQL works on any target,
including dev-mode's dev_<user>_ prefix.

Parameters (base_parameters):
- catalog, schema
"""

# COMMAND ----------

# The catalog.schema the committed .sql files were authored against. Replaced
# at runtime with the deployed catalog.schema.
SRC_QUALIFIER = "solution_builder.demo_global_logistics_exception_cockpit_e302b2"

# Run order matters: gold_exception_resolution feeds mv_exception_resolution;
# mv_delivery_sla reads gold_delivery_performance (already built by the pipeline).
SQL_FILES = [
    "gold_exception_resolution.sql",
    "mv_delivery_sla.sql",
    "mv_exception_resolution.sql",
]

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
assert catalog and schema, "catalog + schema are required"

DST_QUALIFIER = f"{catalog}.{schema}"
print(f"Building gold table + metric views in {DST_QUALIFIER}")

# COMMAND ----------

import os

notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
# .../src/metric_view/deploy_gold_and_metrics  → bundle root is three dirs up.
bundle_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
sql_dir = f"/Workspace{bundle_root}/src/metric_view"

for fname in SQL_FILES:
    path = f"{sql_dir}/{fname}"
    with open(path) as f:
        raw = f.read()
    n = raw.count(SRC_QUALIFIER)
    stmt = raw.replace(SRC_QUALIFIER, DST_QUALIFIER)
    print(f"\n── {fname}: substituted {n}× {SRC_QUALIFIER} → {DST_QUALIFIER}")
    spark.sql(stmt)
    print(f"   OK")

print("\nAll gold + metric-view objects built.")
