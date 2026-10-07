# Lakeflow — Synthetic Data + SDP Pipeline

## Shared Context (referenced by all other spec files)

**Company**: MedTranz Global — medical device manufacturer. Products: `instruments`, `implants`, `capital_equipment`. Ships to hospitals across **12 regions**.

**Persona**: Maya Patel, Global Logistics Director.

**The event (the catalyst — must be visible to the eye on the dashboard):**
A service-failure spike in shipment exceptions peaked **~3 weeks ago at 3× baseline**, concentrated in the **Southeast** region, on **express/emergency** priority, driven by **two carriers** (`SwiftMed Freight` and `AeroCare Logistics`). It put **$1.6M** of expedited freight + backorder risk on the line. The spike has a clear build-up → peak → decay shape.

**Time anchors** (`NOW = datetime.now()`, rolling so the chart's right edge is always ~yesterday):
- `STORY_START = NOW − 365 days` (rolling 12-month history)
- `SPIKE_BUILD_START = NOW − 35 days`
- `SPIKE_PEAK = NOW − 21 days` (~3 weeks ago — the peak, clearly in the past)
- `DECAY_START = NOW − 14 days`
- `STORY_END = NOW`

**Baselines**: normal daily exception rate ~6% of active shipments; at `SPIKE_PEAK` the Southeast express/emergency exception rate hits ~18% (3× baseline). Normal weekly expedited-freight cost ~$180K; at peak ~$540K.

**Regions (12)**: `Northeast`, `Southeast`, `Midwest`, `Southwest`, `West`, `Pacific Northwest`, `Mountain`, `Great Lakes`, `Mid-Atlantic`, `South Central`, `New England`, `Capital Region`. **Southeast is the affected region** — it must stand out in every exception chart.

**Carriers (6)**: `SwiftMed Freight`, `AeroCare Logistics`, `MediLine Express`, `Continental Cargo`, `Vanguard Transport`, `PrimeHealth Carriers`. The spike concentrates on `SwiftMed Freight` + `AeroCare Logistics` in the Southeast.

**Exception types** (for tickets / status): `customs_delay`, `damage`, `missing_docs`, `temperature_excursion`. During the spike, `temperature_excursion` and `customs_delay` dominate the Southeast express/emergency lanes.

**Priorities**: `standard`, `express`, `emergency`.

**Shipment status enum**: `in_transit`, `delivered`, `delayed`, `exception`, `on_hold`.

> Numbers are demo targets, not invariants — match the narrative shape, ±10% is fine. The one hard rule: the Southeast express/emergency exception spike ~3 weeks ago must dominate baseline variance so anyone can point at it.

---

## A. Synthetic Data Generation

**Skill**: `databricks-synthetic-data-gen` (read `SKILLS/databricks-synthetic-data-gen/SKILL.md`). Use the pre-provisioned databricks-connect venv (Python 3.12 + faker + numpy + pandas + pyarrow) — do NOT create a new venv.

Write raw datasets as **parquet files into the UC Volume** `/Volumes/{catalog}/{schema}/raw_data/<dataset>/` (one subdir per dataset). SDP silver reads them via `read_files()` — no bronze layer.

| Dataset | Rows | Notes |
|---------|------|-------|
| `warehouses` | 24 | Origin warehouses: id `WH-NN`, name, region (2 per region across the 12 regions), lat/lng. |
| `hospitals` | ~400 | Destination hospitals: id `HOSP-NNNN`, name, region, city, lat/lng. |
| `products` | ~600 | SKU `SKU-NNNNNN`, name, category (`instruments`/`implants`/`capital_equipment`), unit_weight_kg. |
| `shipments` | **500K+** | One row per shipment over the 12-month window. See schema + event below. |
| `inventory` | **50K** | warehouse × product_sku snapshot (24 warehouses × ~2,100 SKUs). |

### `shipments` generation (the core table — 500K+ rows)

Columns (raw): `shipment_id` (`SHP-NNNNNNNN`), `origin_warehouse` (WH id), `destination_hospital` (HOSP id), `carrier`, `status`, `ship_date` (TIMESTAMP), `estimated_delivery` (TIMESTAMP), `actual_delivery` (TIMESTAMP, NULL if not yet delivered), `freight_cost_usd` (DOUBLE), `weight_kg` (DOUBLE), `priority`, `region` (= destination hospital's region), `product_category`.

Generation rules:
- ~500K+ shipments spread over the 12-month window, ~1,400/day baseline with ±15% daily gaussian noise + mild weekly seasonality (weekday > weekend).
- Priority mix: `standard` 70%, `express` 22%, `emergency` 8%. Emergency/express skew toward `implants` + `capital_equipment`.
- `freight_cost_usd`: base by weight × priority multiplier (standard 1.0, express 2.2, emergency 4.5) + region distance factor. Expedited (express/emergency) exceptions add a surcharge (see event).
- SLA: `estimated_delivery = ship_date + lead_time(priority, region)` (standard 5d, express 2d, emergency 1d, +0–2d region factor). Normal shipments: `actual_delivery ≈ estimated_delivery ± small jitter`, status `delivered`. ~6% baseline exceptions: `actual_delivery` late by 1–6 days, status `exception` or `delayed`.
- Recent shipments (last few days) may still be `in_transit` with NULL `actual_delivery`.

### The Event (must dominate the Southeast charts)

Between `SPIKE_BUILD_START` (NOW−35d) and `DECAY_START` (NOW−14d), **Southeast** `express`/`emergency` shipments on `SwiftMed Freight` + `AeroCare Logistics` get an elevated exception rate that **builds to 3× baseline at `SPIKE_PEAK` (NOW−21d)**, then decays back toward baseline over the final 2 weeks:
- Exception rate on those lanes: ~6% baseline → ramps → ~18% at peak (NOW−21d) → decays to ~9% by NOW.
- Late deliveries 3–8 days late; status `exception`; `freight_cost_usd` on these gets a **1.8× expedited surcharge** (the $1.6M expedited-freight story).
- Exception types on the spike lanes: predominantly `temperature_excursion` + `customs_delay` (the Southeast heat + a customs bottleneck narrative).
- Keep non-Southeast / standard-priority exceptions at flat ~6% baseline across the whole window, so the Southeast spike is visually unmistakable.
- **Guardrail**: the peak sits at NOW−21d with build-up before and decay after — never at the chart's right edge.

### `inventory` generation (50K rows)

Columns: `warehouse_id`, `warehouse_name`, `product_sku`, `product_name`, `category`, `quantity_on_hand` (INT), `reorder_point` (INT), `last_replenished` (DATE), `region`. ~2,100 SKUs across 24 warehouses = ~50K rows. ~8% of rows have `quantity_on_hand < reorder_point` (backorder risk). Southeast warehouses carry a visibly higher share of below-reorder-point implants/capital_equipment (ties to the backorder-risk half of the $1.6M).

---

## B. SDP Pipeline

**Skill**: `databricks-pipelines` — read `SKILLS/databricks-pipelines/SKILL.md` before implementing.

Create pipeline **`global_logistics_pipeline_e302b2`** transforming raw parquet → gold tables in `{catalog}.{schema}`. No bronze; silver reads raw via `read_files()`, gold aggregates silver.

### Gold tables (the three the brief names + supporting silver)

**`gold_shipments`** — per-shipment fact (the brief's exact columns). `read_files()` on raw `shipments` JOIN `warehouses` (→ origin names/geo) JOIN `hospitals` (→ destination name/region/geo) JOIN `products` (→ product name/category). Columns:
`shipment_id`, `origin_warehouse`, `origin_warehouse_name`, `destination_hospital`, `destination_hospital_name`, `carrier`, `status`, `ship_date`, `estimated_delivery`, `actual_delivery`, `freight_cost_usd`, `weight_kg`, `priority`, `region`, `product_category`, plus derived **`is_exception`** (BOOLEAN: status IN (`exception`,`delayed`) OR `actual_delivery > estimated_delivery`), **`days_late`** (INT, 0 if on-time/NULL), **`is_expedited`** (priority IN (`express`,`emergency`)), destination `dest_lat`/`dest_lng` (for the map). Cluster by `ship_date`. **500K+ rows.**

**`gold_inventory`** — the brief's inventory table + derived `below_reorder` (BOOLEAN: `quantity_on_hand < reorder_point`) and `shortfall_units` (reorder_point − qty, floored at 0). **50K rows.**

**`gold_delivery_performance`** — **pre-aggregated daily delivery SLA metrics by `region` × `carrier` × `priority` × `product_category`**. One row per (`metric_date`, `region`, `carrier`, `priority`, `product_category`). Metrics: `shipments_count`, `on_time_count`, `exception_count`, `avg_days_late`, `sla_pct` (on_time/shipments), `exception_rate` (exception/shipments), `total_freight_usd`, `expedited_freight_usd`. Derived from `gold_shipments` GROUP BY date/region/carrier/priority/product_category over the 12-month window. **~200K rows** (realized active-combo count from ~1M shipments; the daily × 12-region × 6-carrier × 3-priority × 3-category grain caps the theoretical max at ~236K — this is the fully-populated pre-aggregated SLA layer the dashboard + Genie read).

**Dashboard-filter contract**: every dashboard-consumed table carries `region`, `carrier`, `priority`, `product_category` where applicable so global filters apply uniformly.

### Consumer routing

| Consumer | Table |
|----------|-------|
| Dashboard KPIs + SLA trend + exception-by-carrier/region | `gold_delivery_performance` (+ `mv_delivery_sla` metric view, `02-uc-governance.md`) |
| Dashboard map + per-shipment investigation widgets | `gold_shipments` |
| Dashboard backorder panel | `gold_inventory` |
| Genie space | `gold_shipments`, `gold_delivery_performance`, `gold_inventory` |
| Lakebase synced tables (app) | `gold_shipments` (CONTINUOUS), `gold_inventory` (TRIGGERED), `gold_delivery_performance` (SNAPSHOT) — see `03-lakebase.md` |

---

## C. Validation

Run before building downstream resources. Each row = a one-line query; if it fails, fix the synth.

**Load-bearing (gate the story):**
- **Exception spike, peak in past** — weekly `exception_count` from `gold_delivery_performance WHERE region='Southeast' AND priority IN ('express','emergency')`: peak ~3× baseline at NOW−21d, decaying, NOT in the current week.
- **Southeast dominates** — GROUP BY region on exceptions in the spike window → Southeast clearly #1.
- **Two carriers lead** — within Southeast express/emergency, `SwiftMed Freight` + `AeroCare Logistics` carry the bulk of exceptions.
- **Expedited freight surge** — `expedited_freight_usd` in Southeast peaks ~$540K/week vs ~$180K baseline (the $1.6M story over the spike window).
- **Row counts** — `gold_shipments` ≥ 500K, `gold_delivery_performance` ≥ 500K, `gold_inventory` ≈ 50K.
- **Backorder risk** — `gold_inventory WHERE below_reorder` returns a visible share, skewed Southeast.

**Smoke checks**: 12 distinct regions; 6 carriers; 3 priorities; 3 product categories; `dest_lat`/`dest_lng` non-null and in earth-bounds; `sla_pct`/`exception_rate` in [0,1].

Add `pipeline_id` to `resources.json`.
