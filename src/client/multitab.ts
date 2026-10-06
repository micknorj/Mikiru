export type Notice = { type: 'commit' | 'reset' };
export const GENERATION_LOCK = 'mikiru:generation';
export const RESET_LOCK = 'mikiru:reset';
export class MultiTab {
  private readonly channel: BroadcastChannel;
  constructor(private readonly onNotice: (notice: Notice) => void) {
    if (!navigator.locks || !globalThis.BroadcastChannel) throw new Error('BROWSER_COORDINATION_UNAVAILABLE');
    this.channel = new BroadcastChannel('mikiru:browser');
    this.channel.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (data && typeof data === 'object' && 'type' in data && Object.keys(data).length === 1 && ['commit', 'reset'].includes(String(data.type))) this.onNotice(data as Notice);
    };
  }
  async exclusive<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    return await navigator.locks.request(GENERATION_LOCK, { mode: 'exclusive', signal }, work);
  }
  async resetExclusive<T>(work: () => Promise<T>): Promise<T> {
    // Separate from generation: reset remains available during slow inference.
    return await navigator.locks.request(RESET_LOCK, { mode: 'exclusive' }, work);
  }
  broadcast(notice: Notice): void { this.channel.postMessage(notice); }
  close(): void { this.channel.close(); }
}
