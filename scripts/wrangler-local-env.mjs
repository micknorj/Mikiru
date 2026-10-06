import { resolve } from 'node:path';

export function localWranglerEnv(base = process.env) {
  const env = { ...base, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'true',
    WRANGLER_LOG_PATH: resolve('.private/wrangler/logs') };
  // These values have already been validated/prepared as plain Worker vars.
  delete env.ALLOWED_ORIGIN; delete env.MIKIRU_ZDR_CONFIRMED;
  return env;
}
