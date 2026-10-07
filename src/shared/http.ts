export async function readBoundedText(response: Response | Request, maxBytes: number, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (Number(response.headers.get('content-length')) > maxBytes) { void response.body?.cancel().catch(() => {}); throw new Error('BODY_LIMIT'); }
  if (!response.body) throw new Error('EMPTY_BODY');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { cancel(); throw new Error('BODY_LIMIT'); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('BODY_ENCODING'); }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
}
