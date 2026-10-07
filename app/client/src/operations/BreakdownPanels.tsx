/**
 * Two side-by-side Plotly panels under the map:
 *   - Exception-type breakdown (stacked bar by severity)
 *   - By-carrier open exceptions (bar; SwiftMed + AeroCare tower)
 * Both re-fetch on dataMutated.
 */
import { useEffect, useState } from 'react';
import { PlotlyChart, CHART, type PlotData } from '@/shared/Plotly';
import { fetchTypeBreakdown, fetchCarrierBreakdown } from '@/lib/tickets';
import { dataMutated } from '@/lib/events';
import { exceptionTypeLabel } from '@/shared/badges';
import type { CarrierBreakdownRow, TypeBreakdownRow, ExceptionType } from '@/shared/types';

export function BreakdownPanels({ region }: { region: string | null }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <TypePanel region={region} />
      <CarrierPanel region={region} />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function TypePanel({ region }: { region: string | null }) {
  const [rows, setRows] = useState<TypeBreakdownRow[]>([]);
  useEffect(() => {
    const reload = () => fetchTypeBreakdown(region ?? undefined).then(setRows).catch(() => {});
    void reload();
    return dataMutated.subscribe(reload);
  }, [region]);

  const types = rows.map((r) => exceptionTypeLabel(r.exceptionType as ExceptionType));
  const mk = (key: 'critical' | 'high' | 'medium' | 'low', color: string): PlotData => ({
    type: 'bar',
    orientation: 'h',
    y: types,
    x: rows.map((r) => r[key]),
    name: key,
    marker: { color },
    hovertemplate: `${key}: %{x}<extra></extra>`,
  });

  const data: PlotData[] = [
    mk('critical', CHART.critical),
    mk('high', CHART.high),
    mk('medium', CHART.medium),
    mk('low', CHART.low),
  ];

  return (
    <Panel title="Open exceptions by type & severity">
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <PlotlyChart
          data={data}
          height={240}
          layout={{ barmode: 'stack', showlegend: true, legend: { orientation: 'h', y: -0.2 } }}
        />
      )}
    </Panel>
  );
}

function CarrierPanel({ region }: { region: string | null }) {
  const [rows, setRows] = useState<CarrierBreakdownRow[]>([]);
  useEffect(() => {
    const reload = () => fetchCarrierBreakdown(region ?? undefined).then(setRows).catch(() => {});
    void reload();
    return dataMutated.subscribe(reload);
  }, [region]);

  const data: PlotData[] = [
    {
      type: 'bar',
      x: rows.map((r) => r.carrier),
      y: rows.map((r) => r.openTickets),
      marker: {
        color: rows.map((r) =>
          r.carrier === 'SwiftMed Freight' || r.carrier === 'AeroCare Logistics'
            ? CHART.critical
            : CHART.primary,
        ),
      },
      hovertemplate: '%{x}<br>%{y} open · %{customdata} critical<extra></extra>',
      customdata: rows.map((r) => r.critical),
    },
  ];

  return (
    <Panel title="Open exceptions by carrier">
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <PlotlyChart data={data} height={240} layout={{ xaxis: { tickangle: -30 } }} />
      )}
    </Panel>
  );
}

function Empty() {
  return (
    <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
      No open exceptions in scope.
    </div>
  );
}
