import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createWorker, type WorkerEnv } from '../backend/worker.ts';
import { fixtureProvider } from '../backend/fixture.ts';
import { request } from './fixtures.ts';
import { createHandler } from '../backend/transport.ts';
import { Core } from '../backend/core.ts';
// @ts-expect-error JavaScript preparation helper is executed in Node, never in a Worker.
import { prepareWorker } from '../scripts/prepare-worker.mjs';

const origin = 'https://micknorj.github.io';
const env = (asset: () => Promise<Response> = async () => new Response(null, { status: 404 })): WorkerEnv => ({ ALLOWED_ORIGIN: origin, ASSETS: { fetch: asset } });
function http(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://worker.example${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const webp = new Uint8Array([82, 73, 70, 70, 8, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);

test('Worker uses one structured Groq call through Fetch and fails closed without secrets/ZDR', async () => {
  const calls: Record<string, unknown>[] = [];
  const providerCalls: string[] = [];
  const provider = { complete: async (input: Parameters<typeof fixtureProvider.complete>[0]) => { providerCalls.push(input.kind); return fixtureProvider.complete(input); } };
  const worker = createWorker('SYNTHETIC_CHARACTER', { fetcher: async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    const r = await provider.complete({ kind: 'turn', schema: {}, messages: [], signal: new AbortController().signal });
    return Response.json({ choices: [{ message: { content: r.text }, finish_reason: 'stop' }] });
  } });
  const environment = { ...env(), GROQ_API_KEY: 'synthetic-test-key', MIKIRU_ZDR_CONFIRMED: 'true' };
  const result = await worker.fetch(http('/api/chat', 'POST', request()), environment);
  assert.equal(result.status, 200); assert.deepEqual(providerCalls, ['turn']);
  assert.equal(calls[0]!.model, 'qwen/qwen3.8-27b'); assert.ok(calls[0]!.response_format);
  assert.equal((calls[0]!.response_format as { json_schema: { name: string } }).json_schema.name, 'mikiru_turn');
  assert.equal(JSON.stringify(await result.json()).includes('SYNTHETIC_CHARACTER'), false);
  for (const missing of [env(), { ...environment, MIKIRU_ZDR_CONFIRMED: 'false' }]) {
    assert.equal((await worker.fetch(http('/api/chat', 'POST', request()), missing)).status, 503);
  }
  assert.equal(calls.length, 1);
});

test('Worker artwork streams only fixed ASSETS object with CORS, HEAD, conditional requests and no filename bypass', async () => {
  const paths: string[] = [];
  const environment: WorkerEnv = { ...env(), ASSETS: { fetch: async req => {
    paths.push(new URL(req.url).pathname);
    return new Response(webp, { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(webp.length), ETag: '"test-art"' } });
  } } };
  const worker = createWorker('SYNTHETIC_CHARACTER', { provider: fixtureProvider });
  const result = await worker.fetch(http('/api/art/mikiru'), environment);
  assert.equal(result.status, 200); assert.deepEqual(new Uint8Array(await result.arrayBuffer()), webp);
  assert.equal(result.headers.get('access-control-allow-origin'), origin); assert.match(result.headers.get('cache-control')!, /private/);
  const head = await worker.fetch(http('/api/art/mikiru', 'HEAD'), environment); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await worker.fetch(http('/api/art/mikiru', 'GET', undefined, { 'If-None-Match': 'W/"test-art"' }), environment)).status, 304);
  const options = await worker.fetch(http('/api/art/mikiru', 'OPTIONS'), environment); assert.equal(options.status, 204); assert.match(options.headers.get('access-control-allow-headers')!, /if-none-match/);
  assert.equal((await worker.fetch(http('/mikiru.webp'), environment)).status, 404);
  assert.deepEqual(paths, ['/mikiru.webp', '/mikiru.webp', '/mikiru.webp']);
  assert.equal((await worker.fetch(http('/api/art/mikiru'), env())).status, 404);
  assert.equal((await worker.fetch(http('/api/art/mikiru'), { ALLOWED_ORIGIN: origin })).status, 404);
  assert.equal((await worker.fetch(http('/api/art/mikiru'), env(async () => new Response('bad', { headers: { 'Content-Type': 'text/plain' } })))).status, 503);
  assert.equal((await worker.fetch(http('/api/art/mikiru'), env(async () => new Response(webp, { headers: { 'Content-Type': 'image/png' } })))).status, 503, 'PNG cannot become a runtime fallback');
});

