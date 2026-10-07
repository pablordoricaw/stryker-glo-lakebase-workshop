# User's original brief (verbatim — authoritative source of intent)

> This is exactly what the user provided, captured unaltered. Treat it
> as the source of truth for the demo's intent. Preserve its specifics
> (names, numbers, entities, requirements, phrasing) end-to-end; do not
> dilute them into a shorter summary.

Build a solution called "Global Logistics Command Center" — a Databricks App built 
with AppKit (TypeScript/React) powered by Lakebase, featuring an embedded AI agent 
built with the OpenAI Agents SDK that can query Genie Agents and perform operational 
actions. Use Plotly for all visualizations. The solution showcases LTAP capabilities 
alongside core Lakebase features for a medical device company's Global Logistics team.

Use synthetic data. Azure cloud. Deploy via Databricks Asset Bundles.

## The Story
A medical device manufacturer's Global Logistics team already uses Genie Agents for 
ad-hoc analytics on their lakehouse data. They want the next step: a production 
operational app where logistics coordinators can track shipments, manage exceptions, 
and make decisions — with an AI assistant that can both answer analytical questions 
(via Genie) AND take operational actions (write to Lakebase) in the same conversation.

## What to Build

### Part 1: Lakehouse Foundation
Create synthetic Delta gold tables in Unity Catalog:
- `gold_shipments` — shipment_id, origin_warehouse, destination_hospital, carrier, 
  status, ship_date, estimated_delivery, actual_delivery, freight_cost_usd, weight_kg, 
  priority (standard/express/emergency), region, product_category 
  (instruments/implants/capital_equipment)
- `gold_inventory` — warehouse_id, warehouse_name, product_sku, product_name, category, 
  quantity_on_hand, reorder_point, last_replenished, region
- `gold_delivery_performance` — pre-aggregated daily delivery SLA metrics by region, 
  carrier, and priority level

Generate 500K+ shipments, 50K inventory rows, 500K+ delivery performance rows.

### Part 2: Lakebase as the Operational Database

**Synced Tables (Lakehouse → Lakebase):**
- Sync gold_shipments (CONTINUOUS), gold_inventory (TRIGGERED), 
  gold_delivery_performance (SNAPSHOT) into Lakebase
- Enable LTAP Direct Writes if available
- Register the Lakebase database in Unity Catalog

**Native OLTP Tables (app-owned):**
- `shipment_actions` — action_id, shipment_id, action_type (reroute/escalate/
  hold/release/add_note), performed_by, timestamp, details_json
- `exception_tickets` — ticket_id, shipment_id, exception_type (customs_delay/
  damage/missing_docs/temperature_excursion), severity (low/medium/high/critical), 
  status (open/investigating/resolved), assigned_to, created_at, resolved_at, 
  resolution_notes
- `coordinator_preferences` — user_id, default_region_filter, default_view, 
  notification_settings_json

**Lakebase CDF (Lakebase → Lakehouse):**
Enable CDF on the native OLTP tables. Build a materialized view on the CDF output 
computing "average exception resolution time by type and region."

### Part 3: The AppKit Application

Build the app using Databricks AppKit (https://github.com/databricks/appkit). 
Use the AppKit plugin architecture:

**AppKit Setup:**
```typescript
import { createApp, server, analytics, genie } from '@databricks/appkit';

createApp({
  plugins: [
    server(),
    analytics(),    // SQL queries against Lakebase + SQL Warehouse
    genie(),        // Genie Agent integration
  ],
});
