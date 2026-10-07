import { sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import type { ActionDetails } from '../schema.js';

/**
 * Exception-ticket + shipment-action queries for the Command Center.
 *
 * Reads: exception_tickets (the queue) joined to the synced shipments mirror.
 * Writes: shipment_actions (append-only audit) + exception_tickets status flips.
 * The agent's bulk tool (execute_action_batch) and the drawer's manual
 * buttons both go through here.
 */

export type TicketStatus = 'open' | 'investigating' | 'resolved';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ExceptionType =
  | 'customs_delay'
  | 'damage'
  | 'missing_docs'
  | 'temperature_excursion';
export type ActionType = 'reroute' | 'escalate' | 'hold' | 'release' | 'add_note';

export type TicketListRow = {
  ticketId: string;
  shipmentId: string;
  exceptionType: ExceptionType;
  severity: Severity;
  status: TicketStatus;
  assignedTo: string | null;
  createdAt: string;
  resolvedAt: string | null;
  lastAction: string | null;
  region: string | null;
  carrier: string | null;
  // From the joined shipment mirror.
  destinationHospitalName: string | null;
  priority: string | null;
  productCategory: string | null;
  daysLate: number | null;
  freightCostUsd: number | null;
  shipmentStatus: string | null;
};

type TicketListFilters = {
  region?: string;
  carrier?: string;
  severity?: Severity;
  status?: TicketStatus;
  exceptionType?: ExceptionType;
  limit?: number;
};

export async function listTickets(
  db: AppDb,
  f: TicketListFilters = {},
): Promise<TicketListRow[]> {
  const limit = f.limit ?? 500;
  const wRegion = f.region ? sql`AND t.region = ${f.region}` : sql``;
  const wCarrier = f.carrier ? sql`AND t.carrier = ${f.carrier}` : sql``;
  const wSeverity = f.severity ? sql`AND t.severity = ${f.severity}` : sql``;
  const wStatus = f.status ? sql`AND t.status = ${f.status}` : sql``;
  const wType = f.exceptionType ? sql`AND t.exception_type = ${f.exceptionType}` : sql``;
  const res = await db.execute(sql`
    SELECT
      t.ticket_id, t.shipment_id, t.exception_type, t.severity, t.status,
      t.assigned_to, t.created_at, t.resolved_at, t.last_action, t.region, t.carrier,
      s.destination_hospital_name, s.priority, s.product_category,
      s.days_late, s.freight_cost_usd::float8 AS freight_cost_usd, s.status AS shipment_status
    FROM app.exception_tickets t
    LEFT JOIN app.shipments s ON s.shipment_id = t.shipment_id
    WHERE 1=1 ${wRegion} ${wCarrier} ${wSeverity} ${wStatus} ${wType}
    ORDER BY
      CASE t.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      t.created_at DESC
    LIMIT ${limit}
  `);
  return (res.rows as Array<Record<string, unknown>>).map(toTicketRow);
}

function toTicketRow(r: Record<string, unknown>): TicketListRow {
  return {
    ticketId: String(r.ticket_id),
    shipmentId: String(r.shipment_id),
    exceptionType: r.exception_type as ExceptionType,
    severity: r.severity as Severity,
    status: r.status as TicketStatus,
    assignedTo: (r.assigned_to as string | null) ?? null,
    createdAt: String(r.created_at),
    resolvedAt: (r.resolved_at as string | null) ?? null,
    lastAction: (r.last_action as string | null) ?? null,
    region: (r.region as string | null) ?? null,
    carrier: (r.carrier as string | null) ?? null,
    destinationHospitalName: (r.destination_hospital_name as string | null) ?? null,
    priority: (r.priority as string | null) ?? null,
    productCategory: (r.product_category as string | null) ?? null,
    daysLate: r.days_late === null || r.days_late === undefined ? null : Number(r.days_late),
    freightCostUsd:
      r.freight_cost_usd === null || r.freight_cost_usd === undefined
        ? null
        : Number(r.freight_cost_usd),
    shipmentStatus: (r.shipment_status as string | null) ?? null,
  };
}

// ============================================================================
// KPI summary — drives the top-of-page tiles.
// ============================================================================

export type TicketKpis = {
  openCount: number;
  criticalCount: number;
  resolvedCount: number;
  expeditedFreightAtRisk: number;
  avgResolutionHours: number | null;
};

export async function ticketKpis(db: AppDb): Promise<TicketKpis> {
  const res = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE t.status <> 'resolved')::int AS open_count,
      COUNT(*) FILTER (WHERE t.severity = 'critical' AND t.status <> 'resolved')::int AS critical_count,
      COUNT(*) FILTER (WHERE t.status = 'resolved')::int AS resolved_count,
      COALESCE(SUM(s.freight_cost_usd) FILTER (
        WHERE t.status <> 'resolved' AND s.is_expedited = true
      ), 0)::float8 AS expedited_freight,
      AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0)
        FILTER (WHERE t.status = 'resolved' AND t.resolved_at IS NOT NULL)::float8 AS avg_hours
    FROM app.exception_tickets t
    LEFT JOIN app.shipments s ON s.shipment_id = t.shipment_id
  `);
  const r = (res.rows[0] ?? {}) as {
    open_count: number;
    critical_count: number;
    resolved_count: number;
    expedited_freight: number;
    avg_hours: number | null;
  };
  return {
    openCount: r.open_count ?? 0,
    criticalCount: r.critical_count ?? 0,
    resolvedCount: r.resolved_count ?? 0,
    expeditedFreightAtRisk: Number(r.expedited_freight ?? 0),
    avgResolutionHours:
      r.avg_hours === null || r.avg_hours === undefined ? null : Number(r.avg_hours),
  };
}

// ============================================================================
// Panels — exception-type + by-carrier breakdowns (open tickets).
// ============================================================================

export type TypeBreakdownRow = {
  exceptionType: ExceptionType;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
};

export async function exceptionTypeBreakdown(
  db: AppDb,
  f: { region?: string } = {},
): Promise<TypeBreakdownRow[]> {
  const wRegion = f.region ? sql`AND region = ${f.region}` : sql``;
  const res = await db.execute(sql`
    SELECT exception_type,
      COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical,
      COUNT(*) FILTER (WHERE severity = 'high')::int AS high,
      COUNT(*) FILTER (WHERE severity = 'medium')::int AS medium,
      COUNT(*) FILTER (WHERE severity = 'low')::int AS low,
      COUNT(*)::int AS total
    FROM app.exception_tickets
    WHERE status <> 'resolved' ${wRegion}
    GROUP BY exception_type
    ORDER BY total DESC
  `);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    exceptionType: r.exception_type as ExceptionType,
    critical: Number(r.critical),
    high: Number(r.high),
    medium: Number(r.medium),
    low: Number(r.low),
    total: Number(r.total),
  }));
}

export type CarrierBreakdownRow = {
  carrier: string;
  openTickets: number;
  critical: number;
};

export async function carrierBreakdown(
  db: AppDb,
  f: { region?: string } = {},
): Promise<CarrierBreakdownRow[]> {
  const wRegion = f.region ? sql`AND region = ${f.region}` : sql``;
  const res = await db.execute(sql`
    SELECT COALESCE(carrier, 'Unknown') AS carrier,
      COUNT(*)::int AS open_tickets,
      COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical
    FROM app.exception_tickets
    WHERE status <> 'resolved' ${wRegion}
    GROUP BY COALESCE(carrier, 'Unknown')
    ORDER BY open_tickets DESC
  `);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    carrier: String(r.carrier),
    openTickets: Number(r.open_tickets),
    critical: Number(r.critical),
  }));
}

// ============================================================================
// Geographic map — one bubble per destination hospital with open exceptions.
// ============================================================================

export type MapBucket = {
  hospital: string;
  region: string;
  lat: number;
  lng: number;
  openTickets: number;
  critical: number;
  freightUsd: number;
};

export async function ticketMapBuckets(
  db: AppDb,
  f: { region?: string } = {},
): Promise<MapBucket[]> {
  const wRegion = f.region ? sql`AND t.region = ${f.region}` : sql``;
  const res = await db.execute(sql`
    SELECT
      COALESCE(s.destination_hospital_name, s.destination_hospital, 'Unknown') AS hospital,
      COALESCE(t.region, 'Unknown') AS region,
      AVG(s.dest_lat)::float8 AS lat,
      AVG(s.dest_lng)::float8 AS lng,
      COUNT(*)::int AS open_tickets,
      COUNT(*) FILTER (WHERE t.severity = 'critical')::int AS critical,
      COALESCE(SUM(s.freight_cost_usd), 0)::float8 AS freight_usd
    FROM app.exception_tickets t
    JOIN app.shipments s ON s.shipment_id = t.shipment_id
    WHERE t.status <> 'resolved'
      AND s.dest_lat IS NOT NULL AND s.dest_lng IS NOT NULL ${wRegion}
    GROUP BY 1, 2
    ORDER BY open_tickets DESC
    LIMIT 400
  `);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    hospital: String(r.hospital),
    region: String(r.region),
    lat: Number(r.lat),
    lng: Number(r.lng),
    openTickets: Number(r.open_tickets),
    critical: Number(r.critical),
    freightUsd: Number(r.freight_usd),
  }));
}

// ============================================================================
// Ticket detail (drawer) — ticket + shipment + action timeline.
// ============================================================================

export type ShipmentDetail = {
  shipmentId: string;
  originWarehouseName: string | null;
  destinationHospitalName: string | null;
  carrier: string | null;
  status: string | null;
  priority: string | null;
  productCategory: string | null;
  region: string | null;
  shipDate: string | null;
  estimatedDelivery: string | null;
  actualDelivery: string | null;
  daysLate: number | null;
  freightCostUsd: number | null;
  isExpedited: boolean | null;
};

export type TicketAction = {
  actionId: string;
  actionType: ActionType;
  performedBy: string;
  timestamp: string;
  details: ActionDetails;
};

export type TicketDetail = TicketListRow & {
  shipment: ShipmentDetail | null;
  actions: TicketAction[];
  resolutionNotes: string | null;
};

export async function getTicket(db: AppDb, ticketId: string): Promise<TicketDetail | null> {
  const res = await db.execute(sql`
    SELECT
      t.ticket_id, t.shipment_id, t.exception_type, t.severity, t.status,
      t.assigned_to, t.created_at, t.resolved_at, t.last_action, t.region, t.carrier,
      t.resolution_notes,
      s.destination_hospital_name, s.priority, s.product_category,
      s.days_late, s.freight_cost_usd::float8 AS freight_cost_usd, s.status AS shipment_status,
      s.origin_warehouse_name, s.carrier AS s_carrier, s.region AS s_region,
      CAST(s.ship_date AS TEXT) AS ship_date,
      CAST(s.estimated_delivery AS TEXT) AS estimated_delivery,
      CAST(s.actual_delivery AS TEXT) AS actual_delivery,
      s.is_expedited
    FROM app.exception_tickets t
    LEFT JOIN app.shipments s ON s.shipment_id = t.shipment_id
    WHERE t.ticket_id = ${ticketId}
    LIMIT 1
  `);
  const r = res.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;

  const actionsRes = await db.execute(sql`
    SELECT action_id, action_type, performed_by,
           CAST(timestamp AS TEXT) AS timestamp, details_json
    FROM app.shipment_actions
    WHERE ticket_id = ${ticketId} OR shipment_id = ${String(r.shipment_id)}
    ORDER BY timestamp DESC
    LIMIT 100
  `);
  const actions = (actionsRes.rows as Array<Record<string, unknown>>).map((a) => ({
    actionId: String(a.action_id),
    actionType: a.action_type as ActionType,
    performedBy: String(a.performed_by),
    timestamp: String(a.timestamp),
    details: (a.details_json as ActionDetails) ?? {},
  }));

  const base = toTicketRow(r);
  const shipment: ShipmentDetail | null = r.destination_hospital_name
    ? {
        shipmentId: base.shipmentId,
        originWarehouseName: (r.origin_warehouse_name as string | null) ?? null,
        destinationHospitalName: base.destinationHospitalName,
        carrier: (r.s_carrier as string | null) ?? base.carrier,
        status: (r.shipment_status as string | null) ?? null,
        priority: base.priority,
        productCategory: base.productCategory,
        region: (r.s_region as string | null) ?? base.region,
        shipDate: (r.ship_date as string | null) ?? null,
        estimatedDelivery: (r.estimated_delivery as string | null) ?? null,
        actualDelivery: (r.actual_delivery as string | null) ?? null,
        daysLate: base.daysLate,
        freightCostUsd: base.freightCostUsd,
        isExpedited:
          r.is_expedited === null || r.is_expedited === undefined
            ? null
            : Boolean(r.is_expedited),
      }
    : null;

  return {
    ...base,
    resolutionNotes: (r.resolution_notes as string | null) ?? null,
    shipment,
    actions,
  };
}

// ============================================================================
// Single manual action (drawer buttons) — append audit + update ticket.
// ============================================================================

export async function applyManualAction(
  db: AppDb,
  args: {
    ticketId: string;
    actionType: ActionType;
    userEmail: string;
    rerouteToCarrier?: string;
    note?: string;
  },
): Promise<TicketDetail | null> {
  const { ticketId, actionType, userEmail } = args;
  return db.transaction(async (tx) => {
    const tRes = await tx.execute(sql`
      SELECT shipment_id, carrier, exception_type, severity
      FROM app.exception_tickets WHERE ticket_id = ${ticketId} FOR UPDATE
    `);
    const t = tRes.rows[0] as
      | { shipment_id: string; carrier: string | null; exception_type: string; severity: string }
      | undefined;
    if (!t) return null;

    const details: ActionDetails = {
      reason: args.note,
      note: args.note,
      exception_type: t.exception_type,
    };
    if (actionType === 'reroute' && args.rerouteToCarrier) {
      details.from_carrier = t.carrier ?? undefined;
      details.reroute_to_carrier = args.rerouteToCarrier;
    }

    await tx.execute(sql`
      INSERT INTO app.shipment_actions (shipment_id, ticket_id, action_type, performed_by, details_json)
      VALUES (${t.shipment_id}, ${ticketId}, ${actionType}, ${userEmail}, ${JSON.stringify(details)}::jsonb)
    `);

    // escalate → investigating; reroute/release/hold/add_note resolve the ticket
    // (except add_note which just annotates). Keep it simple: escalate bumps to
    // investigating; reroute/release resolve; hold → investigating; note → unchanged.
    if (actionType === 'escalate' || actionType === 'hold') {
      await tx.execute(sql`
        UPDATE app.exception_tickets
        SET status = CASE WHEN status = 'resolved' THEN status ELSE 'investigating' END,
            last_action = ${actionType}
        WHERE ticket_id = ${ticketId}
      `);
    } else if (actionType === 'reroute' || actionType === 'release') {
      await tx.execute(sql`
        UPDATE app.exception_tickets
        SET status = 'resolved', resolved_at = now(), last_action = ${actionType},
            resolution_notes = ${`Manual ${actionType} by ${userEmail}`}
        WHERE ticket_id = ${ticketId}
      `);
      if (actionType === 'reroute' && args.rerouteToCarrier) {
        await tx.execute(sql`
          UPDATE app.shipments SET carrier = ${args.rerouteToCarrier}, status = 'in_transit'
          WHERE shipment_id = ${t.shipment_id}
        `);
      } else if (actionType === 'release') {
        await tx.execute(sql`
          UPDATE app.shipments SET status = 'in_transit' WHERE shipment_id = ${t.shipment_id}
        `);
      }
    } else {
      await tx.execute(sql`
        UPDATE app.exception_tickets SET last_action = ${actionType} WHERE ticket_id = ${ticketId}
      `);
    }
    return getTicket(tx as unknown as AppDb, ticketId);
  });
}

// ============================================================================
// find_exceptions — read-only scope lookup for the agent (Discovery phase).
// ============================================================================

export type ExceptionScope = {
  filter: { region?: string; carrier?: string; priority?: string };
  openTickets: number;
  affectedShipments: number;
  severitySplit: Record<Severity, number>;
  exceptionTypeSplit: Record<string, number>;
  expeditedFreightUsd: number;
  topCarriers: Array<{ carrier: string; openTickets: number }>;
};

export async function findExceptionScope(
  db: AppDb,
  filter: { region?: string; carrier?: string; priority?: string } = {},
): Promise<ExceptionScope> {
  const wRegion = filter.region ? sql`AND t.region = ${filter.region}` : sql``;
  const wCarrier = filter.carrier ? sql`AND t.carrier = ${filter.carrier}` : sql``;
  const wPriority = filter.priority ? sql`AND s.priority = ${filter.priority}` : sql``;
  const res = await db.execute(sql`
    SELECT
      COUNT(*)::int AS open_tickets,
      COUNT(DISTINCT t.shipment_id)::int AS affected_shipments,
      COUNT(*) FILTER (WHERE t.severity = 'critical')::int AS crit,
      COUNT(*) FILTER (WHERE t.severity = 'high')::int AS high,
      COUNT(*) FILTER (WHERE t.severity = 'medium')::int AS med,
      COUNT(*) FILTER (WHERE t.severity = 'low')::int AS low,
      COUNT(*) FILTER (WHERE t.exception_type = 'temperature_excursion')::int AS temp,
      COUNT(*) FILTER (WHERE t.exception_type = 'customs_delay')::int AS customs,
      COUNT(*) FILTER (WHERE t.exception_type = 'damage')::int AS damage,
      COUNT(*) FILTER (WHERE t.exception_type = 'missing_docs')::int AS docs,
      COALESCE(SUM(s.freight_cost_usd) FILTER (WHERE s.is_expedited = true), 0)::float8 AS expedited_freight
    FROM app.exception_tickets t
    LEFT JOIN app.shipments s ON s.shipment_id = t.shipment_id
    WHERE t.status <> 'resolved' ${wRegion} ${wCarrier} ${wPriority}
  `);
  const r = (res.rows[0] ?? {}) as Record<string, number>;

  const carriersRes = await db.execute(sql`
    SELECT COALESCE(t.carrier, 'Unknown') AS carrier, COUNT(*)::int AS open_tickets
    FROM app.exception_tickets t
    LEFT JOIN app.shipments s ON s.shipment_id = t.shipment_id
    WHERE t.status <> 'resolved' ${wRegion} ${wCarrier} ${wPriority}
    GROUP BY COALESCE(t.carrier, 'Unknown')
    ORDER BY open_tickets DESC
    LIMIT 5
  `);

  return {
    filter,
    openTickets: Number(r.open_tickets ?? 0),
    affectedShipments: Number(r.affected_shipments ?? 0),
    severitySplit: {
      critical: Number(r.crit ?? 0),
      high: Number(r.high ?? 0),
      medium: Number(r.med ?? 0),
      low: Number(r.low ?? 0),
    },
    exceptionTypeSplit: {
      temperature_excursion: Number(r.temp ?? 0),
      customs_delay: Number(r.customs ?? 0),
      damage: Number(r.damage ?? 0),
      missing_docs: Number(r.docs ?? 0),
    },
    expeditedFreightUsd: Number(r.expedited_freight ?? 0),
    topCarriers: (carriersRes.rows as Array<{ carrier: string; open_tickets: number }>).map(
      (c) => ({ carrier: c.carrier, openTickets: Number(c.open_tickets) }),
    ),
  };
}

// ============================================================================
// execute_action_batch — the atomic WRITE (Execution phase).
//   Takes a FILTER (region/carrier/priority/severity), not a list of IDs.
//   Inserts shipment_actions audit rows, flips matching open tickets to
//   resolved, and updates the affected shipment status — one transaction.
// ============================================================================

export type ActionPlanItem = {
  action_type: ActionType;
  // Which slice of the filtered open tickets this action applies to.
  exception_type?: ExceptionType;
  severity?: Severity;
  reroute_to_carrier?: string;
  reason: string;
};

export type BatchFilter = {
  region?: string;
  carrier?: string;
  priority?: string;
};

export type BatchResult = {
  resolvedTickets: number;
  actionsRecorded: number;
  shipmentsUpdated: number;
  byAction: Record<string, number>;
  skipped: number;
};

export async function executeActionBatch(
  db: AppDb,
  args: {
    filter: BatchFilter;
    actions: ActionPlanItem[];
    userEmail: string;
  },
): Promise<BatchResult> {
  const { filter, actions, userEmail } = args;
  return db.transaction(async (tx) => {
    const wRegion = filter.region ? sql`AND t.region = ${filter.region}` : sql``;
    const wCarrier = filter.carrier ? sql`AND t.carrier = ${filter.carrier}` : sql``;
    const wPriority = filter.priority ? sql`AND s.priority = ${filter.priority}` : sql``;

    // Lock the matching OPEN tickets up front.
    const lockRes = await tx.execute(sql`
      SELECT t.ticket_id, t.shipment_id, t.exception_type, t.severity, t.carrier
      FROM app.exception_tickets t
      LEFT JOIN app.shipments s ON s.shipment_id = t.shipment_id
      WHERE t.status <> 'resolved' ${wRegion} ${wCarrier} ${wPriority}
      FOR UPDATE OF t
    `);
    const tickets = lockRes.rows as Array<{
      ticket_id: string;
      shipment_id: string;
      exception_type: ExceptionType;
      severity: Severity;
      carrier: string | null;
    }>;

    const byAction: Record<string, number> = {};
    let actionsRecorded = 0;
    let shipmentsUpdated = 0;
    const resolvedTicketIds = new Set<string>();

    for (const plan of actions) {
      // Which locked tickets this plan item targets.
      const targets = tickets.filter((t) => {
        if (plan.exception_type && t.exception_type !== plan.exception_type) return false;
        if (plan.severity && t.severity !== plan.severity) return false;
        return true;
      });
      for (const t of targets) {
        const details: ActionDetails = {
          reason: plan.reason,
          exception_type: t.exception_type,
          severity: t.severity,
        };
        if (plan.action_type === 'reroute' && plan.reroute_to_carrier) {
          details.from_carrier = t.carrier ?? undefined;
          details.reroute_to_carrier = plan.reroute_to_carrier;
        }
        await tx.execute(sql`
          INSERT INTO app.shipment_actions (shipment_id, ticket_id, action_type, performed_by, details_json)
          VALUES (${t.shipment_id}, ${t.ticket_id}, ${plan.action_type}, ${userEmail}, ${JSON.stringify(details)}::jsonb)
        `);
        actionsRecorded++;
        byAction[plan.action_type] = (byAction[plan.action_type] ?? 0) + 1;

        // reroute/release/escalate resolve the ticket; hold/add_note mark it
        // investigating / annotate. For the batch "clear the backlog" story,
        // every actioned ticket resolves.
        const resolve = plan.action_type !== 'add_note';
        if (resolve) {
          await tx.execute(sql`
            UPDATE app.exception_tickets
            SET status = 'resolved', resolved_at = now(),
                last_action = ${plan.action_type},
                resolution_notes = ${`Batch ${plan.action_type}: ${plan.reason}`.slice(0, 500)}
            WHERE ticket_id = ${t.ticket_id} AND status <> 'resolved'
          `);
          resolvedTicketIds.add(t.ticket_id);
          // Update affected shipment status.
          if (plan.action_type === 'reroute' && plan.reroute_to_carrier) {
            await tx.execute(sql`
              UPDATE app.shipments SET carrier = ${plan.reroute_to_carrier}, status = 'in_transit'
              WHERE shipment_id = ${t.shipment_id}
            `);
            shipmentsUpdated++;
          } else if (plan.action_type === 'release') {
            await tx.execute(sql`
              UPDATE app.shipments SET status = 'in_transit' WHERE shipment_id = ${t.shipment_id}
            `);
            shipmentsUpdated++;
          } else if (plan.action_type === 'hold') {
            await tx.execute(sql`
              UPDATE app.shipments SET status = 'on_hold' WHERE shipment_id = ${t.shipment_id}
            `);
            shipmentsUpdated++;
          }
        } else {
          await tx.execute(sql`
            UPDATE app.exception_tickets SET last_action = 'add_note' WHERE ticket_id = ${t.ticket_id}
          `);
        }
      }
    }

    return {
      resolvedTickets: resolvedTicketIds.size,
      actionsRecorded,
      shipmentsUpdated,
      byAction,
      skipped: 0,
    };
  });
}

// ============================================================================
// Recent activity feed (home page).
// ============================================================================

export type ActivityItem = {
  actionId: string;
  shipmentId: string | null;
  ticketId: string | null;
  actionType: ActionType;
  by: string;
  at: string;
  details: ActionDetails;
};

export async function recentActivity(db: AppDb, limit = 20): Promise<ActivityItem[]> {
  const res = await db.execute(sql`
    SELECT action_id, shipment_id, ticket_id, action_type, performed_by,
           CAST(timestamp AS TEXT) AS timestamp, details_json
    FROM app.shipment_actions
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    actionId: String(r.action_id),
    shipmentId: (r.shipment_id as string | null) ?? null,
    ticketId: (r.ticket_id as string | null) ?? null,
    actionType: r.action_type as ActionType,
    by: String(r.performed_by),
    at: String(r.timestamp),
    details: (r.details_json as ActionDetails) ?? {},
  }));
}

