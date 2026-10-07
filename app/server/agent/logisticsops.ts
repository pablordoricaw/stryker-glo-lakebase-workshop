/**
 * The Global Logistics Command Center agent — the demo's defining piece.
 *
 * Built on `@openai/agents` (OpenAI Agents SDK) against Databricks' Responses
 * API. The agent BOTH investigates (via Genie) AND takes operational action
 * (writes to Lakebase under human approval) in one conversation.
 *
 * Four tools, three-phase chain:
 *   1. Discover  — ask_genie (root-cause the Southeast SLA miss) +
 *                  find_exceptions (read Lakebase: scope the open backlog)
 *   2. Draft     — draft_action_plan (pure function; proposes the batch) → STOP
 *   3. Execute   — execute_action_batch (atomic Lakebase WRITE, filter-driven)
 *
 * The data backend is GENIE (not MAS) — ask_genie from tools/genie.ts.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setTracingDisabled,
} from '@openai/agents';
import type { Tool } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import {
  findExceptionScope,
  executeActionBatch,
  type ActionPlanItem,
  type BatchFilter,
} from '../db/queries/index.js';
import { askGenieTool } from './tools/genie.js';
export type { ToolProgressEvent } from './tools/types.js';

export type ModelErrorDetail = {
  status: number;
  url: string;
  bodyText: string;
  code?: string;
  message?: string;
};

export type AgentContext = {
  db: AppDb;
  userEmail: string;
  req: Request;
  /** Genie space ID the `ask_genie` tool queries. Set in config/app.json as
   * `genieSpaceId` (this is a Genie demo, not MAS). */
  genieSpaceId: string;
  databricksHost: string;
  model: string;
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  modelError?: { current: ModelErrorDetail | null };
};

const ACTION_TYPES = ['reroute', 'escalate', 'hold', 'release', 'add_note'] as const;
const EXC_TYPES = [
  'customs_delay',
  'damage',
  'missing_docs',
  'temperature_excursion',
] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

