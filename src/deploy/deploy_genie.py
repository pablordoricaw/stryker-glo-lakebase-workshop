# Databricks notebook source
"""
Deploy the Global Logistics Command Center Genie Space.

Loads the committed Genie space JSON (curated questions + example SQLs + story
instructions over gold_shipments / gold_inventory / mv_delivery_sla),
substitutes the catalog/schema, then creates or updates the space via the SDK.
Idempotent: searches by title, updates if present, creates if not.

═══════════════════════════════════════════════════════════════════════════
GOTCHAS — proven the hard way; do NOT "simplify" these away:
  • list_spaces PAGINATION: w.genie.list_spaces returns a
    GenieListSpacesResponse OBJECT (.spaces list + .next_page_token), NOT a
    generator. Loop on next_page_token or you'll only see the first page and
    create duplicate spaces on large workspaces.
  • LOAD-FROM-JSON + literal string-replace of the catalog.schema qualifier:
    the same prefix appears in table identifiers, metric-view identifiers, AND
    inside the example SQL bodies, so a JSON-tree walk would miss the SQL ones.

REQUIRES: databricks-sdk>=0.114.0 (environment_key: sdk_latest in databricks.yml).

Parameters (base_parameters):
- catalog, schema, warehouse_id

Outputs (via dbutils.jobs.taskValues.set):
- genie_space_id: the resolved space ID (consumed by export_resources)
"""

# COMMAND ----------

SPACE_TITLE = "Global Logistics Command Center"
SPACE_DESCRIPTION = (
    "Operations analytics for MedTranz Global logistics. Ask why the Southeast "
    "keeps missing SLA — root-cause the exception spike by carrier, lane, "
    "priority, and product category, and track the expedited-freight surge. "
    "Walk the curated questions in order on a cold start."
)

# The catalog.schema the committed genie_space.json was authored against —
# replaced at runtime with the deployed catalog.schema.
SRC_QUALIFIER = "solution_builder.demo_global_logistics_exception_cockpit_e302b2"

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")
assert catalog and schema and warehouse_id, "catalog + schema + warehouse_id are required"

print(f"Deploying Genie Space: '{SPACE_TITLE}'")
print(f"  catalog.schema: {catalog}.{schema}")
print(f"  warehouse:      {warehouse_id}")

# COMMAND ----------

import json
import os
from databricks.sdk import WorkspaceClient

notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
config_path = f"/Workspace{bundle_root}/src/genie/genie_space.json"
print(f"Loading: {config_path}")

with open(config_path) as f:
    serialized = f.read()

DST_QUALIFIER = f"{catalog}.{schema}"
n = serialized.count(SRC_QUALIFIER)
substituted = serialized.replace(SRC_QUALIFIER, DST_QUALIFIER)
print(f"Substituted {n} occurrences of {SRC_QUALIFIER} → {DST_QUALIFIER}")

space_payload = json.loads(substituted)  # validate it still parses
print(f"data_sources.tables:       {len(space_payload['data_sources']['tables'])}")
print(f"data_sources.metric_views: {len(space_payload['data_sources']['metric_views'])}")
print(f"sample_questions:          {len(space_payload['config']['sample_questions'])}")

# COMMAND ----------

w = WorkspaceClient()

existing_id = None
page_token = None
while True:
    resp = w.genie.list_spaces(page_size=200, page_token=page_token)
    for sp in (resp.spaces or []):
        if sp.title == SPACE_TITLE:
            existing_id = sp.space_id
            print(f"Found existing space: {existing_id}")
            break
    if existing_id or not getattr(resp, "next_page_token", None):
        break
    page_token = resp.next_page_token

# COMMAND ----------

if existing_id:
    print(f"Updating space {existing_id}…")
    w.genie.update_space(
        space_id=existing_id,
        warehouse_id=warehouse_id,
        serialized_space=substituted,
    )
    space_id = existing_id
else:
    print("Creating new space…")
    created = w.genie.create_space(
        warehouse_id=warehouse_id,
        title=SPACE_TITLE,
        description=SPACE_DESCRIPTION,
        serialized_space=substituted,
    )
    space_id = created.space_id

print(f"Genie space ready: {space_id}")

# COMMAND ----------

dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
print(f"task value set: genie_space_id = {space_id}")
