import { metaSchema, memorySchema, moodSchema, relationshipSchema, turnSchema, chatResponseSchema, compactResponseSchema, type Snapshot, type ChatResponse, type CompactResponse } from '../shared/contracts.ts';
import { applyMemory, applyMood, applyRelationship, initialMood, deriveStage } from '../shared/state.ts';

export const DB_NAME = 'mikiru';
const STORES = ['meta', 'turns', 'memory', 'characterState'] as const;
const SINGLE = 'current';
const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('TRANSACTION_ABORTED')); tx.onerror = () => { /* onabort owns failure */ }; });
}
async function execute<T>(tx: IDBTransaction, work: () => Promise<T>): Promise<T> {
  const complete = done(tx);
  try { const result = await work(); await complete; return result; }
  catch (error) {
    try { tx.abort(); } catch { /* An IDB request may already have aborted it. */ }
    await complete.catch(() => undefined); throw error;
  }
}

export class Storage {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private generation = 0;
  constructor(private readonly factory: IDBFactory = indexedDB) {}
  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.opening) return this.opening;
    const generation = this.generation;
    let blocked = false;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const r = this.factory.open(DB_NAME, 1);
      r.onupgradeneeded = () => { for (const name of STORES) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name, name === 'turns' ? { keyPath: 'seq' } : undefined); };
      r.onsuccess = () => {
        // Closing a tab/reset can precede the asynchronous open result. Never
        // retain a connection owned by an invalidated or rejected opening.
        if (generation !== this.generation || blocked) { r.result.close(); reject(new Error('DATABASE_CLOSED')); return; }
        this.db = r.result; this.db.onversionchange = () => this.close(); resolve(r.result);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => { blocked = true; reject(new Error('DATABASE_BLOCKED')); };
    }).finally(() => { if (this.opening === opening) this.opening = null; });
    this.opening = opening;
    return opening;
  }
  close(): void { this.generation++; this.db?.close(); this.db = null; this.opening = null; }
  async initialize(now = new Date().toISOString()): Promise<Snapshot> {
    const db = await this.open();
    const tx = db.transaction([...STORES], 'readwrite');
    await execute(tx, async () => {
      const existing = await request(tx.objectStore('meta').get(SINGLE));
      if (!existing) {
        tx.objectStore('meta').put({ schemaVersion: 1, instanceId: crypto.randomUUID(), revision: 0, createdAt: now, lastSuccessfulConversationAt: null, compactedThroughSeq: 0, sleepSeed: crypto.randomUUID() }, SINGLE);
        tx.objectStore('characterState').put({ relationship: { familiarity: 0, trust: 0, closeness: 0, stage: 'stranger' }, mood: initialMood(now) }, SINGLE);
        tx.objectStore('memory').put({ version: 1, items: [] }, SINGLE);
      }
    });
    return this.read();
  }
  async read(): Promise<Snapshot> {
    const db = await this.open();
    const tx = db.transaction([...STORES], 'readonly');
    const [meta, turns, memory, character] = await execute(tx, () => Promise.all([
      request(tx.objectStore('meta').get(SINGLE)), request(tx.objectStore('turns').getAll()),
      request(tx.objectStore('memory').get(SINGLE)), request(tx.objectStore('characterState').get(SINGLE)),
    ]));
    if (!character || typeof character !== 'object') throw new Error('INVALID_DATABASE_STATE');
    const c = character as { relationship: unknown; mood: unknown };
    const state = { meta: metaSchema.parse(meta), turns: turns.map(t => turnSchema.parse(t)), memory: memorySchema.parse(memory), relationship: relationshipSchema.parse(c.relationship), mood: moodSchema.parse(c.mood) };
    if (state.relationship.stage !== deriveStage(state.relationship) || state.memory.items.some(i => i.status !== 'active') ||
        state.turns.some((t, i) => t.seq !== i + 1 || t.revisionAfter > state.meta.revision) ||
        state.meta.compactedThroughSeq > (state.turns.at(-1)?.seq ?? 0)) throw new Error('INVALID_DATABASE_STATE');
    return state;
  }
  private async mutate(instanceId: string, revision: number | null, work: (tx: IDBTransaction, meta: Snapshot['meta']) => void): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([...STORES], 'readwrite');
    await execute(tx, async () => {
      const meta = metaSchema.parse(await request(tx.objectStore('meta').get(SINGLE)));
      if (meta.instanceId !== instanceId || (revision !== null && meta.revision !== revision)) throw new Error('STALE_INSTANCE_OR_REVISION');
      work(tx, meta);
    });
  }
  async commitTurn(base: Snapshot, response: ChatResponse, user: { id: string; text: string; createdAt: string }, decayedMood: Snapshot['mood'], now: string): Promise<Snapshot> {
    const r = chatResponseSchema.parse(response);
    if (r.instanceId !== base.meta.instanceId || r.baseRevision !== base.meta.revision) throw new Error('STALE_RESPONSE');
    const memory = applyMemory(base.memory, r.acceptedStatePatch.memoryOps, now);
    const relationship = relationshipSchema.parse(applyRelationship(base.relationship, r.acceptedStatePatch.relationshipDelta));
    const mood = moodSchema.parse(applyMood(decayedMood, r.acceptedStatePatch.moodDelta, now));
    const seq = (base.turns.at(-1)?.seq ?? 0) + 1;
    const turn = turnSchema.parse({ seq, turnId: user.id, user: { text: user.text, createdAt: user.createdAt }, assistant: { text: r.reply, createdAt: now }, committedAt: now, revisionAfter: base.meta.revision + 1 });
    const nextMeta = metaSchema.parse({ ...base.meta, revision: base.meta.revision + 1, lastSuccessfulConversationAt: now });
    await this.mutate(base.meta.instanceId, base.meta.revision, (tx) => {
      tx.objectStore('turns').add(turn);
      tx.objectStore('memory').put(memory, SINGLE);
      tx.objectStore('characterState').put({ relationship, mood }, SINGLE);
      tx.objectStore('meta').put(nextMeta, SINGLE);
    });
    return { ...base, memory, relationship, mood, turns: [...base.turns, turn], meta: nextMeta };
  }
  prepareCompaction(base: Snapshot, response: CompactResponse, expectedThroughSeq: number, now: string): Snapshot {
    const r = compactResponseSchema.parse(response);
    if (r.instanceId !== base.meta.instanceId || r.baseRevision !== base.meta.revision || r.throughSeq !== expectedThroughSeq || r.throughSeq <= base.meta.compactedThroughSeq || r.throughSeq > (base.turns.at(-1)?.seq ?? 0)) throw new Error('STALE_COMPACTION');
    const memory = applyMemory(base.memory, r.memoryOps, now);
    return { ...base, memory, meta: { ...base.meta, compactedThroughSeq: r.throughSeq } };
  }
  async reset(): Promise<void> {
    // Serialize against already-open IDB transactions, not the inference Web Lock.
    // Clearing meta first makes every subsequent late commit fail its precondition.
    let db: IDBDatabase;
    try { db = await this.open(); }
    catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'VersionError') throw error;
      // An unsupported newer schema stays intact until explicit Reset. Open without
      // a version only to invalidate/erase this Mikiru-owned database, never to migrate.
      db = await request(this.factory.open(DB_NAME));
      db.onversionchange = () => db.close();
    }
    const ownedStores = Array.from(db.objectStoreNames);
    if (ownedStores.length) {
      const tx = db.transaction(ownedStores, 'readwrite');
      const complete = done(tx);
      for (const name of ownedStores) tx.objectStore(name).clear();
      await complete;
    }
    this.close();
    db.close();
    await new Promise<void>((resolve, reject) => {
      const r = this.factory.deleteDatabase(DB_NAME);
      r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
      // Other tabs close on versionchange even if BroadcastChannel delivery is delayed.
    });
  }
}
