import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { Storage, DB_NAME } from '../src/client/storage.ts';
import { applyMemory, applyRelationship, clampRelationship, decayMood } from '../src/shared/state.ts';
import { moodSchema, stateProposalSchema } from '../src/shared/contracts.ts';
import { recentContext, needsCompaction, compactionRange, conversationText, estimateTokens, inferenceMemory, restoreMemoryReferences, workingMemory } from '../src/shared/context.ts';
import { LIMITS } from '../src/shared/config.ts';
import { newFact, now, request, response, snapshot } from './fixtures.ts';

test('close invalidates an in-flight database open without leaking a connection or blocking recovery', async () => {
  const factory = new IDBFactory(); const storage = new Storage(factory);
  const opening = storage.initialize(now); storage.close();
  await assert.rejects(opening, /DATABASE_CLOSED/);
  const deletion = factory.deleteDatabase(DB_NAME);
  await new Promise<void>((resolve, reject) => {
    deletion.onsuccess = () => resolve(); deletion.onerror = () => reject(deletion.error);
    deletion.onblocked = () => reject(new Error('Leaked opening blocks deletion'));
  });
  const recovered = await storage.initialize(now);
  assert.equal(recovered.meta.revision, 0); assert.deepEqual(recovered.turns, []); storage.close();
});
test('fresh database does not open legacy data and atomically commits transcript/state', async () => {
  assert.equal(DB_NAME, 'mikiru');
  const storage = new Storage(new IDBFactory());
  const base = await storage.initialize(now); const r = request(base); const reply = response(r);
  reply.acceptedStatePatch.memoryOps = [newFact()];
  const next = await storage.commitTurn(base, reply, { id: r.userMessage.id, text: r.userMessage.text, createdAt: now }, base.mood, now);
  assert.equal(next.turns.length, 1); assert.equal(next.memory.items.length, 1); assert.equal(next.meta.revision, 1);
  assert.deepEqual(await storage.read(), next); storage.close();
});

