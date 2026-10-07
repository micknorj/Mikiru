import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { prepareWorker } from './prepare-worker.mjs';
try {
  // Public-checkout packaging checks use only synthetic technical inputs.
  // Default behavior still verifies the maintainer's real deployment inputs.
  const fixture = process.argv.includes('--fixture');
  const config = await prepareWorker(fixture ? { fixture: true, dev: true, target: '.private/worker-check-fixture', env: {} } : {});
  const childEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve('.private/wrangler/logs'), CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' };
  // Packaging does not need credentials. Do not pass the local key to Wrangler.
  delete childEnv.GROQ_API_KEY;
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', config, '--outdir', fixture ? '.private/worker-check-package' : '.private/worker-package'], { stdio: 'inherit', env: childEnv });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch { console.error('Private Worker dry-run failed. Check the local runtime and WebP.'); process.exitCode = 1; }
