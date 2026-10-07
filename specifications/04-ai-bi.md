# AI/BI — Dashboard + Genie

Tables/columns defined in `01-lakeflow.md`; metric views in `02-uc-governance.md`.
Build a Genie space and an AI/BI dashboard telling the Global Logistics exception story.

> Talking-track-only (no resource to build): **Databricks One** (surfaces the dashboard/Genie to entitled users), **Genie Code** (NL authoring inside the Genie/SQL editor), **Unity Catalog** (governance layer, already applied via `01`/`02`), **Lakeflow Connect** (positioned as the managed-ingest path; this demo generates synthetic gold directly).

## A. Genie Space

**Skill**: `databricks-genie` — read `SKILLS/databricks-genie/SKILL.md`.

Create **`Global Logistics Exception Analytics_e302b2`** Genie space. This is the Genie Agent the app's embedded assistant queries via its `ask_genie` tool.

### Tables
`mv_delivery_sla` (canonical SLA/exception/freight metric view), `gold_shipments` (per-shipment investigation: carrier, region, priority, product_category, exception flags, days_late, destination geo), `gold_delivery_performance` (daily SLA rollups), `gold_inventory` (backorder risk).

### Self-sufficient room
- **Space `description`**: name the event (Southeast express/emergency exception spike ~3 weeks ago, 3× baseline, SwiftMed + AeroCare, $1.6M freight/backorder risk) and point to the suggested questions in order.
- **Story-context `text_instruction`** at the top of `instructions.text_instructions[]`: WHAT HAPPENED · WHO (Maya Patel, Logistics Director, non-technical) · TONE (crisp, operational).
- **`sample_questions`** + matching `example_question_sqls`, same order.

### Instructions
```
You analyze MedTranz Global logistics data for Maya Patel (Global Logistics Director, non-technical).

BASELINES: normal exception rate ~6%, normal weekly expedited freight ~$180K. Anomaly threshold: exception rate > 12%.

HEADLINE NUMBERS — always answer from mv_delivery_sla (same definitions as the dashboard KPIs):
- "What's our on-time rate / SLA?" / "Exception rate by region?" / "Expedited freight this month?" → mv_delivery_sla.

INVESTIGATION FLOW for "Why does the Southeast keep missing SLA?":
1. mv_delivery_sla → MEASURE(exception_rate) by week → spot the 3× spike peaking ~3 weeks ago.
2. mv_delivery_sla → GROUP BY region → Southeast dominates.
3. mv_delivery_sla WHERE region='Southeast' → GROUP BY carrier → SwiftMed Freight + AeroCare Logistics lead.
4. gold_shipments WHERE region='Southeast' AND is_exception → GROUP BY priority, product_category → express/emergency, implants/capital_equipment.
5. mv_delivery_sla WHERE region='Southeast' → MEASURE(expedited_freight_usd) by week → the ~$540K peak vs ~$180K baseline.
Conclude with the exception-type mix (temperature_excursion + customs_delay) and suggest drafting reroute/escalate/hold actions.
```

### Sample questions — 7-step arc
1. **Headline** — "What's our on-time delivery rate this month vs baseline?" → weekly `MEASURE(sla_pct)` + `MEASURE(exception_rate)` from `mv_delivery_sla`, last 8 weeks.
2. **Which region** — "Which region is driving the exception spike?" → GROUP BY region, exception_rate, spike window.
3. **Which carriers** — "Within the Southeast, which carriers are missing SLA?" → GROUP BY carrier WHERE region='Southeast'.
4. **What + priority** — "What kinds of shipments are failing — priority and product category?" → `gold_shipments` Southeast exceptions GROUP BY priority, product_category.
5. **Cost** — "How much expedited freight is this costing us?" → weekly `MEASURE(expedited_freight_usd)` Southeast, showing the surge.
6. **Backorder risk** — "Which Southeast warehouses are below reorder point?" → `gold_inventory WHERE region='Southeast' AND below_reorder` ORDER BY shortfall_units.
7. **Recovery** — "Is the exception rate recovering? Show the trend." → last 6 weeks of `MEASURE(exception_rate)` Southeast, showing decay toward baseline.

Add `genie_space_id` to `resources.json`.

## B. Dashboard

**Skill**: `databricks-aibi-dashboards` — read `SKILLS/databricks-aibi-dashboards/SKILL.md`. Save locally as `PROJECT/dashboard.json`. Set `--dataset-catalog` + `--dataset-schema` on `lakeview create`/`update`. Name **`Global Logistics Exceptions_e302b2`**.

### Theme
```
canvasBackgroundColor: #F4F7FA / #0F1419 (dark)
widgetBackgroundColor: #FFFFFF / #161B22
widgetBorderColor:     same as background (no border)
fontColor:             #1F2530 / #E8ECF0
selectionColor:        #1E6FD9
visualizationColors:   ["#0B3D91","#1E6FD9","#38B6FF","#FFC43D","#EF476F"]
widgetHeaderAlignment: LEFT
```
Cool→warm palette: deep navy → blue → sky → amber → coral. Semantic pins (literal-hex, never `position N`):
- **Exception / affected (Southeast / spike)** → `#EF476F` coral.
- **On-time / baseline** → `#1E6FD9` blue.

Product-category pins (literal-hex on every widget coloring by `product_category`): `instruments` → `#1E6FD9`, `implants` → `#0B3D91`, `capital_equipment` → `#38B6FF`.

