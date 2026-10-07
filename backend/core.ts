import { z } from 'zod';
import { chatRequestSchema, chatResponseSchema, compactRequestSchema, compactResponseSchema, compactEnvelopeSchema, turnEnvelopeSchema, statePatchSchema, relationshipSchema, moodSchema } from '../src/shared/contracts.ts';
import { LIMITS } from '../src/shared/config.ts';
import { estimateTokens, conversationText, inferenceMemory, restoreMemoryReferences } from '../src/shared/context.ts';
import { applyMemory, applyMood, applyRelationship, clampMood, clampRelationship, deriveStage } from '../src/shared/state.ts';
import type { Provider } from './provider.ts';
import type { PrivateContent } from './private-content.ts';
import { turnMessages, compactMessages } from './prompts.ts';
import { Failure } from './errors.ts';
function input<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new Failure('INVALID_REQUEST', 400);
  return result.data;
}
function output<T>(schema: z.ZodType<T>, text: string): T {
  try {
    if (new TextEncoder().encode(text).byteLength > LIMITS.MODEL_BYTES) throw new Error('SIZE');
    return schema.parse(JSON.parse(text));
  } catch { throw new Failure('MODEL_INVALID_OUTPUT', 502); }
}
function contextLimit(data: unknown) {
  if (estimateTokens(data) + 512 > LIMITS.INPUT_DATA_HARD_MAX) throw new Failure('CONTEXT_LIMIT', 413);
}
export class Core {
  constructor(readonly provider: Provider, readonly content: PrivateContent) {}
  async chat(raw: unknown, signal: AbortSignal) {
    const r = input(chatRequestSchema, raw);
    if (r.userMessage.text.trim().toLowerCase() === 'reset yourself' || r.relationship.stage !== deriveStage(r.relationship) || r.memory.items.some(i => i.status !== 'active')) throw new Failure('INVALID_REQUEST', 400);
    const characterData = { relationship: r.relationship, mood: r.mood, memory: inferenceMemory(r.memory), recentConversation: conversationText(r.recentTurns), userText: r.userMessage.text };
    contextLimit(characterData);
    const runtime = await this.content.runtime(signal);
    signal.throwIfAborted();
    const result = await this.provider.complete({ messages: turnMessages(r, runtime), kind: 'turn', schema: z.toJSONSchema(turnEnvelopeSchema, { unrepresentable: 'any' }), signal });
    signal.throwIfAborted();
    const proposal = output(turnEnvelopeSchema, result.text);
    let memoryOps;
    try { memoryOps = restoreMemoryReferences(proposal.memoryOps, r.memory); }
    catch { throw new Failure('MODEL_INVALID_OUTPUT', 502); }
    const patch = statePatchSchema.parse({ memoryOps, relationshipDelta: clampRelationship(proposal.relationshipDelta), moodDelta: clampMood(proposal.moodDelta) });
    try {
      applyMemory(r.memory, patch.memoryOps, r.userMessage.clientCreatedAt);
      relationshipSchema.parse(applyRelationship(r.relationship, patch.relationshipDelta));
      moodSchema.parse(applyMood(r.mood, patch.moodDelta, r.userMessage.clientCreatedAt));
    }
    catch { throw new Failure('MODEL_INVALID_OUTPUT', 502); }
    signal.throwIfAborted();
    return chatResponseSchema.parse({ requestId: crypto.randomUUID(), instanceId: r.instanceId, baseRevision: r.baseRevision, reply: proposal.reply, acceptedStatePatch: patch });
  }
  async compact(raw: unknown, signal: AbortSignal) {
    const r = input(compactRequestSchema, raw);
    contextLimit({ memory: inferenceMemory(r.currentMemory), conversation: conversationText(r.turns) });
    signal.throwIfAborted();
    const result = await this.provider.complete({ messages: compactMessages(r), kind: 'state', schema: z.toJSONSchema(compactEnvelopeSchema, { unrepresentable: 'any' }), signal });
    signal.throwIfAborted();
    const envelope = output(compactEnvelopeSchema, result.text);
    let memoryOps;
    try { memoryOps = restoreMemoryReferences(envelope.memoryOps, r.currentMemory); applyMemory(r.currentMemory, memoryOps, new Date().toISOString()); }
    catch { throw new Failure('MODEL_INVALID_OUTPUT', 502); }
    return compactResponseSchema.parse({ requestId: crypto.randomUUID(), instanceId: r.instanceId, baseRevision: r.baseRevision, throughSeq: r.turns.at(-1)!.seq, memoryOps });
  }
}
