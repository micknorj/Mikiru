import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Core } from '../backend/core.ts';
import { createHandler } from '../backend/transport.ts';
import { GroqProvider } from '../backend/providers/groq.ts';
import { modelConfig } from '../backend/config.ts';
import { validateRuntime, validateArtwork } from '../backend/private-content.ts';
import { request, zeroMood } from './fixtures.ts';
import type { CompletionInput } from '../backend/provider.ts';
import { readBoundedText } from '../src/shared/http.ts';
const proposal = { memoryOps: [], relationshipDelta: { familiarity: 2, trust: 2, closeness: 2, significance: 'routine' }, moodDelta: zeroMood };
const privateContent = { runtime: async () => 'PRIVATE_TEST_RUNTIME', artwork: async () => null };
function core(state: unknown = proposal, inputs: CompletionInput[] = []) {
  return new Core({ async complete(input) { inputs.push(input); return { text: input.kind === 'dialogue' ? 'Hi. <b>literal</b>' : JSON.stringify(state) }; } }, privateContent);
}
function event(body: unknown = request(), options: { origin?: string; method?: string; path?: string; rawBody?: string; contentType?: string } = {}): Request {
  const method = options.method ?? 'POST';
  return new Request(`https://api.example${options.path ?? '/api/chat'}`, { method,
    headers: { origin: options.origin ?? 'https://micknorj.github.io', 'content-type': options.contentType ?? 'application/json' },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.rawBody ?? JSON.stringify(body) }) });
}
test('dialogue is plain text; state is a second call and private runtime stays backend-side', async () => {
  const calls: CompletionInput[] = []; const result = await core(proposal, calls).chat(request(), new AbortController().signal);
  assert.deepEqual(calls.map(i => i.kind), ['dialogue', 'state']); assert.equal(calls[0]!.schema, undefined); assert.ok(calls[1]!.schema);
  assert.equal(result.reply, 'Hi. <b>literal</b>'); assert.deepEqual(result.acceptedStatePatch.relationshipDelta, { familiarity: 0, trust: 0, closeness: 0 });
  assert.equal(JSON.stringify(result).includes('PRIVATE_TEST_RUNTIME'), false);
  assert.equal(calls[0]!.messages[1]!.content.includes('instanceId'), false);
});
test('invalid or ambiguous state fails the whole turn without output repair', async () => {
  await assert.rejects(core({ ...proposal, unexpected: true }).chat(request(), new AbortController().signal), /MODEL_INVALID_OUTPUT/);
  await assert.rejects(core({ ...proposal, memoryOps: [{ op: 'supersede', id: 'missing', replacementText: null }] }).chat(request(), new AbortController().signal), /MODEL_INVALID_OUTPUT/);
});
test('transport validates method, origin, schema, body size and reset routing before inference', async () => {
  const calls: CompletionInput[] = []; const handle = createHandler(core(proposal, calls), 'https://micknorj.github.io');
  const invalid: Array<[Request, number]> = [[event(undefined, { origin: 'https://other.example' }), 403],
    [event(undefined, { method: 'GET' }), 405], [event({ ...request(), extra: true }), 400],
    [event(request(undefined, 'reset yourself')), 400], [event(undefined, { rawBody: 'x'.repeat(256 * 1024 + 1) }), 413],
    [event(undefined, { contentType: 'text/plain' }), 415]];
  for (const [input, status] of invalid) assert.equal((await handle(input)).status, status);
  assert.equal(calls.length, 0); assert.equal((await handle(event())).status, 200);
});
test('provider errors are sanitized and no provider key/body is returned', async () => {
  const c = new Core({ async complete() { throw new Error('SECRET_AND_PRIVATE_CHAT'); } }, privateContent);
  const result = await createHandler(c, 'https://micknorj.github.io')(event());
  assert.equal(result.status, 503); assert.equal((await result.text()).includes('SECRET_AND_PRIVATE_CHAT'), false);
});
test('Groq adapter sends locked settings, JSON schema only for state, and rejects truncation', async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ choices: [{ message: { content: 'Hi.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } })); };
  const provider = new GroqProvider(async () => 'test-key', modelConfig({}), fetcher);
  await provider.complete({ kind: 'dialogue', messages: [], signal: new AbortController().signal });
  await provider.complete({ kind: 'state', messages: [], schema: { type: 'object' }, signal: new AbortController().signal });
  assert.equal(bodies[0]!.model, 'qwen/qwen3.8-27b'); assert.equal(bodies[0]!.temperature, 0.7); assert.equal(bodies[0]!.top_p, 0.8);
  assert.equal(bodies[0]!.max_completion_tokens, 768); assert.equal(bodies[0]!.reasoning_effort, 'none'); assert.equal(bodies[0]!.stream, false);
  assert.equal('response_format' in bodies[0]!, false); assert.ok(bodies[1]!.response_format); assert.equal('stop' in bodies[0]!, false);
  const truncated = new GroqProvider(async () => 'test-key', modelConfig({}), async () => new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] })));
  await assert.rejects(truncated.complete({ kind: 'dialogue', messages: [], signal: new AbortController().signal }), /MODEL_INVALID_OUTPUT/);
});
test('runtime and artwork reject wrong encoding/formats; missing artwork is a clean 404', async () => {
  assert.throws(() => validateRuntime(new Uint8Array([255])), /MODEL_UNAVAILABLE/);
  assert.throws(() => validateArtwork(new Uint8Array([137, 80, 78, 71])), /INTERNAL_ERROR/);
  assert.equal((await createHandler(core(), 'https://micknorj.github.io')(event(undefined, { path: '/api/art/mikiru', method: 'GET' }))).status, 404);
});
test('streamed provider bodies are bounded before JSON parsing', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedText(new Response(stream), 10), /BODY_LIMIT/); assert.equal(cancelled, true);
  cancelled = false;
  const advertised = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(readBoundedText(new Response(advertised, { headers: { 'Content-Length': '100' } }), 10), /BODY_LIMIT/); assert.equal(cancelled, true);
});
test('cancellation between dialogue and state prevents the second call even if a provider ignores its signal', async () => {
  const owner = new AbortController(); let calls = 0;
  const c = new Core({ async complete() { calls++; owner.abort(); return { text: 'Late dialogue' }; } }, privateContent);
  await assert.rejects(c.chat(request(), owner.signal), { name: 'AbortError' }); assert.equal(calls, 1);
});
test('provider context overflow and rate limits fail without retry or secret disclosure', async () => {
  let calls = 0;
  const provider = new GroqProvider(async () => 'test-key', modelConfig({}), async () => { calls++; return new Response('provider private details', { status:429 }); });
  await assert.rejects(provider.complete({ kind:'dialogue', messages:[{role:'user',content:'x'.repeat(131072)}], signal:new AbortController().signal }), /CONTEXT_LIMIT/); assert.equal(calls,0);
  await assert.rejects(provider.complete({ kind:'dialogue', messages:[], signal:new AbortController().signal }), /RATE_LIMITED/); assert.equal(calls,1);
});