test('Fetch boundary rejects invalid UTF-8 and streamed oversized input before inference', async () => {
  let calls = 0;
  const handler = createHandler(new Core({ complete: async () => { calls++; throw new Error(); } }, { runtime: async () => 'SYNTHETIC_CHARACTER', artwork: async () => null }), origin);
  for (const [body, expected] of [[new Uint8Array([255]), 400], [new Uint8Array(256 * 1024 + 1), 413]] as const) {
    const response = await handler(new Request('https://worker.example/api/chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body }));
    assert.equal(response.status, expected);
  }
  assert.equal(calls, 0);
});

test('request cancellation while reading input is sanitized as unavailable, not malformed input', async () => {
  let calls = 0; let cancelled = false; const owner = new AbortController();
  const handler = createHandler(new Core({ complete: async () => { calls++; throw new Error(); } }, { runtime: async () => 'SYNTHETIC_CHARACTER', artwork: async () => null }), origin);
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } });
  const reading = handler(new Request('https://worker.example/api/chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body, duplex: 'half', signal: owner.signal } as RequestInit));
  owner.abort(); const result = await reading;
  assert.equal(result.status, 503); assert.equal((await result.json()).error.code, 'MODEL_UNAVAILABLE');
  assert.equal(cancelled, true); assert.equal(calls, 0);
});

test('artwork cleanup failures or stalls cannot replace HEAD, conditional or missing-asset status', { timeout: 1000 }, async () => {
  const worker = createWorker('SYNTHETIC_CHARACTER', { provider: fixtureProvider });
  const stream = () => new ReadableStream({ cancel() { throw new Error('PRIVATE_CLEANUP_ERROR'); } });
  const environment = env(async () => new Response(stream(), { headers: { 'Content-Type': 'image/webp', ETag: '"test-art"' } }));
  const head = await worker.fetch(http('/api/art/mikiru', 'HEAD'), environment);
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await worker.fetch(http('/api/art/mikiru', 'GET', undefined, { 'If-None-Match': '"test-art"' }), environment)).status, 304);
  assert.equal((await worker.fetch(http('/api/art/mikiru'), env(async () => new Response(stream(), { status: 404 })))).status, 404);
  const stalled = () => new ReadableStream({ cancel() { return new Promise<void>(() => {}); } });
  assert.equal((await worker.fetch(http('/api/art/mikiru', 'HEAD'), env(async () => new Response(stalled(), { headers: { 'Content-Type': 'image/webp' } })))).status, 200);
  assert.equal((await worker.fetch(http('/api/art/mikiru'), env(async () => new Response(stalled(), { status: 404 })))).status, 404);
});

test('private deployment preparation isolates prompt/artwork and never serializes credentials', async () => {
  await mkdir('.private/test-worker', { recursive: true });
  const directory = await mkdtemp(resolve('.private/test-worker/run-'));
  await writeFile(resolve(directory, 'input.md'), 'SYNTHETIC_CHARACTER'); await writeFile(resolve(directory, 'input.webp'), webp);
  const configPath = await prepareWorker({ target: relative(process.cwd(), resolve(directory, 'prepared')), runtimePath: relative(process.cwd(), resolve(directory, 'input.md')),
    artPath: relative(process.cwd(), resolve(directory, 'input.webp')), env: { GROQ_API_KEY: 'synthetic-private-key', MIKIRU_ZDR_CONFIRMED: 'true' } });
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.assets.run_worker_first, true); assert.equal(config.assets.binding, 'ASSETS');
  assert.equal(config.vars.MIKIRU_ZDR_CONFIRMED, 'true'); assert.equal(config.send_metrics, false);
  assert.deepEqual(await readdir(resolve(directory, 'prepared/assets')), ['mikiru.webp']);
  for (const name of ['wrangler.json', 'entry.ts', 'runtime.txt']) assert.equal((await readFile(resolve(directory, 'prepared', name), 'utf8')).includes('synthetic-private-key'), false);
  assert.equal(await readFile(resolve(directory, 'prepared/runtime.txt'), 'utf8'), 'SYNTHETIC_CHARACTER');
  await assert.rejects(prepareWorker({ target: 'public/private-inputs' }), /OUTPUT_MUST_BE_PRIVATE/);
  await writeFile(resolve(directory, 'prepared/assets/forbidden.txt'), 'synthetic');
  await assert.rejects(prepareWorker({ target: relative(process.cwd(), resolve(directory, 'prepared')), runtimePath: relative(process.cwd(), resolve(directory, 'input.md')), artPath: relative(process.cwd(), resolve(directory, 'input.webp')) }), /ASSETS_DIRECTORY/);
});

