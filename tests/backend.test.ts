import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Core } from '../backend/core.ts';
import { createHandler } from '../backend/transport.ts';
import { GroqProvider } from '../backend/providers/groq.ts';
import { modelConfig } from '../backend/config.ts';
import { validateRuntime, validateArtwork } from '../backend/private-content.ts';
import { request, zeroMood, newFact, now, snapshot } from './fixtures.ts';
import type { CompletionInput } from '../backend/provider.ts';
import { readBoundedText } from '../src/shared/http.ts';
import { turnEnvelopeSchema } from '../src/shared/contracts.ts';
import { applyMemory } from '../src/shared/state.ts';
const proposal = { memoryOps: [], relationshipDelta: { familiarity: 2, trust: 2, closeness: 2, significance: 'routine' }, moodDelta: zeroMood };
const privateContent = { runtime: async () => 'PRIVATE_TEST_RUNTIME', artwork: async () => null };
function core(state: unknown = proposal, inputs: CompletionInput[] = []) {
  return new Core({ async complete(input) { inputs.push(input); return { text: JSON.stringify({ reply: 'Hi. <b>literal</b>', ...(state as object) }) }; } }, privateContent);
}
function event(body: unknown = request(), options: { origin?: string; method?: string; path?: string; rawBody?: string; contentType?: string } = {}): Request {
  const method = options.method ?? 'POST';
  return new Request(`https://api.example${options.path ?? '/api/chat'}`, { method,
    headers: { origin: options.origin ?? 'https://micknorj.github.io', 'content-type': options.contentType ?? 'application/json' },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.rawBody ?? JSON.stringify(body) }) });
}
test('one strict call returns only literal reply plus validated patch; private runtime occurs once', async () => {
  const calls: CompletionInput[] = []; const result = await core(proposal, calls).chat(request(), new AbortController().signal);
  assert.deepEqual(calls.map(i => i.kind), ['turn']); assert.ok(calls[0]!.schema);
  assert.equal(calls[0]!.messages.map(m => m.content).join('').split('PRIVATE_TEST_RUNTIME').length - 1, 1);
  assert.equal(calls[0]!.schema.additionalProperties, false);
  assert.deepEqual(Object.keys(result).sort(), ['acceptedStatePatch', 'baseRevision', 'instanceId', 'reply', 'requestId']);
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
test('Groq adapter keeps model/sampling and output cap; strict schemas apply to turn and compaction', async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ choices: [{ message: { content: 'Hi.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } })); };
  const provider = new GroqProvider(async () => 'test-key', modelConfig({}), fetcher);
  await provider.complete({ kind: 'turn', messages: [], schema: { type: 'object' }, signal: new AbortController().signal });
  await provider.complete({ kind: 'state', messages: [], schema: { type: 'object' }, signal: new AbortController().signal });
  assert.equal(bodies[0]!.model, 'qwen/qwen3.8-27b'); assert.equal(bodies[0]!.temperature, 0.7); assert.equal(bodies[0]!.top_p, 0.8);
  assert.equal(bodies[0]!.max_completion_tokens, 768); assert.equal(bodies[0]!.reasoning_effort, 'none'); assert.equal(bodies[0]!.stream, false);
  assert.deepEqual(bodies[0]!.response_format, { type: 'json_schema', json_schema: { name: 'mikiru_turn', strict: true, schema: { type: 'object' } } });
  assert.ok(bodies[1]!.response_format); assert.equal(bodies[1]!.max_completion_tokens, 2048);
  assert.equal('stop' in bodies[0]!, false); assert.equal('presence_penalty' in bodies[0]!, false);
  const truncated = new GroqProvider(async () => 'test-key', modelConfig({}), async () => new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] })));
  await assert.rejects(truncated.complete({ kind: 'turn', messages: [], schema: {}, signal: new AbortController().signal }), /MODEL_INVALID_OUTPUT/);
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
test('cancellation during combined generation rejects the whole turn even if provider ignores its signal', async () => {
  const owner = new AbortController(); let calls = 0;
  const c = new Core({ async complete() { calls++; owner.abort(); return { text: JSON.stringify({ ...proposal, reply: 'Late dialogue' }) }; } }, privateContent);
  await assert.rejects(c.chat(request(), owner.signal), { name: 'AbortError' }); assert.equal(calls, 1);
});
test('provider context overflow and rate limits fail without retry or secret disclosure', async () => {
  let calls = 0;
  const provider = new GroqProvider(async () => 'test-key', modelConfig({}), async () => { calls++; return new Response('provider private details', { status:429 }); });
  await assert.rejects(provider.complete({ kind:'turn', schema:{}, messages:[{role:'user',content:'x'.repeat(131072)}], signal:new AbortController().signal }), /CONTEXT_LIMIT/); assert.equal(calls,0);
  await assert.rejects(provider.complete({ kind:'turn', schema:{}, messages:[], signal:new AbortController().signal }), /RATE_LIMITED/); assert.equal(calls,1);
});

test('malformed, fenced, incomplete and extra-field envelopes fail without returning a partial reply', async () => {
  const complete = { ...proposal, reply: 'A valid literal reply.' };
  for (const text of ['not JSON', '```json\n' + JSON.stringify(complete) + '\n```', '{"reply":"unfinished"',
    JSON.stringify({ reply: complete.reply }), JSON.stringify({ ...complete, reply: ' ' }), JSON.stringify({ ...complete, reply: 1 }),
    JSON.stringify({ ...complete, extra: true }), JSON.stringify({ ...complete, moodDelta: { ...zeroMood, tiredness: 10 } })]) {
    let calls = 0;
    const c = new Core({ async complete() { calls++; return { text }; } }, privateContent);
    await assert.rejects(c.chat(request(), new AbortController().signal), /MODEL_INVALID_OUTPUT/);
    assert.equal(calls, 1);
  }
});

test('combined output preserves significance caps, mood clamps and strict memory application', async () => {
  const state = { ...proposal, relationshipDelta: { familiarity: 100, trust: -100, closeness: 100, significance: 'meaningful' }, moodDelta: { ...zeroMood, positive: 100, irritation: -100 } };
  const result = await core(state).chat(request(), new AbortController().signal);
  assert.deepEqual(result.acceptedStatePatch.relationshipDelta, { familiarity: 3, trust: -8, closeness: 3 });
  assert.equal(result.acceptedStatePatch.moodDelta.positive, 30); assert.equal(result.acceptedStatePatch.moodDelta.irritation, -30);
  assert.equal(turnEnvelopeSchema.safeParse({ ...state, reply: 'Hi.' }).success, true);
  await assert.rejects(core({ ...state, relationshipDelta: { ...state.relationshipDelta, familiarity: 101 } }).chat(request(), new AbortController().signal), /MODEL_INVALID_OUTPUT/);
});

test('provider refusals, content filtering and truncated structured replies are rejected without retry', async () => {
  for (const choice of [
    { message: { content: JSON.stringify({ ...proposal, reply: 'Partial.' }) }, finish_reason: 'length' },
    { message: { content: JSON.stringify({ ...proposal, reply: 'No.' }), refusal: 'Refused' }, finish_reason: 'stop' },
    { message: { content: 'Filtered' }, finish_reason: 'content_filter' },
  ]) {
    let calls = 0;
    const provider = new GroqProvider(async () => 'test-key', modelConfig({}), async () => { calls++; return Response.json({ choices: [choice] }); });
    await assert.rejects(new Core(provider, privateContent).chat(request(), new AbortController().signal), /MODEL_INVALID_OUTPUT/);
    assert.equal(calls, 1);
  }
});

test('chat and compaction use request-local memory IDs and return canonical operations through the existing API', async () => {
  const s = snapshot(); s.memory = applyMemory(s.memory, [newFact('One'), newFact('Two'), newFact('Three')], now);
  const calls: CompletionInput[] = [];
  const memoryOps = [{ op: 'supersede', id: 'm1', replacementText: 'Corrected fact mentioning m0 literally' }];
  const result = await core({ ...proposal, memoryOps }, calls).chat(request(s), new AbortController().signal);
  const sent = JSON.parse(calls[0]!.messages[1]!.content).memory;
  assert.deepEqual(sent.rows.map((row: unknown[]) => row[0]), ['m0', 'm1', 'm2']);
  assert.equal(calls[0]!.messages[1]!.content.includes(s.memory.items[1]!.id), false);
  assert.match(calls[0]!.messages[0]!.content, /timestamp cells index dates/);
  assert.deepEqual(result.acceptedStatePatch.memoryOps, [{ ...memoryOps[0], id: s.memory.items[1]!.id }]);
  assert.equal(s.memory.items[1]!.text, 'Two');
  const compact = new Core({ async complete(input) { calls.push(input); return { text: JSON.stringify({ memoryOps }) }; } }, privateContent);
  const turn = { seq: 1, turnId: crypto.randomUUID(), user: { text: 'A technical turn', createdAt: now }, assistant: { text: 'Response', createdAt: now }, committedAt: now, revisionAfter: 1 };
  const compacted = await compact.compact({ instanceId: s.meta.instanceId, baseRevision: s.meta.revision, currentMemory: s.memory, turns: [turn] }, new AbortController().signal);
  assert.deepEqual(compacted.memoryOps, result.acceptedStatePatch.memoryOps);
  assert.equal(calls[1]!.messages.map(m => m.content).join('').includes('PRIVATE_TEST_RUNTIME'), false);
});

test('invalid or repeated packed-memory targets reject dialogue and compaction atomically', async () => {
  const s = snapshot(); s.memory = applyMemory(s.memory, [newFact('One'), newFact('Two'), newFact('Three')], now);
  const original = structuredClone(s);
  for (const memoryOps of [[{ op: 'supersede', id: 'm99', replacementText: null }],
    [{ op: 'supersede', id: 'm0', replacementText: null }, { op: 'supersede', id: 'm0', replacementText: 'Ambiguous' }]]) {
    const c = core({ ...proposal, memoryOps });
    await assert.rejects(c.chat(request(s), new AbortController().signal), /MODEL_INVALID_OUTPUT/);
    const compactor = new Core({ async complete() { return { text: JSON.stringify({ memoryOps }) }; } }, privateContent);
    const turn = { seq: 1, turnId: crypto.randomUUID(), user: { text: 'Technical turn', createdAt: now }, assistant: { text: 'Response', createdAt: now }, committedAt: now, revisionAfter: 1 };
    await assert.rejects(compactor.compact({ instanceId: s.meta.instanceId, baseRevision: s.meta.revision, currentMemory: s.memory, turns: [turn] }, new AbortController().signal), /MODEL_INVALID_OUTPUT/);
    assert.deepEqual(s, original);
  }
});
