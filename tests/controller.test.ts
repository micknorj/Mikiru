import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { Controller } from '../src/client/controller.ts';
import { Storage } from '../src/client/storage.ts';
import type { Api } from '../src/client/api.ts';
import { response, newFact, now } from './fixtures.ts';
function setup(api: Pick<Api, 'chat' | 'compact'>, clock = () => new Date(2026, 9, 5, 12)) {
  const storage = new Storage(new IDBFactory());
  const tabs = { exclusive: async <T>(_s: AbortSignal, fn: () => Promise<T>) => fn(), resetExclusive: async <T>(fn: () => Promise<T>) => fn(), broadcast: () => {} };
  return { storage, controller: new Controller({ api, storage, tabs, changed: () => {}, now: clock, online: () => true }) };
}
const compact: Api['compact'] = async r => ({ requestId: crypto.randomUUID(), instanceId: r.instanceId, baseRevision: r.baseRevision, throughSeq: r.turns.at(-1)!.seq, memoryOps: [newFact()] });
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
  await controller.initialize(); const base = await storage.read();
  const r = { instanceId: base.meta.instanceId, baseRevision: base.meta.revision };
  await storage.commitTurn(base, response(r), { id: crypto.randomUUID(), text: 'x'.repeat(8000), createdAt: now }, base.mood, now);
  controller.state = await storage.read(); const original = await storage.read();
  await controller.send('Hello'); assert.equal(compactCalls, 1); assert.deepEqual(await storage.read(), original); storage.close();
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
