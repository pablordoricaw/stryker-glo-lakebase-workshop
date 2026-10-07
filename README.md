# Global Logistics Command Center

A production operational app for a medical device manufacturer's Global Logistics team — built with **Databricks AppKit** (TypeScript/React, Plotly visualizations), powered by **Lakebase** as the operational database, with an embedded **AI assistant** (OpenAI Agents SDK) that both answers analytical questions via **Genie Agents** AND takes operational actions (write-backs to Lakebase) in a single conversation. Showcases **LTAP** (Lakebase Transactional + Analytical Processing) alongside core Lakebase features: synced tables, native OLTP tables, and Lakebase CDF back to the lakehouse.

## The Story

| | |
|---|---|
| **Company** | MedTranz Global — a medical device manufacturer (instruments, implants, capital equipment) shipping to hospitals across 12 regions |
| **Protagonist** | Maya Patel, Global Logistics Director |
| **Challenge** | A service-failure spike peaked ~3 weeks ago at **3× normal** exception volume, putting **$1.6M** of expedited freight and backorder risk on the line — late shipments, temperature excursions, and customs holds across hospitals |
| **Journey** | Maya opens the command center to see which carriers, lanes, and product categories are driving exceptions, then asks the embedded assistant (Genie-backed) *why the Southeast keeps missing SLA* |
| **Resolution** | The AI assistant drafts reroutes, escalations, and hold/release actions; Maya approves the batch; the ops team executes the Lakebase write-backs with full auditability. Resolution time drops and the team avoids another **$400K** in penalty freight |
| **Impact** | $1.6M freight/backorder risk surfaced in one view; ~$400K penalty freight avoided; exception resolution time cut from days to hours |

## Overview

MedTranz Global's logistics team already uses **Genie Agents** for ad-hoc analytics on their lakehouse. The next step is a *production operational app* where coordinators track shipments, manage exceptions, and act — not just read dashboards. The **Global Logistics Command Center** is that app: a Databricks App (AppKit) sitting on **Lakebase**, where analytical gold tables are synced in from the lakehouse and app-owned OLTP tables capture operational actions and exception tickets. The embedded assistant closes the loop — it investigates with Genie, reads operational state from Lakebase, drafts a batch of actions, and (on human approval) commits the writes, which cascade live through the UI.

## Key Numbers

| Metric | Value |
|---|---|
| Shipments (gold) | 500K+ |
| Inventory rows (gold) | 50K |
| Delivery-performance rows (gold, daily SLA) | 500K+ |
| Regions | 12 |
| Product categories | instruments / implants / capital_equipment |
| Freight + backorder risk at peak | $1.6M |
| Penalty freight avoided | ~$400K |
| Exception spike peak | ~3 weeks ago, 3× baseline |

## Demo Walkthrough

1. **Catalyst** — Maya opens the Command Center. The overview page (Plotly) shows exceptions spiking to 3× baseline ~3 weeks ago, concentrated in the Southeast region, express/emergency priority, and two carriers.
2. **Discovery** — She drills into carriers × lanes × product categories to see what's driving the misses, and reviews the open exception-ticket queue (customs delays, temperature excursions, damage, missing docs).
3. **Ask Genie** — In the embedded assistant she asks *"why does the Southeast keep missing SLA?"* The agent calls the Genie Agent, which queries the lakehouse and returns the root-cause breakdown.
4. **Draft + approval (human-in-the-loop)** — The assistant proposes a batch of operational actions — reroute the worst lane, escalate critical tickets, hold/release specific shipments — and **stops for approval**. Maya reviews and approves.
5. **Cascade** — On approval the agent commits write-backs to Lakebase native OLTP tables (`shipment_actions`, `exception_tickets`). KPI counters tick, the ticket queue flips statuses, and the audit trail appears — the visible payoff.
6. **Closed loop** — Lakebase **CDF** streams the OLTP changes back to the lakehouse; a **metric view** computes *average exception resolution time by type and region*, proving the operational actions moved the needle.

## Products Showcased

| Product | Role in this demo |
|---|---|
| **Synthetic data generation** | Spark + Faker generate 500K+ shipments, 50K inventory rows, 500K+ daily delivery-performance rows with a visible exception spike ~3 weeks ago |
| **Lakeflow Spark Declarative Pipelines (SDP)** | Build the gold tables (`gold_shipments`, `gold_inventory`, `gold_delivery_performance`) in Unity Catalog |
| **Unity Catalog** | Governs the lakehouse gold tables and registers the Lakebase database |
| **Lakebase** | Operational database: synced tables (CONTINUOUS / TRIGGERED / SNAPSHOT) from the lakehouse, app-owned native OLTP tables, LTAP direct writes, and CDF back to the lakehouse |
| **AI/BI Dashboards** | Analytical SLA / exception dashboard on the gold tables (the lakehouse analytics the team already runs) |
| **Genie Agents** | Natural-language root-cause analytics over the gold tables; invoked by the app's embedded assistant |
| **Metric Views** | Governed metric: average exception resolution time by type and region, computed on the Lakebase CDF output |
| **Databricks Apps (AppKit)** | The Command Center app — React/Plotly UI + embedded OpenAI Agents SDK assistant (Genie query + Lakebase read + action write-back with approval) |
| **Lakeflow Jobs** | Orchestrates data gen → SDP → Lakebase sync → metric refresh |
