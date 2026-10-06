import { createServer } from 'node:http';
import { LIMITS } from '../src/shared/config.ts';
import { createHandler } from './transport.ts';
import type { Core } from './core.ts';
import type { LocalMetrics } from './local-metrics.ts';

export function createLocalServer(core: Core, allowedOrigin: string, metrics?: LocalMetrics) {
  const handle = createHandler(core, allowedOrigin);
  const server = createServer(async (req, res) => {
    const client = new AbortController();
    req.once('aborted', () => client.abort());
    res.once('close', () => { if (!res.writableEnded) client.abort(); });
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const chunk of req) {
        size = Math.min(LIMITS.BODY_BYTES + 1, size + chunk.length);
        if (size <= LIMITS.BODY_BYTES) chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      if (size > LIMITS.BODY_BYTES) headers.set('content-length', String(size));
      const rawPath = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const method = req.method ?? 'GET';
      const action = () => handle(new Request(`http://127.0.0.1${rawPath}`, { method, headers, signal: client.signal,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: size > LIMITS.BODY_BYTES ? '' : Buffer.concat(chunks) }) }));
      const response = await (metrics && req.method === 'POST' ? metrics.request(rawPath, action) : action());
      if (res.destroyed) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (res.destroyed) return;
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end('{"error":{"code":"INVALID_REQUEST"}}');
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
