import { BarChart, HeatmapChart, LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { fmtAxis } from '../lib/format';

echarts.use([BarChart, LineChart, HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, MarkLineComponent, CanvasRenderer]);

export const CHART = {
  surface: '#1c1c1c',
  grid: '#2c2c2c',
  axis: '#3a3a3a',
  ink: '#e6e6e6',
  ink2: '#a3a3a3',
  muted: '#737373',
  allowed: '#8e9399',
  blocked: '#d95926',
  font: "'Inter Variable', system-ui, sans-serif",
};

/** Shared chrome: recessive hairline grid, muted axis labels, dark tooltip. */
export function baseOption(): EChartsCoreOption {
  return {
    animationDuration: 500,
    textStyle: { fontFamily: CHART.font, color: CHART.ink2 },
    grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(35,35,35,0.97)',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: CHART.ink, fontSize: 12, fontFamily: CHART.font },
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.25)', width: 1 } },
      extraCssText: 'border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.5)',
    },
  };
}

export const valueAxis = (format: (v: number) => string = fmtAxis) => ({
  type: 'value',
  splitNumber: 4,
  axisLabel: { color: CHART.muted, fontSize: 11, formatter: format },
  splitLine: { lineStyle: { color: CHART.grid, width: 1 } },
  axisLine: { show: false },
  axisTick: { show: false },
});

export const categoryAxis = (labels: string[]) => ({
  type: 'category',
  data: labels,
  axisLabel: { color: CHART.muted, fontSize: 11, hideOverlap: true },
  axisLine: { lineStyle: { color: CHART.axis } },
  axisTick: { show: false },
});

/** One row of the tooltip: colour key + label + right-aligned value. */
export function tipRow(color: string, label: string, value: string) {
  return `<div style="display:flex;align-items:center;gap:8px;min-width:180px"><span style="width:9px;height:9px;border-radius:3px;background:${color}"></span><span style="color:${CHART.ink2}">${label}</span><span style="margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600">${value}</span></div>`;
}

export function Chart({ option, height = 260, className }: { option: EChartsCoreOption; height?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      inst.current?.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    inst.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} className={className} style={{ height, width: '100%' }} />;
}
