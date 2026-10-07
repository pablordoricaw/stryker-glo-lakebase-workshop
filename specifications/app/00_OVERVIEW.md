# App Spec — Overview, Home & Assistant

> **Build-time note.** Read `DEMO_SKILL_DIR/app/app.md` FIRST and follow it end-to-end (rsync template → customize → Lakebase → env → smoke test). The template at `DEMO_SKILL_DIR/app/app_template/` is a Node.js + React + Express `@databricks/appkit` app with Lakebase, agent streaming, MLflow tracing, OBO auth, chat dock, and scripted demo chain already wired. Rewrite the domain pieces for THIS story. On conflict: `app.md` governs *how*, this spec governs *what*.

## Name & identity
- **App name**: `dbgen-glcc` (resource name `dbgen-glcc`; `branding.appName` = **"Global Logistics Command Center"**).
- Persona: **Maya Patel, Global Logistics Director, MedTranz Global**.
- Visual identity: operations/control-room feel. Dark-friendly, strong single accent (medical-device blue `#1E6FD9` primary, coral `#EF476F` for exceptions/critical). Plotly for every chart. Reads as a logistics command center, not a returns console.

## Pitch
An embedded AI assistant (built on the **OpenAI Agents SDK**) that **investigates via Genie AND takes operational action** in one conversation. Maya sees the Southeast exception spike on the command center, asks the assistant *why the Southeast keeps missing SLA*; the agent calls the **Genie Agent** to root-cause it, reads operational context from **Lakebase**, drafts a **batch of operational actions** (reroutes, escalations, hold/release), and **stops for approval**. Maya approves; the agent commits the write-backs to Lakebase (`shipment_actions` + `exception_tickets`) in one atomic transaction — the queue, KPI counters, and audit trail cascade live. Every turn is traced in MLflow.

