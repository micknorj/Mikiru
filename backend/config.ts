import { z } from 'zod';
export const PRIVATE_LIMITS = { runtimeBytes: 128 * 1024, artBytes: 4 * 1024 * 1024, readMs: 5_000 } as const;
export const REQUEST_TIMEOUT_MS = 25_000;
// Selected Qwen model's documented context window. Keep the legacy 2048 reserve.
export const PROVIDER_CONTEXT = { hardMax: 131_072, safetyReserve: 2_048 } as const;
export const modelConfigSchema = z.strictObject({
  dialogueModel: z.string().min(1).max(120), stateModel: z.string().min(1).max(120),
  temperature: z.number().min(0).max(2), topP: z.number().min(0).max(1),
  dialogueTokens: z.number().int().min(1).max(768), stateTokens: z.number().int().min(1).max(2048),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export function modelConfig(env: Record<string, string | undefined> = {}): ModelConfig {
  return modelConfigSchema.parse({ dialogueModel: env.MIKIRU_DIALOGUE_MODEL ?? 'qwen/qwen3.8-27b',
    stateModel: env.MIKIRU_STATE_MODEL ?? env.MIKIRU_DIALOGUE_MODEL ?? 'qwen/qwen3.8-27b',
    temperature: Number(env.MIKIRU_TEMPERATURE ?? 0.7), topP: Number(env.MIKIRU_TOP_P ?? 0.8),
    dialogueTokens: Number(env.MIKIRU_DIALOGUE_TOKENS ?? 768), stateTokens: Number(env.MIKIRU_STATE_TOKENS ?? 2048) });
}
