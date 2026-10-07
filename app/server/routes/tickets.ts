import type { Application } from 'express';
import express from 'express';
import {
  listTickets,
  ticketKpis,
  exceptionTypeBreakdown,
  carrierBreakdown,
  ticketMapBuckets,
  getTicket,
  applyManualAction,
  backorderRisk,
  type Severity,
  type TicketStatus,
  type ExceptionType,
  type ActionType,
} from '../db/queries/index.js';
import { getCurrentUserEmail } from '../lib/user.js';
import type { AppDb } from '../db/index.js';

/**
 * Command Center operational routes — exception-ticket queue, KPI tiles, map
 * buckets, breakdown panels, ticket detail + manual actions, backorder context.
 */

function strParam(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'investigating', 'resolved'];
const EXC_TYPES = ['customs_delay', 'damage', 'missing_docs', 'temperature_excursion'];
const ACTION_TYPES = ['reroute', 'escalate', 'hold', 'release', 'add_note'];

function pick<T extends string>(v: unknown, allowed: string[]): T | undefined {
  const s = strParam(v);
  return s && allowed.includes(s) ? (s as T) : undefined;
}

export function registerTicketRoutes(app: Application, deps: { db: AppDb }): void {
  const { db } = deps;

  // GET /api/tickets — the queue, filterable.
  app.get('/api/tickets', async (req, res) => {
    const rows = await listTickets(db, {
      region: strParam(req.query.region),
      carrier: strParam(req.query.carrier),
      severity: pick<Severity>(req.query.severity, SEVERITIES),
      status: pick<TicketStatus>(req.query.status, STATUSES),
      exceptionType: pick<ExceptionType>(req.query.exceptionType, EXC_TYPES),
    });
    res.json(rows);
  });

  // GET /api/tickets/kpis — top-of-page tiles.
  app.get('/api/tickets/kpis', async (_req, res) => {
    res.json(await ticketKpis(db));
  });

  // GET /api/tickets/by-type — exception-type breakdown panel.
  app.get('/api/tickets/by-type', async (req, res) => {
    res.json(await exceptionTypeBreakdown(db, { region: strParam(req.query.region) }));
  });

  // GET /api/tickets/by-carrier — by-carrier panel.
  app.get('/api/tickets/by-carrier', async (req, res) => {
    res.json(await carrierBreakdown(db, { region: strParam(req.query.region) }));
  });

  // GET /api/tickets/map — geographic exception map buckets.
  app.get('/api/tickets/map', async (req, res) => {
    res.json(await ticketMapBuckets(db, { region: strParam(req.query.region) }));
  });

  // GET /api/tickets/:id — ticket detail (shipment + action timeline).
  app.get('/api/tickets/:id', async (req, res) => {
    const row = await getTicket(db, req.params.id);
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(row);
  });

  // POST /api/tickets/:id/action — single manual action (drawer buttons).
  app.post('/api/tickets/:id/action', express.json({ limit: '32kb' }), async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const actionType = pick<ActionType>(req.body?.actionType, ACTION_TYPES);
    if (!actionType) {
      res.status(400).json({ error: `actionType must be one of ${ACTION_TYPES.join('|')}` });
      return;
    }
    const rerouteToCarrier = strParam(req.body?.rerouteToCarrier);
    const rawNote = req.body?.note;
    const note = typeof rawNote === 'string' && rawNote.length > 0 ? rawNote.slice(0, 2000) : undefined;
    const result = await applyManualAction(db, {
      ticketId: req.params.id,
      actionType,
      userEmail,
      rerouteToCarrier,
      note,
    });
    if (!result) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(result);
  });

  // GET /api/backorders — backorder-risk inventory context.
  app.get('/api/backorders', async (req, res) => {
    res.json(await backorderRisk(db, { region: strParam(req.query.region) }));
  });
}
