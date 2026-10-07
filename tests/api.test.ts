import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api, ApiFailure, apiBase } from '../src/client/api.ts';
import { request, response } from './fixtures.ts';
import { LIMITS } from '../src/shared/config.ts';

const base = new URL('http://127.0.0.1:8787/');
const signal = () => new AbortController().signal;

test('429 headers are enough even when the error body stalls or fails cleanup', async () => {
  let cancelled = false;
  const api = new Api(base, async () => new Response(new ReadableStream({ cancel() { cancelled = true; throw new Error('PRIVATE_CLEANUP_ERROR'); } }), { status: 429 }), 20);
  const keepAlive = setTimeout(() => {}, 500);
  try {
    await assert.rejects(api.chat(request(), signal()), (e: unknown) => e instanceof ApiFailure && e.code === 'RATE_LIMITED');
    assert.equal(cancelled, true);
  } finally { clearTimeout(keepAlive); }
});
test('API preserves rate-limit/service errors even when an intermediary returns HTML or an empty body', async () => {
  for (const [status, body, code] of [[429, '<html>slow down</html>', 'RATE_LIMITED'], [503, '', 'MODEL_UNAVAILABLE'], [429, '{"unexpected":true}', 'RATE_LIMITED']] as const) {
    const api = new Api(base, async () => new Response(body, { status }));
    await assert.rejects(api.chat(request(), signal()), (e: unknown) => e instanceof ApiFailure && e.code === code);
  }
});
test('API rejects malformed, oversized and schema-invalid successful responses', async () => {
  for (const body of ['not JSON', '{}', JSON.stringify({ ...response(request()), unexpected: true }), 'x'.repeat(LIMITS.BODY_BYTES + 1)]) {
    await assert.rejects(new Api(base, async () => new Response(body)).chat(request(), signal()), /MODEL_INVALID_OUTPUT/);
  }
  await assert.rejects(new Api(base, async () => new Response(new Uint8Array([255]))).chat(request(), signal()), /MODEL_INVALID_OUTPUT/);
});
test('API distinguishes network failure, timeout and owner cancellation', async () => {
  await assert.rejects(new Api(base, async () => { throw new TypeError('private network details'); }).chat(request(), signal()), /NETWORK_ERROR/);
  const waiting: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    const abort = init!.signal!;
    abort.addEventListener('abort', () => reject(abort.reason), { once: true });
  });
  // Keep Node alive while its intentionally unref'ed timeout signal runs.
  const keepAlive = setTimeout(() => {}, 500);
  try { await assert.rejects(new Api(base, waiting, 20).chat(request(), signal()), /TIMEOUT/); }
  finally { clearTimeout(keepAlive); }
  const owner = new AbortController();
  const attempt = new Api(base, waiting).chat(request(), owner.signal);
  owner.abort();
  await assert.rejects(attempt, (e: unknown) => e instanceof DOMException && e.name === 'AbortError');
});
test('API uses only the configured ingress, no browser credentials, and validates a response before accepting it', async () => {
  const r = request();
  const api = new Api(base, async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:8787/api/chat');
    assert.equal(init!.credentials, 'omit'); assert.equal(init!.cache, 'no-store');
    assert.deepEqual(JSON.parse(String(init!.body)), r);
    return new Response(JSON.stringify(response(r)));
  });
  assert.equal((await api.chat(r, signal())).baseRevision, r.baseRevision);
  for (const value of ['http://external.example/', 'https://user:secret@example.com/', 'https://example.com/?key=secret', 'https://example.com/#secret']) assert.throws(() => apiBase(value));
  assert.equal(apiBase('https://example.com/mikiru')!.pathname, '/mikiru/');
});