### Datasets (3)
| Name | Source | Powers |
|------|--------|--------|
| `ds_sla` | `SELECT date, region, carrier, priority, MEASURE(\`shipments\`) AS shipments, MEASURE(\`exceptions\`) AS exceptions, MEASURE(\`sla_pct\`) AS sla_pct, MEASURE(\`exception_rate\`) AS exception_rate, MEASURE(\`total_freight_usd\`) AS freight_usd, MEASURE(\`expedited_freight_usd\`) AS expedited_usd FROM mv_delivery_sla GROUP BY ALL` | KPI counters, SLA/exception trend, by-carrier + by-region bars, freight trend |
| `ds_shipments` | `SELECT shipment_id, ship_date, region, carrier, priority, product_category, status, is_exception, days_late, freight_cost_usd, dest_lat, dest_lng, CASE WHEN is_exception THEN 'Exception' ELSE 'On time' END AS outcome FROM gold_shipments` | Map, exception-by-priority/category, worst-lane investigation |
| `ds_inventory` | `SELECT warehouse_name, region, category, quantity_on_hand, reorder_point, shortfall_units, below_reorder FROM gold_inventory WHERE below_reorder` | Backorder-risk panel |

No hardcoded date clamps on `ds_sla`/`ds_shipments` — the global Date Range filter is the single windowing source.

### Global filters (left panel)
| Filter | Column | Datasets | Default |
|--------|--------|----------|---------|
| Date Range | `date` (ds_sla) / `ship_date` (ds_shipments) | ds_sla, ds_shipments | All |
| Region | `region` | ds_sla, ds_shipments, ds_inventory | All |
| Carrier | `carrier` | ds_sla, ds_shipments | All |
| Priority | `priority` | ds_sla, ds_shipments | All |

### Page 1 — Command Center (the glance)
**Row 1** — title markdown: *"MedTranz Global — Logistics Command Center. Maya Patel, Global Logistics Director. The Southeast exception spike peaked ~3 weeks ago at 3× normal on SwiftMed + AeroCare express/emergency lanes — $1.6M in expedited freight + backorder risk. This dashboard tracks the recovery."*

**Row 2 — 4 × `counter`** (`ds_sla`, no `period`, value color `#0B3D91`):
- **On-time rate** · `MEASURE(sla_pct)` as percent · *the headline health number.*
- **Exceptions** · `SUM(exceptions)` compact.
- **Expedited freight** · `SUM(expedited_usd)` number-currency USD compact · *the $ story.*
- **Shipments** · `SUM(shipments)` compact.

**Row 3 — `line` · "Weekly exception rate — Southeast vs rest"** (`ds_sla`). x = week(`date`), y = `MEASURE(exception_rate)`, color by a derived `region='Southeast'` split (Southeast coral `#EF476F`, all others blue `#1E6FD9`). *Southeast line builds to a 3× peak ~3 weeks ago then decays; the rest tick flat — the catalyst, unmistakable.* Vertical-line annotation at `SPIKE_PEAK` labeled "Exception peak".

**Row 4 — two side-by-side**
- **`bar` horizontal · "Exceptions by carrier (Southeast)"** · `ds_sla` filtered region=Southeast · y=`carrier`, x=`SUM(exceptions)`, sort DESC · *SwiftMed + AeroCare tower over the rest.*
- **`bar` horizontal stacked · "Exceptions by region"** · `ds_sla` · y=`region`, x=`SUM(exceptions)`, color by priority · *Southeast on top, express/emergency heavy.*

**Row 5 — `symbol-map` · "Exception shipments — destination hospitals"** (full width, `ds_shipments` filtered to exceptions). `coordinates: {latitude: dest_lat, longitude: dest_lng}` (bare fields), size = `COUNT(shipment_id)`, color = `SUM(freight_cost_usd)`, `colorRamp.scheme: "YlOrRd"`, `mark.opacity: 1`. *Southeast hospitals light up deep red.*

### Page 2 — Investigation (deep-dive)
**Row 1** — title markdown: *"Investigation — the same exceptions split by priority, product category, lane, and cost. Southeast express/emergency on two carriers is the story."*

**Row 2**
- **`bar` grouped · "Exceptions by priority × outcome"** · `ds_shipments` · x=`priority`, y=`COUNT(shipment_id)`, color=`outcome` (Exception coral `#EF476F`, On time blue `#1E6FD9`) · *express/emergency carry the coral.*
- **`bar` horizontal · "Exceptions by product category"** · `ds_shipments WHERE is_exception` · y=`product_category`, x=`COUNT`, color = category pins · *implants + capital_equipment lead.*

**Row 3 — `line` · "Weekly expedited freight — Southeast"** (`ds_sla` region=Southeast) · x=week, y=`MEASURE(expedited_freight_usd)` number-currency · *~$180K baseline → ~$540K peak → decay. The $1.6M surge, visualized.*

**Row 4**
- **`table` · "Worst lanes"** · `ds_shipments WHERE is_exception` · columns `region`, `carrier`, `priority`, `product_category`, `COUNT(shipment_id)` AS exceptions, `AVG(days_late)`, `SUM(freight_cost_usd)` · sort exceptions DESC · *Southeast × SwiftMed/AeroCare × express rows on top.*
- **`bar` horizontal · "Backorder risk — below reorder point"** · `ds_inventory` · y=`warehouse_name`, x=`SUM(shortfall_units)`, color = category pins · *Southeast warehouses lead — the backorder half of the $1.6M.*

### Validation
Published dashboard reads at a glance: exception spike stands out (Southeast coral), SwiftMed+AeroCare lead the carrier bar, map lights up Southeast, expedited-freight line shows the surge, global filters update every widget. Genie's "on-time rate this month" matches `MEASURE(sla_pct)`. Add `dashboard_id` to `resources.json`.
