import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Completion, Provider } from './provider.ts';

type CallMeasurement = { kind: 'dialogue' | 'state'; latencyMs: number; completed: boolean; usage?: Completion['usage'] };
export type RequestMeasurement = { recordedAt: string; route: '/api/chat' | '/api/compact'; status: number; latencyMs: number; calls: CallMeasurement[] };
const elapsed = (start: number) => Math.round((performance.now() - start) * 100) / 100;

// Imported only by the local entry point. No content, state, credentials or
// client identifiers are accepted by this recorder or sent over the network.
export class LocalMetrics {
  private readonly scope = new AsyncLocalStorage<CallMeasurement[]>();
  constructor(private readonly record: (measurement: RequestMeasurement) => Promise<void>) {}
  provider(provider: Provider): Provider {
    return { complete: async input => {
      const start = performance.now();
      const measurement: CallMeasurement = { kind: input.kind, latencyMs: 0, completed: false };
      this.scope.getStore()?.push(measurement);
      try {
        const result = await provider.complete(input);
        measurement.completed = true;
        if (result.usage) measurement.usage = result.usage;
        return result;
      } finally { measurement.latencyMs = elapsed(start); }
    } };
  }
  async request(route: string, action: () => Promise<Response>): Promise<Response> {
    if (route !== '/api/chat' && route !== '/api/compact') return action();
    const start = performance.now();
    const calls: CallMeasurement[] = [];
    const result = await this.scope.run(calls, action);
    try { await this.record({ recordedAt: new Date().toISOString(), route, status: result.status, latencyMs: elapsed(start), calls }); }
    catch { console.warn('Local measurements could not be written.'); }
    return result;
  }
}

export function localMetricsFile(path = '.private/metrics/requests.jsonl'): LocalMetrics {
  return new LocalMetrics(async measurement => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(measurement)}\n`, { mode: 0o600 });
  });
}
