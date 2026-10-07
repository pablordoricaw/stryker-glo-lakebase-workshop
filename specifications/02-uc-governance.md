# Unity Catalog — Governance + Metric Views

Tables defined in `01-lakeflow.md`. Catalog/schema from `resources.json`:
`solution_builder.demo_global_logistics_exception_cockpit_e302b2`.

## A. Governance (talking track + light setup)

- All gold tables land in the demo schema under Unity Catalog — single governance layer across lakehouse (Delta) and Lakebase (synced + native OLTP tables).
- **Register the Lakebase database in Unity Catalog** (brief requirement) — once the Lakebase project/database exists (`03-lakebase.md`), register it as a UC connection/catalog so the synced + native OLTP tables are governed and queryable under the same catalog model. Record this in `resources.json` as part of the Lakebase block.
- Add table/column comments on the three gold tables describing the exception story so Genie + Catalog Explorer read well.

## B. Metric View — `mv_delivery_sla`

**Skill**: `databricks-metric-views` — read `SKILLS/databricks-metric-views/SKILL.md`.

Canonical governed SLA metric layer over `gold_delivery_performance`. Dashboard KPIs + Genie headline SLA answers both read it so numbers match exactly.

Create metric view **`mv_delivery_sla`** in the demo schema.

- **Source**: `gold_delivery_performance`.
- **Dimensions**: `metric_date` (→ aliased `date`), `region`, `carrier`, `priority`, `product_category`.
- **Measures**:
  - `shipments` = `SUM(shipments_count)`
  - `exceptions` = `SUM(exception_count)`
  - `on_time` = `SUM(on_time_count)`
  - `sla_pct` = `SUM(on_time_count) / NULLIF(SUM(shipments_count),0)`
  - `exception_rate` = `SUM(exception_count) / NULLIF(SUM(shipments_count),0)`
  - `total_freight_usd` = `SUM(total_freight_usd)`
  - `expedited_freight_usd` = `SUM(expedited_freight_usd)`
  - `avg_days_late` = `SUM(avg_days_late * exception_count) / NULLIF(SUM(exception_count),0)` (exception-weighted)

## C. Metric View — `mv_exception_resolution` (Lakebase CDF closing-the-loop metric)

**The brief's "closing the loop" metric.** Built on the **Lakebase CDF output** (changes on the native OLTP tables `exception_tickets` streamed back to the lakehouse — see `03-lakebase.md` section on CDF). Computes **average exception resolution time by exception_type and region**.

- **Source**: the lakehouse table materialized from Lakebase CDF of `exception_tickets` (e.g. `gold_exception_resolution` — see `03-lakebase.md`), containing resolved tickets with `created_at`, `resolved_at`, `exception_type`, `region`, `severity`.
- **Dimensions**: `exception_type`, `region`, `severity`.
- **Measures**:
  - `tickets_resolved` = `COUNT(*)` where `resolved_at IS NOT NULL`
  - `avg_resolution_hours` = `AVG(DATEDIFF(hour, created_at, resolved_at))` on resolved tickets
  - `median_resolution_hours` (approx via percentile) — optional
  - `open_tickets` = `COUNT(*)` where `status != 'resolved'`

This metric view proves the operational actions moved the needle — resolution time by type/region drops after Maya's batch is executed. Record `metric_view_name` entries in `resources.json`.
