/**
 * The Command Center's visual signature: a geographic exception map. One
 * bubble per destination hospital with open exceptions, sized by count,
 * colored by whether it carries any critical ticket. The Southeast cluster
 * blazes coral on load and visibly thins after the agent's batch executes.
 *
 * Plotly `scattergeo` over a USA map (the brief mandates Plotly; scattergeo
 * needs no external tile server, so it renders reliably in the sandbox).
 */
import { useEffect, useState } from 'react';
import { Globe2, RefreshCw } from 'lucide-react';
import { PlotlyChart, CHART, type PlotData } from '@/shared/Plotly';
import { fetchTicketMap } from '@/lib/tickets';
import { dataMutated } from '@/lib/events';
import type { MapBucket } from '@/shared/types';

export function ExceptionMap({ region }: { region: string | null }) {
  const [buckets, setBuckets] = useState<MapBucket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reload = () =>
      fetchTicketMap(region ?? undefined)
        .then((d) => {
          if (!cancelled) {
            setBuckets(d);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError((e as Error).message);
        });
    void reload();
    const unsub = dataMutated.subscribe(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [region]);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Couldn't load the map: {error}
      </div>
    );
  }
  if (buckets === null) {
    return (
      <div className="rounded-xl border border-border bg-card h-[380px] flex items-center justify-center text-sm text-muted-foreground gap-2">
        <RefreshCw className="size-3.5 animate-spin" />
        Loading exception map…
      </div>
    );
  }

  const totalOpen = buckets.reduce((a, b) => a + b.openTickets, 0);
  const maxCount = Math.max(1, ...buckets.map((b) => b.openTickets));

  const sizes = buckets.map((b) => 8 + 34 * Math.sqrt(b.openTickets / maxCount));
  const colors = buckets.map((b) => (b.critical > 0 ? CHART.critical : CHART.primary));
  const text = buckets.map(
    (b) =>
      `${b.hospital}<br>${b.region}<br>${b.openTickets} open · ${b.critical} critical<br>$${Math.round(
        b.freightUsd,
      ).toLocaleString()} freight`,
  );

  const data: PlotData[] = [
    {
      type: 'scattergeo',
      locationmode: 'USA-states',
      lon: buckets.map((b) => b.lng),
      lat: buckets.map((b) => b.lat),
      text,
      hoverinfo: 'text',
      marker: {
        size: sizes,
        color: colors,
        opacity: 0.72,
        line: { width: 1, color: 'rgba(255,255,255,0.7)' },
      },
    },
  ];

  const layout = {
    geo: {
      scope: 'usa',
      projection: { type: 'albers usa' },
      showland: true,
      landcolor: 'rgba(226,232,240,0.55)',
      subunitcolor: 'rgba(148,163,184,0.5)',
      lakecolor: 'rgba(0,0,0,0)',
      bgcolor: 'rgba(0,0,0,0)',
      showlakes: false,
    },
    margin: { l: 0, r: 0, t: 0, b: 0 },
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Globe2 className="size-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold truncate">
            Exceptions by destination hospital
          </h3>
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {buckets.length} sites · {totalOpen} open
        </div>
      </div>
      <div className="h-[380px]">
        {buckets.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No open exceptions in the current scope.
          </div>
        ) : (
          <PlotlyChart data={data} layout={layout} height={380} />
        )}
      </div>
    </div>
  );
}
