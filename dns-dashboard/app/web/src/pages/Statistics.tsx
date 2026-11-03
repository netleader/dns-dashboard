import { ArrowDown, ArrowUp, Ban, BarChart3, CalendarClock, Download, Filter, Globe, Laptop, Network, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BarList, Delta, SplitBar, Sparkline } from '../components/bits';
import { CHART } from '../components/Chart';
import { Heatmap, Lines, StackedBars, msFormat } from '../components/charts';
import { Card, CardHeader, Empty, ErrorNote, Segmented, SeriesKey, Skeleton } from '../components/ui';
import type { KeyCount, Overview, RangeKey, StatsBundle, TopEntry } from '../lib/api';
import { PROTOS, REASONS, fmtCompact, fmtDateTime, fmtMs, fmtNum, fmtPct, reasonLabel, shortUpstream } from '../lib/format';
import { useApi } from '../lib/hooks';

const RANGES: Array<{ value: RangeKey; label: string; prev: string }> = [
  { value: '24h', label: '24 h', prev: 'Vortag' },
  { value: '7d', label: '7 Tage', prev: 'Vorwoche' },
  { value: '30d', label: '30 Tage', prev: 'Vormonat' },
  { value: '90d', label: '90 Tage', prev: 'Vorquartal' },
  { value: '365d', label: '1 Jahr', prev: 'Vorjahr' },
];

export function StatisticsPage({ o }: { o: Overview | null }) {
  const [range, setRange] = useState<RangeKey>('24h');
  const [server, setServer] = useState('all');
  const { data, error, loading } = useApi<StatsBundle>(`api/stats?range=${range}&server=${server}`, 60_000);
  const servers = o?.servers ?? [];
  const colors = Object.fromEntries(servers.map((s) => [s.id, s.color]));
  const names = Object.fromEntries(servers.map((s) => [s.id, s.name]));
  const prevLabel = RANGES.find((r) => r.value === range)!.prev;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={range} onChange={setRange} options={RANGES} />
        <Segmented value={server} onChange={setServer} options={[{ value: 'all', label: 'Beide Server' }, ...servers.map((s) => ({ value: s.id, label: s.name }))]} />
        <div className="ml-auto flex items-center gap-3">
          {loading && <span className="text-xs text-ink-3">lädt …</span>}
          {data && (
            <button onClick={() => exportCsv(data, names)} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white/[0.04] px-3 py-1.5 text-[13px] text-ink-2 hover:bg-white/[0.08] hover:text-ink">
              <Download className="size-4" /> CSV
            </button>
          )}
        </div>
      </div>

      {error && <ErrorNote>Statistik konnte nicht geladen werden: {error}</ErrorNote>}
      {!data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
          <Skeleton className="col-span-full h-80 rounded-2xl" />
        </div>
      ) : (
        <StatsBody d={data} colors={colors} names={names} prevLabel={prevLabel} />
      )}
    </div>
  );
}

