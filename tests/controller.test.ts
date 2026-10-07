import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { Controller } from '../src/client/controller.ts';
import { Storage } from '../src/client/storage.ts';
import { ApiFailure, type Api } from '../src/client/api.ts';
import { response, newFact, now } from './fixtures.ts';
function setup(api: Pick<Api, 'chat' | 'compact'>, clock = () => new Date(2026, 9, 5, 12)) {
  const storage = new Storage(new IDBFactory());
  const tabs = { exclusive: async <T>(_s: AbortSignal, fn: () => Promise<T>) => fn(), resetExclusive: async <T>(fn: () => Promise<T>) => fn(), broadcast: () => {} };
  return { storage, controller: new Controller({ api, storage, tabs, changed: () => {}, now: clock, online: () => true }) };
}
const compact: Api['compact'] = async r => ({ requestId: crypto.randomUUID(), instanceId: r.instanceId, baseRevision: r.baseRevision, throughSeq: r.turns.at(-1)!.seq, memoryOps: [newFact()] });
test('reset notice invalidates a delayed initialization instead of restoring the erased instance', async () => {
  const { storage, controller } = setup({ compact, chat: async r => response(r) });
  await controller.initialize(); const old = controller.state!;
  let resolve!: (state: typeof old) => void;
  storage.initialize = () => new Promise(done => { resolve = done; });
  const initializing = controller.initialize();
  await controller.notice({ type: 'reset' }); resolve(old); await initializing;
  assert.equal(controller.state, null); assert.equal(controller.pending, null); storage.close();
});
async function seedContext(storage: Storage) {
  let base = await storage.read();
  for (let i = 0; i < 5; i++) {
    const r = { instanceId: base.meta.instanceId, baseRevision: base.meta.revision };
    base = await storage.commitTurn(base, response(r), { id: crypto.randomUUID(), text: 'x'.repeat(1500), createdAt: now }, base.mood, now);
  }
  return base;
}
test('failed inference is RAM-only and retry uses the last committed revision', async () => {
  const seen: number[] = [];
  const { storage, controller } = setup({ compact, chat: async r => { seen.push(r.baseRevision); if (seen.length === 1) throw new Error('unavailable'); return response(r); } });
  await controller.initialize(); const original = await storage.read();
  await controller.send('Hello'); assert.equal(controller.pending?.status, 'failed'); assert.deepEqual(await storage.read(), original);
  await controller.retry(); assert.deepEqual(seen, [0, 0]); assert.equal((await storage.read()).turns.length, 1); storage.close();
});
test('sleep attempts and retry crossing bedtime never reach provider, transcript or memory', async () => {
  let hour = 12; let calls = 0;
  const { storage, controller } = setup({ compact, chat: async () => { calls++; throw new Error('fail'); } }, () => new Date(2026, 9, 5, hour));
  await controller.initialize(); await controller.send('A failed awake message'); hour = 2;
  await controller.retry(); await controller.send('Never delivered');
  assert.equal(calls, 1); assert.equal(controller.pending, null); assert.equal((await storage.read()).turns.length, 0); assert.equal((await storage.read()).memory.items.length, 0); controller.abort(); storage.close();
});
test('reset immediately invalidates pending work even if provider ignores abort', async () => {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }); const started = new Promise<void>(r => { entered = r; });
  const { storage, controller } = setup({ compact, chat: async r => { entered(); await gate; return response(r); } });
  await controller.initialize(); const oldId = controller.state!.meta.instanceId;
  const pending = controller.send('Wait'); await started; await controller.reset(); release(); await pending;
  assert.notEqual(controller.state!.meta.instanceId, oldId); assert.equal((await storage.read()).turns.length, 0); assert.equal(controller.pending, null); storage.close();
});
test('a failed turn after successful compaction commits neither compaction nor dialogue', async () => {
  let compactCalls = 0;
  const { storage, controller } = setup({ compact: async r => { compactCalls++; return compact(r, new AbortController().signal); }, chat: async () => { throw new Error('fail'); } });
  await controller.initialize(); const original = await seedContext(storage); controller.state = original;
  await controller.send('Hello'); assert.equal(compactCalls, 1); assert.deepEqual(await storage.read(), original); storage.close();
});

