/**
 * Plotly wrapper for the Command Center. The brief mandates Plotly for all
 * visualizations. We use the pre-bundled `plotly.js-dist-min` build fed into
 * react-plotly.js's factory. Types come from plotly-shim.d.ts (loose records)
 * so we don't pull in the heavy @types/plotly.js graph.
 *
 * All charts share a control-room look: transparent paper, muted grid, the
 * app's font, no mode-bar by default.
 */
import { useMemo } from 'react';
import createPlotlyComponent, {
  type PlotlyData,
  type PlotlyLayout,
  type PlotlyConfig,
} from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';

const Plot = createPlotlyComponent(Plotly);

export type PlotData = PlotlyData;
export type PlotLayout = PlotlyLayout;

export const CHART = {
  primary: '#1E6FD9',
  critical: '#EF476F',
  high: '#F78C6B',
  medium: '#FFD166',
  low: '#8D99AE',
  teal: '#06D6A0',
  slate: '#5A6B8C',
  grid: 'rgba(148,163,184,0.18)',
  text: '#64748b',
};

const BASE_LAYOUT: PlotlyLayout = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Geist, system-ui, sans-serif', size: 12, color: CHART.text },
  margin: { l: 52, r: 16, t: 14, b: 44 },
  showlegend: false,
  hoverlabel: { bgcolor: '#0f172a', font: { color: '#fff', size: 12 } },
};

const BASE_CONFIG: PlotlyConfig = {
  displayModeBar: false,
  responsive: true,
  // Disable wheel-zoom + double-click interactions. Beyond being the right UX
  // for these static control-room charts, this avoids a known plotly.js crash
  // on the scattergeo map: the geo subplot's updateFx wires wheel/zoom handlers
  // that dereference `gd._context._scrollZoom`, which throws
  // ("Cannot read properties of undefined (reading '_scrollZoom')") when a
  // resize/relayout races the component teardown (e.g. the Operations map
  // remounting on a region-filter change or the chat dock opening). Turning
  // these off takes the no-op branch instead of touching `_context`.
  scrollZoom: false,
  doubleClick: false,
};

export function PlotlyChart({
  data,
  layout,
  height = 260,
  config,
}: {
  data: PlotlyData[];
  layout?: PlotlyLayout;
  height?: number;
  config?: PlotlyConfig;
}) {
  const mergedLayout = useMemo<PlotlyLayout>(() => {
    const baseX = { gridcolor: CHART.grid, zeroline: false, automargin: true };
    const baseY = { gridcolor: CHART.grid, zeroline: false, automargin: true };
    return {
      ...BASE_LAYOUT,
      ...layout,
      height,
      xaxis: { ...baseX, ...((layout?.xaxis as object) ?? {}) },
      yaxis: { ...baseY, ...((layout?.yaxis as object) ?? {}) },
    };
  }, [layout, height]);
  return (
    <Plot
      data={data}
      layout={mergedLayout}
      config={{ ...BASE_CONFIG, ...config }}
      style={{ width: '100%', height }}
      useResizeHandler
    />
  );
}

export function severityColor(sev: string): string {
  switch (sev) {
    case 'critical':
      return CHART.critical;
    case 'high':
      return CHART.high;
    case 'medium':
      return CHART.medium;
    default:
      return CHART.low;
  }
}
