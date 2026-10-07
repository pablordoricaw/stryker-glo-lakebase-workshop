/**
 * Analytics — warehouse-backed Plotly charts over the Delta lakehouse.
 *
 * The "lakehouse analytics" half of the story: live SQL-warehouse queries
 * (not mocks) against the demo's gold tables + the exception-resolution
 * metric view. Each chart fetches `/api/charts/<key>`, whose route reads
 * `config/queries/<key>.sql` (written schema-relative via IDENTIFIER) and
 * runs it with the demo catalog/schema bound as params — so one env var
 * (DEMO_CATALOG/DEMO_SCHEMA) drives analytics on any workspace.
 *
 * Charts, tied to the Southeast SLA story:
 *   sla_trend            — weekly SLA % + exception rate (the dip)
 *   expedited_freight    — weekly expedited $ surge (peaked ~3 weeks ago)
 *   exceptions_by_carrier— Southeast exceptions by carrier (SwiftMed/AeroCare)
 *   resolution_time      — avg resolution hours by type × region (CDF/metric
 *                          -view loop — the "did it get better?" proof)
 *
 * Repurposing: edit/add a .sql under config/queries/, register its key in
 * charts.ts's QUERY_FILES map, and reference it here via <ChartData chartKey=…>.
 */
import { useEffect, useState } from 'react';
import { BarChart, LineChart } from '@databricks/appkit-ui/react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { CHART } from '@/shared/Plotly';
import { exceptionTypeLabel } from '@/shared/badges';
import type { ExceptionType } from '@/shared/types';
import { RtPitch } from '@/architecture/RtPitch';

/**
 * Fetch chart rows from the server's /api/charts/<key> route. That route
 * reads the query SQL, substitutes the demo catalog/schema, and runs it
 * against the SQL warehouse — so a single env var drives the catalog/schema
 * for analytics just like the rest of the app (see server/routes/charts.ts).
 */
function useChartData<T = Record<string, unknown>>(key: string): {
  data: T[] | null;
  error: string | null;
  isLoading: boolean;
} {
  const [state, setState] = useState<{
    data: T[] | null;
    error: string | null;
    isLoading: boolean;
  }>({ data: null, error: null, isLoading: true });

  useEffect(() => {
    let alive = true;
    setState({ data: null, error: null, isLoading: true });
    fetch(`/api/charts/${key}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        return body.data as T[];
      })
      .then((data) => alive && setState({ data, error: null, isLoading: false }))
      .catch(
        (e) =>
          alive &&
          setState({ data: null, error: String(e?.message ?? e), isLoading: false }),
      );
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}

export function AnalyticsView() {
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);

  useEffect(() => {
    fetchWarehouse().then(setWarehouse).catch(console.error);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-10">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Logistics analytics
          </div>
          <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
            Why the Southeast is missing SLA.
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Live queries against the SQL warehouse — the same numbers the
            assistant reasons about. Use the Command Center to take action;
            use this page to see the surge and confirm it's cooling off.
          </p>
        </div>

        <RtPitch
          warehouse={
            warehouse?.name
              ? { name: warehouse.name, state: warehouse.state ?? null }
              : null
          }
          latencyMs={null}
        />

        {/* Top row: SLA trend (wider) + exceptions by carrier. */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <ChartCard
            title="Southeast SLA % & exception rate"
            scope="Last ~16 weeks"
            className="lg:col-span-3"
          >
            <ChartData chartKey="sla_trend" height={260}>
              {(rows) => (
                <LineChart
                  data={rows}
                  xKey="week"
                  yKey={['sla_pct', 'exception_rate_pct']}
                  colors={[CHART.primary, CHART.critical]}
                  height={260}
                  smooth
                />
              )}
            </ChartData>
          </ChartCard>

          <ChartCard
            title="Exceptions by carrier"
            scope="Southeast · 45d"
            className="lg:col-span-2"
          >
            <ChartData chartKey="exceptions_by_carrier" height={260}>
              {(rows) => (
                <BarChart
                  data={rows}
                  xKey="carrier"
                  yKey="exception_count"
                  colors={[CHART.critical]}
                  height={260}
                />
              )}
            </ChartData>
          </ChartCard>
        </div>

        {/* Expedited-freight surge — the money chart. */}
        <ChartCard title="Weekly expedited freight — the surge" scope="Southeast · last ~16 weeks">
          <ChartData chartKey="expedited_freight" height={260}>
            {(rows) => (
              <BarChart
                data={rows}
                xKey="week"
                yKey="expedited_freight_usd"
                colors={[CHART.high]}
                height={260}
              />
            )}
          </ChartData>
        </ChartCard>

        {/* Resolution-time proof — the CDF / metric-view loop. */}
        <ChartCard title="Avg resolution time by type × region" scope="Metric view · resolved tickets" flush>
          <ResolutionTable />
        </ChartCard>
      </div>
    </div>
  );
}

/**
 * Wraps a chart/table in a bordered card with a compact header (title +
 * scope chip). `flush` removes inner padding for components that draw their
 * own (e.g. the resolution table).
 */
function ChartCard({
  title,
  scope,
  className,
  flush,
  children,
}: {
  title: string;
  scope?: string;
  className?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-card overflow-hidden ${className ?? ''}`}
    >
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {scope && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {scope}
          </span>
        )}
      </div>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </div>
  );
}

