import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgFilterStatus } from '../src/adguard/types.ts';
import { computeAlerts, isStale } from '../src/alerts.ts';
import { computeDrift } from '../src/drift.ts';
import type { ServerState } from '../src/poller.ts';

const filtering = (rules: string[], enabled = true): AgFilterStatus => ({
  enabled: true,
  interval: 24,
  filters: [{ id: 1, name: 'A', url: 'https://a', enabled, rules_count: 1 }],
  whitelist_filters: [],
  user_rules: rules,
});

const server = (id: string, over: Partial<ServerState>): ServerState =>
  ({ cfg: { id, name: id.toUpperCase(), url: `http://${id}`, color: '#fff' }, online: true, ...over }) as ServerState;

test('identical configuration reports no drift', () => {
  const r = computeDrift([server('dns1', { filtering: filtering(['||x^']) }), server('dns2', { filtering: filtering(['||x^']) })]);
  assert.equal(r.areas.find((a) => a.key === 'user_rules')?.status, 'equal');
  assert.equal(r.areas.find((a) => a.key === 'rewrites')?.status, 'unknown');
  assert.equal(r.differences, 0);
});

test('missing rules and changed settings are reported per server', () => {
  const r = computeDrift([
    server('dns1', { filtering: filtering(['||x^', '||y^']) }),
    server('dns2', { filtering: filtering(['||x^'], false) }),
  ]);
  const rules = r.areas.find((a) => a.key === 'user_rules')!;
  assert.equal(rules.status, 'differs');
  assert.deepEqual(rules.onlyIn, { dns1: ['||y^'] });
  const lists = r.areas.find((a) => a.key === 'filters')!;
  assert.deepEqual(lists.changed, ['https://a']);
  assert.equal(r.differences, 2);
});

test('stale filter lists respect the update interval', () => {
  const now = Date.parse('2026-01-10T00:00:00Z');
  assert.equal(isStale('2026-01-09T00:00:00Z', 24, now), false);
  assert.equal(isStale('2026-01-07T00:00:00Z', 24, now), true);
  assert.equal(isStale('2026-01-01T00:00:00Z', 0, now), false);
});

test('alerts flag offline servers before drift', () => {
  const alerts = computeAlerts(
    [server('dns1', { online: false, error: 'timeout' }), server('dns2', {})],
    { configured: false, reachable: false },
    { checkedAt: 0, differences: 1, areas: [{ key: 'clients', status: 'differs', onlyIn: {}, changed: ['x'] }] },
  );
  assert.deepEqual(
    alerts.map((a) => [a.level, a.id]),
    [
      ['critical', 'dns1-api'],
      ['warning', 'drift'],
    ],
  );
});
