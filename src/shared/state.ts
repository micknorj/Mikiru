import { LIMITS, MOOD_BASELINE, MOOD_DELTA_CAP, MOOD_HALF_LIFE_MINUTES, RELATIONSHIP_CAPS, STAGE_THRESHOLDS } from './config.ts';
import { memorySchema, type MemoryOperation, type StructuredMemory, type RelationshipState, type RelationshipProposal, type RelationshipDelta, type MoodState, type MoodDelta } from './contracts.ts';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export function deriveStage(r: Omit<RelationshipState, 'stage'>): RelationshipState['stage'] {
  const t = STAGE_THRESHOLDS;
  if (r.familiarity >= t.almost_girlfriend.familiarity && r.trust >= t.almost_girlfriend.trust && r.closeness >= t.almost_girlfriend.closeness) return 'almost_girlfriend';
  if (r.familiarity >= t.close_friend.familiarity && r.trust >= t.close_friend.trust && r.closeness >= t.close_friend.closeness) return 'close_friend';
  if (r.familiarity >= t.friend.familiarity && r.trust >= t.friend.trust) return 'friend';
  if (r.familiarity >= t.acquaintance.familiarity) return 'acquaintance';
  return 'stranger';
}
export function clampRelationship(p: RelationshipProposal): RelationshipDelta {
  const cap = RELATIONSHIP_CAPS[p.significance];
  return { familiarity: clamp(p.familiarity, -cap.negative, cap.positive), trust: clamp(p.trust, -cap.negative, cap.positive), closeness: clamp(p.closeness, -cap.negative, cap.positive) };
}
export function applyRelationship(r: RelationshipState, d: RelationshipDelta): RelationshipState {
  const next = { familiarity: clamp(r.familiarity + d.familiarity, 0, 100), trust: clamp(r.trust + d.trust, 0, 100), closeness: clamp(r.closeness + d.closeness, 0, 100) };
  // The positive caps are below every adjacent threshold gap; a turn cannot jump multiple stages.
  return { ...next, stage: deriveStage(next) };
}
export function initialMood(now: string): MoodState { return { ...MOOD_BASELINE, updatedAt: now }; }
export function decayMood(m: MoodState, now: string): MoodState {
  const minutes = Math.max(0, Date.parse(now) - Date.parse(m.updatedAt)) / 60_000;
  const next = { ...m, updatedAt: now };
  for (const key of Object.keys(MOOD_BASELINE) as (keyof typeof MOOD_BASELINE)[]) {
    next[key] = MOOD_BASELINE[key] + (m[key] - MOOD_BASELINE[key]) * 2 ** (-minutes / MOOD_HALF_LIFE_MINUTES[key]);
  }
  return next;
}
export function clampMood(d: MoodDelta): MoodDelta {
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, clamp(v, -MOOD_DELTA_CAP, MOOD_DELTA_CAP)])) as MoodDelta;
}
export function applyMood(m: MoodState, d: MoodDelta, now: string): MoodState {
  const next = { ...m, updatedAt: now };
  for (const key of Object.keys(d) as (keyof MoodDelta)[]) next[key] = clamp(m[key] + d[key], 0, 100);
  return next;
}
export function applyMemory(memory: StructuredMemory, ops: MemoryOperation[], now: string, newId: () => string = () => crypto.randomUUID()): StructuredMemory {
  const items = memory.items.map(item => ({ ...item }));
  const targets = new Set<string>();
  for (const op of ops) {
    const target = op.op === 'upsert' ? op.item.id : op.id;
    if (target) {
      if (targets.has(target)) throw new Error('AMBIGUOUS_MEMORY_OPERATIONS');
      targets.add(target);
      if (!memory.items.some(i => i.id === target && i.status === 'active')) throw new Error('INVALID_MEMORY_REFERENCE');
    }
    if (op.op === 'upsert') {
      const index = op.item.id ? items.findIndex(i => i.id === op.item.id) : -1;
      const previous = index >= 0 ? items[index] : undefined;
      const item = {
        ...op.item, id: op.item.id ?? newId(), firstSeenAt: previous?.firstSeenAt ?? now,
        lastUpdatedAt: now, lastRelevantAt: now, repetitionCount: (previous?.repetitionCount ?? 0) + 1, status: 'active' as const,
      };
      if (index >= 0) items[index] = item; else items.push(item);
    } else {
      const item = items.find(i => i.id === op.id);
      if (!item || item.status !== 'active') throw new Error('INVALID_MEMORY_REFERENCE');
      item.status = 'superseded'; item.lastUpdatedAt = now;
      if (op.replacementText) items.push({ ...item, id: newId(), text: op.replacementText, firstSeenAt: now, lastRelevantAt: now, repetitionCount: 1, status: 'active' });
    }
  }
  // Superseded records are not working memory. Raw history is retained separately, untouched.
  const active = items.filter(i => i.status === 'active');
  if (active.length > LIMITS.MAX_MEMORY_ITEMS) throw new Error('MEMORY_CAPACITY');
  return memorySchema.parse({ version: 1, items: active });
}