function StatsBody({ d, colors, names, prevLabel }: { d: StatsBundle; colors: Record<string, string>; names: Record<string, string>; prevLabel: string }) {
  const t = d.totals;
  const p = d.previous;
  const hasPrev = !!p && p.queries > 0;
  const from = d.coverage.statsFrom ?? d.coverage.logFrom;
  const partial = from !== null && from > d.from;

  return (
    <>
      {partial && (
        <div className="flex items-start gap-3 rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-[13px] text-ink-2">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <span>
            Das Dashboard sammelt seit <b className="text-ink">{fmtDateTime(from!)}</b> eigene Historie. Längere Zeiträume füllen sich mit der Zeit – AdGuard Home selbst liefert nur die letzten 24 Stunden stündlich.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Anfragen" value={fmtCompact(t.queries)} delta={hasPrev && <Delta now={t.queries} prev={p?.queries} label={prevLabel} />} />
        <Tile label="Block-Rate" value={fmtPct(t.blockedPct)} sub={`${fmtNum(t.blocked)} geblockt`} delta={hasPrev && <Delta now={t.blockedPct} prev={p?.blockedPct} unit="pp" label={prevLabel} />} />
        <Tile label="Ø Antwortzeit" value={fmtMs(t.avgMs)} sub="laut Query-Log" delta={hasPrev && t.avgMs !== null && <Delta now={t.avgMs} prev={p?.avgMs} goodWhenUp={false} label={prevLabel} />} />
        <Tile label="Cache-Trefferquote" value={fmtPct(t.cacheHitPct)} sub="aus dem DNS-Cache beantwortet" />
        <Tile label="NXDOMAIN" value={fmtPct(t.nxdomainPct)} sub={t.servfailPct ? `SERVFAIL ${fmtPct(t.servfailPct)}` : 'nicht existierende Domains'} />
        <Tile label="Clients" value={fmtNum(t.clients)} sub={t.dnssecPct !== null ? `DNSSEC-validiert ${fmtPct(t.dnssecPct)}` : undefined} />
      </div>

      <TrafficCard d={d} colors={colors} names={names} />

      <div className="grid gap-5 lg:grid-cols-2">
        <LoadShareCard d={d} colors={colors} names={names} />
        <Card>
          <CardHeader title="Ø Antwortzeit" subtitle="pro Zeitabschnitt, alle ausgewählten Server (aus dem Query-Log)" />
          <div className="px-3 pb-3">
            {d.series.avgMs.some((v) => v !== null) ? (
              <Lines t={d.t} unit={d.unit} series={[{ name: 'Ø Antwortzeit', color: CHART.allowed, data: d.series.avgMs }]} format={msFormat} axisFormat={(v) => `${v} ms`} height={220} />
            ) : (
              <Empty>Noch keine Query-Log-Daten</Empty>
            )}
          </div>
        </Card>
      </div>

      <HeatmapCard d={d} />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Breakdown title="Ergebnis der Filterung" icon={<Filter className="size-4" />} items={d.reasons} label={reasonLabel} colorOf={(k) => (REASONS[k]?.tone === 'blocked' ? CHART.blocked : CHART.allowed)} note="Anteil am Query-Log" />
        <Breakdown title="Anfragetypen" icon={<BarChart3 className="size-4" />} items={d.qtypes} />
        <Breakdown title="Antwortcodes" icon={<Sparkles className="size-4" />} items={d.rcodes} />
        <Breakdown title="Protokolle" icon={<Network className="size-4" />} items={d.protos} label={(k) => PROTOS[k] ?? k} />
        <Breakdown title="Treffer je Filterliste" icon={<Ban className="size-4" />} items={d.filterLists} color={CHART.blocked} note="Welche Liste hat wie oft gegriffen" />
        <Breakdown title="Blockierte Dienste" icon={<Ban className="size-4" />} items={d.services} color={CHART.blocked} empty="Keine Dienste blockiert" />
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader title="Upstreams" icon={<Network className="size-4" />} subtitle="nicht gecachte Anfragen" />
          <UpstreamTable items={d.upstreams} />
        </Card>
        <TopTables d={d} colors={colors} names={names} prevLabel={prevLabel} />
      </div>
    </>
  );
}

function Tile({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="tnum mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1.5 min-h-4 text-xs text-ink-3">{delta || sub}</div>
    </Card>
  );
}

function TrafficCard({ d, colors, names }: { d: StatsBundle; colors: Record<string, string>; names: Record<string, string> }) {
  const [mode, setMode] = useState<'status' | 'server'>('status');
  const series = useMemo(() => {
    const ids = Object.keys(d.series.queries);
    if (mode === 'server') return ids.map((id) => ({ name: names[id] ?? id, color: colors[id] ?? CHART.muted, data: d.series.queries[id] }));
    const q = d.t.map((_, i) => ids.reduce((a, id) => a + d.series.queries[id][i], 0));
    const b = d.t.map((_, i) => ids.reduce((a, id) => a + d.series.blocked[id][i], 0));
    return [
      { name: 'Erlaubt', color: CHART.allowed, data: q.map((v, i) => Math.max(0, v - b[i])) },
      { name: 'Geblockt', color: CHART.blocked, data: b },
    ];
  }, [d, mode, colors, names]);
  const empty = series.every((s) => s.data.every((v) => !v));
  return (
    <Card>
      <CardHeader
        title="Anfragen und Blockierungen"
        subtitle={d.unit === 'hour' ? 'stündlich' : 'täglich'}
        right={
          <>
            <div className="mr-2 hidden gap-3 sm:flex">
              {series.map((s) => (
                <SeriesKey key={s.name} color={s.color} label={s.name} />
              ))}
            </div>
            <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'status', label: 'Erlaubt / Geblockt' }, { value: 'server', label: 'Nach Server' }]} />
          </>
        }
      />
      <div className="px-3 pb-3">{empty ? <Empty>Für diesen Zeitraum liegen noch keine Daten vor</Empty> : <StackedBars t={d.t} unit={d.unit} series={series} height={300} />}</div>
    </Card>
  );
}

