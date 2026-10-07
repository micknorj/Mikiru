export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
export type Completion = { text: string; usage?: { promptTokens: number; completionTokens: number } };
export type CompletionInput = { messages: Message[]; kind: 'turn' | 'state'; schema: Record<string, unknown>; signal: AbortSignal };
export interface Provider { complete(input: CompletionInput): Promise<Completion> }
