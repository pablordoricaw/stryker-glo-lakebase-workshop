# Databricks notebook source
"""
Grant the Command Center app's service principal UC privileges.

The app reads the demo's gold tables + metric views via the SQL warehouse and
reads the raw landing zone from a UC volume. Without these grants the app's
first /api/config call crashes with:
  INSUFFICIENT_PERMISSIONS: User does not have USE CATALOG on Catalog ...

Granted to the app SP:
  - USE_CATALOG on the catalog
  - USE_SCHEMA + SELECT on the schema (covers every gold_*/silver_*/mv_* read)
  - READ_VOLUME on the raw_data volume

This demo trains NO ML model, so there is no EXECUTE-on-function grant.

═══════════════════════════════════════════════════════════════════════════
WHY auto-resolve the SP: the grant target is the app's service-principal
client_id (a UUID). We resolve it via w.apps.get(app_name) rather than passing
it as a parameter — more robust against config drift. UC grants are issued as
SQL via spark.sql.

Idempotent — repeated grants no-op.

Parameters:
- catalog, schema, app_name
"""

# COMMAND ----------

# Every UC volume the app reads. This demo ships one: the raw landing zone.
DEMO_VOLUMES = ["raw_data"]

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("app_name", "", "App name")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
app_name = dbutils.widgets.get("app_name")
assert catalog and schema and app_name

# COMMAND ----------

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

app = w.apps.get(name=app_name)
sp_client_id = app.service_principal_client_id
assert sp_client_id, f"App '{app_name}' has no service_principal_client_id"
print(f"App SP: {sp_client_id}")

# COMMAND ----------

grants = [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp_client_id}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp_client_id}`",
]
grants += [
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.{vol} TO `{sp_client_id}`"
    for vol in DEMO_VOLUMES
]

for stmt in grants:
    print(f"  {stmt}")
    spark.sql(stmt)

print("Grants applied.")
