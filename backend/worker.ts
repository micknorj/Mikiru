import { Core } from './core.ts';
import { modelConfig, PRIVATE_LIMITS } from './config.ts';
import { Failure } from './errors.ts';
import { validateRuntime, type PrivateContent } from './private-content.ts';
import { GroqProvider } from './providers/groq.ts';
import type { Provider } from './provider.ts';
import { createHandler } from './transport.ts';

export type WorkerEnv = {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  ALLOWED_ORIGIN: string;
  GROQ_API_KEY?: string;
  MIKIRU_ZDR_CONFIRMED?: string;
};

// The deployment entry injects a private Text module. Public builds contain only this factory.
export function createWorker(runtime: string, options: { provider?: Provider; fetcher?: typeof fetch } = {}) {
  const privateRuntime = validateRuntime(new TextEncoder().encode(runtime));
  return {
    async fetch(request: Request, env: WorkerEnv): Promise<Response> {
      const content: PrivateContent = {
        async runtime(signal) { signal.throwIfAborted(); return privateRuntime; },
        async artwork(signal) {
          signal.throwIfAborted();
          if (!env.ASSETS) return null;
          // Always address the one prepared asset; request paths never reach the binding directly.
          const asset = await env.ASSETS.fetch(new Request(new URL('/mikiru.webp', request.url), { signal }));
          if (asset.status === 404) { await asset.body?.cancel(); return null; }
          const length = asset.headers.get('content-length');
          if (!asset.ok || asset.headers.get('content-type')?.split(';')[0] !== 'image/webp' ||
              (length !== null && (!/^\d+$/.test(length) || Number(length) > PRIVATE_LIMITS.artBytes))) {
            await asset.body?.cancel(); throw new Failure('INTERNAL_ERROR', 503);
          }
          return asset;
        },
      };
      const provider = options.provider ?? new GroqProvider(async () => {
        if (!env.GROQ_API_KEY || env.MIKIRU_ZDR_CONFIRMED !== 'true') throw new Failure('MODEL_UNAVAILABLE', 503);
        return env.GROQ_API_KEY;
      }, modelConfig(), options.fetcher);
      try { return await createHandler(new Core(provider, content), env.ALLOWED_ORIGIN)(request); }
      catch { return Response.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
    },
  };
}
