import { z } from 'zod';
import { chatRequestSchema, chatResponseSchema, compactRequestSchema, compactResponseSchema, compactEnvelopeSchema, stateProposalSchema, replySchema, statePatchSchema, relationshipSchema, moodSchema } from '../src/shared/contracts.ts';
import { LIMITS } from '../src/shared/config.ts';
import { estimateTokens } from '../src/shared/context.ts';
import { applyMemory, applyMood, applyRelationship, clampMood, clampRelationship, deriveStage } from '../src/shared/state.ts';
import type { Provider } from './provider.ts';
import type { PrivateContent } from './private-content.ts';
import { dialogueMessages, stateMessages, compactMessages } from './prompts.ts';
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
    const characterData = { relationship: r.relationship, mood: r.mood, memory: r.memory, recentTurns: r.recentTurns, userText: r.userMessage.text };
    contextLimit(characterData);
    const runtime = await this.content.runtime(signal);
    signal.throwIfAborted();
    const dialogue = await this.provider.complete({ messages: dialogueMessages(r, runtime), kind: 'dialogue', signal });
    signal.throwIfAborted();
    const parsedReply = replySchema.safeParse(dialogue.text);
    if (!parsedReply.success) throw new Failure('MODEL_INVALID_OUTPUT', 502);
    const state = await this.provider.complete({ messages: stateMessages(r, parsedReply.data, runtime), kind: 'state', schema: z.toJSONSchema(stateProposalSchema, { unrepresentable: 'any' }), signal });
    signal.throwIfAborted();
    const proposal = output(stateProposalSchema, state.text);
    const patch = statePatchSchema.parse({ memoryOps: proposal.memoryOps, relationshipDelta: clampRelationship(proposal.relationshipDelta), moodDelta: clampMood(proposal.moodDelta) });
    try {
      applyMemory(r.memory, patch.memoryOps, r.userMessage.clientCreatedAt);
      relationshipSchema.parse(applyRelationship(r.relationship, patch.relationshipDelta));
      moodSchema.parse(applyMood(r.mood, patch.moodDelta, r.userMessage.clientCreatedAt));
    }
    catch { throw new Failure('MODEL_INVALID_OUTPUT', 502); }
    return chatResponseSchema.parse({ requestId: crypto.randomUUID(), instanceId: r.instanceId, baseRevision: r.baseRevision, reply: parsedReply.data, acceptedStatePatch: patch });
  }
  async compact(raw: unknown, signal: AbortSignal) {
    const r = input(compactRequestSchema, raw);
    contextLimit({ memory: r.currentMemory, turns: r.turns });
    signal.throwIfAborted();
    const result = await this.provider.complete({ messages: compactMessages(r), kind: 'state', schema: z.toJSONSchema(compactEnvelopeSchema, { unrepresentable: 'any' }), signal });
    signal.throwIfAborted();
    const envelope = output(compactEnvelopeSchema, result.text);
    try { applyMemory(r.currentMemory, envelope.memoryOps, new Date().toISOString()); }
    catch { throw new Failure('MODEL_INVALID_OUTPUT', 502); }
    return compactResponseSchema.parse({ requestId: crypto.randomUUID(), instanceId: r.instanceId, baseRevision: r.baseRevision, throughSeq: r.turns.at(-1)!.seq, ...envelope });
  }
}
