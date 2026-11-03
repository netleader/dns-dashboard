// Simulates two AdGuard Home instances (+ a tiny UDP DNS responder each) and AdGuard Home Sync
// so the dashboard can be developed without the real servers. Run: npm run mock
import { createSocket } from 'node:dgram';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';

const HOUR = 3600_000;

const CLIENTS = [
  ['192.168.10.20', 'MacBook-Pro'],
  ['192.168.10.21', 'iPhone'],
  ['192.168.10.22', 'iPad'],
  ['192.168.10.23', 'Apple-TV'],
  ['192.168.10.24', 'HomePod-Kitchen'],
  ['192.168.10.30', 'Sonos-Living-Room'],
  ['192.168.10.31', 'Fire-TV'],
  ['192.168.10.40', 'Shelly-Plug-1'],
  ['192.168.10.41', 'Shelly-Plug-2'],
  ['192.168.10.50', 'Printer'],
  ['192.168.10.60', 'NAS'],
  ['192.168.10.61', 'Windows-PC'],
  ['192.168.10.70', 'Pixel'],
  ['192.168.10.10', 'homeassistant'],
] as const;

const DOMAINS: Array<[string, number]> = [
  ['www.google.com', 30], ['gateway.icloud.com', 25], ['api.apple-cloudkit.com', 18], ['time.apple.com', 10],
  ['www.youtube.com', 14], ['i.ytimg.com', 12], ['spotify.com', 8], ['api.spotify.com', 9], ['github.com', 7],
  ['api.github.com', 6], ['www.netflix.com', 6], ['nflxvideo.net', 9], ['sonos.com', 5], ['shelly.cloud', 4],
  ['home-assistant.io', 4], ['cloudflare-dns.com', 3], ['www.wikipedia.org', 3], ['heise.de', 4], ['tagesschau.de', 4],
  ['ntp.org', 3], ['amazon.de', 5], ['device-metrics-us.amazon.com', 4], ['mqtt.eclipseprojects.io', 2],
];
const BLOCKED: Array<[string, number]> = [
  ['doubleclick.net', 12], ['googleads.g.doubleclick.net', 9], ['app-measurement.com', 8], ['graph.facebook.com', 5],
  ['browser.events.data.microsoft.com', 6], ['ads.youtube.com', 4], ['metrics.icloud.com', 7], ['sentry.io', 3],
  ['analytics.tiktok.com', 2], ['telemetry.sonos.com', 4], ['device-metrics-us-2.amazon.com', 3],
];
const UPSTREAMS = ['https://dns.cloudflare.com/dns-query', 'https://dns.quad9.net/dns-query', 'tls://dns.google'];
const QTYPES: Array<[string, number]> = [['A', 50], ['AAAA', 30], ['HTTPS', 14], ['PTR', 4], ['TXT', 1], ['SRV', 1]];

