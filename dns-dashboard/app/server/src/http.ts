export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function basicAuth(username?: string, password?: string): Record<string, string> {
  if (!username) return {};
  return { Authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}` };
}

/** fetch with timeout; parses JSON when the response is JSON, otherwise returns the text. */
export async function request<T>(
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? 8000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(res.status, `${res.status} ${res.statusText}${text ? `: ${text.trim().slice(0, 200)}` : ''}`);
  }
  if ((res.headers.get('content-type') ?? '').includes('json') && text) return JSON.parse(text) as T;
  return text as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return 'Timeout';
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code) return `${err.message} (${cause.code})`;
    return err.message;
  }
  return String(err);
}
