import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const banned = ["Mick's Motions", 'mikiru-v2', 'Mikiru v2', '@cf/', 'turnstile', 'PRIVATE_TEST_RUNTIME', 'LOCAL_TECHNICAL_FIXTURE'];
// Optional maintainer inputs improve local scanning; CI/public builds need none of them.
const privateFragments = [];
for (const path of ['.private/runtime/mikiru.md', 'spec/mikiru.md', 'spec/MIKIRU_LORE_SUPPLEMENT.md']) {
  try { privateFragments.push(...(await readFile(path, 'utf8')).split(/\r?\n/).map(s => s.trim()).filter(s => s.length >= 100)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const privateValues = [];
try {
  for (const line of (await readFile('.private/backend.env', 'utf8')).split(/\r?\n/)) {
    const match = /^(?:GROQ_API_KEY|[A-Z_]*(?:TOKEN|SECRET|PASSWORD|ACCESS_KEY))\s*=\s*(.+)$/.exec(line.trim());
    if (match) { const value = match[1].replace(/^['"]|['"]$/g, ''); if (value.length >= 8) privateValues.push(value); }
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
async function scan(path, frontend) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const file = join(path, item.name);
    if (item.isDirectory()) { await scan(file, frontend); continue; }
    if (frontend && /\.(?:png|webp|ttf)$/i.test(file)) throw new Error(`Private/unsupported frontend asset: ${file}`);
    if (/\.(?:m?js|css|html|json)$/i.test(file)) {
      const text = await readFile(file, 'utf8');
      for (const token of banned) if (text.includes(token)) throw new Error(`Disallowed build content: ${file}`);
      if (privateFragments.some(fragment => text.includes(fragment)) || privateValues.some(value => text.includes(value))) throw new Error(`Private content in build: ${file}`);
      if (/node:|@aws-sdk|aws-content|lambda\.ts|r2_buckets|kv_namespaces/.test(text)) throw new Error(`Retired/runtime dependency in build: ${file}`);
      if (/gsk_[A-Za-z0-9_-]{20,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text)) throw new Error(`Credential in build: ${file}`);
      if (/[A-Za-z]:[\\/]Users[\\/]|\/Users\/|\/home\/[a-z][a-z0-9_-]*\//i.test(text)) throw new Error(`Machine-local path in build: ${file}`);
    }
  }
}
await scan('dist/frontend', true); await scan('dist/worker', false);
console.log('Public artifacts contain no private runtime, artwork, credentials, retired branding or TTF fonts.');
