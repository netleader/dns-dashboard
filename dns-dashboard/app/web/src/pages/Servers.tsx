import { CheckCircle2, ChevronRight, Eraser, GitCompare, ListFilter, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../components/bits';
import { serverTone } from '../components/Header';
import { Badge, Button, Card, CardHeader, Dot, Empty, ErrorNote, Skeleton, cx } from '../components/ui';
import { type ActionResult, type DriftArea, type Overview, type ServerDetail, type ServersResponse, postJson } from '../lib/api';
import { fmtAgo, fmtDuration, fmtMs, fmtNum, shortUpstream } from '../lib/format';
import { useApi, useNow } from '../lib/hooks';

export function ServersPage({ o }: { o: Overview | null }) {
  const { data, error, reload } = useApi<ServersResponse>('api/servers', 15_000);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !o)
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  return (
    <div className="space-y-5">
      <Actions onDone={reload} sync={data.sync} />
      <div className="grid gap-5 lg:grid-cols-2">
        {data.servers.map((s) => (
          <ServerCard key={s.id} s={s} />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <SyncCard sync={data.sync} servers={data.servers} />
        <DriftCard areas={data.drift.areas} servers={data.servers} checkedAt={data.drift.checkedAt} />
      </div>
    </div>
  );
}

function Actions({ onDone, sync }: { onDone: () => void; sync: ServersResponse['sync'] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const run = async (key: string, path: string, success: string) => {
    setBusy(key);
    try {
      const r = await postJson<ActionResult>(path);
      const failed = r.results?.filter((x) => !x.ok) ?? [];
      if (failed.length) toast('critical', failed.map((f) => `${f.name}: ${f.error}`).join(' · '));
      else toast('good', success);
      onDone();
    } catch (err) {
      toast('critical', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button icon={<Eraser className="size-4" />} loading={busy === 'cache'} onClick={() => run('cache', 'api/actions/cache-clear', 'DNS-Cache auf allen Servern geleert')}>
        DNS-Cache leeren
      </Button>
      <Button icon={<ListFilter className="size-4" />} loading={busy === 'filters'} onClick={() => run('filters', 'api/actions/filters-refresh', 'Filterlisten werden aktualisiert')}>
        Filterlisten aktualisieren
      </Button>
      {sync.configured && (
        <Button icon={<RefreshCw className="size-4" />} loading={busy === 'sync' || sync.running} onClick={() => run('sync', 'api/actions/sync', 'Synchronisation gestartet')}>
          Jetzt synchronisieren
        </Button>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line py-2 text-[13px]">
      <span className="shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 text-right break-words">{children}</span>
    </div>
  );
}

const onOff = (v: boolean | null | undefined) =>
  v === null || v === undefined ? '–' : v ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="size-3.5 text-good" />an</span> : <span className="inline-flex items-center gap-1 text-ink-2"><XCircle className="size-3.5 text-ink-3" />aus</span>;

/** "[/a.com/b.com/]https://dns…" routes only those domains to that upstream. */
function parseUpstream(line: string): { upstream: string; domains: string[] } {
  const m = line.match(/^\[\/(.*)\/\](.*)$/);
  if (!m) return { upstream: line, domains: [] };
  return { upstream: m[2].trim() === '#' ? '' : m[2].trim(), domains: m[1].split('/').filter(Boolean) };
}

function ServerCard({ s }: { s: ServerDetail }) {
  const now = useNow(30_000);
  const [showLists, setShowLists] = useState(false);
  const tone = serverTone(s);
  const lists = [...(s.filtering?.filters ?? []), ...(s.filtering?.allowlists ?? [])];
  const stale = lists.filter((l) => l.stale).length;
  const d = s.dnsInfo;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="size-3 rounded-[4px]" style={{ background: s.color }} />
            {s.name}
            {s.isOrigin && <span className="rounded-md bg-white/[0.07] px-1.5 py-px text-[10px] font-semibold tracking-wide text-ink-2 uppercase">Origin</span>}
          </span>
        }
        subtitle={s.url}
        right={<Badge tone={tone}>{tone === 'good' ? 'OK' : tone === 'warning' ? 'Achtung' : 'Problem'}</Badge>}
      />
      <div className="px-5 pb-5">
        {!s.online && <div className="mb-3 rounded-lg bg-critical/12 px-3 py-2 text-[13px]">Web-API nicht erreichbar: {s.error}</div>}
        <Row label="Version">{s.version ?? '–'}{s.updateAvailable && <span className="ml-2 text-xs text-warning">→ {s.updateAvailable} verfügbar</span>}</Row>
        <Row label="Läuft seit">{s.startTime ? fmtDuration(now - s.startTime) : '–'}</Row>
        <Row label="DNS-Antwort (Port 53)">{s.dns?.ok ? fmtMs(s.dns.ms) : <span className="text-critical">{s.dns?.error ?? '–'}</span>}</Row>
        <Row label="Schutz">{s.protection.enabled ? onOff(true) : s.protection.pausedUntil ? `pausiert bis ${new Date(s.protection.pausedUntil).toLocaleTimeString('de-DE')}` : onOff(false)}</Row>
        <Row label="Safe Browsing / Kinderschutz / SafeSearch">
          <span className="inline-flex gap-3">
            {onOff(s.features.safebrowsing)} {onOff(s.features.parental)} {onOff(s.features.safesearch)}
          </span>
        </Row>
        <Row label="Upstreams">
          <div className="space-y-0.5">
            {(d?.upstream_dns ?? []).filter((u) => u && !u.startsWith('#')).map((u) => {
              const scoped = parseUpstream(u);
              return (
                <div key={u} className="truncate" title={u}>
                  {shortUpstream(scoped.upstream) || 'Standard-Upstreams'}
                  {scoped.domains.length > 0 && (
                    <span className="text-ink-3">
                      {' '}
                      · nur für {scoped.domains[0]}
                      {scoped.domains.length > 1 && ` +${scoped.domains.length - 1}`}
                    </span>
                  )}
                </div>
              );
            })}
            {d?.upstream_mode && <div className="text-xs text-ink-3">Modus: {d.upstream_mode}</div>}
          </div>
        </Row>
        <Row label="Cache">{d ? (d.cache_enabled ? `${fmtNum(Math.round((d.cache_size ?? 0) / 1024))} KB${d.cache_optimistic ? ' · optimistisch' : ''}` : 'aus') : '–'}</Row>
        <Row label="DNSSEC">{onOff(d?.dnssec_enabled)}</Row>
        <Row label="Blocking-Modus / Ratelimit">{d ? `${d.blocking_mode ?? '–'} · ${d.ratelimit ? `${d.ratelimit}/s` : 'kein Limit'}` : '–'}</Row>
        <Row label="Clients / Umschreibungen / Dienste">
          {[s.counts.clients, s.counts.rewrites, s.counts.blockedServices].map((v) => (v ?? '–')).join(' / ')}
        </Row>
        <Row label="Filterlisten">
          <button onClick={() => setShowLists((v) => !v)} className="inline-flex items-center gap-1 hover:text-ink-2">
            {lists.filter((l) => l.enabled).length} aktiv · {fmtNum(lists.reduce((a, l) => a + (l.enabled ? l.rules : 0), 0))} Regeln
            {stale > 0 && <span className="text-warning"> · {stale} veraltet</span>}
            <ChevronRight className={cx('size-3.5 transition', showLists && 'rotate-90')} />
          </button>
        </Row>
        {showLists && (
          <ul className="mt-1 space-y-1.5 rounded-xl border border-line bg-white/[0.02] p-3">
            {lists.map((l) => (
              <li key={l.url} className="flex items-center gap-2 text-xs">
                <Dot tone={!l.enabled ? 'neutral' : l.stale ? 'warning' : 'good'} />
                <span className={cx('min-w-0 flex-1 truncate', !l.enabled && 'text-ink-3')} title={l.url}>
                  {l.name}
                </span>
                <span className="tnum text-ink-3">{fmtNum(l.rules)}</span>
                <span className="w-24 text-right text-ink-3">{l.lastUpdated ? fmtAgo(Date.parse(l.lastUpdated), now) : '–'}</span>
              </li>
            ))}
            <li className="pt-1 text-xs text-ink-3">+ {s.filtering?.userRules ?? 0} eigene Regeln · Update alle {s.filtering?.interval ?? '–'} h</li>
          </ul>
        )}
      </div>
    </Card>
  );
}

function SyncCard({ sync, servers }: { sync: ServersResponse['sync']; servers: ServerDetail[] }) {
  const now = useNow(15_000);
  const instances = [...(sync.origin ? [{ ...sync.origin, role: 'Origin' }] : []), ...sync.replicas.map((r) => ({ ...r, role: 'Replica' }))];
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="AdGuard Home Sync" icon={<RefreshCw className="size-4" />} subtitle={sync.configured ? undefined : 'nicht konfiguriert'} />
      {!sync.configured ? (
        <Empty>Trage die Sync-URL in den App-Optionen ein, um den Sync-Status zu sehen.</Empty>
      ) : !sync.reachable ? (
        <div className="px-5 pb-5 text-[13px] text-critical">Nicht erreichbar: {sync.error}</div>
      ) : (
        <div className="px-5 pb-5">
          <Row label="Status">{sync.running ? 'synchronisiert gerade …' : 'bereit'}</Row>
          <Row label="Letzter erkannter Sync">{sync.lastSyncAt ? fmtAgo(sync.lastSyncAt, now) : 'noch keiner beobachtet'}</Row>
          <div className="mt-3 space-y-2">
            {instances.map((i) => {
              const ok = !i.error && (i.status === 'success' || i.status === 'info' || !i.status);
              const match = servers.find((s) => s.id === i.serverId);
              return (
                <div key={`${i.role}-${i.url}`} className="flex items-start gap-3 rounded-xl border border-line bg-white/[0.03] px-3 py-2.5">
                  <Dot tone={ok ? 'good' : 'critical'} className="mt-1.5" />
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{match?.name ?? i.host ?? i.url}</span>
                      <span className="text-[11px] text-ink-3">{i.role}</span>
                    </div>
                    <div className="truncate text-xs text-ink-3">{i.url}</div>
                    {i.error && <div className="mt-1 text-xs text-critical">{i.error}</div>}
                  </div>
                  <ShieldCheck className={cx('size-4', i.protection_enabled ? 'text-good' : 'text-ink-3')} aria-label={i.protection_enabled ? 'Schutz an' : 'Schutz aus'} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function DriftCard({ areas, servers, checkedAt }: { areas: DriftArea[]; servers: ServerDetail[]; checkedAt: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const name = (id: string) => servers.find((s) => s.id === id)?.name ?? id;
  const diffs = areas.filter((a) => a.status === 'differs').length;
  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="Konfigurationsvergleich"
        icon={<GitCompare className="size-4" />}
        subtitle={`Prüft, ob beide Server gleich konfiguriert sind · ${fmtAgo(checkedAt)}`}
        right={<Badge tone={diffs ? 'warning' : 'good'}>{diffs ? `${diffs} Bereich${diffs > 1 ? 'e' : ''} abweichend` : 'identisch'}</Badge>}
      />
      <ul className="px-3 pb-4">
        {areas.map((a) => {
          const expandable = a.status === 'differs';
          return (
            <li key={a.key}>
              <button
                disabled={!expandable}
                onClick={() => setOpen(open === a.key ? null : a.key)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[13px] enabled:hover:bg-white/[0.04]"
              >
                <Dot tone={a.status === 'equal' ? 'good' : a.status === 'differs' ? 'warning' : 'neutral'} />
                <span className="flex-1">{a.label}</span>
                <span className="text-xs text-ink-3">{a.status === 'equal' ? 'gleich' : a.status === 'differs' ? 'abweichend' : 'unbekannt'}</span>
                {expandable && <ChevronRight className={cx('size-4 text-ink-3 transition', open === a.key && 'rotate-90')} />}
              </button>
              {open === a.key && (
                <div className="mx-2 mb-2 space-y-2 rounded-xl border border-line bg-white/[0.02] p-3 text-xs">
                  {Object.entries(a.onlyIn).map(([id, items]) => (
                    <div key={id}>
                      <div className="mb-1 font-medium text-ink-2">Nur auf {name(id)}:</div>
                      <ul className="space-y-0.5">
                        {items.slice(0, 30).map((i) => (
                          <li key={i}>
                            <code className="break-all text-ink-3">{i}</code>
                          </li>
                        ))}
                        {items.length > 30 && <li className="text-ink-3">… und {items.length - 30} weitere</li>}
                      </ul>
                    </div>
                  ))}
                  {a.changed.length > 0 && (
                    <div>
                      <div className="mb-1 font-medium text-ink-2">Unterschiedlich eingestellt:</div>
                      <div className="text-ink-3">{a.changed.join(', ')}</div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {servers.length < 2 && <Empty>Für den Vergleich werden zwei Server benötigt.</Empty>}
    </Card>
  );
}