const pick = <T>(items: Array<[T, number]>): T => {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[0][0];
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Entry {
  ts: number;
  time: string;
  client: string;
  domain: string;
  qtype: string;
  reason: string;
  cached: boolean;
  upstream: string;
  elapsed: number;
  listId?: number;
}

const iso = (ts: number) => {
  const s = new Date(ts).toISOString();
  return `${s.slice(0, 23)}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}Z`;
};

const FILTERS = [
  { id: 1, name: 'AdGuard DNS filter', url: 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt', rules_count: 61234 },
  { id: 2, name: 'OISD Big', url: 'https://big.oisd.nl', rules_count: 251190 },
  { id: 3, name: 'HaGeZi Pro', url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt', rules_count: 189022 },
];

class MockAdGuard {
  entries: Entry[] = [];
  protectionEnabled = true;
  pausedUntil = 0;
  userRules = ['||tracker.example^', '@@||s.youtube.com^$important', '! Eigene Regeln'];
  readonly started = Date.now() - rand(2, 9) * 24 * HOUR;

  readonly share: number;
  readonly version: string;

  constructor(share: number, version: string) {
    this.share = share;
    this.version = version;
    const now = Date.now();
    for (let t = now - 24 * HOUR; t < now; t += 1000) this.generate(t, 1);
    setInterval(() => this.generate(Date.now(), 1), 1000);
  }

  /** Queries per second follow a day/night curve. */
  generate(ts: number, seconds: number) {
    const hour = new Date(ts).getHours();
    const rate = this.share * (0.15 + 0.85 * Math.max(0, Math.sin(((hour - 5) / 24) * Math.PI * 2 - Math.PI / 4) + 0.6));
    const n = Math.floor(rate * seconds + Math.random());
    const batch: Entry[] = [];
    for (let i = 0; i < n; i++) {
      const t = ts + Math.random() * 1000 * seconds;
      const paused = !this.protectionEnabled || this.pausedUntil > t;
      const isBlocked = !paused && Math.random() < 0.17;
      const cached = !isBlocked && Math.random() < 0.55;
      const special = Math.random();
      const reason = isBlocked
        ? special < 0.03 ? 'FilteredSafeBrowsing' : special < 0.06 ? 'FilteredBlockedService' : 'FilteredBlackList'
        : special < 0.02 ? 'NotFilteredAllowList' : special < 0.03 ? 'Rewrite' : 'NotFilteredNotFound';
      batch.push({
        ts: t,
        time: iso(t),
        client: CLIENTS[Math.floor(Math.random() ** 1.6 * CLIENTS.length)][0],
        domain: isBlocked ? pick(BLOCKED) : pick(DOMAINS),
        qtype: pick(QTYPES),
        reason,
        cached,
        upstream: isBlocked || cached ? '' : UPSTREAMS[Math.floor(Math.random() ** 2 * UPSTREAMS.length)],
        elapsed: isBlocked || cached ? rand(0.05, 0.4) : rand(8, 45),
        listId: reason === 'FilteredBlackList' ? 1 + Math.floor(Math.random() * 3) : reason === 'NotFilteredAllowList' ? 0 : undefined,
      });
    }
    // Batches arrive in time order, so sorting the batch keeps the whole list sorted.
    this.entries.push(...batch.sort((a, b) => a.ts - b.ts));
    const cutoff = Date.now() - 24 * HOUR;
    if (this.entries.length && this.entries[0].ts < cutoff) this.entries = this.entries.filter((e) => e.ts >= cutoff);
  }

  stats() {
    const now = Date.now();
    const hourNow = Math.floor(now / HOUR) * HOUR;
    const buckets = Array.from({ length: 24 }, () => ({ q: 0, b: 0, sb: 0 }));
    const top = (f: (e: Entry) => string | undefined) => {
      const m = new Map<string, number>();
      for (const e of this.entries) {
        const k = f(e);
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([k, v]) => ({ [k]: v }));
    };
    let blocked = 0;
    let sb = 0;
    let elapsed = 0;
    for (const e of this.entries) {
      const i = 23 - Math.floor((hourNow - Math.floor(e.ts / HOUR) * HOUR) / HOUR);
      if (i < 0 || i > 23) continue;
      buckets[i].q++;
      elapsed += e.elapsed;
      if (e.reason === 'FilteredBlackList' || e.reason === 'FilteredBlockedService') {
        buckets[i].b++;
        blocked++;
      }
      if (e.reason === 'FilteredSafeBrowsing') {
        buckets[i].sb++;
        sb++;
      }
    }
    const upstreamCounts = top((e) => e.upstream || undefined);
    return {
      time_units: 'hours',
      num_dns_queries: this.entries.length,
      num_blocked_filtering: blocked,
      num_replaced_safebrowsing: sb,
      num_replaced_safesearch: 0,
      num_replaced_parental: 0,
      avg_processing_time: elapsed / Math.max(1, this.entries.length) / 1000,
      top_queried_domains: top((e) => e.domain),
      top_clients: top((e) => e.client),
      top_blocked_domains: top((e) => (e.reason.startsWith('Filtered') ? e.domain : undefined)),
      top_upstreams_responses: upstreamCounts,
      top_upstreams_avg_time: upstreamCounts.map((o) => {
        const k = Object.keys(o)[0];
        const xs = this.entries.filter((e) => e.upstream === k);
        return { [k]: xs.reduce((a, e) => a + e.elapsed, 0) / xs.length / 1000 };
      }),
      dns_queries: buckets.map((b) => b.q),
      blocked_filtering: buckets.map((b) => b.b),
      replaced_safebrowsing: buckets.map((b) => b.sb),
      replaced_parental: buckets.map(() => 0),
    };
  }

  querylog(q: URLSearchParams) {
    const limit = Number(q.get('limit') ?? 100);
    const older = q.get('older_than');
    const olderTs = older ? Date.parse(older) : Infinity;
    const search = q.get('search');
    const status = q.get('response_status');
    const out: Entry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.entries[i];
      if (e.ts >= olderTs) continue;
      if (search && !e.domain.includes(search) && !e.client.includes(search)) continue;
      if (status === 'blocked' && !e.reason.startsWith('Filtered')) continue;
      if (status === 'processed' && e.reason.startsWith('Filtered')) continue;
      if (status === 'whitelisted' && e.reason !== 'NotFilteredAllowList') continue;
      if (status === 'rewritten' && e.reason !== 'Rewrite') continue;
      if (status === 'blocked_safebrowsing' && e.reason !== 'FilteredSafeBrowsing') continue;
      out.push(e);
    }
    const names = new Map<string, string>(CLIENTS.map(([ip, n]) => [ip, n]));
    return {
      oldest: out.at(-1)?.time ?? '',
      data: out.map((e) => ({
        time: e.time,
        client: e.client,
        client_info: { name: names.get(e.client) ?? '', whois: {}, disallowed: false },
        client_proto: Math.random() < 0.1 ? 'doh' : '',
        question: { class: 'IN', name: e.domain, type: e.qtype },
        reason: e.reason,
        status: e.reason === 'FilteredBlackList' && e.qtype === 'HTTPS' ? 'NXDOMAIN' : 'NOERROR',
        cached: e.cached,
        upstream: e.upstream,
        elapsedMs: e.elapsed.toFixed(3),
        answer_dnssec: e.domain.endsWith('.de'),
        answer: e.reason.startsWith('Filtered') ? [{ type: e.qtype, value: '0.0.0.0', ttl: 10 }] : [{ type: e.qtype, value: '93.184.215.14', ttl: 300 }],
        rules: e.listId !== undefined ? [{ filter_list_id: e.listId, text: e.listId === 0 ? '@@||s.youtube.com^$important' : `||${e.domain}^` }] : [],
        service_name: e.reason === 'FilteredBlockedService' ? 'tiktok' : undefined,
      })),
    };
  }

  handle(req: IncomingMessage, url: URL, body: Record<string, unknown>) {
    const now = Date.now();
    if (this.pausedUntil && this.pausedUntil < now) {
      this.pausedUntil = 0;
      this.protectionEnabled = true;
    }
    const lastUpdated = new Date(now - rand(1, 5) * HOUR).toISOString();
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /control/status':
        return {
          dns_addresses: ['192.168.10.x'],
          dns_port: 53,
          http_port: 80,
          protection_enabled: this.protectionEnabled,
          protection_disabled_duration: this.pausedUntil ? this.pausedUntil - now : 0,
          running: true,
          version: this.version,
          language: 'de',
          start_time: this.started,
        };
      case 'GET /control/stats':
        return this.stats();
      case 'GET /control/querylog':
        return this.querylog(url.searchParams);
      case 'GET /control/filtering/status':
        return {
          enabled: true,
          interval: 24,
          filters: FILTERS.map((f) => ({ ...f, enabled: true, last_updated: lastUpdated })),
          whitelist_filters: [],
          user_rules: this.userRules,
        };
      case 'GET /control/clients':
        return {
          clients: [
            { name: 'Kids-iPad', ids: ['192.168.10.22'], tags: ['user_child'], use_global_settings: false, filtering_enabled: true, parental_enabled: true, safebrowsing_enabled: true },
            { name: 'Living-Room-TV', ids: ['192.168.10.23', '192.168.10.31'], tags: ['device_tv'], use_global_settings: true },
          ],
          auto_clients: CLIENTS.map(([ip, name]) => ({ ip, name, source: 'rDNS' })),
        };
      case 'GET /control/dns_info':
        return {
          upstream_dns: UPSTREAMS,
          bootstrap_dns: ['9.9.9.10', '149.112.112.10'],
          upstream_mode: 'load_balance',
          protection_enabled: this.protectionEnabled,
          blocking_mode: 'default',
          ratelimit: 20,
          cache_enabled: true,
          cache_size: 4194304,
          cache_optimistic: true,
          dnssec_enabled: true,
        };
      case 'POST /control/version.json':
        return { disabled: false, new_version: this.version === 'v0.107.65' ? 'v0.107.66' : '', can_autoupdate: true };
      case 'GET /control/safebrowsing/status':
        return { enabled: true };
      case 'GET /control/parental/status':
        return { enabled: false };
      case 'GET /control/safesearch/status':
        return { enabled: false };
      case 'GET /control/rewrite/list':
        return [{ domain: 'ha.home.arpa', answer: '192.168.10.10', enabled: true }, { domain: 'nas.home.arpa', answer: '192.168.10.60', enabled: true }];
      case 'GET /control/blocked_services/get':
        return { ids: ['tiktok'], schedule: { time_zone: 'Local' } };
      case 'GET /control/access/list':
        return { allowed_clients: [], disallowed_clients: [], blocked_hosts: ['version.bind', 'id.server', 'hostname.bind'] };
      case 'GET /control/filtering/check_host': {
        const name = url.searchParams.get('name') ?? '';
        const hit = BLOCKED.find(([d]) => name.endsWith(d));
        return hit ? { reason: 'FilteredBlackList', rules: [{ filter_list_id: 1, text: `||${hit[0]}^` }] } : { reason: 'NotFilteredNotFound', rules: [] };
      }
      case 'POST /control/protection':
        this.protectionEnabled = !!body.enabled;
        this.pausedUntil = !body.enabled && body.duration ? now + Number(body.duration) : 0;
        return 'OK';
      case 'POST /control/cache_clear':
      case 'POST /control/filtering/refresh':
        return 'OK';
      case 'POST /control/filtering/set_rules':
        this.userRules = (body.rules as string[]) ?? [];
        return 'OK';
      default:
        return undefined;
    }
  }
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
}

function send(res: ServerResponse, value: unknown) {
  if (value === undefined) {
    res.writeHead(404).end('not found');
  } else if (typeof value === 'string') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(value);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  }
}

