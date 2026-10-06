import type { Snapshot } from '../shared/contracts.ts';
import { LIMITS } from '../shared/config.ts';
import { compactionRange, needsCompaction, recentContext, workingMemory } from '../shared/context.ts';
import { decayMood } from '../shared/state.ts';
import { ApiFailure, type Api } from './api.ts';
import type { Storage } from './storage.ts';
import type { MultiTab, Notice } from './multitab.ts';
import type { PendingMessage, SleepAttempt } from './pending.ts';
import { localTimeContext, sleepState } from './sleep.ts';

type Dependencies = {
  storage: Storage; api: Pick<Api, 'chat' | 'compact'>;
  tabs: Pick<MultiTab, 'exclusive' | 'resetExclusive' | 'broadcast'>;
  changed: () => void;
  now?: () => Date; online?: () => boolean; descriptions?: () => boolean;
};
function failureMessage(error: unknown, committing: boolean): string {
  if (error instanceof Error && ['STALE_RESPONSE', 'STALE_INSTANCE_OR_REVISION'].includes(error.message)) return 'Chat changed in another tab. Try again.';
  if (error instanceof Error && error.message === 'CONTEXT_LIMIT') return 'Message or chat context is too large.';
  if (committing) return 'Reply could not be saved. Try again.';
  if (error instanceof ApiFailure) {
    switch (error.code) {
      case 'RATE_LIMITED': return 'Too many requests. Wait a moment, then retry.';
      case 'TIMEOUT': return 'The reply took too long. Try again.';
      case 'NETWORK_ERROR': return 'Connection lost. Try again.';
      case 'MODEL_INVALID_OUTPUT': return 'The reply could not be completed. Try again.';
      case 'CONTEXT_LIMIT': return 'Message or chat context is too large.';
    }
  }
  return 'Mikiru is unavailable right now. Try again.';
}
export class Controller {
  state: Snapshot | null = null;
  pending: PendingMessage | null = null;
  sleepAttempts: SleepAttempt[] = [];
  error = '';
  resetting = false;
  private epoch = 0;
  private readonly now: () => Date;
  private readonly online: () => boolean;
  constructor(private readonly deps: Dependencies) {
    this.now = deps.now ?? (() => new Date());
    this.online = deps.online ?? (() => navigator.onLine);
  }
  async initialize(): Promise<void> { this.state = await this.deps.storage.initialize(this.now().toISOString()); this.deps.changed(); }
  private sleepFade(text: string, createdAt: string): void {
    const attempt = { localId: crypto.randomUUID(), text, createdAt };
    this.sleepAttempts.push(attempt); this.deps.changed();
    setTimeout(() => { this.sleepAttempts = this.sleepAttempts.filter(a => a !== attempt); this.deps.changed(); }, LIMITS.SLEEP_FADE_MS);
  }
  async send(text: string): Promise<void> {
    if (!this.state || this.resetting || (this.pending && this.pending.status !== 'failed')) return;
    if (!text.trim()) return;
    if (text.length > LIMITS.USER_CHARS) { this.error = 'Message exceeds 8,000 characters'; this.deps.changed(); return; }
    if (!this.online()) { this.error = 'Offline'; this.deps.changed(); return; }
    this.pending?.abortController.abort(); this.pending = null; this.error = '';
    const createdAt = this.now().toISOString();
    if (sleepState(this.state.meta.sleepSeed, this.now()).asleep) { this.sleepFade(text, createdAt); return; }
    this.pending = { localId: crypto.randomUUID(), instanceId: this.state.meta.instanceId, text, createdAt, descriptions: this.deps.descriptions?.() ?? false, status: 'waiting_for_lock', abortController: new AbortController() };
    this.deps.changed(); await this.process(this.pending);
  }
  async retry(): Promise<void> {
    if (!this.pending || this.pending.status !== 'failed' || !this.online() || this.resetting) return;
    this.error = ''; this.pending.abortController = new AbortController(); this.pending.status = 'waiting_for_lock';
    this.deps.changed(); await this.process(this.pending);
  }
  private alive(pending: PendingMessage, epoch: number): boolean {
    return this.pending === pending && epoch === this.epoch && !pending.abortController.signal.aborted && !this.resetting;
  }
  private matchesInstance(base: Snapshot, pending: PendingMessage, epoch: number): boolean {
    if (!this.alive(pending, epoch)) return false;
    if (base.meta.instanceId !== pending.instanceId) {
      // Broadcast delivery can be delayed. Fresh IDB state still invalidates an old send.
      this.pending = null; this.state = base; return false;
    }
    return true;
  }
  private async process(pending: PendingMessage): Promise<void> {
    const epoch = this.epoch;
    let committing = false;
    try {
      await this.deps.tabs.exclusive(pending.abortController.signal, async () => {
        let base = await this.deps.storage.read();
        if (!this.matchesInstance(base, pending, epoch)) return;
        if (sleepState(base.meta.sleepSeed, this.now()).asleep) { this.pending = null; this.sleepFade(pending.text, pending.createdAt); return; }
        pending.status = 'sending'; this.deps.changed();
        if (needsCompaction(base, pending.text)) {
          try {
            const range = compactionRange(base);
            const result = await this.deps.api.compact({ instanceId: base.meta.instanceId, baseRevision: base.meta.revision, currentMemory: workingMemory(base.memory), turns: range }, pending.abortController.signal);
            if (!this.alive(pending, epoch)) return;
            base = this.deps.storage.prepareCompaction(base, result, range.at(-1)!.seq, this.now().toISOString());

          } catch {
            if (!this.alive(pending, epoch)) return;
            // Failed compaction changes nothing. Safe raw context may still fit this turn.
          }

        }
        if (!this.matchesInstance(base, pending, epoch)) return;
        const now = this.now();
        if (sleepState(base.meta.sleepSeed, now).asleep) { this.pending = null; this.sleepFade(pending.text, pending.createdAt); return; }
        const mood = decayMood(base.mood, now.toISOString());
        const response = await this.deps.api.chat({
          instanceId: base.meta.instanceId, baseRevision: base.meta.revision,
          userMessage: { id: pending.localId, text: pending.text, clientCreatedAt: pending.createdAt },
          relationship: base.relationship, mood, memory: workingMemory(base.memory), recentTurns: recentContext(base, pending.text),
          timeContext: localTimeContext(now, base.meta.lastSuccessfulConversationAt, sleepState(base.meta.sleepSeed, now).justWoke),
          descriptions: pending.descriptions,
        }, pending.abortController.signal);
        if (!this.alive(pending, epoch)) return;
        committing = true;
        const committed = await this.deps.storage.commitTurn(base, response, { id: pending.localId, text: pending.text, createdAt: pending.createdAt }, mood, this.now().toISOString());
        if (!this.alive(pending, epoch)) return;
        this.pending = null;
        this.state = committed;
        this.deps.tabs.broadcast({ type: 'commit' });
      });
    } catch (error) {
      if (!this.alive(pending, epoch)) return;
      pending.status = 'failed'; this.error = this.online() ? failureMessage(error, committing) : 'Offline';
    } finally { this.deps.changed(); }
  }
  abort(): void { this.epoch++; this.pending?.abortController.abort(); this.pending = null; this.sleepAttempts = []; this.error = ''; }
  async notice(notice: Notice): Promise<void> {
    if (notice.type === 'reset') { this.abort(); this.state = null; this.deps.storage.close(); this.deps.changed(); return; }
    if (!this.resetting) {
      const epoch = this.epoch;
      try { const state = await this.deps.storage.read(); if (epoch === this.epoch) { this.state = state; this.deps.changed(); } } catch { /* reset may have removed this database */ }
    }
  }
  async reset(): Promise<void> {
    this.resetting = true; this.abort(); this.state = null; this.deps.changed();
    try {
      await this.deps.tabs.resetExclusive(async () => {
        this.deps.tabs.broadcast({ type: 'reset' });
        await this.deps.storage.reset();
        // This is a new blank instance; all old persistent state has been deleted.
        await this.initialize();
        this.deps.tabs.broadcast({ type: 'commit' });
      });
    } catch { this.error = 'Local storage is unavailable'; }
    finally { this.resetting = false; this.deps.changed(); }
  }
}
