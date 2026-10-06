import type { ChatRequest, ChatResponse, MemoryOperation, Snapshot } from '../src/shared/contracts.ts';
import { initialMood } from '../src/shared/state.ts';
export const now = '2026-10-05T05:00:00.000Z';
export const zeroMood = { positive: 0, irritation: 0, sadness: 0, embarrassment: 0, concern: 0, jealousy: 0, suspicion: 0 };
export function snapshot(): Snapshot {
  return { meta: { schemaVersion: 1, instanceId: crypto.randomUUID(), revision: 0, createdAt: now, lastSuccessfulConversationAt: null, compactedThroughSeq: 0, sleepSeed: crypto.randomUUID() },
    relationship: { familiarity: 0, trust: 0, closeness: 0, stage: 'stranger' }, mood: initialMood(now), memory: { version: 1, items: [] }, turns: [] };
}
export function request(s = snapshot(), text = 'Hello'): ChatRequest {
  return { instanceId: s.meta.instanceId, baseRevision: s.meta.revision, userMessage: { id: crypto.randomUUID(), text, clientCreatedAt: now },
    relationship: s.relationship, mood: s.mood, memory: s.memory, recentTurns: [], descriptions: false,
    timeContext: { localIso: '2026-10-05T12:00:00', localWeekday: 'Monday', elapsedSinceLastSuccessfulConversationMs: null, justWoke: false } };
}
export function response(r: Pick<ChatRequest, 'instanceId' | 'baseRevision'>): ChatResponse {
  return { requestId: crypto.randomUUID(), instanceId: r.instanceId, baseRevision: r.baseRevision, reply: 'Hi.',
    acceptedStatePatch: { memoryOps: [], relationshipDelta: { familiarity: 0, trust: 0, closeness: 0 }, moodDelta: zeroMood } };
}
export const newFact = (text = 'The user is called Pat'): MemoryOperation => ({ op: 'upsert', item: { id: null, category: 'user.fact', text, importance: 'high', confidence: 1, sensitivity: 'ordinary' } });
