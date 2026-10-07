// Public contract ceilings. The backend enforces them again.
export const LIMITS = {
  USER_CHARS: 8_000,
  REPLY_CHARS: 8_000,
  BODY_BYTES: 256 * 1024,
  MODEL_BYTES: 64 * 1024,
  MAX_RECENT_TURNS: 120,
  MAX_MEMORY_ITEMS: 128,
  MAX_MEMORY_OPS: 24,
  MEMORY_TEXT_CHARS: 512,
  INPUT_DATA_HARD_MAX: 16_672,
  // Byte-estimated data budgets, not guarantees about provider token quotas.
  CONTEXT_TARGET: 6_000,
  COMPACTION_TRIGGER: 6_000,
  API_TIMEOUT_MS: 50_000,
  JUST_WOKE_WINDOW_MINUTES: 30,
  SLEEP_FADE_MS: 1_600,
  STORAGE_WARNING_BYTES: 50 * 1024 * 1024,
} as const;

export const STAGE_THRESHOLDS = {
  acquaintance: { familiarity: 15 },
  friend: { familiarity: 35, trust: 30 },
  close_friend: { familiarity: 60, trust: 60, closeness: 55 },
  almost_girlfriend: { familiarity: 80, trust: 82, closeness: 80 },
} as const;

export const RELATIONSHIP_CAPS = {
  routine: { positive: 0, negative: 2 },
  meaningful: { positive: 3, negative: 8 },
  major: { positive: 5, negative: 35 },
} as const;
export const MOOD_DELTA_CAP = 30;
export const MOOD_BASELINE = {
  positive: 10, irritation: 12, sadness: 0, embarrassment: 0,
  concern: 0, jealousy: 0, suspicion: 10,
} as const;
export const MOOD_HALF_LIFE_MINUTES = {
  positive: 120, irritation: 90, sadness: 240, embarrassment: 30,
  concern: 180, jealousy: 60, suspicion: 240,
} as const;