/**
 * Fetches /api/charts/<chartKey> and renders the rows via `children` once
 * ready, with loading/error/empty fallbacks (data-mode charts don't fetch
 * on their own, so we own the states here).
 */
function ChartData({
  chartKey,
  height,
  children,
}: {
  chartKey: string;
  height: number;
  children: (rows: Record<string, unknown>[]) => React.ReactNode;
}) {
  const { data, error, isLoading } = useChartData(chartKey);
  const center = `flex items-center justify-center text-sm`;
  if (error) {
    return (
      <div className={`${center} text-destructive`} style={{ height }}>
        Error loading chart: {error}
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className={`${center} text-muted-foreground`} style={{ height }}>
        Loading…
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className={`${center} text-muted-foreground`} style={{ height }}>
        No data.
      </div>
    );
  }
  return <>{children(data)}</>;
}

// --- Resolution-time table (metric-view loop) ------------------------------

type ResolutionRow = {
  exception_type: string;
  region: string;
  avg_resolution_hours: number;
  tickets_resolved: number;
};

/** Color the resolution hours by how long it's taking. */
function hoursToneClass(h: number): string {
  if (h >= 48) return 'text-[var(--severity-danger)]';
  if (h >= 24) return 'text-[var(--severity-warning)]';
  return 'text-foreground';
}

function ResolutionTable() {
  const { data, error, isLoading } = useChartData<ResolutionRow>('resolution_time');

  if (error) {
    return <div className="px-4 py-3 text-sm text-destructive">Couldn't load: {error}</div>;
  }
  if (isLoading || !data) {
    return <div className="px-4 py-6 text-sm text-muted-foreground text-center">Loading…</div>;
  }
  if (data.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground text-center">
        No resolved tickets yet. Approve the assistant's batch to populate this.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left font-medium px-3 py-2">Exception type</th>
            <th className="text-left font-medium px-3 py-2">Region</th>
            <th className="text-right font-medium px-3 py-2">Avg hours</th>
            <th className="text-right font-medium px-3 py-2">Resolved</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row, i) => (
            <tr key={`${row.exception_type}-${row.region}-${i}`} className="hover:bg-muted/40">
              <td className="px-3 py-2">{exceptionTypeLabel(row.exception_type as ExceptionType)}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.region ?? '—'}</td>
              <td className={`px-3 py-2 text-right font-semibold ${hoursToneClass(row.avg_resolution_hours)}`}>
                {row.avg_resolution_hours}h
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                {row.tickets_resolved.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
