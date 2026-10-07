# App Spec — Data Model

## Two stores
- **Delta (lakehouse)** — source of truth, read-only from app. Warehouse queries + Genie read here.
- **Lakebase Postgres** — OLTP write surface. Chat state + synced gold mirror + app-owned native OLTP tables.

## Lakebase schema (`app.*`, Drizzle in `server/db/schema.ts`)

### Chat state (reusable — keep as-is)
`conversations`, `messages` (with `thinking` JSONB, `traceId`), `feedback` — unchanged from template.

### Synced gold mirror (from Delta, `01-lakeflow.md`)
| Table | Source | Sync mode (talking track) | Key fields |
|-------|--------|---------------------------|-----------|
| `shipments` | `gold_shipments` | CONTINUOUS | shipmentId (PK), originWarehouse, originWarehouseName, destinationHospital, destinationHospitalName, carrier, status, shipDate, estimatedDelivery, actualDelivery, freightCostUsd, weightKg, priority, region, productCategory, isException, daysLate, isExpedited, destLat, destLng |
| `inventory` | `gold_inventory` | TRIGGERED | warehouseId, warehouseName, productSku, productName, category, quantityOnHand, reorderPoint, lastReplenished, region, belowReorder, shortfallUnits |
| `deliveryPerformance` | `gold_delivery_performance` | SNAPSHOT | metricDate, region, carrier, priority, shipmentsCount, onTimeCount, exceptionCount, avgDaysLate, slaPct, exceptionRate, totalFreightUsd, expeditedFreightUsd |

Build-time: one-shot Delta→Lakebase sync at boot via SQL Statements API, chunked (<65,535 params/insert), idempotent (onConflictDoNothing). Reset endpoint truncates mirror + native tables and re-syncs + re-seeds. Table names from `config.data.tables`. **Watch types**: cast Delta TIMESTAMP → PG timestamptz, DOUBLE → double precision, BIGINT → bigint.

### Native OLTP tables (app-owned, written — the brief's three)
| Table | Key fields |
|-------|-----------|
| `shipment_actions` | actionId (uuid PK), shipmentId, actionType (`reroute`/`escalate`/`hold`/`release`/`add_note`), performedBy (OBO email), timestamp (default now), detailsJson (jsonb — reroute target carrier, reason, notes). **Append-only audit.** |
| `exception_tickets` | ticketId (uuid PK), shipmentId, exceptionType (`customs_delay`/`damage`/`missing_docs`/`temperature_excursion`), severity (`low`/`medium`/`high`/`critical`), status (`open`/`investigating`/`resolved`), assignedTo, createdAt, resolvedAt (null until resolved), resolutionNotes, region, carrier (denormalized for panels + CDF metric). |
| `coordinator_preferences` | userId (PK), defaultRegionFilter, defaultView, notificationSettingsJson (jsonb) |

### Seeding `exception_tickets` on boot/reset
Seed from `gold_shipments WHERE is_exception AND region='Southeast'` (plus a smaller sample of other regions): create a ticket per exception shipment with exceptionType weighted temperature_excursion + customs_delay in the Southeast, severity skewed high/critical, status mostly open/investigating, region + carrier from the shipment, createdAt near the shipment's exception date, resolvedAt NULL. Target ~60–120 Southeast open tickets so the queue + map have a strong story on load, and the agent's batch has real rows to resolve.

## Lakebase CDF → lakehouse (closing the loop)
On resolution, `exception_tickets` changes are captured via Lakebase CDF (build-time: periodic `lakeflow-jobs` task reads the OLTP table) → written to Delta `gold_exception_resolution` → `mv_exception_resolution` metric view (avg resolution time by type × region). The Analytics page's `resolution_time.sql` reads this — the demo's proof the operational actions worked.

## config/app.json wiring
- `genieSpaceId` = Genie space from `04-ai-bi.md` (set this; leave `masEndpointName` empty — Genie, not MAS).
- `dashboardId` = dashboard from `04-ai-bi.md`.
- `data.catalog` / `data.schema` from env (`DEMO_CATALOG`/`DEMO_SCHEMA`).
- `data.tables` → logical→Delta name map: `shipments: gold_shipments`, `inventory: gold_inventory`, `deliveryPerformance: gold_delivery_performance`.
- `agentModel` = `databricks-gpt-5-4`.
