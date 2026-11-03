import { AlertOctagon, AlertTriangle, Ban, Clock, Globe, Info, Laptop, Network, Server, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Delta, SplitBar, Sparkline } from '../components/bits';
import { CHART } from '../components/Chart';
import { StackedBars } from '../components/charts';
import { Card, CardHeader, Empty, Segmented, SeriesKey, Skeleton, cx } from '../components/ui';
import type { Alert, Overview } from '../lib/api';
import { fmtCompact, fmtDuration, fmtMs, fmtNum, fmtPct, shortUpstream } from '../lib/format';
import { useNow } from '../lib/hooks';

type TopItem = Overview['combined']['topDomains'][number] & { label?: string };

export function OverviewPage({ o, go }: { o: Overview | null; go: (r: string) => void }) {
  if (!o) return <LoadingGrid />;
  const c = o.combined;
  const colors = Object.fromEntries(o.servers.map((s) => [s.id, s.color]));
  const names = Object.fromEntries(o.servers.map((s) => [s.id, s.name]));
  const total = (rec: Record<string, number[]>) => {
    const arrs = Object.values(rec);
    return arrs[0]?.map((_, i) => arrs.reduce((a, x) => a + (x[i] ?? 0), 0)) ?? [];
  };
  const queries = total(c.series.queries);
  const blocked = total(c.series.blocked);

  return (
    <div className="space-y-5">
      {o.alerts.length > 0 && <AlertList alerts={o.alerts} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          icon={<Globe className="size-4" />}
          label="DNS-Anfragen · 24 h"
          value={fmtCompact(c.queries)}
          delta={<Delta now={c.queries} prev={c.previous?.queries} />}
          spark={{ values: queries, color: CHART.allowed }}
        />
        <Kpi
          icon={<Ban className="size-4" />}
          label="Geblockt"
          value={fmtPct(c.blockedPct)}
          sub={`${fmtNum(c.blocked)} Anfragen`}
          delta={<Delta now={c.blockedPct} prev={c.previous?.blockedPct} unit="pp" />}
          spark={{ values: blocked, color: CHART.blocked }}
        />
        <Kpi
          icon={<Clock className="size-4" />}
          label="Ø Verarbeitungszeit"
          value={fmtMs(c.avgMs)}
          sub={o.servers.map((s) => `${s.name.split(' ')[0]} ${fmtMs(s.stats?.avgMs)}`).join(' · ')}
        />
        <Kpi
          icon={<Users className="size-4" />}
          label="Aktive Clients"
          value={fmtNum(c.activeClients)}
          sub="in den letzten 24 Stunden"
          footer={
            <div className="mt-3">
              <div className="mb-1.5 flex justify-between text-[11px] text-ink-3">
                <span>Lastverteilung</span>
                <span className="tnum">
                  {o.servers.map((s) => `${fmtPct((100 * (s.stats?.queries ?? 0)) / Math.max(1, c.queries), 0)}`).join(' / ')}
                </span>
              </div>
              <SplitBar parts={o.servers.map((s) => ({ color: s.color, value: s.stats?.queries ?? 0, label: s.name }))} />
            </div>
          }
        />
      </div>

      <TrafficCard o={o} colors={colors} names={names} />

      <div className="grid gap-5 lg:grid-cols-3">
        <TopCard title="Top geblockte Domains" icon={<Ban className="size-4" />} items={c.topBlocked} colors={colors} names={names} onSelect={(d) => go(`log?q=${encodeURIComponent(d)}`)} />
        <TopCard title="Top Domains" icon={<Globe className="size-4" />} items={c.topDomains} colors={colors} names={names} onSelect={(d) => go(`log?q=${encodeURIComponent(d)}`)} />
        <TopCard title="Top Clients" icon={<Laptop className="size-4" />} items={c.topClients} colors={colors} names={names} onSelect={(d) => go(`log?q=${encodeURIComponent(d)}`)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Server im Vergleich" icon={<Server className="size-4" />} subtitle="Letzte 24 Stunden laut AdGuard Home" />
          <ServerTable o={o} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Upstreams" icon={<Network className="size-4" />} subtitle="Antworten und Ø Antwortzeit, beide Server" />
          <UpstreamList items={c.topUpstreams} />
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, delta, spark, footer }: { icon: React.ReactNode; label: string; value: string; sub?: string; delta?: React.ReactNode; spark?: { values: number[]; color: string }; footer?: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        <span className="text-ink-3">{icon}</span>
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="tnum text-[26px] leading-none font-semibold tracking-tight whitespace-nowrap sm:text-[30px]">{value}</div>
        {spark && (
          <div className="hidden 2xl:block">
            <Sparkline {...spark} />
          </div>
        )}
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1">
        {delta}
        {sub && <span className="truncate text-xs text-ink-3">{sub}</span>}
      </div>
      {spark && (
        <div className="mt-3 2xl:hidden">
          <Sparkline {...spark} stretch height={26} />
        </div>
      )}
      {footer}
    </Card>
  );
}

function TrafficCard({ o, colors, names }: { o: Overview; colors: Record<string, string>; names: Record<string, string> }) {
  const [mode, setMode] = useState<'status' | 'server'>('status');
  const s = o.combined.series;
  const series = useMemo(() => {
    const ids = Object.keys(s.queries);
    if (mode === 'server') return ids.map((id) => ({ name: names[id], color: colors[id], data: s.queries[id] }));
    const sum = (rec: Record<string, number[]>) => s.t.map((_, i) => ids.reduce((a, id) => a + (rec[id]?.[i] ?? 0), 0));
    const q = sum(s.queries);
    const b = sum(s.blocked);
    return [
      { name: 'Erlaubt', color: CHART.allowed, data: q.map((v, i) => Math.max(0, v - b[i])) },
      { name: 'Geblockt', color: CHART.blocked, data: b },
    ];
  }, [s, mode, colors, names]);

  return (
    <Card>
      <CardHeader
        title="Anfragen im Verlauf"
        subtitle={s.units === 'hours' ? 'Letzte 24 Stunden, stündlich' : 'Täglich'}
        right={
          <>
            <div className="mr-2 hidden gap-3 sm:flex">
              {series.map((x) => (
                <SeriesKey key={x.name} color={x.color} label={x.name} />
              ))}
            </div>
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'status', label: 'Erlaubt / Geblockt' },
                { value: 'server', label: 'Nach Server' },
              ]}
            />
          </>
        }
      />
      <div className="px-3 pb-3">
        {s.t.length ? <StackedBars t={s.t} unit={s.units} series={series} height={280} /> : <Empty>Noch keine Daten</Empty>}
      </div>
    </Card>
  );
}