function serve(mock: MockAdGuard, port: number) {
  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const body = await readBody(req);
    // Some latency like a real Pi.
    setTimeout(() => send(res, mock.handle(req, url, body)), rand(5, 40));
  }).listen(port);
}

/** Answers every A query with 93.184.215.14 after a few ms. */
function serveDns(port: number, delay: [number, number]) {
  const sock = createSocket('udp4');
  sock.on('message', (msg, rinfo) => {
    let off = 12;
    while (msg[off] !== 0) off += msg[off] + 1;
    const question = msg.subarray(12, off + 5);
    const header = Buffer.from([msg[0], msg[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]);
    const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 1, 0x2c, 0, 4, 93, 184, 215, 14]);
    setTimeout(() => sock.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address), rand(...delay));
  });
  sock.bind(port, '127.0.0.1');
}

const dns1 = new MockAdGuard(0.9, 'v0.107.66');
const dns2 = new MockAdGuard(0.5, 'v0.107.66');
serve(dns1, 3101);
serve(dns2, 3102);
serveDns(5301, [6, 18]);
serveDns(5302, [2, 6]);

let syncCount = 0;
let syncRunning = false;
const runSync = () => {
  syncRunning = true;
  setTimeout(() => {
    dns2.userRules = [...dns1.userRules];
    syncCount++;
    syncRunning = false;
  }, 1500);
};
setInterval(runSync, 5 * 60_000);
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  await readBody(req);
  if (req.method === 'POST' && url.pathname === '/api/v1/sync') {
    runSync();
    return send(res, 'OK');
  }
  if (url.pathname === '/api/v1/status') {
    return send(res, {
      syncRunning,
      origin: { host: '127.0.0.1:3101', url: 'http://127.0.0.1:3101', status: 'success', protection_enabled: dns1.protectionEnabled },
      replicas: [{ host: '127.0.0.1:3102', url: 'http://127.0.0.1:3102', status: 'success', protection_enabled: dns2.protectionEnabled }],
    });
  }
  if (url.pathname === '/metrics') {
    return send(res, `# TYPE adguard_home_sync_sync_count_total counter\nadguard_home_sync_sync_count_total{result="success"} ${syncCount}\n`);
  }
  send(res, undefined);
}).listen(3180);

console.log('Mock AdGuard Home: DNS1 http://127.0.0.1:3101 (dns :5301), DNS2 http://127.0.0.1:3102 (dns :5302), Sync http://127.0.0.1:3180');
