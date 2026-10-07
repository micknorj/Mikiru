import type { Snapshot } from '../shared/contracts.ts';
export type PendingMessage = {
  localId: string;
  instanceId: string;
  text: string;
  createdAt: string;
  descriptions: boolean;
  status: 'waiting_for_lock' | 'sending' | 'failed';
  abortController: AbortController;
  stagedCompaction?: Snapshot;
};
export type SleepAttempt = { localId: string; text: string; createdAt: string };

// These types have no storage serializer. Each tab's controller owns them in RAM.
