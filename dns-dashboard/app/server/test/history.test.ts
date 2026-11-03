import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { AgQueryLogItem } from '../src/adguard/types.ts';
import { HOUR_MS, History } from '../src/db/history.ts';
import { StatsQueries, buckets } from '../src/db/queries.ts';
import { normalizeItem, parseTimeUs } from '../src/querylog.ts';

const dir = mkdtempSync(join(tmpdir(), 'dns-dashboard-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const item = (time: string, domain: string, reason = 'NotFilteredNotFound', client = '10.0.0.1'): AgQueryLogItem => ({
  time,
  client,
  question: { name: domain, type: 'A' },
  reason,
  status: 'NOERROR',
  elapsedMs: '4.0',
  cached: reason === 'NotFilteredNotFound',
  rules: reason === 'FilteredBlackList' ? [{ filter_list_id: 7, text: `||${domain}^` }] : [],
});

test('parseTimeUs keeps microseconds and honours the offset', () => {
  assert.equal(parseTimeUs('2026-01-01T12:00:00.123456789+01:00'), Date.UTC(2026, 0, 1, 11) * 1000 + 123456);
  assert.equal(parseTimeUs('2026-01-01T12:00:00Z'), Date.UTC(2026, 0, 1, 12) * 1000);
});

test('ingest de-duplicates and rollups feed the statistics', () => {
  const h = new History(dir, 7, 365);
  const q = new StatsQueries(h);
  const hour = Date.UTC(2026, 0, 1, 10);
  const t = (min: number) => new Date(hour + min * 60_000).toISOString();
  const entries = [
    normalizeItem('dns1', item(t(1), 'a.com')),
    normalizeItem('dns1', item(t(2), 'ads.com', 'FilteredBlackList')),
    normalizeItem('dns2', item(t(3), 'a.com', 'NotFilteredNotFound', '10.0.0.2')),
  ];
  assert.equal(h.insertQueries(entries), 3);
  assert.equal(h.insertQueries(entries), 0, 'second insert is ignored');
  h.rollup();

  const w = { from: hour, to: hour + HOUR_MS };
  const totals = q.totals(w, ['dns1', 'dns2']);
  assert.equal(totals.queries, 3);
  assert.equal(totals.blocked, 1);
  assert.equal(totals.clients, 2);
  assert.equal(totals.cacheHitPct, 66.7);

  const bundle = q.bundle(w, {
    servers: ['dns1', 'dns2'],
    listNames: new Map([['dns1', new Map([[7, 'Liste Sieben']])]]),
    clientName: (k) => (k === '10.0.0.1' ? 'Laptop' : undefined),
  });
  assert.deepEqual(bundle.filterLists, [{ key: 'Liste Sieben', count: 1 }]);
  assert.equal(bundle.topDomains[0].key, 'a.com');
  assert.deepEqual(bundle.topDomains[0].perServer, { dns1: 1, dns2: 1 });
  assert.equal(bundle.topClients.find((c) => c.key === '10.0.0.1')?.label, 'Laptop');
  assert.deepEqual(bundle.series.queries, { dns1: [2], dns2: [1] });

  // AdGuard's own hourly counters take precedence over the query log.
  h.db.prepare('INSERT INTO hourly_stats VALUES (?, ?, ?, ?, 0, 0)').run('dns1', hour, 50, 5);
  assert.equal(q.totals(w, ['dns1', 'dns2']).queries, 51);
  h.close();
});

test('buckets switch to local days beyond a week', () => {
  const to = Date.UTC(2026, 0, 31);
  assert.equal(buckets({ from: to - 24 * HOUR_MS, to }).t.length, 24);
  const days = buckets({ from: to - 30 * 24 * HOUR_MS, to });
  assert.equal(days.unit, 'day');
  assert.ok(days.t.length >= 30 && days.t.length <= 31);
});
