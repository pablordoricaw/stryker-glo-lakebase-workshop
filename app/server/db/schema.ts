import {
  text,
  timestamp,
  date,
  uuid,
  integer,
  bigint,
  doublePrecision,
  jsonb,
  pgSchema,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Lakebase schema (`app.*`) for the Global Logistics Command Center.
 *
 * Three groups:
 *   1. Chat state      (conversations, messages, feedback) — REUSE AS-IS.
 *   2. Delta mirror    (shipments, inventory, delivery_performance) — synced
 *                      from the gold tables (01-lakeflow.md) by db/sync.ts.
 *   3. Native OLTP     (shipment_actions, exception_tickets,
 *                      coordinator_preferences) — app-owned, written by the
 *                      agent + the drawer. shipment_actions is the append-only
 *                      audit; exception_tickets is the queue the UI manages.
 */
export const appSchema = pgSchema('app');

// ============================================================================
// Chat state (reusable — unchanged from template)
// ============================================================================

export const conversations = appSchema.table(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userEmail: text('user_email').notNull(),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['default', 'demo_dock'] })
      .notNull()
      .default('default'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversations_user_idx').on(t.userEmail, t.updatedAt),
    index('conversations_kind_idx').on(t.userEmail, t.kind),
  ],
);

export const messages = appSchema.table(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    position: integer('position').notNull(),
    traceId: text('trace_id'),
    thinking: jsonb('thinking').$type<ThinkingEntry[]>().notNull().default([]),
    error: text('error'),
    canceled: boolean('canceled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_convo_pos_uq').on(t.conversationId, t.position),
  ],
);

export const feedback = appSchema.table(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    value: text('value', { enum: ['up', 'down'] }).notNull(),
    rationale: text('rationale'),
    traceId: text('trace_id'),
    mlflowAssessmentId: text('mlflow_assessment_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('feedback_message_idx').on(t.messageId)],
);

// ============================================================================
// Delta mirror — synced from gold tables (server/db/sync.ts)
// ============================================================================

// gold_shipments → CONTINUOUS (talking track). The operational shipment
// state the queue + map read. Scoped at build-time to recent exceptions.
export const shipments = appSchema.table(
  'shipments',
  {
    shipmentId: text('shipment_id').primaryKey(),
    originWarehouse: text('origin_warehouse'),
    originWarehouseName: text('origin_warehouse_name'),
    destinationHospital: text('destination_hospital'),
    destinationHospitalName: text('destination_hospital_name'),
    carrier: text('carrier'),
    status: text('status'),
    shipDate: timestamp('ship_date', { withTimezone: true }),
    estimatedDelivery: timestamp('estimated_delivery', { withTimezone: true }),
    actualDelivery: timestamp('actual_delivery', { withTimezone: true }),
    freightCostUsd: doublePrecision('freight_cost_usd'),
    weightKg: doublePrecision('weight_kg'),
    priority: text('priority'),
    region: text('region'),
    productCategory: text('product_category'),
    isException: boolean('is_exception'),
    daysLate: integer('days_late'),
    isExpedited: boolean('is_expedited'),
    destLat: doublePrecision('dest_lat'),
    destLng: doublePrecision('dest_lng'),
  },
  (t) => [
    index('shipments_region_idx').on(t.region, t.carrier),
    index('shipments_exc_idx').on(t.isException),
  ],
);

// gold_inventory → TRIGGERED (talking track). Backorder context for the
// ticket drawer (implants / capital_equipment below reorder).
export const inventory = appSchema.table(
  'inventory',
  {
    // Composite natural key (warehouse × sku) collapsed to a surrogate PK.
    id: text('id').primaryKey(),
    warehouseId: text('warehouse_id'),
    warehouseName: text('warehouse_name'),
    productSku: text('product_sku'),
    productName: text('product_name'),
    category: text('category'),
    quantityOnHand: integer('quantity_on_hand'),
    reorderPoint: integer('reorder_point'),
    lastReplenished: date('last_replenished'),
    region: text('region'),
    belowReorder: boolean('below_reorder'),
    shortfallUnits: integer('shortfall_units'),
  },
  (t) => [index('inventory_region_idx').on(t.region, t.category)],
);

// gold_delivery_performance → SNAPSHOT (talking track). Pre-aggregated daily
// SLA metrics. Build-time: scoped to the Southeast story region.
export const deliveryPerformance = appSchema.table(
  'delivery_performance',
  {
    id: text('id').primaryKey(),
    metricDate: date('metric_date'),
    region: text('region'),
    carrier: text('carrier'),
    priority: text('priority'),
    productCategory: text('product_category'),
    shipmentsCount: bigint('shipments_count', { mode: 'number' }),
    onTimeCount: bigint('on_time_count', { mode: 'number' }),
    exceptionCount: bigint('exception_count', { mode: 'number' }),
    avgDaysLate: doublePrecision('avg_days_late'),
    slaPct: doublePrecision('sla_pct'),
    exceptionRate: doublePrecision('exception_rate'),
    totalFreightUsd: doublePrecision('total_freight_usd'),
    expeditedFreightUsd: doublePrecision('expedited_freight_usd'),
  },
  (t) => [index('delivery_perf_region_idx').on(t.region, t.metricDate)],
);

// ============================================================================
// Native OLTP tables (app-owned — the brief's three)
// ============================================================================

// Append-only audit of operational actions. Every reroute / escalate / hold /
// release / add_note the agent OR the drawer performs lands here, stamped with
// the OBO operator email. Powers the Activity-tab timeline + the home feed.
export const shipmentActions = appSchema.table(
  'shipment_actions',
  {
    actionId: uuid('action_id').primaryKey().defaultRandom(),
    shipmentId: text('shipment_id'),
    ticketId: uuid('ticket_id'),
    actionType: text('action_type', {
      enum: ['reroute', 'escalate', 'hold', 'release', 'add_note'],
    }).notNull(),
    performedBy: text('performed_by').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true })
      .notNull()
      .defaultNow(),
    detailsJson: jsonb('details_json').$type<ActionDetails>().notNull().default({}),
  },
  (t) => [
    index('shipment_actions_shipment_idx').on(t.shipmentId),
    index('shipment_actions_ticket_idx').on(t.ticketId),
    index('shipment_actions_time_idx').on(t.timestamp),
  ],
);

