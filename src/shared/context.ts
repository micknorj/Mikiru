import { LIMITS } from './config.ts';
import type { CommittedTurn, Snapshot, StructuredMemory } from './contracts.ts';

// A byte-level upper estimate is deliberately conservative for Qwen's byte-based tokenizer.
// Benchmark against provider token counts before reducing this reserve/estimator.
export const estimateTokens = (value: unknown): number => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
export const INPUT_DATA_BUDGET = LIMITS.INPUT_DATA_HARD_MAX;
export function workingMemory(memory: StructuredMemory): StructuredMemory {
  return { version: 1, items: memory.items.filter(i => i.status === 'active') };
}
function contextCost(state: Snapshot, turns: CommittedTurn[], userText: string): number {
  return estimateTokens({ relationship: state.relationship, mood: state.mood, memory: workingMemory(state.memory), recentTurns: turns, userText }) + 512;
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
  const memoryCost = estimateTokens(workingMemory(state.memory)) + 512;
  for (const turn of raw) {
    if (chosen.length >= LIMITS.MAX_RECENT_TURNS || memoryCost + estimateTokens([...chosen, turn]) > Math.min(LIMITS.CONTEXT_TARGET, INPUT_DATA_BUDGET)) break;
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
