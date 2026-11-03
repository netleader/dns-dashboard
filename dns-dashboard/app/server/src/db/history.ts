import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgStats } from '../adguard/types.ts';
import { seriesTimes } from '../aggregate.ts';
import type { MetaStore } from '../poller.ts';
import type { LogEntry } from '../querylog.ts';

export const HOUR_MS = 3600_000;
const US_PER_HOUR = 3_600_000_000;

/**
 * history.db  – hourly counters + rollups (small, kept for a year, included in HA backups)
 * raw.db      – individual queries (large, kept for a few days, excluded from backups)
 */
export class History implements MetaStore {
  readonly db: DatabaseSync;
  readonly rawDays: number;
  readonly hourlyDays: number;

  constructor(dataDir: string, rawDays: number, hourlyDays: number) {
    this.rawDays = rawDays;
    this.hourlyDays = hourlyDays;
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'history.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      ATTACH DATABASE '${join(dataDir, 'raw.db').replaceAll("'", "''")}' AS raw;
      PRAGMA raw.journal_mode = WAL;
      PRAGMA raw.auto_vacuum = INCREMENTAL;

      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS hourly_stats (
        server TEXT NOT NULL, hour INTEGER NOT NULL,
        queries INTEGER NOT NULL, blocked INTEGER NOT NULL,
        safebrowsing INTEGER NOT NULL, parental INTEGER NOT NULL,
        PRIMARY KEY (server, hour)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS rollup (
        server TEXT NOT NULL, hour INTEGER NOT NULL, dim TEXT NOT NULL, key TEXT NOT NULL,
        count INTEGER NOT NULL, blocked INTEGER NOT NULL, elapsed_sum REAL NOT NULL,
        PRIMARY KEY (server, hour, dim, key)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS rollup_dim_hour ON rollup (dim, hour);
      CREATE TABLE IF NOT EXISTS client_names (client TEXT PRIMARY KEY, name TEXT NOT NULL, seen INTEGER NOT NULL);

      CREATE TABLE IF NOT EXISTS raw.queries (
        server TEXT NOT NULL, ts INTEGER NOT NULL,
        client TEXT NOT NULL, domain TEXT NOT NULL, qtype TEXT NOT NULL,
        reason TEXT NOT NULL, blocked INTEGER NOT NULL, rcode TEXT NOT NULL,
        cached INTEGER NOT NULL, dnssec INTEGER NOT NULL, upstream TEXT NOT NULL,
        elapsed_ms REAL NOT NULL, proto TEXT NOT NULL,
        filter_list_id INTEGER, service TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS raw.queries_uniq ON queries (server, ts, client, domain, qtype);
      CREATE INDEX IF NOT EXISTS raw.queries_ts ON queries (ts);
      CREATE INDEX IF NOT EXISTS raw.queries_client ON queries (client, ts);
    `);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Stores AdGuard's own hourly counters; the current hour is overwritten as it grows. */
  recordStats(server: string, stats: AgStats, now = Date.now()) {
    if (stats.time_units !== 'hours' || !stats.dns_queries?.length) return;
    const times = seriesTimes(stats.dns_queries.length, 'hours', now);
    const stmt = this.db.prepare(`
      INSERT INTO hourly_stats (server, hour, queries, blocked, safebrowsing, parental) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(server, hour) DO UPDATE SET queries = excluded.queries, blocked = excluded.blocked,
        safebrowsing = excluded.safebrowsing, parental = excluded.parental`);
    this.transaction(() => {
      times.forEach((hour, i) => {
        stmt.run(
          server,
          hour,
          stats.dns_queries[i] ?? 0,
          stats.blocked_filtering?.[i] ?? 0,
          stats.replaced_safebrowsing?.[i] ?? 0,
          stats.replaced_parental?.[i] ?? 0,
        );
      });
    });
  }

  /** Inserts query log entries; returns how many were new. Marks their hours for re-rollup. */
  insertQueries(entries: LogEntry[]): number {
    if (!entries.length) return 0;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO raw.queries
        (server, ts, client, domain, qtype, reason, blocked, rcode, cached, dnssec, upstream, elapsed_ms, proto, filter_list_id, service)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const names = this.db.prepare(`
      INSERT INTO client_names (client, name, seen) VALUES (?, ?, ?)
      ON CONFLICT(client) DO UPDATE SET name = excluded.name, seen = excluded.seen WHERE excluded.seen >= seen`);
    let inserted = 0;
    let minTs = Infinity;
    this.transaction(() => {
      for (const e of entries) {
        const r = stmt.run(
          e.server,
          e.tsUs,
          e.client,
          e.domain,
          e.qtype,
          e.reason,
          e.blocked ? 1 : 0,
          e.rcode,
          e.cached ? 1 : 0,
          e.dnssec ? 1 : 0,
          e.cached ? '' : e.upstream,
          e.elapsedMs,
          e.proto,
          e.rules[0]?.listId ?? null,
          e.service ?? '',
        );
        if (Number(r.changes) > 0) {
          inserted++;
          minTs = Math.min(minTs, e.tsUs);
        }
        if (e.clientName) names.run(e.client, e.clientName, e.ts);
      }
    });
    if (inserted) {
      const dirty = Number(this.getMeta('rollup_dirty_from') ?? Infinity);
      if (minTs < dirty) this.setMeta('rollup_dirty_from', String(minTs));
    }
    return inserted;
  }

  /** Re-aggregates every hour touched since the last run into the rollup table. */
  rollup() {
    const dirty = this.getMeta('rollup_dirty_from');
    if (!dirty) return;
    const fromUs = Math.floor(Number(dirty) / US_PER_HOUR) * US_PER_HOUR;
    const fromMs = fromUs / 1000;
    const hourExpr = `(ts / ${US_PER_HOUR}) * ${HOUR_MS}`;
    const dims: Array<{ dim: string; key: string; where?: string; top?: number }> = [
      { dim: 'total', key: "''" },
      { dim: 'qtype', key: 'qtype' },
      { dim: 'rcode', key: 'rcode' },
      { dim: 'reason', key: 'reason' },
      { dim: 'proto', key: 'proto' },
      { dim: 'cached', key: 'CAST(cached AS TEXT)' },
      { dim: 'dnssec', key: 'CAST(dnssec AS TEXT)' },
      { dim: 'upstream', key: 'upstream', where: "upstream != ''" },
      { dim: 'filter_list', key: 'CAST(filter_list_id AS TEXT)', where: 'filter_list_id IS NOT NULL' },
      { dim: 'service', key: 'service', where: "service != ''" },
      { dim: 'client', key: 'client', top: 200 },
      { dim: 'domain', key: 'domain', top: 50 },
      { dim: 'blocked_domain', key: 'domain', where: 'blocked = 1', top: 50 },
    ];
    this.transaction(() => {
      this.db.prepare('DELETE FROM rollup WHERE hour >= ?').run(fromMs);
      for (const d of dims) {
        const where = `ts >= ${fromUs}${d.where ? ` AND ${d.where}` : ''}`;
        const select = `SELECT server, ${hourExpr} AS hour, '${d.dim}' AS dim, ${d.key} AS k,
            COUNT(*) AS c, SUM(blocked) AS b, SUM(elapsed_ms) AS e`;
        const sql = d.top
          ? `INSERT INTO rollup (server, hour, dim, key, count, blocked, elapsed_sum)
             SELECT server, hour, dim, k, c, b, e FROM (
               ${select}, ROW_NUMBER() OVER (PARTITION BY server, ${hourExpr} ORDER BY COUNT(*) DESC) AS rn
               FROM raw.queries WHERE ${where} GROUP BY server, hour, k
             ) WHERE rn <= ${d.top}`
          : `INSERT INTO rollup (server, hour, dim, key, count, blocked, elapsed_sum)
             ${select} FROM raw.queries WHERE ${where} GROUP BY server, hour, k`;
        this.db.exec(sql);
      }
      this.db.prepare('DELETE FROM meta WHERE key = ?').run('rollup_dirty_from');
    });
  }

  /** Drops data past its retention and gives the space back to the file system. */
  cleanup(now = Date.now()) {
    const rawCutoffUs = (now - this.rawDays * 24 * HOUR_MS) * 1000;
    const hourlyCutoff = now - this.hourlyDays * 24 * HOUR_MS;
    this.db.prepare('DELETE FROM raw.queries WHERE ts < ?').run(rawCutoffUs);
    this.db.prepare('DELETE FROM rollup WHERE hour < ?').run(hourlyCutoff);
    this.db.prepare('DELETE FROM hourly_stats WHERE hour < ?').run(hourlyCutoff);
    this.db.prepare('DELETE FROM client_names WHERE seen < ?').run(hourlyCutoff);
    this.db.exec('PRAGMA raw.incremental_vacuum; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA raw.wal_checkpoint(TRUNCATE);');
  }

  close() {
    this.db.close();
  }
}
