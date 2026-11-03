import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.ts';

const NUMERIC_VARS = [
  'POLL_INTERVAL',
  'QUERYLOG_POLL_INTERVAL',
  'HISTORY_RAW_DAYS',
  'HISTORY_HOURLY_DAYS',
  'DNS_PROBE_INTERVAL',
  'PORT',
] as const;

const MISSING_OPTIONS = join(tmpdir(), `dns-dashboard-no-options-${process.pid}`, 'options.json');

/** Runs fn with an isolated environment: no options.json, one server, only the given numeric vars set. */
function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const saved = { ...process.env };
  try {
    for (const name of [...NUMERIC_VARS, 'DATA_DIR', 'INGRESS_ONLY', 'DNS2_URL', 'DNS3_URL', 'DNS4_URL', 'SYNC_URL']) {
      delete process.env[name];
    }
    process.env.OPTIONS_PATH = MISSING_OPTIONS;
    process.env.DNS1_URL = 'http://dns1.test';
    Object.assign(process.env, vars);
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}

/** Asserts that loadConfig() throws an Error mentioning both the variable name and the offending value. */
function assertRejects(name: string, value: string): void {
  withEnv({ [name]: value }, () => {
    assert.throws(
      () => loadConfig(),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'expected an Error instance');
        assert.ok(err.message.includes(name), `message should name ${name}: ${err.message}`);
        assert.ok(err.message.includes(value), `message should contain value "${value}": ${err.message}`);
        return true;
      },
    );
  });
}

test('AC-1: POLL_INTERVAL=abc throws an Error naming the variable and the value', () => {
  assertRejects('POLL_INTERVAL', 'abc');
});

const AC2_CASES: Array<[string, string]> = [
  ['QUERYLOG_POLL_INTERVAL', 'x-qlog'],
  ['HISTORY_RAW_DAYS', 'x-raw'],
  ['HISTORY_HOURLY_DAYS', 'x-hourly'],
  ['DNS_PROBE_INTERVAL', 'x-probe'],
  ['PORT', 'x-port'],
];

for (const [name, value] of AC2_CASES) {
  test(`AC-2: ${name}=${value} throws an Error naming the variable and the value`, () => {
    assertRejects(name, value);
  });
}

test('AC-3: POLL_INTERVAL=Infinity throws because only finite numbers are valid', () => {
  withEnv({ POLL_INTERVAL: 'Infinity' }, () => {
    assert.throws(() => loadConfig(), Error);
  });
});

test('AC-4: valid POLL_INTERVAL=15 and PORT=9000 are used as numbers', () => {
  const cfg = withEnv({ POLL_INTERVAL: '15', PORT: '9000' }, () => loadConfig());
  assert.equal(cfg.pollInterval, 15);
  assert.equal(cfg.port, 9000);
});

const DEFAULTS = {
  pollInterval: 10,
  querylogPollInterval: 5,
  historyRawDays: 7,
  historyHourlyDays: 365,
  dnsProbeInterval: 60,
  port: 8099,
};

const pickNumeric = (cfg: ReturnType<typeof loadConfig>) => ({
  pollInterval: cfg.pollInterval,
  querylogPollInterval: cfg.querylogPollInterval,
  historyRawDays: cfg.historyRawDays,
  historyHourlyDays: cfg.historyHourlyDays,
  dnsProbeInterval: cfg.dnsProbeInterval,
  port: cfg.port,
});

test('AC-5: unset numeric variables fall back to the defaults', () => {
  const cfg = withEnv({}, () => loadConfig());
  assert.deepEqual(pickNumeric(cfg), DEFAULTS);
});

test('AC-5: empty numeric variables fall back to the defaults', () => {
  const empty = Object.fromEntries(NUMERIC_VARS.map((n) => [n, '']));
  const cfg = withEnv(empty, () => loadConfig());
  assert.deepEqual(pickNumeric(cfg), DEFAULTS);
});

test('AC-6: POLL_INTERVAL=1 is still clamped to the minimum of 3', () => {
  const cfg = withEnv({ POLL_INTERVAL: '1' }, () => loadConfig());
  assert.equal(cfg.pollInterval, 3);
});