/** Share of each server per bucket – shows failover and how evenly clients spread their queries. */
function LoadShareCard({ d, colors, names }: { d: StatsBundle; colors: Record<string, string>; names: Record<string, string> }) {
  const ids = Object.keys(d.series.queries);
  const series = ids.map((id) => ({
    name: names[id] ?? id,
    color: colors[id] ?? CHART.muted,
    data: d.t.map((_, i) => {
      const tot = ids.reduce((a, x) => a + d.series.queries[x][i], 0);
      return tot ? Math.round((d.series.queries[id][i] / tot) * 1000) / 10 : null;
    }),
  }));
  const totals = ids.map((id) => ({ id, value: d.series.queries[id].reduce((a, v) => a + v, 0) }));
  return (
    <Card>
      <CardHeader
        title="Lastverteilung"
        subtitle={ids.length > 1 ? 'Anteil je Server an allen Anfragen' : 'nur ein Server ausgewählt'}
        right={
          <div className="flex gap-3">
            {series.map((s) => (
              <SeriesKey key={s.name} color={s.color} label={s.name} />
            ))}
          </div>
        }
      />
      {ids.length > 1 ? (
        <>
          <div className="px-5 pb-1">
            <SplitBar parts={totals.map((x) => ({ color: colors[x.id], value: x.value, label: names[x.id] }))} className="h-2" />
          </div>
          <div className="px-3 pb-3">
            <Lines t={d.t} unit={d.unit} series={series} stackPercent format={(v) => fmtPct(v)} axisFormat={(v) => `${v} %`} height={200} />
          </div>
        </>
      ) : (
        <Empty>Wähle „Beide Server“, um die Verteilung zu sehen.</Empty>
      )}
    </Card>
  );
}

function HeatmapCard({ d }: { d: StatsBundle }) {
  const [mode, setMode] = useState<'queries' | 'blocked'>('queries');
  return (
    <Card>
      <CardHeader
        title="Wochenrhythmus"
        subtitle={mode === 'queries' ? 'Ø Anfragen je Stunde nach Wochentag (mind. 7 Tage)' : 'Block-Rate nach Wochentag und Uhrzeit'}
        right={<Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'queries', label: 'Anfragen' }, { value: 'blocked', label: 'Block-Rate' }]} />}
      />
      <div className="overflow-x-auto px-3 pb-3">
        <div className="min-w-[560px]">
          <Heatmap values={mode === 'queries' ? d.heatmap.queries : d.heatmap.blockedPct} percent={mode === 'blocked'} />
        </div>
      </div>
    </Card>
  );
}

function Breakdown({ title, icon, items, label, color = CHART.allowed, colorOf, note, empty = 'Noch keine Daten' }: { title: string; icon: React.ReactNode; items: KeyCount[] | Array<{ key: string; count: number }>; label?: (k: string) => string; color?: string; colorOf?: (k: string) => string; note?: string; empty?: string }) {
  const total = items.reduce((a, i) => a + i.count, 0);
  return (
    <Card>
      <CardHeader title={title} icon={icon} subtitle={note} />
      {items.length ? (
        <BarList items={items.slice(0, 8)} color={color} colorOf={colorOf} label={label} extra={(it) => <span className="tnum text-xs text-ink-3">{fmtPct((it.count / Math.max(1, total)) * 100)}</span>} />
      ) : (
        <Empty>{empty}</Empty>
      )}
    </Card>
  );
}