function makeTools(ctx: AgentContext) {
  // ── find_exceptions (Discovery, read-only) ───────────────────────────────
  const findExceptions = tool({
    name: 'find_exceptions',
    description:
      'Read Lakebase: scope the OPEN exception-ticket backlog for a filter (region / carrier / priority). Returns open ticket count, affected shipments, severity split, exception-type mix, expedited-freight $ at risk, and the top carriers driving exceptions. Read-only — use this to confirm the scope with the user BEFORE drafting any actions.',
    parameters: z.object({
      region: z.string().nullable().describe('Region to scope to, e.g. "Southeast". null = all regions.'),
      carrier: z.string().nullable().describe('Carrier to scope to, e.g. "SwiftMed Freight". null = all carriers.'),
      priority: z
        .string()
        .nullable()
        .describe('Shipment priority filter: "standard" / "express" / "emergency". null = all.'),
    }),
    execute: async ({ region, carrier, priority }) =>
      mlflow.withSpan(
        async () =>
          findExceptionScope(ctx.db, {
            region: region ?? undefined,
            carrier: carrier ?? undefined,
            priority: priority ?? undefined,
          }),
        {
          name: 'find_exceptions',
          spanType: mlflow.SpanType.TOOL,
          inputs: { region, carrier, priority },
        },
      ),
  });

  // ── draft_action_plan (Draft, pure — NO DB write) ────────────────────────
  const actionItemSchema = z.object({
    action_type: z.enum(ACTION_TYPES).describe('reroute | escalate | hold | release | add_note'),
    exception_type: z
      .enum(EXC_TYPES)
      .nullable()
      .describe('Target only tickets of this exception type. null = all types in scope.'),
    severity: z
      .enum(SEVERITIES)
      .nullable()
      .describe('Target only tickets of this severity. null = all severities in scope.'),
    reroute_to_carrier: z
      .string()
      .nullable()
      .describe('For action_type="reroute": the destination carrier (e.g. "Continental Cargo"). null otherwise.'),
    reason: z.string().describe('Short human-readable reason, recorded in the audit trail.'),
  });

  const draftActionPlan = tool({
    name: 'draft_action_plan',
    description:
      'PURE function (no DB write): given the discovered filter + scope, assemble a reviewable batch of operational actions — reroute the worst lane off the failing carrier, escalate critical tickets, hold/release specific shipments. Returns the plan verbatim plus a count estimate per action. Show this to the user and STOP for approval before calling execute_action_batch.',
    parameters: z.object({
      filter: z.object({
        region: z.string().nullable().describe('Region scope, e.g. "Southeast".'),
        carrier: z.string().nullable().describe('Carrier scope, e.g. "SwiftMed Freight".'),
        priority: z.string().nullable().describe('Priority scope: standard/express/emergency.'),
      }),
      actions: z.array(actionItemSchema).describe('The ordered list of actions in this batch.'),
    }),
    execute: async ({ filter, actions }) =>
      mlflow.withSpan(
        async () => {
          // Estimate how many open tickets each action would touch, for the
          // user-facing draft. Read-only.
          const scope = await findExceptionScope(ctx.db, {
            region: filter.region ?? undefined,
            carrier: filter.carrier ?? undefined,
            priority: filter.priority ?? undefined,
          });
          const estimates = actions.map((a) => {
            let n = scope.openTickets;
            if (a.severity) n = scope.severitySplit[a.severity] ?? 0;
            else if (a.exception_type) n = scope.exceptionTypeSplit[a.exception_type] ?? 0;
            return {
              action_type: a.action_type,
              exception_type: a.exception_type,
              severity: a.severity,
              reroute_to_carrier: a.reroute_to_carrier,
              reason: a.reason,
              estimated_tickets: n,
            };
          });
          return {
            filter,
            actions: estimates,
            scope_open_tickets: scope.openTickets,
            scope_expedited_freight_usd: scope.expeditedFreightUsd,
            requires_approval: true,
          };
        },
        {
          name: 'draft_action_plan',
          spanType: mlflow.SpanType.TOOL,
          inputs: { filter, action_count: actions.length },
        },
      ),
  });

  // ── execute_action_batch (Execution — atomic Lakebase WRITE) ─────────────
  const executeBatch = tool({
    name: 'execute_action_batch',
    description:
      'WRITE (requires prior user approval). One atomic Lakebase transaction over the matching OPEN tickets: inserts shipment_actions audit rows (stamped with the operator email), flips matched exception_tickets to resolved, and updates affected shipment status (reroute → in_transit on the new carrier, hold → on_hold, release → in_transit). Takes a FILTER (region/carrier/priority) + the drafted actions — NEVER a list of ticket IDs; the tool re-derives the row set server-side. Returns {resolvedTickets, actionsRecorded, shipmentsUpdated, byAction}. Call ONLY after the user has approved the drafted plan.',
    parameters: z.object({
      filter: z.object({
        region: z.string().nullable(),
        carrier: z.string().nullable(),
        priority: z.string().nullable(),
      }),
      actions: z.array(actionItemSchema),
    }),
    execute: async ({ filter, actions }) =>
      mlflow.withSpan(
        async () => {
          const f: BatchFilter = {
            region: filter.region ?? undefined,
            carrier: filter.carrier ?? undefined,
            priority: filter.priority ?? undefined,
          };
          const plan: ActionPlanItem[] = actions.map((a) => ({
            action_type: a.action_type,
            exception_type: a.exception_type ?? undefined,
            severity: a.severity ?? undefined,
            reroute_to_carrier: a.reroute_to_carrier ?? undefined,
            reason: a.reason,
          }));
          return executeActionBatch(ctx.db, { filter: f, actions: plan, userEmail: ctx.userEmail });
        },
        {
          name: 'execute_action_batch',
          spanType: mlflow.SpanType.TOOL,
          inputs: { filter, action_count: actions.length },
        },
      ),
  });

  const tools: Tool[] = [findExceptions, draftActionPlan, executeBatch];
  if (ctx.genieSpaceId) {
    tools.push(askGenieTool(ctx, ctx.genieSpaceId));
  }
  return tools;
}

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  const headers = await authHeaders(ctx.req);
  const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const client = new OpenAI({
    apiKey: bearer,
    baseURL: `${ctx.databricksHost}/serving-endpoints`,
    maxRetries: 4,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Connection', 'close');
      let body = init?.body;
      if (typeof body === 'string' && body.startsWith('{')) {
        try {
          const parsed = JSON.parse(body) as {
            input?: Array<Record<string, unknown>>;
            messages?: Array<Record<string, unknown>>;
          };
          if (Array.isArray(parsed.input)) {
            for (const item of parsed.input) {
              const id = item.id;
              if (typeof id === 'string' && id.length > 64) {
                delete item.id;
              }
            }
          }
          if (Array.isArray(parsed.messages)) {
            for (const m of parsed.messages) {
              const content = (m as { content?: unknown }).content;
              if (Array.isArray(content)) {
                for (const part of content as Array<Record<string, unknown>>) {
                  if (part && typeof part === 'object') {
                    delete part.annotations;
                  }
                }
              }
            }
          }
          body = JSON.stringify(parsed);
        } catch {
          /* not JSON — pass through */
        }
      }
      const url =
        typeof input === 'string'
          ? input
          : (input as URL | Request).toString?.() ?? String(input);
      console.debug(
        `[openai-shim] → ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 2000) : '(non-string)'}`,
      );
      const tShim = Date.now();
      let resp: Response;
      try {
        resp = await fetch(input as Parameters<typeof fetch>[0], {
          ...init,
          headers,
          body,
          keepalive: false,
        });
      } catch (e) {
        console.error('[openai-shim] fetch threw', { url, error: e });
        throw e;
      }
      console.debug(
        `[openai-shim] ← ${resp.status} ${resp.statusText} from ${url} in ${Date.now() - tShim}ms (content-type: ${resp.headers.get('content-type') ?? '?'})`,
      );
      if (!resp.ok) {
        try {
          const text = await resp.clone().text();
          let code: string | undefined;
          let message: string | undefined;
          try {
            const parsed = JSON.parse(text) as { error_code?: string; message?: string };
            code = parsed.error_code;
            message = parsed.message;
          } catch {
            /* body wasn't JSON — keep raw text */
          }
          if (ctx.modelError) {
            ctx.modelError.current = { status: resp.status, url, bodyText: text, code, message };
          }
          console.error(
            `[openai-shim] ${resp.status} from ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 4000) : '(non-string)'}\n  response_body: ${text.slice(0, 4000)}`,
          );
        } catch (e) {
          console.error('[openai-shim] failed to clone error response', e);
        }
      }
      return resp;
    },
  });
  setDefaultOpenAIClient(client);
  setTracingDisabled(true);
}

