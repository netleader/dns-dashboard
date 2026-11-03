import { CheckCircle2, Pause, Play, Search, ShieldBan, ShieldCheck, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Drawer, useToast } from '../components/bits';
import { Badge, Button, Card, Empty, ErrorNote, Segmented, Skeleton, type Tone, cx } from '../components/ui';
import { type CheckHost, type LogEntry, type Overview, type QueryLogPage, getJson, postJson } from '../lib/api';
import { PROTOS, REASONS, fmtMs, fmtTime, reasonLabel, shortUpstream } from '../lib/format';

const STATUS = [
  { value: 'all', label: 'Alle' },
  { value: 'blocked', label: 'Geblockt' },
  { value: 'processed', label: 'Erlaubt' },
  { value: 'whitelisted', label: 'Allowlist' },
  { value: 'rewritten', label: 'Umgeschrieben' },
  { value: 'blocked_safebrowsing', label: 'Safe Browsing' },
];

const toneOf = (reason: string): Tone => {
  const t = REASONS[reason]?.tone;
  return t === 'blocked' ? 'blocked' : t === 'allowed' ? 'allowed' : t === 'warn' ? 'warning' : 'neutral';
};

function initialSearch() {
  const m = window.location.hash.match(/[?&]q=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export function QueryLogPage({ o }: { o: Overview | null }) {
  const [search, setSearch] = useState(initialSearch);
  const [query, setQuery] = useState(search);
  const [status, setStatus] = useState('all');
  const [server, setServer] = useState('all');
  const [live, setLive] = useState(true);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [errors, setErrors] = useState<QueryLogPage['errors']>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const pagedRef = useRef(false);

  const servers = o?.servers ?? [];
  const meta = Object.fromEntries(servers.map((s) => [s.id, s]));
  const params = `search=${encodeURIComponent(query)}&status=${status}&server=${server}&limit=60`;

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const loadFirst = useCallback(async () => {
    try {
      const page = await getJson<QueryLogPage>(`api/querylog?${params}`);
      if (pagedRef.current) return;
      setEntries(page.entries);
      setNext(page.next);
      setErrors(page.errors);
    } catch (err) {
      setErrors([{ server: '', error: err instanceof Error ? err.message : String(err) }]);
    }
  }, [params]);

  useEffect(() => {
    pagedRef.current = false;
    setEntries(null);
    void loadFirst();
  }, [loadFirst]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => void loadFirst(), 5000);
    return () => clearInterval(id);
  }, [live, loadFirst]);

  const loadMore = async () => {
    if (!next) return;
    pagedRef.current = true;
    setLive(false);
    setLoadingMore(true);
    try {
      const page = await getJson<QueryLogPage>(`api/querylog?${params}&before=${encodeURIComponent(next)}`);
      setEntries((e) => [...(e ?? []), ...page.entries]);
      setNext(page.next);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleLive = () => {
    if (!live) {
      pagedRef.current = false;
      void loadFirst();
    }
    setLive((v) => !v);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Domain oder Client-IP suchen"
            className="w-full rounded-xl border border-line bg-white/[0.04] py-2 pr-3 pl-9 text-[13px] text-ink placeholder:text-ink-3 focus:border-allowed/60 focus:outline-none"
          />
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl border border-line bg-[#111724] px-3 py-2 text-[13px] text-ink focus:outline-none"
          aria-label="Status"
        >
          {STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <Segmented value={server} onChange={setServer} options={[{ value: 'all', label: 'Beide' }, ...servers.map((s) => ({ value: s.id, label: s.name }))]} />
        <Button onClick={toggleLive} icon={live ? <Pause className="size-4" /> : <Play className="size-4" />} className="ml-auto">
          {live ? (
            <span className="flex items-center gap-2">
              <span className="live-dot size-2 rounded-full bg-good text-good" />
              Live
            </span>
          ) : (
            'Pausiert'
          )}
        </Button>
      </div>

      {errors.map((e) => (
        <ErrorNote key={e.server}>
          {e.server ? `${meta[e.server]?.name ?? e.server}: ` : ''}
          {e.error}
        </ErrorNote>
      ))}

      <Card className="overflow-hidden">
        {entries === null ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <Empty>Keine Einträge gefunden</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-3">
                  <th className="px-4 py-2.5 font-medium">Zeit</th>
                  <th className="px-2 py-2.5 font-medium">Server</th>
                  <th className="px-2 py-2.5 font-medium">Client</th>
                  <th className="px-2 py-2.5 font-medium">Domain</th>
                  <th className="px-2 py-2.5 font-medium">Status</th>
                  <th className="px-2 py-2.5 text-right font-medium">Zeit</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Antwort von</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={`${e.server}-${e.tsUs}-${e.domain}-${e.qtype}`}
                    onClick={() => setSelected(e)}
                    className={cx('cursor-pointer border-b border-line/60 hover:bg-white/[0.04]', e.blocked && 'bg-blocked/[0.05]')}
                  >
                    <td className="tnum px-4 py-2 whitespace-nowrap text-ink-2">{fmtTime(e.ts, true)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-ink-2">
                        <span className="size-2 rounded-[3px]" style={{ background: meta[e.server]?.color }} />
                        {meta[e.server]?.name.split(' ')[0] ?? e.server}
                      </span>
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-2" title={e.client}>
                      {e.clientName ?? e.client}
                      {e.clientName && <span className="ml-1.5 text-xs text-ink-3">{e.client}</span>}
                    </td>
                    <td className="max-w-[340px] truncate px-2 py-2" title={e.domain}>
                      {e.domain}
                      <span className="ml-1.5 text-[11px] text-ink-3">{e.qtype}</span>
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={toneOf(e.reason)}>{reasonLabel(e.reason)}</Badge>
                    </td>
                    <td className="tnum px-2 py-2 text-right whitespace-nowrap text-ink-2">{fmtMs(e.elapsedMs)}</td>
                    <td className="hidden max-w-[220px] truncate px-4 py-2 text-ink-3 lg:table-cell">{e.cached ? 'Cache' : e.upstream ? shortUpstream(e.upstream) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {next && entries && entries.length > 0 && (
          <div className="flex justify-center border-t border-line p-3">
            <Button onClick={loadMore} loading={loadingMore} variant="ghost">
              Ältere Einträge laden
            </Button>
          </div>
        )}
      </Card>

      <EntryDrawer entry={selected} onClose={() => setSelected(null)} serverName={(id) => meta[id]?.name ?? id} originName={servers.find((s) => s.isOrigin)?.name} />
    </div>
  );
}

function EntryDrawer({ entry, onClose, serverName, originName }: { entry: LogEntry | null; onClose: () => void; serverName: (id: string) => string; originName?: string }) {
  const [check, setCheck] = useState<CheckHost | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const domain = entry?.domain.replace(/\.$/, '');

  useEffect(() => {
    setCheck(null);
    if (!domain) return;
    getJson<CheckHost>(`api/check-host?name=${encodeURIComponent(domain)}`).then(setCheck).catch(() => undefined);
  }, [domain]);

  const act = async (action: 'allow' | 'block' | 'remove') => {
    if (!domain) return;
    setBusy(action);
    try {
      const r = await postJson('api/actions/rule', { domain, action });
      const failed = r.results?.find((x) => !x.ok);
      if (failed) toast('critical', `${failed.name}: ${failed.error}`);
      else {
        const verb = action === 'allow' ? 'freigegeben' : action === 'block' ? 'blockiert' : 'Regel entfernt';
        toast('good', `${domain} ${verb}${r.synced ? ' · Sync gestartet' : r.syncError ? ` · Sync fehlgeschlagen: ${r.syncError}` : ''}`);
      }
      setCheck(await getJson<CheckHost>(`api/check-host?name=${encodeURIComponent(domain)}`));
    } catch (err) {
      toast('critical', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!entry) return null;
  const rows: Array<[string, React.ReactNode]> = [
    ['Zeit', new Date(entry.ts).toLocaleString('de-DE')],
    ['Server', serverName(entry.server)],
    ['Client', entry.clientName ? `${entry.clientName} (${entry.client})` : entry.client],
    ['Typ', entry.qtype],
    ['Status', <Badge key="s" tone={toneOf(entry.reason)}>{reasonLabel(entry.reason)}</Badge>],
    ['Antwortcode', entry.rcode || '–'],
    ['Verarbeitung', fmtMs(entry.elapsedMs)],
    ['Beantwortet von', entry.cached ? 'DNS-Cache' : entry.upstream || '–'],
    ['Protokoll', PROTOS[entry.proto] ?? entry.proto],
    ['DNSSEC', entry.dnssec ? 'validiert' : 'nein'],
  ];
  if (entry.service) rows.push(['Blockierter Dienst', entry.service]);

  return (
    <Drawer open onClose={onClose} title={entry.domain} subtitle={`${entry.qtype} · ${serverName(entry.server)}`}>
      <div className="space-y-6 p-5">
        <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>

        {entry.rules.length > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Greifende Regel</h4>
            {entry.rules.map((r) => (
              <div key={r.text} className="rounded-xl border border-line bg-white/[0.03] px-3 py-2">
                <code className="text-[12px] break-all text-ink">{r.text}</code>
                <div className="mt-1 text-xs text-ink-3">{r.listName ?? `Liste #${r.listId}`}</div>
              </div>
            ))}
          </section>
        )}

        {entry.answers.length > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Antwort</h4>
            <ul className="space-y-1 text-[12px]">
              {entry.answers.map((a) => (
                <li key={a}>
                  <code className="break-all text-ink-2">{a}</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Aktueller Stand auf den Servern</h4>
          {!check ? (
            <Skeleton className="h-16" />
          ) : (
            <ul className="space-y-2">
              {check.results.map((r) => (
                <li key={r.server} className="flex items-start gap-2 text-[13px]">
                  {r.error ? (
                    <span className="text-critical">{serverName(r.server)}: {r.error}</span>
                  ) : (
                    <>
                      <span className="w-28 shrink-0 text-ink-3">{serverName(r.server)}</span>
                      <div className="min-w-0">
                        <Badge tone={toneOf(r.reason ?? '')}>{reasonLabel(r.reason ?? '')}</Badge>
                        {r.rules?.map((x) => (
                          <div key={x.text} className="mt-1 text-xs text-ink-3">
                            <code className="break-all">{x.text}</code> {x.listName && `· ${x.listName}`}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-line bg-white/[0.03] p-4">
          <h4 className="text-[13px] font-semibold">Eigene Regel für {domain}</h4>
          <p className="mt-1 text-xs text-ink-3">
            Wird auf dem Origin{originName ? ` (${originName})` : ''} gespeichert und per AdGuard Home Sync verteilt.
            {check?.userRule === 'allow' && ' Aktuell: freigegeben.'}
            {check?.userRule === 'block' && ' Aktuell: blockiert.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => act('allow')} loading={busy === 'allow'} disabled={!!busy || check?.userRule === 'allow'} icon={<ShieldCheck className="size-4" />}>
              Freigeben
            </Button>
            <Button onClick={() => act('block')} loading={busy === 'block'} disabled={!!busy || check?.userRule === 'block'} icon={<ShieldBan className="size-4" />}>
              Blockieren
            </Button>
            {check?.userRule && (
              <Button variant="ghost" onClick={() => act('remove')} loading={busy === 'remove'} disabled={!!busy} icon={<Undo2 className="size-4" />}>
                Regel entfernen
              </Button>
            )}
            {check && !check.userRule && <span className="flex items-center gap-1 text-xs text-ink-3"><CheckCircle2 className="size-3.5" /> keine eigene Regel</span>}
          </div>
        </section>
      </div>
    </Drawer>
  );
}