function UpstreamTable({ items }: { items: KeyCount[] }) {
  if (!items.length) return <Empty>Keine Upstream-Daten</Empty>;
  const total = items.reduce((a, i) => a + i.count, 0);
  return (
    <div className="overflow-x-auto px-5 pb-4">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th className="py-2 font-medium">Upstream</th>
            <th className="py-2 text-right font-medium">Anteil</th>
            <th className="py-2 text-right font-medium">Ø Zeit</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.key} className="border-t border-line">
              <td className="max-w-0 truncate py-2 pr-3" title={u.key}>
                {shortUpstream(u.key)}
              </td>
              <td className="tnum py-2 text-right text-ink-2">{fmtPct((u.count / total) * 100)}</td>
              <td className="tnum py-2 pl-3 text-right">{fmtMs(u.avgMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopTables({ d, colors, names, prevLabel }: { d: StatsBundle; colors: Record<string, string>; names: Record<string, string>; prevLabel: string }) {
  const [tab, setTab] = useState<'domains' | 'blocked' | 'clients'>('blocked');
  const items = tab === 'domains' ? d.topDomains : tab === 'blocked' ? d.topBlocked : d.topClients;
  return (
    <Card className="xl:col-span-3">
      <CardHeader
        title="Top-Listen"
        icon={tab === 'clients' ? <Laptop className="size-4" /> : <Globe className="size-4" />}
        subtitle={`Trend im Zeitraum · Rang ggü. ${prevLabel}`}
        right={
          <Segmented
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'blocked', label: 'Geblockt' },
              { value: 'domains', label: 'Domains' },
              { value: 'clients', label: 'Clients' },
            ]}
          />
        }
      />
      {items.length === 0 ? (
        <Empty>Noch keine Query-Log-Daten</Empty>
      ) : (
        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="w-8 py-2 font-medium">#</th>
                <th className="py-2 font-medium">{tab === 'clients' ? 'Client' : 'Domain'}</th>
                <th className="hidden py-2 font-medium sm:table-cell">Verlauf</th>
                <th className="py-2 text-right font-medium">Anfragen</th>
                <th className="hidden w-28 py-2 pl-4 font-medium md:table-cell">Server</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <TopRow key={e.key} e={e} tab={tab} colors={colors} names={names} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TopRow({ e, tab, colors, names }: { e: TopEntry; tab: string; colors: Record<string, string>; names: Record<string, string> }) {
  const move = e.prevRank === undefined ? 'new' : e.prevRank - e.rank;
  return (
    <tr className="border-t border-line">
      <td className="py-2">
        <div className="flex items-center gap-1">
          <span className="tnum text-ink-3">{e.rank}</span>
          {move === 'new' ? (
            <span className="rounded bg-allowed/20 px-1 text-[9px] font-semibold text-ink uppercase">neu</span>
          ) : move > 0 ? (
            <ArrowUp className="size-3 text-ink-2" aria-label={`${move} Plätze hoch`} />
          ) : move < 0 ? (
            <ArrowDown className="size-3 text-ink-3" aria-label={`${-move} Plätze runter`} />
          ) : null}
        </div>
      </td>
      <td className="max-w-0 truncate py-2 pr-3" title={e.key}>
        {e.label ? (
          <>
            {e.label} <span className="text-ink-3">{e.key}</span>
          </>
        ) : (
          e.key
        )}
        {tab === 'clients' && e.blocked > 0 && <span className="ml-2 text-xs text-ink-3">{fmtPct((e.blocked / e.count) * 100, 0)} geblockt</span>}
      </td>
      <td className="hidden py-1 sm:table-cell">
        <Sparkline values={e.trend} color={tab === 'blocked' ? CHART.blocked : CHART.allowed} width={110} height={24} />
      </td>
      <td className="tnum py-2 text-right font-medium">{fmtNum(e.count)}</td>
      <td className="hidden py-2 pl-4 md:table-cell">
        <SplitBar parts={Object.entries(e.perServer).map(([id, v]) => ({ color: colors[id], value: v, label: names[id] ?? id }))} />
      </td>
    </tr>
  );
}

function exportCsv(d: StatsBundle, names: Record<string, string>) {
  const ids = Object.keys(d.series.queries);
  const lines = [['Zeit', ...ids.flatMap((id) => [`${names[id] ?? id} Anfragen`, `${names[id] ?? id} geblockt`]), 'Ø Antwortzeit ms'].join(';')];
  d.t.forEach((ts, i) => {
    lines.push([new Date(ts).toISOString(), ...ids.flatMap((id) => [d.series.queries[id][i], d.series.blocked[id][i]]), d.series.avgMs[i] ?? ''].join(';'));
  });
  lines.push('', 'Top-Liste;Rang;Eintrag;Anfragen;geblockt');
  for (const [name, list] of [
    ['Domains', d.topDomains],
    ['Geblockt', d.topBlocked],
    ['Clients', d.topClients],
  ] as const) {
    for (const e of list) lines.push([name, e.rank, e.label ? `${e.label} (${e.key})` : e.key, e.count, e.blocked].join(';'));
  }
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dns-statistik-${d.range}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

