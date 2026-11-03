import { Resolver, lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { errorMessage } from '../http.ts';

export interface DnsProbeResult {
  ok: boolean;
  ms?: number;
  error?: string;
  at: number;
}

/** Resolves `domain` directly against the server on port 53 – independent of the web API. */
export async function probeDns(address: string, domain: string, timeoutMs = 2000): Promise<DnsProbeResult> {
  const at = Date.now();
  try {
    const [host, port] = splitHostPort(address);
    const ip = isIP(host) ? host : (await lookup(host)).address;
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
    resolver.setServers([port ? (isIP(ip) === 6 ? `[${ip}]:${port}` : `${ip}:${port}`) : ip]);
    const start = performance.now();
    await resolver.resolve4(domain);
    return { ok: true, ms: Math.round((performance.now() - start) * 10) / 10, at };
  } catch (err) {
    return { ok: false, error: errorMessage(err), at };
  }
}

function splitHostPort(address: string): [string, string | undefined] {
  const v6 = address.match(/^\[(.+)\](?::(\d+))?$/);
  if (v6) return [v6[1], v6[2]];
  if (isIP(address) === 6) return [address, undefined];
  const [host, port] = address.split(':');
  return [host, port];
}
