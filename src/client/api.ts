import { z } from 'zod';
import { apiErrorSchema, chatResponseSchema, compactResponseSchema, type ChatRequest, type CompactRequest, type ErrorCode } from '../shared/contracts.ts';
import { LIMITS } from '../shared/config.ts';
import { readBoundedText } from '../shared/http.ts';

export class ApiFailure extends Error {
  constructor(readonly code: ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT') { super(code); }
}
export function apiBase(value = import.meta.env?.VITE_API_BASE_URL ?? (import.meta.env?.DEV ? 'http://127.0.0.1:8787/' : '')): URL | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('INVALID_API_URL');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
export class Api {
  constructor(readonly base = apiBase(), private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis), private readonly timeoutMs: number = LIMITS.API_TIMEOUT_MS) {}
  private async call<T>(route: string, schema: z.ZodType<T>, body: unknown, signal: AbortSignal): Promise<T> {
    if (!this.base) throw new ApiFailure('MODEL_UNAVAILABLE');
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const response = await this.fetcher(new URL(`api/${route}`, this.base), {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'omit', cache: 'no-store', body: JSON.stringify(body), signal: combined,
      });
      let data: unknown;
      try { data = JSON.parse(await readBoundedText(response, LIMITS.BODY_BYTES)); }
      catch (error) {
        combined.throwIfAborted();
        if (!response.ok) throw new ApiFailure(response.status === 429 ? 'RATE_LIMITED' : 'MODEL_UNAVAILABLE');
        if (error instanceof TypeError) throw new ApiFailure('NETWORK_ERROR');
        throw new ApiFailure('MODEL_INVALID_OUTPUT');
      }
      combined.throwIfAborted();
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(data);
        throw new ApiFailure(response.status === 429 ? 'RATE_LIMITED' : parsed.success ? parsed.data.error.code : 'MODEL_UNAVAILABLE');
      }
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw new ApiFailure('MODEL_INVALID_OUTPUT');
      return parsed.data;
    } catch (error) {
      // A reset/page close owns cancellation and must never create a retryable turn.
      signal.throwIfAborted();
      if (timeout.aborted) throw new ApiFailure('TIMEOUT');
      if (error instanceof ApiFailure) throw error;
      throw new ApiFailure('NETWORK_ERROR');
    }
  }
  chat(request: ChatRequest, signal: AbortSignal) { return this.call('chat', chatResponseSchema, request, signal); }
  compact(request: CompactRequest, signal: AbortSignal) { return this.call('compact', compactResponseSchema, request, signal); }
}