test('compaction quota rejection stops before dialogue and changes nothing until manual retry', async () => {
  let compactCalls = 0; let chatCalls = 0;
  const { storage, controller } = setup({ compact: async r => {
    compactCalls++; if (compactCalls === 1) throw new ApiFailure('RATE_LIMITED');
    return compact(r, new AbortController().signal);
  }, chat: async r => { chatCalls++; return response(r); } });
  await controller.initialize(); const original = await seedContext(storage); controller.state = original;
  await controller.send('Hello');
  assert.equal(compactCalls, 1); assert.equal(chatCalls, 0);
  assert.equal(controller.pending?.status, 'failed'); assert.equal(controller.error, 'Groq quota reached. Retry later.');
  assert.equal(controller.pending?.stagedCompaction, undefined); assert.deepEqual(await storage.read(), original);
  await controller.retry();
  assert.equal(compactCalls, 2); assert.equal(chatCalls, 1);
  assert.equal((await storage.read()).meta.revision, original.meta.revision + 1); storage.close();
});

test('quota failure reuses only validated staged compaction and commits it atomically on manual retry', async () => {
  let compactCalls = 0; let chatCalls = 0;
  const seen: Parameters<Api['chat']>[0][] = [];
  const { storage, controller } = setup({ compact: async r => { compactCalls++; return compact(r, new AbortController().signal); },
    chat: async r => { seen.push(r); chatCalls++; if (chatCalls === 1) throw new ApiFailure('RATE_LIMITED'); return response(r); } });
  await controller.initialize(); const original = await seedContext(storage); controller.state = original;
  await controller.send('Hello');
  assert.equal(controller.pending?.status, 'failed'); assert.equal(controller.error, 'Groq quota reached. Retry later.');
  assert.equal(compactCalls, 1); assert.equal(chatCalls, 1); assert.deepEqual(await storage.read(), original);
  assert.equal(seen[0]!.recentTurns.length, 2); assert.equal(seen[0]!.memory.items[0]!.text, 'The user is called Pat');
  await controller.retry();
  assert.equal(compactCalls, 1); assert.equal(chatCalls, 2); assert.deepEqual(seen[1], seen[0]);
  const committed = await storage.read();
  assert.equal(committed.meta.revision, original.meta.revision + 1); assert.equal(committed.meta.compactedThroughSeq, 3);
  assert.equal(committed.turns.length, 6); assert.equal(committed.memory.items.length, 1);
  assert.equal(controller.pending, null); storage.close();
});

test('another committed revision invalidates the RAM compaction cache before retry', async () => {
  let compactCalls = 0; let chatCalls = 0; const revisions: number[] = [];
  const { storage, controller } = setup({ compact: async r => { compactCalls++; return compact(r, new AbortController().signal); },
    chat: async r => { revisions.push(r.baseRevision); chatCalls++; if (chatCalls === 1) throw new ApiFailure('RATE_LIMITED'); return response(r); } });
  await controller.initialize(); const original = await seedContext(storage); controller.state = original;
  await controller.send('Pending');
  const r = { instanceId: original.meta.instanceId, baseRevision: original.meta.revision };
  await storage.commitTurn(original, response(r), { id: crypto.randomUUID(), text: 'Another tab', createdAt: now }, original.mood, now);
  await controller.retry();
  assert.deepEqual(revisions, [5, 6]); assert.equal(compactCalls, 2);
  assert.equal((await storage.read()).meta.revision, 7); storage.close();
});

test('reset discards staged compaction and cannot restore old memory on a later turn', async () => {
  let fail = true; let compactCalls = 0;
  const { storage, controller } = setup({ compact: async r => { compactCalls++; return compact(r, new AbortController().signal); },
    chat: async r => { if (fail) throw new ApiFailure('RATE_LIMITED'); assert.equal(r.memory.items.length, 0); return response(r); } });
  await controller.initialize(); controller.state = await seedContext(storage);
  await controller.send('Pending'); assert.ok(controller.pending?.stagedCompaction);
  await controller.reset(); assert.equal(controller.pending, null);
  fail = false; await controller.send('New instance'); assert.equal(compactCalls, 1);
  const state = await storage.read(); assert.equal(state.turns.length, 1); assert.equal(state.memory.items.length, 0); storage.close();
});
test('stale controller response preserves another tab commit and retry selects its new revision', async () => {
  let storage!: Storage; const seen: number[] = [];
  const setupResult = setup({ compact, chat: async r => {
    seen.push(r.baseRevision);
    if (seen.length === 1) {
      const latest = await storage.read();
      await storage.commitTurn(latest, response(r), { id: crypto.randomUUID(), text: 'Another tab won the race', createdAt: now }, latest.mood, now);
    }
    return response(r);
  } });
  storage = setupResult.storage; const controller = setupResult.controller;
  await controller.initialize(); await controller.send('Stale attempt');
  assert.equal(controller.pending?.status, 'failed'); assert.match(controller.error, /another tab/);
  assert.equal((await storage.read()).turns.length, 1);
  await controller.retry(); assert.deepEqual(seen, [0, 1]); assert.equal((await storage.read()).turns.length, 2); storage.close();
});