function TopCard({ title, icon, items, colors, names, onSelect }: { title: string; icon: React.ReactNode; items: TopItem[]; colors: Record<string, string>; names: Record<string, string>; onSelect: (k: string) => void }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <Card>
      <CardHeader title={title} icon={icon} subtitle="beide Server zusammen · Balken = Anteil je Server" />
      {items.length === 0 ? (
        <Empty>Keine Einträge</Empty>
      ) : (
        <ol className="space-y-0.5 px-3 pb-4">
          {items.map((it, i) => (
            <li key={it.name}>
              <button onClick={() => onSelect(it.name)} className="group w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]" title="Im Query-Log anzeigen">
                <div className="flex items-baseline gap-2.5">
                  <span className="tnum w-4 shrink-0 text-right text-[11px] text-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {it.label ? (
                      <>
                        {it.label} <span className="text-ink-3">{it.name}</span>
                      </>
                    ) : (
                      it.name
                    )}
                  </span>
                  <span className="tnum shrink-0 text-[13px] font-medium text-ink-2">{fmtNum(it.count)}</span>
                </div>
                <div className="mt-1 ml-6.5 flex h-1.5 gap-[2px]" style={{ width: `${Math.max(4, (it.count / max) * 100)}%` }}>
                  {Object.entries(it.perServer).map(([id, v]) => (
                    <span key={id} className="h-full rounded-[2px]" style={{ width: `${(v / it.count) * 100}%`, background: colors[id] }} title={`${names[id]}: ${fmtNum(v)}`} />
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ServerTable({ o }: { o: Overview }) {
  const now = useNow(30_000);
  const rows: Array<[string, (s: Overview['servers'][number]) => React.ReactNode]> = [
    ['Anfragen', (s) => fmtNum(s.stats?.queries)],
    ['Geblockt', (s) => (s.stats ? `${fmtPct(s.stats.blockedPct)} · ${fmtNum(s.stats.blocked)}` : '–')],
    ['Ø Verarbeitung', (s) => fmtMs(s.stats?.avgMs)],
    ['DNS-Antwort (Port 53)', (s) => (s.dns?.ok ? fmtMs(s.dns.ms) : <span className="text-critical">keine Antwort</span>)],
    ['Safe Browsing ersetzt', (s) => fmtNum(s.stats?.safebrowsing)],
    ['Version', (s) => (s.updateAvailable ? `${s.version} → ${s.updateAvailable}` : (s.version ?? '–'))],
    ['Läuft seit', (s) => (s.startTime ? fmtDuration(now - s.startTime) : '–')],
  ];
  return (
    <div className="overflow-x-auto px-5 pb-4">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th className="py-2 font-medium" />
            {o.servers.map((s) => (
              <th key={s.id} className="py-2 pl-4 font-medium">
                <span className="inline-flex items-center gap-2 text-ink-2">
                  <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
                  {s.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-2 pr-2 text-ink-3">{label}</td>
              {o.servers.map((s) => (
                <td key={s.id} className="tnum py-2 pl-4 text-ink">
                  {s.online ? fn(s) : <span className="text-ink-3">offline</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UpstreamList({ items }: { items: Overview['combined']['topUpstreams'] }) {
  if (!items.length) return <Empty>Keine Upstream-Daten</Empty>;
  const max = Math.max(1, ...items.map((u) => u.responses));
  const fastest = Math.min(...items.map((u) => u.avgMs));
  return (
    <ul className="space-y-3 px-5 pb-5">
      {items.map((u) => (
        <li key={u.name}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate" title={u.name}>
              {shortUpstream(u.name)}
            </span>
            <span className={cx('tnum shrink-0 text-xs', u.avgMs === fastest ? 'text-good' : 'text-ink-3')}>Ø {fmtMs(u.avgMs)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full bg-allowed" style={{ width: `${(u.responses / max) * 100}%` }} />
            </div>
            <span className="tnum w-16 shrink-0 text-right text-xs text-ink-2">{fmtCompact(u.responses)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const ALERT_STYLE = {
  critical: { icon: AlertOctagon, cls: 'border-critical/45 bg-critical/12', iconCls: 'text-critical', label: 'Kritisch' },
  warning: { icon: AlertTriangle, cls: 'border-warning/35 bg-warning/10', iconCls: 'text-warning', label: 'Warnung' },
  info: { icon: Info, cls: 'border-line bg-white/[0.04]', iconCls: 'text-ink-2', label: 'Hinweis' },
};

export function AlertList({ alerts }: { alerts: Alert[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {alerts.map((a) => {
        const st = ALERT_STYLE[a.level];
        const Icon = st.icon;
        return (
          <div key={a.id} className={cx('fade-up flex items-start gap-3 rounded-xl border px-4 py-3', st.cls)}>
            <Icon className={cx('mt-0.5 size-4 shrink-0', st.iconCls)} aria-label={st.label} />
            <div className="min-w-0 text-[13px]">
              <div className="font-medium">{a.title}</div>
              {a.detail && <div className="mt-0.5 truncate text-xs text-ink-2" title={a.detail}>{a.detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}
