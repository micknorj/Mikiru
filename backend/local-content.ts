import { readFile, stat } from 'node:fs/promises';
import { validateRuntime, validateArtwork, type PrivateContent } from './private-content.ts';
import { PRIVATE_LIMITS } from './config.ts';
export class LocalContent implements PrivateContent {
  constructor(readonly runtimePath = '.private/runtime/mikiru.md', readonly artPath = '.private/art/mikiru.webp') {}
  async runtime(signal: AbortSignal): Promise<string> {
    if ((await stat(this.runtimePath)).size > PRIVATE_LIMITS.runtimeBytes) throw new Error('RUNTIME_LIMIT');
    return validateRuntime(await readFile(this.runtimePath, { signal }));
  }
  async artwork(signal: AbortSignal): Promise<Response | null> {
    try {
      if ((await stat(this.artPath)).size > PRIVATE_LIMITS.artBytes) throw new Error('ART_LIMIT');
      const bytes = validateArtwork(await readFile(this.artPath, { signal }));
      const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
      const etag = `"${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}"`;
      return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/webp', ETag: etag } });
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
}