// ============================================================================
// Backorder context — implants / capital_equipment below reorder in a region.
// ============================================================================

export type BackorderRow = {
  warehouseName: string | null;
  productName: string | null;
  category: string | null;
  quantityOnHand: number | null;
  reorderPoint: number | null;
  shortfallUnits: number | null;
  region: string | null;
};

export async function backorderRisk(
  db: AppDb,
  f: { region?: string; limit?: number } = {},
): Promise<BackorderRow[]> {
  const wRegion = f.region ? sql`AND region = ${f.region}` : sql``;
  const res = await db.execute(sql`
    SELECT warehouse_name, product_name, category, quantity_on_hand,
           reorder_point, shortfall_units, region
    FROM app.inventory
    WHERE below_reorder = true ${wRegion}
    ORDER BY shortfall_units DESC
    LIMIT ${f.limit ?? 20}
  `);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    warehouseName: (r.warehouse_name as string | null) ?? null,
    productName: (r.product_name as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    quantityOnHand: r.quantity_on_hand === null ? null : Number(r.quantity_on_hand),
    reorderPoint: r.reorder_point === null ? null : Number(r.reorder_point),
    shortfallUnits: r.shortfall_units === null ? null : Number(r.shortfall_units),
    region: (r.region as string | null) ?? null,
  }));
}
