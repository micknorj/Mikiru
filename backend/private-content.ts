import { PRIVATE_LIMITS } from './config.ts';
import { Failure } from './errors.ts';
export interface PrivateContent { runtime(signal: AbortSignal): Promise<string>; artwork(signal: AbortSignal): Promise<Response | null> }
export function validateRuntime(bytes: Uint8Array): string {
  try {
    if (!bytes.byteLength || bytes.byteLength > PRIVATE_LIMITS.runtimeBytes) throw new Error('SIZE');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.trim()) throw new Error('EMPTY');
    return text;
  } catch { throw new Failure('MODEL_UNAVAILABLE', 503); }
}
export function validateArtwork(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 16 || bytes.length > PRIVATE_LIMITS.artBytes ||
      new TextDecoder().decode(bytes.subarray(0, 4)) !== 'RIFF' || new TextDecoder().decode(bytes.subarray(8, 12)) !== 'WEBP' ||
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 !== bytes.length) throw new Failure('INTERNAL_ERROR', 503);
  return bytes;
}
