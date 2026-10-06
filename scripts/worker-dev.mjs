import { spawn } from 'node:child_process';
import { prepareWorker } from './prepare-worker.mjs';
import { dirname, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { localWranglerEnv } from './wrangler-local-env.mjs';
const fixture = process.argv.includes('--fixture');
try {
  if (!fixture && (!process.env.GROQ_API_KEY || process.env.MIKIRU_ZDR_CONFIRMED !== 'true')) throw new Error('PRIVATE_CONFIGURATION_REQUIRED');
  const config = await prepareWorker({ fixture, dev: true, target: fixture ? '.private/worker-fixture' : '.private/worker-dev' });
  const emptyEnv = join(dirname(config), 'process-only.env');
  await writeFile(emptyEnv, '# No values. Required secrets come directly from process memory.\n');
  const environment = localWranglerEnv();
  if (fixture) delete environment.GROQ_API_KEY;
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--config', config, '--env-file', emptyEnv], {
    stdio: ['inherit', 'pipe', 'pipe'], env: environment,
  });
  // Required secrets load directly from this process. No credential file is generated.
  const safeOutput = line => {
    const key = process.env.GROQ_API_KEY;
    // Wrangler masks secret bindings; fail closed if an unexpected line contains one.
    process.stdout.write(key && line.includes(key) ? '[Private output suppressed]\n' : line);
  };
  // Buffer by line so a secret split across pipe chunks cannot escape redaction.
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => { pending += chunk; let end; while ((end = pending.indexOf('\n')) >= 0) { safeOutput(pending.slice(0, end + 1)); pending = pending.slice(end + 1); } });
    stream.on('end', () => { if (pending) safeOutput(pending); });
  }
  child.on('exit', code => { process.exitCode = code ?? 1; });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} catch { console.error('Local Worker could not start. Check the ignored private inputs and backend configuration.'); process.exitCode = 1; }
