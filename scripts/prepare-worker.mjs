import { readFile, writeFile, mkdir, realpath, readdir } from 'node:fs/promises';
import { resolve, relative, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateRuntime, validateArtwork } from '../backend/private-content.ts';

const root = resolve(import.meta.dirname, '..');
export async function prepareWorker({ fixture = false, dev = false, target = '.private/worker',
  runtimePath = '.private/runtime/mikiru.md', artPath = '.private/art/mikiru.webp', env = process.env } = {}) {
  const directory = resolve(root, target);
  const privateRoot = resolve(root, '.private');
  const child = relative(privateRoot, directory);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('OUTPUT_MUST_BE_PRIVATE');
  await mkdir(directory, { recursive: true });
  const actualChild = relative(await realpath(privateRoot), await realpath(directory));
  if (actualChild.startsWith('..') || isAbsolute(actualChild)) throw new Error('OUTPUT_MUST_BE_PRIVATE');
  const runtime = fixture ? 'LOCAL_TECHNICAL_FIXTURE' : validateRuntime(await readFile(resolve(root, runtimePath)));
  let artwork;
  try { artwork = validateArtwork(await readFile(resolve(root, artPath))); }
  catch (error) { if (error.code !== 'ENOENT' || !dev) throw new Error('PRIVATE_WEBP_REQUIRED'); }
  const assets = join(directory, 'assets');
  await mkdir(assets, { recursive: true });
  if ((await readdir(assets)).some(name => name !== 'mikiru.webp')) throw new Error('ASSETS_DIRECTORY_MUST_CONTAIN_ONLY_WEBP');
  if (artwork) await writeFile(join(assets, 'mikiru.webp'), artwork);
  else if ((await readdir(assets)).length) throw new Error('STALE_PRIVATE_ARTWORK');
  await writeFile(join(directory, 'runtime.txt'), runtime, { mode: 0o600 });
  const worker = relative(directory, join(root, 'backend/worker.ts')).replaceAll('\\', '/');
  const fixtureModule = relative(directory, join(root, 'backend/fixture.ts')).replaceAll('\\', '/');
  await writeFile(join(directory, 'entry.ts'), `import runtime from './runtime.txt';\nimport { createWorker } from '${worker}';\n${fixture ? `import { fixtureProvider } from '${fixtureModule}';\n` : ''}export default createWorker(runtime${fixture ? ', { provider: fixtureProvider }' : ''});\n`);
  const config = JSON.parse(await readFile(join(root, 'wrangler.json'), 'utf8'));
  delete config.$schema;
  config.main = './entry.ts'; config.assets.directory = './assets';
  config.vars.MIKIRU_ZDR_CONFIRMED = env.MIKIRU_ZDR_CONFIRMED === 'true' ? 'true' : 'false';
  if (dev) config.vars.ALLOWED_ORIGIN = 'http://127.0.0.1:5173';
  if (fixture) config.secrets.required = [];
  // Never serialize the provider key, process environment or machine-local paths.
  await writeFile(join(directory, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');
  return join(directory, 'wrangler.json');
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try { await prepareWorker(); console.log('Private Worker inputs prepared locally. No deployment performed.'); }
  catch { console.error('Worker preparation failed. Check the private runtime and WebP inputs.'); process.exitCode = 1; }
}
