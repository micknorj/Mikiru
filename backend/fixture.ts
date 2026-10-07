import type { Provider } from './provider.ts';

// Synthetic technical fixture; never selected by a real deployment entry.
export const fixtureProvider: Provider = { async complete(input) {
  return { text: JSON.stringify(input.kind === 'turn' ? {
      reply: '[Local fixture] The technical chat flow is working.',
      memoryOps: [], relationshipDelta: { familiarity: 0, trust: 0, closeness: 0, significance: 'routine' },
      moodDelta: { positive: 0, irritation: 0, sadness: 0, embarrassment: 0, concern: 0, jealousy: 0, suspicion: 0 },
    } : { memoryOps: [] }) };
} };
