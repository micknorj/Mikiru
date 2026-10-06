import { Core } from './core.ts';
import { Failure } from './errors.ts';
import { REQUEST_TIMEOUT_MS } from './config.ts';
import { LIMITS } from '../src/shared/config.ts';
import { readBoundedText } from '../src/shared/http.ts';

// The same Fetch boundary runs in Workers and in the technical test adapter.
export function createHandler(core: Core, allowedOrigin: string) {
  const originUrl = new URL(allowedOrigin);
  if (originUrl.origin !== allowedOrigin || originUrl.username || originUrl.password) throw new Error('INVALID_ALLOWED_ORIGIN');
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
    const requestId = crypto.randomUUID();
    try {
      if (request.headers.get('origin') !== allowedOrigin) throw new Failure('INVALID_REQUEST', 403);
      headers.set('Access-Control-Allow-Origin', allowedOrigin);
      const { method } = request;
      const route = new URL(request.url).pathname;
      if (!['/api/chat', '/api/compact', '/api/art/mikiru'].includes(route)) throw new Failure('INVALID_REQUEST', 404);
      if (method === 'OPTIONS') {
        headers.set('Access-Control-Allow-Methods', route === '/api/art/mikiru' ? 'GET, HEAD, OPTIONS' : 'POST, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'content-type, if-none-match');
        return new Response(null, { status: 204, headers });
      }
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      if (route === '/api/art/mikiru') {
        if (!['GET', 'HEAD'].includes(method)) throw new Failure('INVALID_REQUEST', 405);
        const art = await core.content.artwork(signal);
        if (!art) throw new Failure('INVALID_REQUEST', 404);
        headers.set('Content-Type', 'image/webp');
        headers.set('Cache-Control', 'private, max-age=3600');
        headers.set('Access-Control-Expose-Headers', 'ETag');
        const etag = art.headers.get('etag');
        if (etag) headers.set('ETag', etag);
        const unchanged = etag && request.headers.get('if-none-match')?.split(',').some(t => t.trim().replace(/^W\//, '') === etag);
        if (unchanged || method === 'HEAD') {
          await art.body?.cancel();
          return new Response(null, { status: unchanged ? 304 : 200, headers });
        }
        return new Response(art.body, { status: 200, headers });
      }
      if (method !== 'POST') throw new Failure('INVALID_REQUEST', 405);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new Failure('INVALID_REQUEST', 415);
      const length = request.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > LIMITS.BODY_BYTES)) throw new Failure('INVALID_REQUEST', 413);
      let data: unknown;
      try { data = JSON.parse(await readBoundedText(request, LIMITS.BODY_BYTES)); }
      catch (error) { throw new Failure('INVALID_REQUEST', error instanceof Error && error.message === 'BODY_LIMIT' ? 413 : 400); }
      signal.throwIfAborted();
      const response = route === '/api/chat' ? await core.chat(data, signal) : await core.compact(data, signal);
      return Response.json(response, { headers });
    } catch (error) {
      const known = error instanceof Failure ? error : new Failure('MODEL_UNAVAILABLE', 503);
      return Response.json({ error: { code: known.code, requestId } }, { status: known.status, headers });
    }
  };
}
