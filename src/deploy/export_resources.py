# Databricks notebook source
"""
Export the resolved resource IDs as the job's exit value — FINAL task of the
Global Logistics Command Center setup job.

Collects the bundle-resolved IDs (passed via base_parameters) plus the
SDK-created Genie space ID (passed via {{tasks.deploy_genie.values.*}}) and
emits them as one JSON via dbutils.notebook.exit().

═══════════════════════════════════════════════════════════════════════════
WHY exit() (not taskValues): finalize_app.sh reads this JSON back through
`databricks jobs get-run-output` → notebook_output.result, then writes the
app's app.yaml env + redeploys. The exit value IS retrievable post-run;
task-values are NOT (cleanly) retrievable from outside the job. This same JSON
doubles as the demo's resources.json manifest.

GUARD: if {{task.values}} substitution didn't fire, the widget value is the
literal template string ("{{...}}"). We fail loudly rather than export garbage.

This demo has NO Knowledge Assistant, NO Multi-Agent Supervisor, NO ML model,
and NO RAG PDFs — so those keys are absent. The two metric views ARE exported.

Parameters (base_parameters in databricks.yml):
- catalog, schema, app_name, dashboard_id, pipeline_id, warehouse_id
- genie_space_id (from the deploy_genie task value)
"""

# COMMAND ----------

import json

names = [
    "catalog", "schema", "app_name",
    "dashboard_id", "pipeline_id", "warehouse_id",
    "genie_space_id",
]
for n in names:
    dbutils.widgets.text(n, "", n)

vals = {n: dbutils.widgets.get(n) for n in names}

# Guard: if task-value substitution didn't fire, the value is the literal
# template string — fail loudly rather than export garbage.
v = vals["genie_space_id"]
if v.startswith("{{") and v.endswith("}}"):
    raise RuntimeError(f"genie_space_id={v!r} — task value substitution didn't fire.")

resources = {
    "catalog":                      vals["catalog"],
    "schema":                       vals["schema"],
    "app_name":                     vals["app_name"],
    "dashboard_id":                 vals["dashboard_id"],
    "pipeline_id":                  vals["pipeline_id"],
    "warehouse_id":                 vals["warehouse_id"],
    "genie_space_id":               vals["genie_space_id"],
    # The two UC metric views the pipeline/metric-view task built.
    "metric_view_name":             f"{vals['catalog']}.{vals['schema']}.mv_delivery_sla",
    "resolution_metric_view_name":  f"{vals['catalog']}.{vals['schema']}.mv_exception_resolution",
    "agent_mlflow_experiment_path": f"/Shared/solution_builder/{vals['app_name']}-agent-traces",
}

print("Exporting resources:")
for k, val in resources.items():
    print(f"  {k} = {val}")

# COMMAND ----------

dbutils.notebook.exit(json.dumps(resources))
