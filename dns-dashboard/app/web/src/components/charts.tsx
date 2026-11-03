import type { EChartsCoreOption } from 'echarts/core';
import { useMemo } from 'react';
import { fmtBucket, fmtBucketLong, fmtMs, fmtNum, fmtPct } from '../lib/format';
import { t as tr } from '../lib/i18n';
import { CHART, Chart, baseOption, categoryAxis, tipRow, valueAxis } from './Chart';

export interface Series {
  name: string;
  color: string;
  data: Array<number | null>;
}

type Unit = 'hour' | 'day' | 'hours' | 'days';

/** Stacked columns: ≤24px wide, 2px surface gap between segments, rounded top. */
export function StackedBars({ t, unit, series, height = 260 }: { t: number[]; unit: Unit; series: Series[]; height?: number }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const total = t.map((_, i) => series.reduce((a, s) => a + (s.data[i] ?? 0), 0));
    return {
      ...baseOption(),
      tooltip: {
        ...(baseOption().tooltip as object),
        formatter: (params: Array<{ dataIndex: number; seriesIndex: number; value: number }>) => {
          const i = params[0]?.dataIndex ?? 0;
          const rows = [...params].reverse().map((p) => tipRow(series[p.seriesIndex].color, series[p.seriesIndex].name, fmtNum(p.value)));
          return `<div style="margin-bottom:6px;font-weight:600">${fmtBucketLong(t[i], unit)}</div>${rows.join('')}<div style="margin-top:6px;border-top:1px solid rgba(255,255,255,.08);padding-top:6px">${tipRow('transparent', tr('common.total'), fmtNum(total[i]))}</div>`;
        },
      },
      xAxis: categoryAxis(t.map((x) => fmtBucket(x, unit))),
      yAxis: valueAxis(),
      series: series.map((s, idx) => ({
        name: s.name,
        type: 'bar',
        stack: 'total',
        data: s.data,
        barMaxWidth: 24,
        itemStyle: {
          color: s.color,
          borderColor: CHART.surface,
          borderWidth: 1,
          borderRadius: idx === series.length - 1 ? [4, 4, 0, 0] : 0,
        },
        emphasis: { focus: 'series' },
      })),
    };
  }, [t, unit, series]);
  return <Chart option={option} height={height} />;
}

/** Line chart for one measure (one axis); several series share it. */
export function Lines({
  t,
  unit,
  series,
  height = 220,
  format = fmtNum,
  axisFormat,
  area = true,
  stackPercent = false,
}: {
  t: number[];
  unit: Unit;
  series: Series[];
  height?: number;
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  area?: boolean;
  stackPercent?: boolean;
}) {
  const option = useMemo<EChartsCoreOption>(
    () => ({
      ...baseOption(),
      tooltip: {
        ...(baseOption().tooltip as object),
        formatter: (params: Array<{ dataIndex: number; seriesIndex: number; value: number | null }>) => {
          const i = params[0]?.dataIndex ?? 0;
          return `<div style="margin-bottom:6px;font-weight:600">${fmtBucketLong(t[i], unit)}</div>${params
            .map((p) => tipRow(series[p.seriesIndex].color, series[p.seriesIndex].name, p.value === null ? '–' : format(p.value)))
            .join('')}`;
        },
      },
      xAxis: { ...categoryAxis(t.map((x) => fmtBucket(x, unit))), boundaryGap: false },
      yAxis: { ...valueAxis(axisFormat ?? format), ...(stackPercent ? { max: 100 } : {}) },
      series: series.map((s) => ({
        name: s.name,
        type: 'line',
        data: s.data,
        stack: stackPercent ? 'share' : undefined,
        smooth: 0.25,
        connectNulls: false,
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2, color: s.color, cap: 'round', join: 'round' },
        itemStyle: { color: s.color, borderColor: CHART.surface, borderWidth: 2 },
        areaStyle: area || stackPercent ? { color: s.color, opacity: stackPercent ? 0.35 : 0.1 } : undefined,
      })),
    }),
    [t, unit, series, format, axisFormat, area, stackPercent],
  );
  return <Chart option={option} height={height} />;
}

const DAYS = tr('days.short').split(',');

/** Weekday × hour heatmap with a neutral sequential ramp (dark = little, light = a lot). */
export function Heatmap({ values, height = 250, percent = false }: { values: number[][]; height?: number; percent?: boolean }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const data: Array<[number, number, number]> = [];
    let max = 0;
    values.forEach((row, d) =>
      row.forEach((v, h) => {
        data.push([h, d, v]);
        max = Math.max(max, v);
      }),
    );
    return {
      ...baseOption(),
      grid: { left: 8, right: 8, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        ...(baseOption().tooltip as object),
        trigger: 'item',
        formatter: (p: { value: [number, number, number] }) =>
          `<div style="font-weight:600;margin-bottom:4px">${DAYS[p.value[1]]}, ${String(p.value[0]).padStart(2, '0')}:00–${String(p.value[0] + 1).padStart(2, '0')}:00</div>${tipRow(
            'transparent',
            percent ? tr('chart.blockRate') : tr('chart.avgPerHour'),
            percent ? fmtPct(p.value[2]) : fmtNum(p.value[2]),
          )}`,
      },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
        axisLabel: { color: CHART.muted, fontSize: 10, interval: 2 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category',
        data: DAYS,
        inverse: true,
        axisLabel: { color: CHART.muted, fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      visualMap: {
        show: false,
        min: 0,
        max: Math.max(1, max),
        inRange: { color: ['#262626', '#3a3a3a', '#555555', '#787878', '#a3a3a3', '#d6d6d6'] },
      },
      series: [
        {
          type: 'heatmap',
          data,
          itemStyle: { borderColor: CHART.surface, borderWidth: 2, borderRadius: 4 },
          emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1 } },
        },
      ],
    };
  }, [values, percent]);
  return <Chart option={option} height={height} />;
}

export const msFormat = (v: number) => fmtMs(v);
