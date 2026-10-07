# Lakebase — Operational Database (LTAP) + CDF

Lakebase is the operational heart of this demo: analytical gold tables are **synced in** from the lakehouse, the app **owns native OLTP tables** it writes to, and **CDF streams the OLTP changes back** to the lakehouse to close the analytical loop. Showcases **LTAP** (Lakebase Transactional + Analytical Processing) alongside core Lakebase features.

**Skill**: `databricks-lakebase` — read `SKILLS/databricks-lakebase/SKILL.md`.

Lakebase project/database provisioned via `app/scripts/lakebase_setup_db.sh` (see `app.md` Step 4a).
`lakebase_database = dbgen_glcc_e302b2`. Record `lakebase_project_id` (UUID), `lakebase_project_slug`, `lakebase_database` in `resources.json`.

## A. Synced Tables (Lakehouse → Lakebase)

Sync the three gold tables from `01-lakeflow.md` into Lakebase, each demonstrating a different sync mode (the brief's exact requirement):

| Gold table | Sync mode | Rationale (talking track) |
|------------|-----------|---------------------------|
| `gold_shipments` | **CONTINUOUS** | Operational shipment state must be fresh for the live queue — continuous replication keeps Lakebase in lockstep with the lakehouse. |
| `gold_inventory` | **TRIGGERED** | Inventory snapshots refresh on a schedule — triggered sync when the replenishment job runs. |
| `gold_delivery_performance` | **SNAPSHOT** | Pre-aggregated daily SLA metrics are a periodic full snapshot. |

- **LTAP Direct Writes**: enable if available in the workspace — lets the app write transactionally to Lakebase while the same data participates in analytical queries. If not available, degrade gracefully to native OLTP tables + sync (talking track notes LTAP as the production path).
- **Register the Lakebase database in Unity Catalog** so synced + native tables are governed under the same catalog (see `02-uc-governance.md`).

> **Build-time simplification** (same outcome on screen): for the preview/build the app performs a one-shot Delta→Lakebase sync at boot (code we can show, no managed resource to provision). The managed **Synced Tables** with the three modes above is the production story we sell. The three native OLTP tables below are always real Lakebase Postgres tables the app writes to.

## B. Native OLTP Tables (app-owned, written by the app/agent)

Real Lakebase Postgres tables, managed via Drizzle in the app (`server/db/schema.ts`). The brief's three:

**`shipment_actions`** (append-only audit of operational actions)
- `action_id` (uuid, PK), `shipment_id` (text, FK → shipments mirror), `action_type` (`reroute`/`escalate`/`hold`/`release`/`add_note`), `performed_by` (text — operator email, OBO), `timestamp` (timestamptz, default now), `details_json` (jsonb — reroute target, reason, notes, etc.)

**`exception_tickets`** (the queue the app manages; CDF source)
- `ticket_id` (uuid, PK), `shipment_id` (text), `exception_type` (`customs_delay`/`damage`/`missing_docs`/`temperature_excursion`), `severity` (`low`/`medium`/`high`/`critical`), `status` (`open`/`investigating`/`resolved`), `assigned_to` (text), `created_at` (timestamptz), `resolved_at` (timestamptz, null until resolved), `resolution_notes` (text), plus denormalized `region` + `carrier` (for the CDF metric and the UI panels).

**`coordinator_preferences`** (app settings)
- `user_id` (text, PK), `default_region_filter` (text), `default_view` (text), `notification_settings_json` (jsonb)

**Seeding**: on sync/boot, seed `exception_tickets` from the Southeast spike shipments (`gold_shipments WHERE is_exception AND region='Southeast'`) so the queue opens with the story's ~open tickets — a mix of `temperature_excursion` + `customs_delay`, severities skewed high/critical, status mostly `open`/`investigating`. This gives the Operations page a populated queue on first load, and gives the agent real rows to act on.

## C. Lakebase CDF (Lakebase → Lakehouse)

Enable **Change Data Feed** on the native OLTP tables (`shipment_actions`, `exception_tickets`). Stream the ticket changes back into a lakehouse Delta table (e.g. `gold_exception_resolution`) carrying `ticket_id`, `shipment_id`, `exception_type`, `severity`, `region`, `carrier`, `status`, `created_at`, `resolved_at`.

Build the **materialized view / metric view `mv_exception_resolution`** (`02-uc-governance.md`) on this CDF output computing **average exception resolution time by type and region** — proving the operational actions (Maya's approved batch) reduced resolution time. This is the LTAP round-trip: write in Lakebase (transactional) → CDF → analyze in the lakehouse (analytical).

> **Build-time implementation**: managed Lakebase CDF→lakehouse replication is positioned as the production mechanism (talking track). For the build, `gold_exception_resolution` is materialized by the orchestration job (`global_logistics_refresh_e302b2`, `lakeflow-jobs`) from the Southeast exception shipments, with resolution hours that *improve* over the decay window (older exceptions ~42–72h, recent ones ~6–18h) — proving the operational actions reduced resolution time. `mv_exception_resolution` sits on top (avg resolution hours by exception_type × region × severity). Same analytical result the native CDF path would produce.

## Keys for `resources.json`

```
"lakebase_project_id": "<uuid>",
"lakebase_project_slug": "<slug>",
"lakebase_database": "dbgen_glcc_e302b2"
```