## Databricks capabilities mapped
| Capability | Where it shows |
|-----------|----------------|
| **Lakebase** | OLTP write surface: synced gold tables (shipments/inventory/delivery-perf) + app-owned native OLTP (`shipment_actions`, `exception_tickets`, `coordinator_preferences`). The agent writes here under OBO identity. LTAP: transactional writes + analytical reads on the same store. |
| **Genie Agent** | The assistant's `ask_genie` tool delegates analytical questions to the Genie space (`04-ai-bi.md`); reasoning streams into the Thinking panel. |
| **OpenAI Agents SDK** | The embedded agent loop — tools + instructions + the 3-phase action chain. |
| **SQL Warehouse on Delta** | Analytics page + Delta→Lakebase sync. |
| **AI/BI Dashboard** | Embedded iframe (`config.dashboardId`). |
| **MLflow tracing** | Per-turn traces, tool spans, thumbs → assessments. |
| **Databricks Apps** | SSO, OBO (actions stamped with Maya's email), autoscaling. |
| **Lakebase CDF + Metric View** | Resolved tickets flow back to the lakehouse → `mv_exception_resolution` (avg resolution time by type/region) — shown on the Analytics page as the "did it work?" proof. |

## Pages
| Page | Purpose | Key capability |
|------|---------|----------------|
| **Home** | Narrative landing — persona, the spike, journey diagram, starter chips, featured action, activity feed | Config + `HomeView.tsx` |
| **Command Center** (`/operations`) | **Primary surface** — exception cockpit (see `01_OPERATIONS.md`): shipment-exception map + KPI tiles + exception-ticket queue + action drawer | **Lakebase** OLTP |
| **Analytics** (`/analytics`) | Plotly charts over Delta via warehouse: SLA trend, exceptions by carrier, expedited-freight surge, **resolution-time by type/region** (the CDF/metric-view loop) | **SQL Warehouse** + metric view |
| **Dashboard** (`/dashboard`) | Embedded AI/BI dashboard iframe | **AI/BI** |

## Assistant
Lives on every page (floating dock + full-page chat). One brain, OpenAI Agents SDK.

### Agent tools (4 — the brief's "query Genie AND perform operational actions")
| Tool | What it does | Phase |
|------|--------------|-------|
| `ask_genie` | Delegates an analytical question to the Genie Agent (space from `04-ai-bi.md`); streams reasoning to the Thinking panel. **The "query Genie Agents" capability.** | Investigation |
| `find_exceptions` | Reads Lakebase: open exception tickets + their shipments for a filter (region / carrier / priority), returning count, affected shipments, severity split, exception-type mix — read-only, for human confirmation of scope. | Discovery |
| `draft_action_plan` | Pure function: given the filter + findings, drafts a **batch of operational actions** — reroute the worst lane, escalate critical tickets, hold/release specific shipments — as a reviewable list with per-shipment action_type + reason. No DB write. | Draft |
| `execute_action_batch` | **WRITE (requires approval)**: one atomic transaction over Lakebase — insert `shipment_actions` rows (audit, stamped with Maya's OBO email), flip matching `exception_tickets` from `open`/`investigating` → `resolved` (set `resolved_at`, `resolution_notes`), update affected shipment status (`on_hold`/`in_transit` reroute). Takes a **filter** (region/carrier/priority/ticket scope) + the drafted action spec — never a list of IDs. Emits `dataMutated` on commit. | Execution |

### Human-in-the-loop (3-phase chain — mandatory approval stop)
1. **Discover** — `ask_genie` to root-cause, then `find_exceptions` to pull the affected tickets/shipments (read-only).
2. **Draft + confirm** — `draft_action_plan` shows the batch (e.g. "reroute 42 Southeast express shipments off SwiftMed to Continental Cargo; escalate 11 critical temperature-excursion tickets; hold 7 awaiting customs docs") + totals → **STOP, wait for approval**.
3. **Execute** (after "yes") — `execute_action_batch` commits the write-backs atomically → emits `dataMutated`.

### The UI cascade on write
On commit, the Command Center refetches: KPI tiles tick (Open tickets drop, Resolved jump), queue rows flip status + gain an **Action** badge (Rerouted / Escalated / Held), the exception map re-renders (fewer red bubbles in the Southeast), the activity feed grows, any open drawer re-fetches its action timeline. **This live cascade is the payoff** — confirm it works before declaring done.

## Home page
- **Hero**: "Maya Patel · Global Logistics Director · MedTranz Global", headline **"Southeast SLA is missing — exceptions are 3× normal"**, situation (exceptions spiked to 3× ~3 weeks ago on SwiftMed + AeroCare express/emergency lanes; $1.6M in expedited freight + backorder risk), goal (root-cause → draft reroutes/escalations/holds → approve the batch → watch resolution time drop).
- **Journey diagram** (4 cards): See the spike → Command Center · Ask why → opens chat · Draft the fix → featured action · Approve & watch it cascade.
- **Starter chips**: "Why does the Southeast keep missing SLA?" / "Which carriers are driving the exceptions?" / "What's the expedited-freight cost this month?"
- **Featured action card**: "Clear the Southeast exception backlog — draft reroutes, escalations & holds for approval" → triggers the full investigate → draft → approve flow.
- **Activity feed**: live tail of agent actions ("Rerouted 42 Southeast express shipments off SwiftMed Freight", "Escalated 11 critical temperature-excursion tickets", "Resolved 60 exception tickets for the Southeast lane").

## Scripted demo flow (~3 min) — `config.assistantScript`
**Step 1 — "Why does the Southeast keep missing SLA?"** (always available). Agent calls `ask_genie` → Genie returns the root cause (3× spike, SwiftMed + AeroCare, express/emergency, temperature_excursion + customs_delay, ~$540K/wk expedited freight). Suggests drafting the action batch.

**Step 2 — "Draft a plan to clear the Southeast backlog."** (unlocks on "lot"/"carrier"/"Southeast"/"exception"). Agent calls `find_exceptions` (Southeast), then `draft_action_plan` → shows the batch (reroutes + escalations + holds) with counts + which tickets. **Stops, waits.**

**Step 3 — "Yes — execute the plan."** (unlocks on "reroute"/"escalate"/"approve"/"plan"). `execute_action_batch` runs one atomic Lakebase write → emits `dataMutated`. On screen: Open-tickets KPI drops, Resolved jumps, queue rows flip + gain Action badges, map sheds red Southeast bubbles, activity feed grows — all live. **The story beat.**

All narrative config lives in `config/app.json` (branding, assistantScript + triggerAfter, data.tables, dashboardId, genieSpaceId) + `HomeView.tsx` constants. Set `genieSpaceId` (NOT `masEndpointName` — this demo uses Genie, not MAS). `agentModel` = `databricks-gpt-5-4` (Responses-API-capable).
