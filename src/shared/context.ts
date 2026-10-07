import { LIMITS } from './config.ts';
import type { CommittedTurn, MemoryOperation, Snapshot, StructuredMemory } from './contracts.ts';

// A byte-level upper estimate is deliberately conservative for Qwen's byte-based tokenizer.
// Benchmark against provider token counts before reducing this reserve/estimator.
export const estimateTokens = (value: unknown): number => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
export const INPUT_DATA_BUDGET = LIMITS.INPUT_DATA_HARD_MAX;
export function workingMemory(memory: StructuredMemory): StructuredMemory {
  return { version: 1, items: memory.items.filter(i => i.status === 'active') };
}
export function conversationText(turns: CommittedTurn[]) {
  return turns.map(t => ({ user: t.user.text, mikiru: t.assistant.text }));
}
const memoryColumns = ['id', 'category', 'text', 'importance', 'confidence', 'sensitivity', 'firstSeenAt', 'lastUpdatedAt', 'lastRelevantAt', 'repetitionCount', 'status'] as const;
const datedColumns = new Set<string>(['firstSeenAt', 'lastUpdatedAt', 'lastRelevantAt']);
export const usesMemoryTable = (memory: StructuredMemory) => memory.items.length >= 3;
// A lossless provider representation: shared field names/dates appear once.
// IDs are local to this request; the backend restores canonical IDs before validation.
export function inferenceMemory(memory: StructuredMemory) {
  if (!usesMemoryTable(memory)) return memory;
  const dates: string[] = [];
  const dateIds = new Map<string, number>();
  const rows = memory.items.map((item, index) => memoryColumns.map(key => {
    const value = item[key];
    if (key === 'id') return `m${index}`;
    if (datedColumns.has(key) && typeof value === 'string') {
      if (!dateIds.has(value)) { dateIds.set(value, dates.length); dates.push(value); }
      return dateIds.get(value)!;
    }
    return value;
  }));
  return { version: memory.version, columns: memoryColumns, dates, rows };
}
export function restoreMemoryReferences(ops: MemoryOperation[], memory: StructuredMemory): MemoryOperation[] {
  if (!usesMemoryTable(memory)) return ops;
  const ids = new Map(memory.items.map((item, index) => [`m${index}`, item.id]));
  const restore = (id: string) => { const real = ids.get(id); if (!real) throw new Error('INVALID_MEMORY_REFERENCE'); return real; };
  return ops.map(op => op.op === 'upsert'
    ? { ...op, item: { ...op.item, id: op.item.id === null ? null : restore(op.item.id) } }
    : { ...op, id: restore(op.id) });
}
function contextCost(state: Snapshot, turns: CommittedTurn[], userText: string): number {
  return estimateTokens({ relationship: state.relationship, mood: state.mood, memory: inferenceMemory(workingMemory(state.memory)), recentConversation: conversationText(turns), userText }) + 512;
}
export function uncompactedTurns(state: Snapshot): CommittedTurn[] {
  return state.turns.filter(t => t.seq > state.meta.compactedThroughSeq);
}
export function needsCompaction(state: Snapshot, userText: string): boolean {
  const raw = uncompactedTurns(state);
  return raw.length > 0 && (contextCost(state, raw, userText) >= LIMITS.COMPACTION_TRIGGER || raw.length >= LIMITS.MAX_RECENT_TURNS - 8);
}
export function compactionRange(state: Snapshot): CommittedTurn[] {
  const raw = uncompactedTurns(state);
  const chosen: CommittedTurn[] = [];
  const memoryCost = estimateTokens(inferenceMemory(workingMemory(state.memory))) + 512;
  // Preserve recent conversational cadence when older context can be compacted.
  const candidates = raw.length > 2 ? raw.slice(0, -2) : raw.slice(0, 1);
  for (const turn of candidates) {
    if (chosen.length >= LIMITS.MAX_RECENT_TURNS || memoryCost + estimateTokens(conversationText([...chosen, turn])) > Math.min(LIMITS.CONTEXT_TARGET, INPUT_DATA_BUDGET)) break;
    chosen.push(turn);
  }
  if (!chosen.length) throw new Error('CONTEXT_LIMIT');
  return chosen;
}
export function recentContext(state: Snapshot, userText: string): CommittedTurn[] {
  const raw = uncompactedTurns(state);
  if (raw.length > LIMITS.MAX_RECENT_TURNS || contextCost(state, raw, userText) > INPUT_DATA_BUDGET) throw new Error('CONTEXT_LIMIT');
  // Archived transcript is for display only. Never reconstruct forgotten facts from it.
  return raw;
}