// The exception queue the app manages. Seeded on boot from the Southeast
// exception shipments. CDF source (resolved tickets flow back to the lakehouse).
export const exceptionTickets = appSchema.table(
  'exception_tickets',
  {
    ticketId: uuid('ticket_id').primaryKey().defaultRandom(),
    shipmentId: text('shipment_id').notNull(),
    exceptionType: text('exception_type', {
      enum: ['customs_delay', 'damage', 'missing_docs', 'temperature_excursion'],
    }).notNull(),
    severity: text('severity', {
      enum: ['low', 'medium', 'high', 'critical'],
    }).notNull(),
    status: text('status', {
      enum: ['open', 'investigating', 'resolved'],
    })
      .notNull()
      .default('open'),
    assignedTo: text('assigned_to'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNotes: text('resolution_notes'),
    // Last operational action applied (reroute/escalate/hold/release) — drives
    // the "Action badge" on queue rows after the agent's batch commits.
    lastAction: text('last_action'),
    // Denormalized from the shipment for the panels + CDF metric.
    region: text('region'),
    carrier: text('carrier'),
  },
  (t) => [
    index('exception_tickets_status_idx').on(t.status, t.severity),
    index('exception_tickets_region_idx').on(t.region, t.carrier),
    index('exception_tickets_shipment_idx').on(t.shipmentId),
  ],
);

export const coordinatorPreferences = appSchema.table(
  'coordinator_preferences',
  {
    userId: text('user_id').primaryKey(),
    defaultRegionFilter: text('default_region_filter'),
    defaultView: text('default_view'),
    notificationSettingsJson: jsonb('notification_settings_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

/** Free-form detail recorded on each shipment_actions row. */
export type ActionDetails = {
  reason?: string;
  reroute_to_carrier?: string;
  from_carrier?: string;
  note?: string;
  severity?: string;
  exception_type?: string;
  [k: string]: unknown;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
