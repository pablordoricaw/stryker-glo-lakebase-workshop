import type { Application } from 'express';
import { recentActivity } from '../db/queries/index.js';
import type { AppDb } from '../db/index.js';

/**
 * Unified activity feed — operational actions (reroute / escalate / hold /
 * release / note) the agent + operators performed. Powers the home-page feed.
 */
export function registerActivityRoutes(app: Application, deps: { db: AppDb }): void {
  app.get('/api/activity/recent', async (req, res) => {
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 100) : 20;
    const events = await recentActivity(deps.db, limit);
    res.json(events);
  });
}