export function buildAgent(ctx: AgentContext): Agent {
  return new Agent({
    name: 'LogisticsOps',
    model: ctx.model,
    modelSettings: {
      reasoning: { effort: 'low', summary: 'auto' },
      store: false,
    },
    instructions: `
You are the operations assistant for Maya Patel, Global Logistics Director at
MedTranz Global — a medical device manufacturer shipping instruments, implants,
and capital equipment to hospitals across 12 regions. Maya runs the Global
Logistics Command Center. Be decisive, concise, and always lead with the number.

The current situation: shipment exceptions spiked to ~3× normal ~3 weeks ago,
concentrated in the SOUTHEAST region, on EXPRESS/EMERGENCY priority, driven by
two carriers — SwiftMed Freight and AeroCare Logistics — dominated by
temperature_excursion and customs_delay. ~$1.6M of expedited freight + backorder
risk is on the line (~$540K/week expedited freight at peak vs ~$180K baseline).

════════════════════════════════════════════════════════════
TOOLS
════════════════════════════════════════════════════════════

ask_genie(question) — delegates an analytical "why / what / which" question to
  the Databricks Genie space, which queries the lakehouse gold tables and
  returns a synthesized answer. Use for root-cause investigation. Prefer ONE
  focused question over many (broad questions trigger long polls). Example:
  "Which carriers and exception types are driving the Southeast express/emergency
   SLA misses over the last 3 weeks, and what's the expedited freight cost?"

find_exceptions(region, carrier, priority) — reads Lakebase and returns the
  OPEN exception-ticket scope for the filter: open ticket count, affected
  shipments, severity split, exception-type mix, expedited freight $ at risk,
  top carriers. Read-only. Pass null for any dimension you don't want to filter.

draft_action_plan(filter, actions) — PURE (no write). Assembles a reviewable
  batch of operational actions and estimates how many tickets each touches.
  Each action has: action_type (reroute|escalate|hold|release|add_note),
  optional exception_type and/or severity to target a slice, optional
  reroute_to_carrier (for reroute), and a reason.

execute_action_batch(filter, actions) — the WRITE. One atomic Lakebase
  transaction: inserts audit rows, flips matched OPEN tickets to resolved,
  updates shipment status. Takes the SAME filter + actions shape. NEVER echo
  ticket IDs — the tool re-derives the row set from the filter server-side.
  Call ONLY after the user approves.

════════════════════════════════════════════════════════════
OPERATING MODES
════════════════════════════════════════════════════════════

MODE A — INVESTIGATION
If the user asks "why" / "what" / "which" / anything investigative → call
ask_genie EXACTLY ONCE with a focused question, then synthesize for Maya. Lead
with the headline number. Do NOT call the action tools unless she asks you to
fix / draft / clear something. After answering, you MAY suggest drafting an
action plan to clear the backlog.

MODE B — ACTION CHAIN (HUMAN-IN-THE-LOOP, 3 phases)
If the user asks you to DRAFT / CLEAR / FIX / RESOLVE / HANDLE the backlog, run
the three-phase chain. NEVER run phase 3 (execute_action_batch) until the user
has explicitly approved.

--- Phase 1 · Discover (read-only) ---
  1. (If you haven't already) call ask_genie to confirm the root cause.
  2. Call find_exceptions with the story filter (region="Southeast", and if the
     user named a carrier/priority, those too). Remember the counts.

--- Phase 2 · Draft + ASK FOR CONFIRMATION ---
  3. Call draft_action_plan with a sensible batch for the Southeast backlog. A
     good default batch:
       - reroute the worst lane off the failing carrier: action_type="reroute",
         carrier in filter = "SwiftMed Freight" (or the worst from find_exceptions),
         reroute_to_carrier = "Continental Cargo" (a healthy carrier),
         reason = "Reroute Southeast express lane off <carrier> to recover SLA".
       - escalate critical tickets: action_type="escalate", severity="critical",
         reason = "Escalate critical temperature-excursion tickets to carrier ops".
       - hold shipments awaiting customs docs: action_type="hold",
         exception_type="customs_delay",
         reason = "Hold pending customs documentation".
  4. Reply to Maya with:
       - A bold headline: "Southeast backlog: {open} open tickets · {expedited}
         expedited freight at risk."
       - A short markdown list of the drafted actions WITH the estimated_tickets
         count for each (from draft_action_plan's output).
       - A single CTA: "Reply **yes** to execute this batch — or tell me what to change."
     STOP HERE. Do not call execute_action_batch yet.

--- Phase 3 · Execute (on approval) ---
  Triggered only when the user's NEXT message is an approval ("yes", "go", "ok",
  "approved", "do it", "execute", "proceed", "looks good"). A revision request
  ("make it only critical", "reroute to Vanguard instead") → re-draft via
  draft_action_plan and STOP again. On approval:
    A. Call execute_action_batch ONCE with the SAME filter + actions you drafted.
    B. Final summary — see below. Use the returned counts, not your memory.

════════════════════════════════════════════════════════════
SUMMARY FORMAT (final assistant message of an action chain)
════════════════════════════════════════════════════════════

End with a markdown summary Maya reads in 10 seconds. Example:

**Done — Southeast exception backlog cleared.**

- **{resolvedTickets} tickets resolved** across the Southeast lane
- {byAction.reroute} rerouted off SwiftMed Freight → Continental Cargo
- {byAction.escalate} critical tickets escalated
- {byAction.hold} shipments held pending customs docs
- {shipmentsUpdated} shipment statuses updated

The Command Center map + KPI tiles have updated — open exceptions dropped and
the Southeast cluster thinned. Resolution time should fall over the next week.

Rules:
- Numbers come from execute_action_batch's return value, NOT memory.
- Markdown-bold the headline on line 1.
- Never claim a tool ran that didn't; surface any error plainly.

════════════════════════════════════════════════════════════
TONE
════════════════════════════════════════════════════════════
Maya is busy. Lead with the answer. No "Sure, I'll help!" preamble. No
questions-about-your-question unless genuinely ambiguous. Synthesize; don't
dump raw data.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };
