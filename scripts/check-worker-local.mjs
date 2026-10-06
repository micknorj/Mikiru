import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import assert from 'node:assert/strict';
import { prepareWorker } from './prepare-worker.mjs';
import { localWranglerEnv } from './wrangler-local-env.mjs';
import { request } from '../tests/fixtures.ts';

await mkdir('.private/worker-local-tests', { recursive: true });
const target = await mkdtemp(resolve('.private/worker-local-tests/run-'));
const config = await prepareWorker({ fixture: true, dev: true, target: relative(process.cwd(), target), env: {} });
const value = JSON.parse(await readFile(config, 'utf8'));
value.secrets.required = ['GROQ_API_KEY']; value.vars.MIKIRU_ZDR_CONFIRMED = 'true';
await writeFile(config, JSON.stringify(value));
const workerModule = relative(dirname(config), resolve('backend/worker.ts')).replaceAll('\\', '/');
const fixtureModule = relative(dirname(config), resolve('backend/fixture.ts')).replaceAll('\\', '/');
await writeFile(join(target, 'entry.ts'), `import { createWorker } from '${workerModule}';
import { fixtureProvider } from '${fixtureModule}';
export default createWorker('LOCAL_TECHNICAL_FIXTURE', { fetcher: async (_url, init) => {
  if (init.headers.Authorization !== 'Bearer LOCAL_TEST_KEY') throw new Error('SECRET_NOT_LOADED');
  const body = JSON.parse(init.body);
  const result = await fixtureProvider.complete({ kind: body.response_format ? 'state' : 'dialogue',
    schema: body.response_format?.json_schema.schema, messages: [], signal: init.signal });
  return Response.json({ choices: [{ message: { content: result.text }, finish_reason: 'stop' }] });
} });\n`);
const emptyEnv = join(target, 'process-only.env'); await writeFile(emptyEnv, '# No secret values\n');
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--config', config, '--env-file', emptyEnv],
  { env: localWranglerEnv({ ...process.env, GROQ_API_KEY: 'LOCAL_TEST_KEY' }), stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('LOCAL_WORKER_START_TIMEOUT')); }, 20000);
    const poll = setInterval(() => { if (output.includes('Ready on')) { clearTimeout(timeout); clearInterval(poll); resolve(); } }, 100);
    child.once('exit', () => { clearTimeout(timeout); clearInterval(poll); reject(new Error('LOCAL_WORKER_EXITED')); });
  });
  assert.doesNotMatch(output, /Missing required secrets/);
  const origin = { Origin: 'http://127.0.0.1:5173' }; const base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { ...origin, 'Content-Type': 'application/json' }, body: JSON.stringify(request()) });
  assert.equal(response.status, 200, 'required process secret reaches real Groq adapter, with all provider HTTP intercepted inside the local Worker');
  const accepted = await response.json(); assert.equal(accepted.reply, '[Local fixture] The technical chat flow is working.'); assert.ok(accepted.acceptedStatePatch);
  const artwork = await fetch(`${base}/api/art/mikiru`, { headers: origin });
  assert.ok([200, 404].includes(artwork.status));
  if (artwork.ok) assert.equal(artwork.headers.get('content-type'), 'image/webp');
  await artwork.body?.cancel();
  assert.equal((await fetch(`${base}/mikiru.webp`, { headers: origin })).status, 404);
  console.log('Local Wrangler passed required process-secret loading, real Worker/Groq adapter two-pass validation, static artwork and direct-filename isolation. No live inference.');
} finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGINT'); await once(child, 'exit').catch(() => {}); } }
