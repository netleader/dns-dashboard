import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgStats } from '../src/adguard/types.ts';
import { combineSeries, counters, mergeTop, mergeUpstreams, seriesTimes } from '../src/aggregate.ts';

const stats = (over: Partial<AgStats>): AgStats => ({
  time_units: 'hours',
  num_dns_queries: 0,
  num_blocked_filtering: 0,
  num_replaced_safebrowsing: 0,
  num_replaced_safesearch: 0,
  num_replaced_parental: 0,
  avg_processing_time: 0,
  top_queried_domains: [],
  top_clients: [],
  top_blocked_domains: [],
  dns_queries: [],
  blocked_filtering: [],
  replaced_safebrowsing: [],
  replaced_parental: [],
  ...over,
});

test('mergeTop sums by key and keeps the per-server split', () => {
  const merged = mergeTop([
    { id: 'a', list: [{ 'x.com': 5 }, { 'y.com': 3 }] },
    { id: 'b', list: [{ 'y.com': 4 }, { 'z.com': 1 }] },
  ]);
  assert.deepEqual(merged, [
    { name: 'y.com', count: 7, perServer: { a: 3, b: 4 } },
    { name: 'x.com', count: 5, perServer: { a: 5 } },
    { name: 'z.com', count: 1, perServer: { b: 1 } },
  ]);
});

test('counters weight the average processing time by query volume', () => {
  const c = counters([
    stats({ num_dns_queries: 900, num_blocked_filtering: 90, avg_processing_time: 0.01 }),
    stats({ num_dns_queries: 100, num_blocked_filtering: 10, avg_processing_time: 0.05 }),
  ]);
  assert.equal(c.queries, 1000);
  assert.equal(c.blockedPct, 10);
  assert.equal(c.avgMs, 14);
});

test('mergeUpstreams weights upstream latency by responses', () => {
  const u = mergeUpstreams([
    { id: 'a', stats: stats({ top_upstreams_responses: [{ q9: 300 }], top_upstreams_avg_time: [{ q9: 0.01 }] }) },
    { id: 'b', stats: stats({ top_upstreams_responses: [{ q9: 100 }], top_upstreams_avg_time: [{ q9: 0.05 }] }) },
  ]);
  assert.deepEqual(u, [{ name: 'q9', responses: 400, avgMs: 20 }]);
});

test('combineSeries right-aligns series of different length', () => {
  const now = Date.UTC(2026, 0, 1, 12, 30);
  const s = combineSeries(
    [
      { id: 'a', stats: stats({ dns_queries: [1, 2, 3], blocked_filtering: [0, 1, 1] }) },
      { id: 'b', stats: stats({ dns_queries: [5], blocked_filtering: [2] }) },
    ],
    now,
  );
  assert.deepEqual(s.queries, { a: [1, 2, 3], b: [0, 0, 5] });
  assert.deepEqual(s.blocked.b, [0, 0, 2]);
  assert.equal(s.t.at(-1), Date.UTC(2026, 0, 1, 12));
  assert.deepEqual(seriesTimes(2, 'hours', now), [Date.UTC(2026, 0, 1, 11), Date.UTC(2026, 0, 1, 12)]);
});
