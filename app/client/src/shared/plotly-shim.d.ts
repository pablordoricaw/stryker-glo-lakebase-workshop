// Type shims for the Plotly build we use. `plotly.js-dist-min` ships no types,
// and we don't install the heavy `@types/plotly.js`. We model just the surface
// the app uses: loose Data/Layout/Config objects + the react-plotly.js factory.
declare module 'plotly.js-dist-min' {
  const Plotly: unknown;
  export default Plotly;
}

declare module 'react-plotly.js/factory' {
  import type { ComponentType } from 'react';
  export type PlotlyData = Record<string, unknown>;
  export type PlotlyLayout = Record<string, unknown>;
  export type PlotlyConfig = Record<string, unknown>;
  export interface PlotParams {
    data: PlotlyData[];
    layout?: PlotlyLayout;
    config?: PlotlyConfig;
    style?: Record<string, unknown>;
    useResizeHandler?: boolean;
    className?: string;
  }
  export default function createPlotlyComponent(
    plotly: unknown,
  ): ComponentType<PlotParams>;
}
