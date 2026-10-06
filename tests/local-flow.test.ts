import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { IDBFactory } from 'fake-indexeddb';
import { Core } from '../backend/core.ts';
import { GroqProvider } from '../backend/providers/groq.ts';
import { modelConfig } from '../backend/config.ts';
import { createLocalServer } from '../backend/local-server.ts';
import { LocalMetrics, type RequestMeasurement } from '../backend/local-metrics.ts';
import { Api } from '../src/client/api.ts';
import { Controller } from '../src/client/controller.ts';
import { Storage } from '../src/client/storage.ts';
import { LIMITS } from '../src/shared/config.ts';
import { newFact, zeroMood } from './fixtures.ts';

const origin = 'http://127.0.0.1:5173';
const proposal = { memoryOps: [newFact()], relationshipDelta: { familiarity: 3, trust: 2, closeness: 1, significance: 'meaningful' }, moodDelta: { ...zeroMood, positive: 4 } };
const groqResponse = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 123, completion_tokens: 45 } }));
async function setup(fetcher: typeof fetch) {
  const measurements: RequestMeasurement[] = [];
  const metrics = new LocalMetrics(async m => { measurements.push(m); });
  const core = new Core(metrics.provider(new GroqProvider(async () => 'LOCAL_TEST_KEY', modelConfig({}), fetcher)), { runtime: async () => 'PRIVATE_TEST_RUNTIME', artwork: async () => null });
  const server = createLocalServer(core, origin, metrics);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  const api = new Api(base, async (url, init) => {
    const headers = new Headers(init?.headers); headers.set('Origin', origin);
    return fetch(url, { ...init, headers });
  });
  const factory = new IDBFactory(); const storage = new Storage(factory);
  let clock = new Date(2026, 9, 5, 12);
  const tabs = { exclusive: async <T>(_signal: AbortSignal, work: () => Promise<T>) => work(), resetExclusive: async <T>(work: () => Promise<T>) => work(), broadcast: () => {} };
  const controller = new Controller({ storage, api, tabs, now: () => clock, online: () => true, changed: () => {} });
  await controller.initialize();
  return { api, controller, storage, factory, measurements, base, setClock: (date: Date) => { clock = date; }, close: async () => { controller.abort(); storage.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('local HTTP + Groq adapter + separate state pass atomically persist history, relationship, mood and memory through refresh', async () => {
  const bodies: Record<string, unknown>[] = [];
  const flow = await setup(async (url, init) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    return groqResponse(body.response_format ? JSON.stringify(proposal) : 'Fine. <b>This stays literal.</b>');
  });
  try {
    await flow.controller.send('My name is Pat.');
    const state = await flow.storage.read();
    assert.equal(state.meta.revision, 1); assert.equal(state.turns.length, 1);
    assert.equal(state.turns[0]!.assistant.text, 'Fine. <b>This stays literal.</b>');
    assert.equal(state.relationship.familiarity, 3); assert.equal(state.relationship.trust, 2);
    assert.equal(state.mood.positive, 14); assert.equal('tiredness' in state.mood, false);
    assert.equal(state.memory.items[0]!.text, 'The user is called Pat');
    assert.equal(flow.controller.pending, null); assert.equal(bodies.length, 2);
    assert.equal(bodies[0]!.response_format, undefined); assert.ok(bodies[1]!.response_format);
    assert.equal(JSON.stringify(bodies[0]).includes('PRIVATE_TEST_RUNTIME'), true);
    flow.storage.close();
    const refreshed = new Storage(flow.factory);
    assert.deepEqual(await refreshed.initialize(), state); refreshed.close();
    const metric = flow.measurements[0]!;
    assert.equal(metric.status, 200); assert.ok(metric.latencyMs >= 0);
    assert.deepEqual(metric.calls.map(c => c.kind), ['dialogue', 'state']);
    assert.ok(metric.calls.every(c => c.completed && c.latencyMs >= 0 && c.usage!.promptTokens === 123 && c.usage!.completionTokens === 45));
    for (const secret of ['PRIVATE_TEST_RUNTIME', 'LOCAL_TEST_KEY', 'Pat', state.meta.instanceId]) assert.equal(JSON.stringify(metric).includes(secret), false);
    await flow.controller.reset();
    const blank = await flow.storage.read();
    assert.notEqual(blank.meta.instanceId, state.meta.instanceId);
    assert.equal(blank.meta.revision, 0); assert.equal(blank.turns.length, 0); assert.equal(blank.memory.items.length, 0); assert.equal(blank.relationship.familiarity, 0);
  } finally { await flow.close(); }
});

test('provider failures and malformed/ambiguous state leave every committed field intact; retry uses the same revision', async () => {
  const modes = ['dialogue-failure', 'rate-limit', 'state-failure', 'malformed', 'ambiguous', 'tiredness'] as const;
  for (const mode of modes) {
    let fail = false; const dialogueContexts: Record<string, unknown>[] = [];
    const flow = await setup(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); const structured = !!body.response_format;
      if (!structured) dialogueContexts.push(body);
      if (fail && mode === 'dialogue-failure') return new Response('SECRET_FAILURE', { status: 503 });
      if (fail && mode === 'rate-limit') return new Response('SECRET_FAILURE', { status: 429 });
      if (fail && structured) {
        if (mode === 'state-failure') return new Response('SECRET_FAILURE', { status: 503 });
        if (mode === 'malformed') return groqResponse('not JSON');
        if (mode === 'ambiguous') return groqResponse(JSON.stringify({ ...proposal, memoryOps: [{ op: 'supersede', id: 'missing', replacementText: null }] }));
        if (mode === 'tiredness') return groqResponse(JSON.stringify({ ...proposal, moodDelta: { ...proposal.moodDelta, tiredness: 50 } }));
      }
      return groqResponse(structured ? JSON.stringify(proposal) : 'A test reply.');
    });
    try {
      await flow.controller.send('A committed turn.');
      const committed = await flow.storage.read(); fail = true;
      await flow.controller.send('This attempt must remain pending.');
      assert.equal(flow.controller.pending?.status, 'failed', mode);
      assert.deepEqual(await flow.storage.read(), committed, mode);
      assert.equal(flow.controller.error.includes('SECRET_FAILURE'), false);
      if (mode === 'rate-limit') assert.match(flow.controller.error, /Too many requests/);
      assert.equal(flow.measurements.at(-1)!.status, mode === 'rate-limit' ? 429 : mode.includes('failure') ? 503 : 502);
      fail = false; await flow.controller.retry();
      const retried = await flow.storage.read();
      assert.equal(retried.meta.revision, committed.meta.revision + 1);
      assert.equal(retried.turns.length, committed.turns.length + 1);
      assert.deepEqual(dialogueContexts.at(-1), dialogueContexts.at(-2), 'retry starts from identical committed context and app clock');
    } finally { await flow.close(); }
  }
});

