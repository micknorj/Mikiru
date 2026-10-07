import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedText } from '../src/shared/http.ts';
import { Api } from '../src/client/api.ts';
import { GroqProvider } from '../backend/providers/groq.ts';
import { modelConfig } from '../backend/config.ts';
import { request } from './fixtures.ts';

test('abort cancels a stalled body read and never returns partial content', async () => {
  const owner = new AbortController(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"unfinished":')); }, cancel() { cancelled = true; } });
  const reading = readBoundedText(new Response(body), 1024, owner.signal);
  owner.abort(); await assert.rejects(reading, { name: 'AbortError' }); assert.equal(cancelled, true);
});

test('API timeout also covers a response whose headers arrived but body stalled', async () => {
  let cancelled = false;
  const api = new Api(new URL('http://127.0.0.1/'), async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })), 10);
  // An active timer keeps Node alive while AbortSignal.timeout's unref'ed timer fires.
  const deadline = setTimeout(() => {}, 1000);
  try { await assert.rejects(api.chat(request(), new AbortController().signal), /TIMEOUT/); assert.equal(cancelled, true); }
  finally { clearTimeout(deadline); }
});

test('failed stream cleanup cannot mask size limits or provider rate limits', async () => {
  const badCleanup = () => new ReadableStream({ cancel() { throw new Error('PRIVATE_CLEANUP_FAILURE'); } });
  await assert.rejects(readBoundedText(new Response(badCleanup(), { headers: { 'Content-Length': '4096' } }), 10), /BODY_LIMIT/);
  const provider = new GroqProvider(async () => 'test-key', modelConfig({}), async () => new Response(badCleanup(), { status: 429 }));
  await assert.rejects(provider.complete({ kind: 'turn', schema: {}, messages: [], signal: new AbortController().signal }), /RATE_LIMITED/);
});
