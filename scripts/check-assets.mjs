import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) { await scan(file); continue; }
    if (/\.(png|jpe?g|ttf)$/i.test(file)) throw new Error(`Unsupported runtime asset: ${file}`);
    if (/\.(ts|m?js|css|html|json)$/i.test(file)) {
      const text = await readFile(file, 'utf8');
      if (/\.(?:png|jpe?g|ttf)\b|image\/(?:png|jpeg)|data:image\//i.test(text)) throw new Error(`Unsupported runtime asset dependency: ${file}`);
    }
  }
}
for (const path of ['src', 'backend', 'public', 'dist/frontend', 'dist/worker']) await scan(path);
for (const file of ['scripts/prepare-worker.mjs', 'scripts/build-worker.mjs', 'scripts/worker-dev.mjs']) {
  if (/\.png\b|image\/png/i.test(await readFile(file, 'utf8'))) throw new Error(`PNG deployment dependency: ${file}`);
}
// Private preparation is optional for a public checkout; when present it must be WebP-only.
try {
  const files = await readdir('.private/worker/assets');
  if (files.some(file => file !== 'mikiru.webp')) throw new Error('Worker static assets must contain only the private WebP.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log('WebP-only artwork runtime/deployment paths and WOFF2-only fonts passed; no PNG dependency or conversion step in application builds.');