test('aborted read and initialization consume transaction failures and recover without changing committed state', async () => {
  const storage = new Storage(new IDBFactory()); const before = await storage.initialize(now);
  const originalGetAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function (...args: Parameters<IDBObjectStore['getAll']>) {
    const result = originalGetAll.apply(this, args); queueMicrotask(() => this.transaction.abort()); return result;
  };
  try { await assert.rejects(storage.read(), { name: 'AbortError' }); }
  finally { IDBObjectStore.prototype.getAll = originalGetAll; }
  assert.deepEqual(await storage.read(), before);
  const originalGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (key) { const result = originalGet.call(this, key); queueMicrotask(() => this.transaction.abort()); return result; };
  try { await assert.rejects(storage.initialize(now), { name: 'AbortError' }); }
  finally { IDBObjectStore.prototype.get = originalGet; }
  assert.deepEqual(await storage.read(), before); storage.close();
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

test('earlier compaction uses actual dialogue data, bounded older batches, and retains the two latest turns', () => {
  const state = snapshot();
  state.memory = applyMemory(state.memory, [newFact('A meaningful fact that must be retained')], now, () => 'meaningful');
  state.turns = Array.from({ length: 7 }, (_, i) => ({ seq: i + 1, turnId: crypto.randomUUID(), user: { text: 'u'.repeat(1000), createdAt: now },
    assistant: { text: 'reply', createdAt: now }, committedAt: now, revisionAfter: i + 1 }));
  assert.equal(needsCompaction(state, 'Hello'), true);
  const range = compactionRange(state);
  assert.equal(range.length, 5); assert.equal(range.at(-1)!.seq, 5);
  assert.ok(estimateTokens(state.memory) + 512 + estimateTokens(conversationText(range)) <= LIMITS.CONTEXT_TARGET);
  const staged = { ...state, meta: { ...state.meta, compactedThroughSeq: 5 } };
  assert.deepEqual(recentContext(staged, 'Hello').map(t => t.seq), [6, 7]);
  assert.deepEqual(staged.memory, state.memory);
  assert.deepEqual(Object.keys(conversationText(range)[0]!).sort(), ['mikiru', 'user']);
});

test('unfit context/memory is rejected without dropping important facts or reconstructing archived history', () => {
  const state = snapshot();
  state.memory = applyMemory(state.memory, Array.from({ length: 60 }, (_, i) => newFact(`Important ${i}: ` + 'x'.repeat(450))), now);
  const original = structuredClone(state.memory);
  assert.throws(() => recentContext(state, 'Hello'), /CONTEXT_LIMIT/);
  assert.deepEqual(state.memory, original); assert.equal(state.memory.items.length, 60);
});
test('routine activity earns no positive relationship and mood decays independently', () => {
  const s = snapshot(); const delta = clampRelationship({ familiarity: 100, trust: 5, closeness: 10, significance: 'routine' });
  assert.deepEqual(delta, { familiarity: 0, trust: 0, closeness: 0 }); assert.equal(applyRelationship(s.relationship, delta).stage, 'stranger');
  const decayed = decayMood({ ...s.mood, irritation: 90 }, '2026-10-05T06:30:00.000Z'); assert.equal(decayed.irritation, 51);
  assert.equal(moodSchema.safeParse({ ...s.mood, tiredness: 55 }).success, false);
  assert.equal(stateProposalSchema.safeParse({ memoryOps: [], relationshipDelta: { ...delta, significance: 'routine' }, moodDelta: { tiredness: 1 } }).success, false);
});

test('inference memory table preserves every fact, field, distinct date and null without modifying canonical memory', () => {
  const memory = applyMemory(snapshot().memory, [newFact('Literal m0 is part of this fact'), newFact('Second fact'), newFact('Third fact')], now);
  memory.items[1]!.lastRelevantAt = null;
  memory.items[2]!.lastUpdatedAt = '2026-10-06T05:00:00.000Z';
  memory.items[2]!.repetitionCount = 7;
  const original = structuredClone(memory);
  const packed = inferenceMemory(memory);
  assert.ok('rows' in packed);
  const restored = packed.rows.map((row, index) => Object.fromEntries(packed.columns.map((column, cell) => {
    const value = row[cell];
    return [column, column === 'id' ? memory.items[index]!.id : typeof value === 'number' && ['firstSeenAt', 'lastUpdatedAt', 'lastRelevantAt'].includes(column) ? packed.dates[value] : value];
  })));
  assert.deepEqual(restored, memory.items);
  assert.deepEqual(packed.rows.map(row => row[0]), ['m0', 'm1', 'm2']);
  assert.equal(packed.dates.length, 2);
  assert.ok(estimateTokens(packed) < estimateTokens(memory));
  assert.deepEqual(memory, original);
  const small = inferenceMemory({ version: 1, items: memory.items.slice(0, 2) });
  assert.ok('items' in small); assert.equal(small.items.length, 2, 'small memory sets avoid table overhead');
});

test('memory references restore only operation IDs, reject unknown aliases, and preserve duplicate-target validation', () => {
  const memory = applyMemory(snapshot().memory, [newFact('First'), newFact('Second'), newFact('Third')], now);
  const update = newFact('literal m0'); assert.ok(update.op === 'upsert'); update.item.id = 'm1';
  const ops = restoreMemoryReferences([{ op: 'supersede', id: 'm0', replacementText: 'literal m1 stays in the text' },
    update, newFact('New fact')], memory);
  assert.equal(ops[0]!.op === 'supersede' && ops[0]!.id, memory.items[0]!.id);
  assert.equal(ops[0]!.op === 'supersede' && ops[0]!.replacementText, 'literal m1 stays in the text');
  assert.equal(ops[1]!.op === 'upsert' && ops[1]!.item.id, memory.items[1]!.id);
  assert.equal(ops[2]!.op === 'upsert' && ops[2]!.item.id, null);
  assert.throws(() => restoreMemoryReferences([{ op: 'supersede', id: memory.items[0]!.id, replacementText: null }], memory), /INVALID_MEMORY_REFERENCE/);
  assert.throws(() => restoreMemoryReferences([{ op: 'supersede', id: 'm3', replacementText: null }], memory), /INVALID_MEMORY_REFERENCE/);
  const duplicate = restoreMemoryReferences([{ op: 'supersede', id: 'm0', replacementText: null }, { op: 'supersede', id: 'm0', replacementText: null }], memory);
  assert.throws(() => applyMemory(memory, duplicate, now), /AMBIGUOUS_MEMORY_OPERATIONS/);
});

test('context budgeting uses the packed working memory without sending superseded or archived facts', () => {
  const state = snapshot();
  state.memory = applyMemory(state.memory, Array.from({ length: 30 }, (_, i) => newFact(`Technical project ${i}`)), now);
  state.memory.items.push({ ...state.memory.items[0]!, id: 'archived', text: 'FORGOTTEN_FACT', status: 'superseded' });
  assert.equal(needsCompaction(state, 'Hi'), false);
  assert.deepEqual(recentContext(state, 'Hi'), []);
  assert.equal(JSON.stringify(inferenceMemory(workingMemory(state.memory))).includes('FORGOTTEN_FACT'), false);
  assert.equal(state.memory.items.length, 31, 'selection does not erase stored history');
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
