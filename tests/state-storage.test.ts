import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { Storage, DB_NAME } from '../src/client/storage.ts';
import { applyMemory, applyRelationship, clampRelationship, decayMood } from '../src/shared/state.ts';
import { moodSchema, stateProposalSchema } from '../src/shared/contracts.ts';
import { recentContext } from '../src/shared/context.ts';
import { newFact, now, request, response, snapshot } from './fixtures.ts';
test('fresh database does not open legacy data and atomically commits transcript/state', async () => {
  assert.equal(DB_NAME, 'mikiru');
  const storage = new Storage(new IDBFactory());
  const base = await storage.initialize(now); const r = request(base); const reply = response(r);
  reply.acceptedStatePatch.memoryOps = [newFact()];
  const next = await storage.commitTurn(base, reply, { id: r.userMessage.id, text: r.userMessage.text, createdAt: now }, base.mood, now);
  assert.equal(next.turns.length, 1); assert.equal(next.memory.items.length, 1); assert.equal(next.meta.revision, 1);
  assert.deepEqual(await storage.read(), next); storage.close();
});
test('invalid state and duplicate memory targets leave all persistent state intact', async () => {
  const storage = new Storage(new IDBFactory()); const base = await storage.initialize(now); const r = request(base);
  const reply = response(r); reply.acceptedStatePatch.memoryOps = [{ op: 'supersede', id: 'unknown', replacementText: null }];
  await assert.rejects(storage.commitTurn(base, reply, { id: r.userMessage.id, text: 'Hello', createdAt: now }, base.mood, now));
  assert.deepEqual(await storage.read(), base); storage.close();
  const memory = applyMemory({ version: 1, items: [] }, [newFact()], now, () => 'name');
  assert.throws(() => applyMemory(memory, [{ op: 'supersede', id: 'name', replacementText: null }, { op: 'supersede', id: 'name', replacementText: 'Changed' }], now), /AMBIGUOUS/);
});
test('revision race rejects a stale tab and reset rejects a late response', async () => {
  const factory = new IDBFactory(); const a = new Storage(factory); const b = new Storage(factory);
  const base = await a.initialize(now); await b.initialize(now); const r = request(base);
  await a.commitTurn(base, response(r), { id: r.userMessage.id, text: 'Hello', createdAt: now }, base.mood, now);
  await assert.rejects(b.commitTurn(base, response(r), { id: crypto.randomUUID(), text: 'Stale', createdAt: now }, base.mood, now), /STALE/);
  await a.reset(); const fresh = await a.initialize(now);
  assert.notEqual(fresh.meta.instanceId, base.meta.instanceId); assert.deepEqual(fresh.memory.items, []); assert.deepEqual(fresh.turns, []); assert.equal(fresh.meta.revision, 0);
  await assert.rejects(b.commitTurn(base, response(r), { id: crypto.randomUUID(), text: 'Late', createdAt: now }, base.mood, now), /STALE/);
  a.close(); b.close();
});
test('compaction is staged and forgotten history never returns to inference', async () => {
  const storage = new Storage(new IDBFactory()); let base = await storage.initialize(now); const r = request(base);
  base = await storage.commitTurn(base, response(r), { id: r.userMessage.id, text: 'Old detail', createdAt: now }, base.mood, now);
  const staged = storage.prepareCompaction(base, { requestId: crypto.randomUUID(), instanceId: base.meta.instanceId, baseRevision: base.meta.revision, throughSeq: 1, memoryOps: [newFact()] }, 1, now);
  assert.deepEqual(await storage.read(), base); assert.deepEqual(recentContext(staged, 'Hi'), []);
  const nextR = request(staged);
  await storage.commitTurn(staged, response(nextR), { id: nextR.userMessage.id, text: 'Hi', createdAt: now }, staged.mood, now);
  const committed = await storage.read(); assert.equal(committed.meta.compactedThroughSeq, 1); assert.equal(committed.meta.revision, 2); assert.equal(committed.memory.items.length, 1); storage.close();
});
test('routine activity earns no positive relationship and mood decays independently', () => {
  const s = snapshot(); const delta = clampRelationship({ familiarity: 100, trust: 5, closeness: 10, significance: 'routine' });
  assert.deepEqual(delta, { familiarity: 0, trust: 0, closeness: 0 }); assert.equal(applyRelationship(s.relationship, delta).stage, 'stranger');
  const decayed = decayMood({ ...s.mood, irritation: 90 }, '2026-10-05T06:30:00.000Z'); assert.equal(decayed.irritation, 51);
  assert.equal(moodSchema.safeParse({ ...s.mood, tiredness: 55 }).success, false);
  assert.equal(stateProposalSchema.safeParse({ memoryOps: [], relationshipDelta: { ...delta, significance: 'routine' }, moodDelta: { tiredness: 1 } }).success, false);
});
test('transaction failure after the transcript write rolls back transcript, metadata, memory and character state', async () => {
  const storage = new Storage(new IDBFactory()); const base = await storage.initialize(now); const r = request(base);
  const reply = response(r); reply.acceptedStatePatch.memoryOps = [newFact()];
  reply.acceptedStatePatch.relationshipDelta = { familiarity: 3, trust: 2, closeness: 1 };
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
    if (this.name === 'memory') throw new DOMException('Simulated exhausted browser storage', 'QuotaExceededError');
    return originalPut.apply(this, args);
  };
  try { await assert.rejects(storage.commitTurn(base, reply, { id: r.userMessage.id, text: 'Hello', createdAt: now }, base.mood, now), { name: 'QuotaExceededError' }); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  assert.deepEqual(await storage.read(), base); storage.close();
});
test('memory capacity failure is atomic and never silently drops an existing memory', async () => {
  const storage = new Storage(new IDBFactory()); let base = await storage.initialize(now);
  for (const length of [24, 24, 24, 24, 24, 8]) {
    const r = request(base); const reply = response(r); reply.acceptedStatePatch.memoryOps = Array.from({ length }, (_, i) => newFact(`Important fact ${base.meta.revision}:${i}`));
    base = await storage.commitTurn(base, reply, { id: r.userMessage.id, text: 'Hello', createdAt: now }, base.mood, now);
  }
  assert.equal(base.memory.items.length, 128);
  const r = request(base); const reply = response(r); reply.acceptedStatePatch.memoryOps = [newFact('One too many')];
  await assert.rejects(storage.commitTurn(base, reply, { id: r.userMessage.id, text: 'No partial commit', createdAt: now }, base.mood, now), /MEMORY_CAPACITY/);
  assert.deepEqual(await storage.read(), base); storage.close();
});
