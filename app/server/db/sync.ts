import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import {
  shipments,
  inventory,
  deliveryPerformance,
  exceptionTickets,
} from './schema.js';

/**
 * One-shot Delta → Lakebase sync for the Global Logistics Command Center.
 *
 * Mirrors a story-scoped subset of the three gold tables (01-lakeflow.md) into
 * the Lakebase OLTP store, then SEEDS the native `exception_tickets` queue from
 * the Southeast exception shipments so the Command Center opens with a strong
 * story (red Southeast cluster, open ticket backlog) and the agent has real
 * rows to act on.
 *
 * Idempotent in the "only-if-destination-empty" sense (skips if app.shipments
 * already has rows). Pass `{ forceIfAnyEmpty: true }` to re-sync — the "Reset
 * demo" button TRUNCATEs the mirror + native tables first, then calls this.
 */

export type DataConfig = {
  catalog: string;
  schema: string;
  tables: {
    shipments: string;
    inventory: string;
    deliveryPerformance: string;
  };
};

// How many recent days of exceptions to pull into the shipments mirror / use
// for seeding. Covers the spike window (peak NOW-21d) with margin.
const STORY_WINDOW_DAYS = 75;
// Cap the shipments mirror so boot stays fast even if the window is dense.
const SHIPMENTS_LIMIT = 15_000;

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.shipments`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }

  console.log('[sync] Starting Delta → Lakebase sync (parallel)…');
  const t0 = Date.now();

  const fq = (name: keyof DataConfig['tables']) =>
    `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;

  const [shipmentRows, inventoryRows, deliveryRows] = await Promise.all([
    // Recent exceptions (the story) + any recent in-transit/on-hold shipments.
    // Bounded by window + LIMIT so boot stays fast against the 1M-row gold table.
    execSql<ShipmentRow>(
      warehouseId,
      `SELECT shipment_id, origin_warehouse, origin_warehouse_name,
              destination_hospital, destination_hospital_name, carrier, status,
              CAST(ship_date AS STRING) AS ship_date,
              CAST(estimated_delivery AS STRING) AS estimated_delivery,
              CAST(actual_delivery AS STRING) AS actual_delivery,
              freight_cost_usd, weight_kg, priority, region, product_category,
              is_exception, days_late, is_expedited, dest_lat, dest_lng
       FROM ${fq('shipments')}
       WHERE is_exception = true
         AND ship_date >= date_sub(current_date(), ${STORY_WINDOW_DAYS})
       ORDER BY ship_date DESC
       LIMIT ${SHIPMENTS_LIMIT}`,
    ),
    // Backorder-risk inventory (below reorder) — context for the ticket drawer.
    execSql<InventoryRow>(
      warehouseId,
      `SELECT warehouse_id, warehouse_name, product_sku, product_name, category,
              quantity_on_hand, reorder_point,
              CAST(last_replenished AS STRING) AS last_replenished,
              region, below_reorder, shortfall_units
       FROM ${fq('inventory')}
       WHERE below_reorder = true`,
    ),
    // Pre-aggregated SLA metrics for the story region window (talking-track
    // snapshot; the Analytics page queries Delta directly via the warehouse).
    execSql<DeliveryRow>(
      warehouseId,
      `SELECT CAST(metric_date AS STRING) AS metric_date, region, carrier,
              priority, product_category, shipments_count, on_time_count,
              exception_count, avg_days_late, sla_pct, exception_rate,
              total_freight_usd, expedited_freight_usd
       FROM ${fq('deliveryPerformance')}
       WHERE metric_date >= date_sub(current_date(), 120)`,
    ),
  ]);
  console.log(`[sync]   queries done (${((Date.now() - t0) / 1000).toFixed(1)}s) — inserting…`);

  if (shipmentRows.length) {
    await chunkInsert(shipmentRows, 2_000, (chunk) =>
      db.insert(shipments).values(
        chunk.map((r) => ({
          shipmentId: r.shipment_id,
          originWarehouse: r.origin_warehouse,
          originWarehouseName: r.origin_warehouse_name,
          destinationHospital: r.destination_hospital,
          destinationHospitalName: r.destination_hospital_name,
          carrier: r.carrier,
          status: r.status,
          shipDate: toDate(r.ship_date),
          estimatedDelivery: toDate(r.estimated_delivery),
          actualDelivery: toDate(r.actual_delivery),
          freightCostUsd: num(r.freight_cost_usd),
          weightKg: num(r.weight_kg),
          priority: r.priority,
          region: r.region,
          productCategory: r.product_category,
          isException: toBool(r.is_exception),
          daysLate: r.days_late === null ? null : Number(r.days_late),
          isExpedited: toBool(r.is_expedited),
          destLat: num(r.dest_lat),
          destLng: num(r.dest_lng),
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   shipments: ${shipmentRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (inventoryRows.length) {
    await chunkInsert(inventoryRows, 3_000, (chunk) =>
      db.insert(inventory).values(
        chunk.map((r) => ({
          id: `${r.warehouse_id}:${r.product_sku}`,
          warehouseId: r.warehouse_id,
          warehouseName: r.warehouse_name,
          productSku: r.product_sku,
          productName: r.product_name,
          category: r.category,
          quantityOnHand: r.quantity_on_hand === null ? null : Number(r.quantity_on_hand),
          reorderPoint: r.reorder_point === null ? null : Number(r.reorder_point),
          lastReplenished: r.last_replenished,
          region: r.region,
          belowReorder: toBool(r.below_reorder),
          shortfallUnits: r.shortfall_units === null ? null : Number(r.shortfall_units),
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   inventory: ${inventoryRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (deliveryRows.length) {
    await chunkInsert(deliveryRows, 3_000, (chunk) =>
      db.insert(deliveryPerformance).values(
        chunk.map((r) => ({
          id: `${r.metric_date}:${r.region}:${r.carrier}:${r.priority}:${r.product_category}`,
          metricDate: r.metric_date,
          region: r.region,
          carrier: r.carrier,
          priority: r.priority,
          productCategory: r.product_category,
          shipmentsCount: r.shipments_count === null ? null : Number(r.shipments_count),
          onTimeCount: r.on_time_count === null ? null : Number(r.on_time_count),
          exceptionCount: r.exception_count === null ? null : Number(r.exception_count),
          avgDaysLate: num(r.avg_days_late),
          slaPct: num(r.sla_pct),
          exceptionRate: num(r.exception_rate),
          totalFreightUsd: num(r.total_freight_usd),
          expeditedFreightUsd: num(r.expedited_freight_usd),
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   delivery_performance: ${deliveryRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  // Seed the exception-ticket queue from the Southeast exception shipments.
  await seedExceptionTickets(db);
  console.log(`[sync] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ============================================================================
// Exception-ticket seeding — the story's open backlog on first load.
// ============================================================================

const EXC_TYPES = ['temperature_excursion', 'customs_delay', 'damage', 'missing_docs'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'investigating', 'resolved'] as const;
const ASSIGNEES = [
  'r.okafor@medtranzglobal.com',
  'l.chen@medtranzglobal.com',
  'j.alvarez@medtranzglobal.com',
  's.patel@medtranzglobal.com',
];

/** Deterministic 0-1 hash from a string so seeding is stable across resets. */
function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function weighted<T>(r: number, choices: Array<[T, number]>): T {
  const total = choices.reduce((a, [, w]) => a + w, 0);
  let acc = 0;
  const x = r * total;
  for (const [v, w] of choices) {
    acc += w;
    if (x < acc) return v;
  }
  return choices[choices.length - 1][0];
}

async function seedExceptionTickets(db: AppDb): Promise<void> {
  // Pull Southeast exception shipments (plus a smaller sample of other regions)
  // from the just-synced mirror. One ticket per shipment.
  const res = await db.execute(sql`
    SELECT shipment_id, region, carrier, product_category, priority,
           ship_date, days_late
    FROM app.shipments
    WHERE is_exception = true
      AND (
        region = 'Southeast'
        OR (region <> 'Southeast' AND mod(abs(hashtext(shipment_id)), 10) = 0)
      )
    ORDER BY (region = 'Southeast') DESC, ship_date DESC
    LIMIT 320
  `);
  const rows = res.rows as Array<{
    shipment_id: string;
    region: string | null;
    carrier: string | null;
    product_category: string | null;
    priority: string | null;
    ship_date: string | null;
    days_late: number | null;
  }>;
  if (rows.length === 0) return;

  const spikeCarriers = new Set(['SwiftMed Freight', 'AeroCare Logistics']);

  const tickets = rows.map((r) => {
    const se = r.region === 'Southeast';
    const onSpike = se && !!r.carrier && spikeCarriers.has(r.carrier);
    const rType = hash01(r.shipment_id, 1);
    const rSev = hash01(r.shipment_id, 2);
    const rStat = hash01(r.shipment_id, 3);
    const rAssign = hash01(r.shipment_id, 4);

    // Southeast spike lanes dominated by temperature_excursion + customs_delay.
    const exceptionType: (typeof EXC_TYPES)[number] = se
      ? weighted(rType, [
          ['temperature_excursion', 0.42],
          ['customs_delay', 0.36],
          ['damage', 0.13],
          ['missing_docs', 0.09],
        ])
      : weighted(rType, [
          ['customs_delay', 0.3],
          ['damage', 0.3],
          ['missing_docs', 0.25],
          ['temperature_excursion', 0.15],
        ]);

    // Severity skewed high/critical on the spike lanes.
    const severity: (typeof SEVERITIES)[number] = onSpike
      ? weighted(rSev, [
          ['critical', 0.34],
          ['high', 0.4],
          ['medium', 0.2],
          ['low', 0.06],
        ])
      : weighted(rSev, [
          ['critical', 0.12],
          ['high', 0.28],
          ['medium', 0.4],
          ['low', 0.2],
        ]);

    // Mostly open / investigating; a few already resolved.
    const status: (typeof STATUSES)[number] = weighted(rStat, [
      ['open', 0.62],
      ['investigating', 0.3],
      ['resolved', 0.08],
    ]);

    const createdAt = r.ship_date ? new Date(r.ship_date) : new Date();
    const resolved = status === 'resolved';
    // Resolved tickets closed 1-4 days after creation.
    const resolvedAt = resolved
      ? new Date(createdAt.getTime() + (1 + Math.floor(rStat * 4)) * 86400000)
      : null;

    return {
      shipmentId: r.shipment_id,
      exceptionType,
      severity,
      status,
      assignedTo: ASSIGNEES[Math.floor(rAssign * ASSIGNEES.length)],
      createdAt,
      resolvedAt,
      resolutionNotes: resolved ? 'Auto-closed on carrier confirmation.' : null,
      lastAction: null,
      region: r.region,
      carrier: r.carrier,
    };
  });

  await chunkInsert(tickets, 500, (chunk) =>
    db.insert(exceptionTickets).values(chunk).onConflictDoNothing(),
  );
  const se = tickets.filter((t) => t.region === 'Southeast').length;
  console.log(`[sync]   exception_tickets seeded: ${tickets.length} (${se} Southeast)`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.shipment_actions RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.exception_tickets RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.shipments RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.inventory RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.delivery_performance RESTART IDENTITY CASCADE`);
    // coordinator_preferences is user-owned config — leave it.
  });
}

// ============================================================================
// Row types + coercion helpers
// ============================================================================

type ShipmentRow = {
  shipment_id: string;
  origin_warehouse: string | null;
  origin_warehouse_name: string | null;
  destination_hospital: string | null;
  destination_hospital_name: string | null;
  carrier: string | null;
  status: string | null;
  ship_date: string | null;
  estimated_delivery: string | null;
  actual_delivery: string | null;
  freight_cost_usd: number | string | null;
  weight_kg: number | string | null;
  priority: string | null;
  region: string | null;
  product_category: string | null;
  is_exception: boolean | string | null;
  days_late: number | string | null;
  is_expedited: boolean | string | null;
  dest_lat: number | string | null;
  dest_lng: number | string | null;
};

type InventoryRow = {
  warehouse_id: string;
  warehouse_name: string | null;
  product_sku: string;
  product_name: string | null;
  category: string | null;
  quantity_on_hand: number | string | null;
  reorder_point: number | string | null;
  last_replenished: string | null;
  region: string | null;
  below_reorder: boolean | string | null;
  shortfall_units: number | string | null;
};

type DeliveryRow = {
  metric_date: string;
  region: string | null;
  carrier: string | null;
  priority: string | null;
  product_category: string | null;
  shipments_count: number | string | null;
  on_time_count: number | string | null;
  exception_count: number | string | null;
  avg_days_late: number | string | null;
  sla_pct: number | string | null;
  exception_rate: number | string | null;
  total_freight_usd: number | string | null;
  expedited_freight_usd: number | string | null;
};

function num(v: number | string | null): number | null {
  return v === null || v === undefined || v === '' ? null : Number(v);
}
function toBool(v: boolean | string | null): boolean | null {
  if (v === null || v === undefined) return null;
  return v === true || v === 'true' || v === 't' || v === '1';
}
function toDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function execSql<T>(
  warehouseId: string,
  statement: string,
): Promise<T[]> {
  const { client } = getExecutionContext();
  type StmtResp = {
    statement_id: string;
    status: { state: string; error?: { message: string } };
    manifest?: {
      schema: { columns: Array<{ name: string }> };
      chunks?: Array<{ chunk_index: number; row_count: number }>;
    };
    result?: {
      chunk_index: number;
      row_count: number;
      data_array?: Array<Array<unknown>>;
      next_chunk_index?: number;
    };
  };

  const initial = (await client.apiClient.request({
    method: 'POST',
    path: '/api/2.0/sql/statements',
    payload: {
      statement,
      warehouse_id: warehouseId,
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    },
    headers: new Headers(),
    raw: false,
    query: {},
  })) as StmtResp;

  const POLL_DEADLINE_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  let cur = initial;
  while (
    cur.status.state !== 'SUCCEEDED' &&
    cur.status.state !== 'FAILED' &&
    cur.status.state !== 'CANCELED'
  ) {
    if (Date.now() - startedAt > POLL_DEADLINE_MS) {
      throw new Error(
        `[sync] SQL still ${cur.status.state} after 10 minutes — aborting (statement_id=${cur.statement_id})`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
    cur = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp;
  }
  if (cur.status.state !== 'SUCCEEDED') {
    throw new Error(
      `[sync] SQL failed: ${cur.status.error?.message ?? cur.status.state}`,
    );
  }

  const cols = cur.manifest?.schema.columns.map((c) => c.name) ?? [];
  const rows: T[] = [];
  let chunk = cur.result;
  while (chunk) {
    for (const row of chunk.data_array ?? []) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
      rows.push(obj as T);
    }
    if (chunk.next_chunk_index === undefined || chunk.next_chunk_index === null) break;
    chunk = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp['result'];
  }
  return rows;
}

async function chunkInsert<T>(
  rows: T[],
  size: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}
