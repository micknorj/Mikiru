import { z } from 'zod';
import type { CompletionInput, Provider } from '../provider.ts';
import type { ModelConfig } from '../config.ts';
import { PROVIDER_CONTEXT } from '../config.ts';
import { estimateTokens } from '../../src/shared/context.ts';
import { Failure } from '../errors.ts';
import { LIMITS } from '../../src/shared/config.ts';
import { readBoundedText } from '../../src/shared/http.ts';
const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1), refusal: z.string().nullable().optional() }), finish_reason: z.literal('stop') })).length(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional(),
});
export class GroqProvider implements Provider {
  constructor(private readonly key: () => Promise<string>, readonly settings: ModelConfig,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  async complete(input: CompletionInput) {
    input.signal.throwIfAborted();
    const outputTokens = input.kind === 'state' ? this.settings.stateTokens : this.settings.dialogueTokens;
    if (estimateTokens({ messages: input.messages, schema: input.schema }) + outputTokens + PROVIDER_CONTEXT.safetyReserve > PROVIDER_CONTEXT.hardMax) throw new Failure('CONTEXT_LIMIT', 413);
    const key = await this.key();
    input.signal.throwIfAborted();
    if (!key || key.length > 4096) throw new Failure('MODEL_UNAVAILABLE', 503);
    const compacting = input.kind === 'state';
    const response = await this.fetcher('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({ model: compacting ? this.settings.stateModel : this.settings.dialogueModel,
        messages: input.messages, temperature: this.settings.temperature, top_p: this.settings.topP,
        reasoning_effort: 'none', max_completion_tokens: outputTokens,
        stream: false, response_format: { type: 'json_schema', json_schema: { name: compacting ? 'mikiru_state' : 'mikiru_turn', strict: true, schema: input.schema } } }),
    });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Failure(response.status === 429 ? 'RATE_LIMITED' : 'MODEL_UNAVAILABLE', response.status === 429 ? 429 : 503); }
    try {
      const parsed = completionSchema.parse(JSON.parse(await readBoundedText(response, LIMITS.MODEL_BYTES, input.signal)));
      const choice = parsed.choices[0]!;
      if (choice.message.refusal) throw new Error('REFUSAL');
      input.signal.throwIfAborted();
      return { text: choice.message.content, ...(parsed.usage ? { usage: { promptTokens: parsed.usage.prompt_tokens, completionTokens: parsed.usage.completion_tokens } } : {}) };
    } catch (error) {
      input.signal.throwIfAborted();
      throw new Failure(error instanceof TypeError ? 'MODEL_UNAVAILABLE' : 'MODEL_INVALID_OUTPUT', error instanceof TypeError ? 503 : 502);
    }
  }
}
