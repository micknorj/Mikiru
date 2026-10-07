import { z } from 'zod';
import { LIMITS, MOOD_DELTA_CAP } from './config.ts';

// Use interpreted validation in the browser and backend.
z.config({ jitless: true });

export const uuid = z.uuid();
export const iso = z.iso.datetime({ offset: true });
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const score = z.number().finite().min(0).max(100);
const delta = z.number().finite().min(-100).max(100);
const moodFields = {
  positive: score, irritation: score, sadness: score, embarrassment: score,
  concern: score, jealousy: score, suspicion: score,
};
const moodDeltaFields = {
  positive: delta, irritation: delta, sadness: delta, embarrassment: delta,
  concern: delta, jealousy: delta, suspicion: delta,
};
export const moodSchema = z.strictObject({ ...moodFields, updatedAt: iso });
export const moodDeltaSchema = z.strictObject(moodDeltaFields);
export const acceptedMoodDeltaSchema = moodDeltaSchema.refine(v => Object.values(v).every(n => Math.abs(n) <= MOOD_DELTA_CAP));
export const relationshipSchema = z.strictObject({
  familiarity: score, trust: score, closeness: score,
  stage: z.enum(['stranger', 'acquaintance', 'friend', 'close_friend', 'almost_girlfriend']),
});
export const relationshipDeltaSchema = z.strictObject({ familiarity: delta, trust: delta, closeness: delta });
export const relationshipProposalSchema = relationshipDeltaSchema.extend({ significance: z.enum(['routine', 'meaningful', 'major']) });
export const acceptedRelationshipDeltaSchema = relationshipDeltaSchema.refine(v => Object.values(v).every(n => n >= -35 && n <= 5));
const memoryContent = {
  category: z.enum(['user.fact', 'user.preference', 'user.person', 'sharedEvent', 'unfinishedTopic', 'importantHistory', 'relationshipHistory']),
  text: z.string().min(1).max(LIMITS.MEMORY_TEXT_CHARS).refine(v => v.trim().length > 0),
  importance: z.enum(['low', 'medium', 'high']),
  confidence: z.number().finite().min(0).max(1),
  sensitivity: z.enum(['ordinary', 'sensitive']),
};
const memoryId = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
export const memoryItemSchema = z.strictObject({
  id: memoryId, ...memoryContent, firstSeenAt: iso, lastUpdatedAt: iso,
  lastRelevantAt: iso.nullable(), repetitionCount: count, status: z.enum(['active', 'superseded']),
});
export const memorySchema = z.strictObject({ version: z.literal(1), items: z.array(memoryItemSchema).max(LIMITS.MAX_MEMORY_ITEMS) })
  .refine(v => new Set(v.items.map(i => i.id)).size === v.items.length);
export const memoryOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('upsert'), item: z.strictObject({ id: memoryId.nullable(), ...memoryContent }) }),
  z.strictObject({ op: z.literal('supersede'), id: memoryId, replacementText: memoryContent.text.nullable() }),
]);
export const memoryOpsSchema = z.array(memoryOperationSchema).max(LIMITS.MAX_MEMORY_OPS);
export const turnSchema = z.strictObject({
  seq: count.min(1), turnId: uuid,
  user: z.strictObject({ text: z.string().min(1).max(LIMITS.USER_CHARS), createdAt: iso }),
  assistant: z.strictObject({ text: z.string().min(1).max(LIMITS.REPLY_CHARS), createdAt: iso }),
  committedAt: iso, revisionAfter: count.min(1),
});
const turns = z.array(turnSchema).max(LIMITS.MAX_RECENT_TURNS)
  .refine(v => v.every((t, i) => i === 0 || t.seq === v[i - 1]!.seq + 1));
export const metaSchema = z.strictObject({
  schemaVersion: z.literal(1), instanceId: uuid, revision: count, createdAt: iso,
  lastSuccessfulConversationAt: iso.nullable(), compactedThroughSeq: count, sleepSeed: uuid,
});
export const timeContextSchema = z.strictObject({
  localIso: z.iso.datetime({ local: true }),
  localWeekday: z.enum(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']),
  elapsedSinceLastSuccessfulConversationMs: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  justWoke: z.boolean(),
});
export const chatRequestSchema = z.strictObject({
  instanceId: uuid, baseRevision: count,
  userMessage: z.strictObject({ id: uuid, text: z.string().min(1).max(LIMITS.USER_CHARS).refine(v => v.trim().length > 0), clientCreatedAt: iso }),
  relationship: relationshipSchema, mood: moodSchema, memory: memorySchema,
  recentTurns: turns, timeContext: timeContextSchema, descriptions: z.boolean().default(false),
});
export const replySchema = z.string().min(1).max(LIMITS.REPLY_CHARS).refine(v => v.trim().length > 0);
export const stateProposalSchema = z.strictObject({
  memoryOps: memoryOpsSchema, relationshipDelta: relationshipProposalSchema, moodDelta: moodDeltaSchema,
});
// Provider-only envelope. The HTTP/browser response remains chatResponseSchema.
export const turnEnvelopeSchema = z.strictObject({ reply: replySchema, ...stateProposalSchema.shape });
export const statePatchSchema = z.strictObject({
  memoryOps: memoryOpsSchema, relationshipDelta: acceptedRelationshipDeltaSchema, moodDelta: acceptedMoodDeltaSchema,
});
export const chatResponseSchema = z.strictObject({
  requestId: uuid, instanceId: uuid, baseRevision: count,
  reply: replySchema, acceptedStatePatch: statePatchSchema,
});
export const compactRequestSchema = z.strictObject({ instanceId: uuid, baseRevision: count, currentMemory: memorySchema, turns: turns.refine(v => v.length > 0) });
export const compactResponseSchema = z.strictObject({ requestId: uuid, instanceId: uuid, baseRevision: count, throughSeq: count.min(1), memoryOps: memoryOpsSchema });
export const compactEnvelopeSchema = z.strictObject({ memoryOps: memoryOpsSchema });
export const errorCodeSchema = z.enum(['INVALID_REQUEST', 'RATE_LIMITED', 'MODEL_UNAVAILABLE', 'MODEL_INVALID_OUTPUT', 'CONTEXT_LIMIT', 'INTERNAL_ERROR']);
export const apiErrorSchema = z.strictObject({ error: z.strictObject({ code: errorCodeSchema, requestId: uuid.optional() }) });

export type MoodState = z.infer<typeof moodSchema>;
export type MoodDelta = z.infer<typeof moodDeltaSchema>;
export type RelationshipState = z.infer<typeof relationshipSchema>;
export type RelationshipDelta = z.infer<typeof relationshipDeltaSchema>;
export type RelationshipProposal = z.infer<typeof relationshipProposalSchema>;
export type MemoryItem = z.infer<typeof memoryItemSchema>;
export type StructuredMemory = z.infer<typeof memorySchema>;
export type MemoryOperation = z.infer<typeof memoryOperationSchema>;
export type MetaState = z.infer<typeof metaSchema>;
export type CommittedTurn = z.infer<typeof turnSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type CompactRequest = z.infer<typeof compactRequestSchema>;
export type CompactResponse = z.infer<typeof compactResponseSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type Snapshot = { meta: MetaState; relationship: RelationshipState; mood: MoodState; memory: StructuredMemory; turns: CommittedTurn[] };