test('asleep attempts never enter HTTP, model context, transcript or memory after waking', async () => {
  const bodies: string[] = [];
  const flow = await setup(async (_url, init) => { bodies.push(String(init?.body)); return groqResponse(JSON.parse(String(init?.body)).response_format ? JSON.stringify({ ...proposal, memoryOps: [] }) : 'Awake.'); });
  try {
    const before = await flow.storage.read(); flow.setClock(new Date(2026, 9, 6, 2));
    await flow.controller.send('UNDELIVERED_SLEEP_MESSAGE');
    assert.equal(bodies.length, 0); assert.equal(flow.measurements.length, 0); assert.deepEqual(await flow.storage.read(), before);
    flow.setClock(new Date(2026, 9, 6, 12)); await flow.controller.send('Now awake.');
    assert.equal(bodies.length, 2); assert.equal(bodies.join('').includes('UNDELIVERED_SLEEP_MESSAGE'), false);
    const after = await flow.storage.read(); assert.equal(after.turns.length, 1); assert.equal(after.memory.items.length, 0);
  } finally { await flow.close(); }
});

test('local oversized request retains CORS and private missing art returns a clean 404', async () => {
  const flow = await setup(async () => { throw new Error('must not call provider'); });
  try {
    const result = await fetch(new URL('api/chat', flow.base), { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: 'x'.repeat(LIMITS.BODY_BYTES + 1) });
    assert.equal(result.status, 413); assert.equal(result.headers.get('Access-Control-Allow-Origin'), origin); assert.equal((await result.json()).error.code, 'INVALID_REQUEST');
    assert.equal((await fetch(new URL('api/art/mikiru', flow.base), { headers: { Origin: origin } })).status, 404);
  } finally { await flow.close(); }
});