test('Worker preparation requires existing WebP and never consumes or converts a source PNG', async () => {
  await mkdir('.private/test-worker', { recursive: true });
  const directory = await mkdtemp(resolve('.private/test-worker/webp-only-'));
  const runtimePath = relative(process.cwd(), resolve(directory, 'input.md'));
  const artPath = relative(process.cwd(), resolve(directory, 'input.webp'));
  const target = relative(process.cwd(), resolve(directory, 'prepared'));
  await writeFile(resolve(directory, 'input.md'), 'SYNTHETIC_CHARACTER');
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]);
  await writeFile(resolve(directory, 'source.png'), png);
  await assert.rejects(prepareWorker({ target, runtimePath, artPath }), /PRIVATE_WEBP_REQUIRED/);
  await writeFile(resolve(directory, 'input.webp'), png);
  await assert.rejects(prepareWorker({ target, runtimePath, artPath }), /PRIVATE_WEBP_REQUIRED/);
  await writeFile(resolve(directory, 'input.webp'), webp);
  await prepareWorker({ target, runtimePath, artPath });
  assert.deepEqual(await readdir(resolve(directory, 'prepared/assets')), ['mikiru.webp']);
  assert.deepEqual(new Uint8Array(await readFile(resolve(directory, 'source.png'))), png, 'maintainer source is preserved and unused');
});

test('private preparation rejects redirected asset directories before writing deployment inputs', async () => {
  await mkdir('.private/test-worker', { recursive: true });
  const directory = await mkdtemp(resolve('.private/test-worker/link-'));
  const prepared = resolve(directory, 'prepared');
  const elsewhere = resolve(directory, 'elsewhere');
  await mkdir(prepared); await mkdir(elsewhere);
  await symlink(elsewhere, resolve(prepared, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareWorker({ target: relative(process.cwd(), prepared), fixture: true, dev: true }), /OUTPUT_LINK_NOT_ALLOWED/);
  assert.deepEqual(await readdir(elsewhere), []);
  assert.deepEqual(await readdir(prepared), ['assets'], 'no runtime/config is written on rejected destinations');
});

test('private preparation rejects linked parent directories before even creating the output', async () => {
  await mkdir('.private/test-worker', { recursive: true });
  const directory = await mkdtemp(resolve('.private/test-worker/parent-link-'));
  const elsewhere = resolve(directory, 'elsewhere'); await mkdir(elsewhere);
  const redirected = resolve(directory, 'redirected');
  await symlink(elsewhere, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareWorker({ target: relative(process.cwd(), resolve(redirected, 'prepared')), fixture: true, dev: true }), /OUTPUT_LINK_NOT_ALLOWED/);
  assert.deepEqual(await readdir(elsewhere), [], 'no private output or directory may be created through a parent link');
});

test('active runtime/configuration contains no AWS dependencies, R2, retired Cloudflare bindings or automatic Worker deployment', async () => {
  const packageText = await readFile('package.json', 'utf8');
  assert.doesNotMatch(packageText, /@aws-sdk|build-backend|lambda/i);
  for (const path of ['wrangler.json', 'backend/worker.ts', 'backend/transport.ts', '.github/workflows/pages.yml']) {
    const text = await readFile(path, 'utf8');
    assert.doesNotMatch(text, /r2_buckets|\bR2\b|kv_namespaces|turnstile|workers\.ai|rate_limit|aws-sdk|wrangler deploy/i);
  }
  assert.equal((await readdir('backend')).some(name => /aws|lambda/i.test(name)), false);
});
