import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
};

/** Serves the built frontend from memory – it is a handful of files, so no static-file plugin needed. */
export function registerStatic(app: FastifyInstance, dir: string) {
  const files = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.set(`/${relative(dir, p).split('\\').join('/')}`, readFileSync(p));
    }
  };
  if (existsSync(dir)) walk(dir);
  else console.warn(`frontend not built (${dir} missing) – only the API is served`);

  app.get('/*', (req, reply) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const key = files.has(path) ? path : '/index.html';
    const body = files.get(key);
    if (!body) return reply.code(404).send('Not found');
    reply
      .header('Content-Type', TYPES[extname(key)] ?? 'application/octet-stream')
      .header('Cache-Control', key.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    return reply.send(body);
  });
}
