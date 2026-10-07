# App Spec — Command Center (primary operations page)

Route `/operations`, labeled **"Command Center"** in the sidebar. This is what Maya stares at all day — an **exception cockpit**, not a plain queue. Screenshot test: it must read as *"a global logistics command center"* at a glance.

## Layout (top → bottom)

**Row 1 — KPI tiles** (from Lakebase, subscribe to `dataMutated`, pulse on change):
- **Open exceptions** (count of `exception_tickets` where status ≠ resolved) — the number that must visibly drop after the agent acts.
- **Critical tickets** (severity = critical).
- **Expedited freight at risk** ($ sum of expedited exception shipments in scope) — the money tile.
- **Avg resolution time** (hours, from resolved tickets) — the "did it get better?" tile.

**Row 2 — Exception map** (full width, Plotly `scattergeo`/`scattermapbox`): one bubble per destination hospital with open exceptions, sized by exception count, colored by severity (critical = coral `#EF476F`). The **Southeast cluster blazes red on load** and visibly thins after the agent's batch executes. This is the visual signature of the page. Data from the shipments mirror + ticket join. (If map tiles are unavailable, fall back to a Plotly region bubble/heat layout — still geographic, never a bare table.)

**Row 3 — two panels side by side:**
- **Exception-type breakdown** (Plotly bar): open tickets grouped by `exception_type` (temperature_excursion / customs_delay / damage / missing_docs), colored by severity. Southeast-heavy on load.
- **By-carrier panel** (Plotly bar): open exceptions by carrier — SwiftMed Freight + AeroCare Logistics tower.

**Row 4 — Exception-ticket queue** (the actionable table, secondary to the hero map):
- Columns: Ticket, Shipment, Region, Carrier, Exception type, Severity (badge), Status (badge), Assigned to, Age. 
- Filters (URL-synced): Region (default Southeast per the story), Carrier, Severity, Status, Exception type.
- Row click → **Action drawer**.
- Rows gain an **Action badge** (Rerouted / Escalated / Held / Released) after the agent's write; status badge flips open→investigating→resolved.

## Action drawer (slide-over, 3 tabs)
- **Ticket tab**: full ticket detail (shipment, lane, exception type, severity, SLA miss, freight cost) + manual action buttons: **Reroute** / **Escalate** / **Hold** / **Release** / **Add note** → POST writes a `shipment_actions` row + updates the ticket (mirrors what the agent does, for manual ops).
- **Shipment tab**: the synced shipment detail (origin warehouse, destination hospital, carrier, priority, product category, ship/est/actual dates, days late, freight cost).
- **Activity tab**: merged timeline from this ticket's/shipment's `shipment_actions` rows (append-only audit) — who did what, when, with details. Grows live when the agent executes.

## Data wiring
- Reads: `exception_tickets`, synced `gold_shipments` (shipment detail), `gold_inventory` (backorder context in the ticket tab for implants/capital_equipment).
- Writes: `shipment_actions` (append), `exception_tickets` (status/resolution update) — both via the drawer buttons (manual) and the agent's `execute_action_batch` (bulk).
- Subscribe to `dataMutated`; refetch KPIs + queue + map + panels; pulse changed values (`usePulseOnChange`).

## Analytics page (`/analytics`) — Plotly over Delta (warehouse)
Secondary to the embedded dashboard. 3–4 Plotly charts tied to the story (SQL in `config/queries/`):
- `sla_trend.sql` — weekly `sla_pct` + `exception_rate` from `mv_delivery_sla` (or `gold_delivery_performance`), last ~16 weeks.
- `exceptions_by_carrier.sql` — Southeast exceptions by carrier.
- `expedited_freight.sql` — weekly expedited freight (Southeast), the surge.
- `resolution_time.sql` — **`mv_exception_resolution`**: avg resolution hours by `exception_type` × `region` — the CDF/metric-view loop, proving resolution time dropped. (Update `AnalyticsView.tsx` queryKey list to match these files; delete all template example queries.)
