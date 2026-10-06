import { LIMITS } from '../shared/config.ts';

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function jitter(seed: string, date: string, kind: 'bed' | 'wake'): number {
  let hash = 2166136261;
  for (const c of `${seed}:${date}:${kind}`) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % 11 - 5;
}
export function sleepInterval(seed: string, bedtimeDate: Date): { start: Date; wake: Date } {
  const key = localDateKey(bedtimeDate);
  const start = new Date(bedtimeDate.getFullYear(), bedtimeDate.getMonth(), bedtimeDate.getDate(), 23, jitter(seed, key, 'bed'));
  const wake = new Date(bedtimeDate.getFullYear(), bedtimeDate.getMonth(), bedtimeDate.getDate() + 1, 8, 30 + jitter(seed, key, 'wake'));
  return { start, wake };
}
export function sleepState(seed: string, now: Date): { asleep: boolean; justWoke: boolean } {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const intervals = [sleepInterval(seed, yesterday), sleepInterval(seed, now)];
  return {
    asleep: intervals.some(i => now >= i.start && now < i.wake),
    justWoke: intervals.some(i => now >= i.wake && now.getTime() - i.wake.getTime() < LIMITS.JUST_WOKE_WINDOW_MINUTES * 60_000),
  };
}
export function localTimeContext(now: Date, lastSuccessful: string | null, justWoke: boolean) {
  const pad = (v: number) => String(v).padStart(2, '0');
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
  return {
    localIso: `${localDateKey(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    localWeekday: weekdays[now.getDay()]!,
    elapsedSinceLastSuccessfulConversationMs: lastSuccessful ? Math.max(0, now.getTime() - Date.parse(lastSuccessful)) : null,
    justWoke,
  };
}
