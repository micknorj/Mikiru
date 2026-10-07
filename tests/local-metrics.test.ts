import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalMetrics, type RequestMeasurement } from '../backend/local-metrics.ts';

test('local measurements remain isolated across concurrent requests and record only timings/usage', async () => {
  const records: RequestMeasurement[] = [];
  const metrics = new LocalMetrics(async r => { records.push(r); });
  const provider = metrics.provider({ async complete(input) {
    await new Promise(resolve => setTimeout(resolve, input.kind === 'turn' ? 5 : 1));
    return { text: 'PRIVATE_DIALOGUE', usage: { promptTokens: input.kind === 'turn' ? 100 : 50, completionTokens: 10 } };
  } });
  const result = new Response('PRIVATE_RESPONSE');
  const call = (kind: 'turn' | 'state') => provider.complete({ kind, schema: {}, signal: new AbortController().signal, messages: [{ role: 'system', content: 'PRIVATE_PROMPT' }] });
  await Promise.all([
    metrics.request('/api/chat', async () => { await call('turn'); return result; }),
    metrics.request('/api/compact', async () => { await call('state'); return result; }),
  ]);
  assert.equal(records.length, 2);
  assert.deepEqual(records.find(r => r.route === '/api/chat')!.calls.map(c => c.kind), ['turn']);
  assert.deepEqual(records.find(r => r.route === '/api/compact')!.calls.map(c => c.kind), ['state']);
  assert.equal(JSON.stringify(records).includes('PRIVATE_'), false);
  assert.ok(records.every(r => r.latencyMs >= 0 && r.calls.every(c => c.completed && c.latencyMs >= 0 && c.usage!.completionTokens === 10)));
});
