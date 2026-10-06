import { createRequire } from 'node:module';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { Core } from '../backend/core.ts';
import { GroqProvider } from '../backend/providers/groq.ts';
import { modelConfig } from '../backend/config.ts';
import { LocalContent } from '../backend/local-content.ts';
import { createLocalServer } from '../backend/local-server.ts';
import { LocalMetrics } from '../backend/local-metrics.ts';
import { newFact, zeroMood } from '../tests/fixtures.ts';

// This test substitutes only Groq's HTTP response. The browser still runs the
// actual UI, API validation, HTTP server, two-pass core and IndexedDB commits.
// It never loads a key or sends data to a provider.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.MIKIRU_PREVIEW_URL ?? 'http://127.0.0.1:5173/';
const origin = new URL(base).origin;
const calls = []; const measurements = []; const browserErrors = []; const hosts = new Set();
let mode = 'success'; let badBackend = false; let networkFailure = false;
let releaseState; let enteredState;
const proposal = { memoryOps: [newFact()], relationshipDelta: { familiarity: 1, trust: 1, closeness: 1, significance: 'meaningful' }, moodDelta: { ...zeroMood, positive: 2 } };
const provider = new GroqProvider(async () => 'LOCAL_TEST_KEY', modelConfig({}), async (url, init) => {
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  const body = JSON.parse(init.body); calls.push(body);
  if (mode === 'rate-limit') return new Response('private provider error', { status: 429 });
  const structured = !!body.response_format;
  if (structured && mode === 'gated') {
    const gate = new Promise(resolve => { releaseState = resolve; });
    enteredState(); await gate;
    init.signal.throwIfAborted();
  }
  const text = structured ? mode === 'invalid-state' ? 'invalid JSON' : JSON.stringify(proposal) : 'Local test reply. <b>Keep this literal.</b>';
  return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 40 } }));
});
const metrics = new LocalMetrics(async measurement => { measurements.push(measurement); });
const localContent = new LocalContent();
const core = new Core(metrics.provider(provider), { runtime: async () => 'PRIVATE_TEST_RUNTIME', artwork: signal => localContent.artwork(signal) });
const server = createLocalServer(core, origin, metrics);
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const api = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const readState = page => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('mikiru'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try {
    const tx = db.transaction(['meta', 'turns', 'memory', 'characterState'], 'readonly');
    const read = (store, all = false) => new Promise((resolve, reject) => { const r = all ? tx.objectStore(store).getAll() : tx.objectStore(store).get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const [meta, turns, memory, character] = await Promise.all([read('meta'), read('turns', true), read('memory'), read('characterState')]);
    return { meta, turns, memory, ...character };
  } finally { db.close(); }
});
const input = page => page.getByRole('textbox', { name: 'Message' });
const send = async (page, text) => { await input(page).fill(text); await input(page).press('Enter'); };
const replies = async (page, count) => page.waitForFunction(n => document.querySelectorAll('.mikiru-message').length === n, count);
const reset = async page => { await send(page, 'reset yourself'); await page.getByRole('button', { name: 'Reset', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.transcript .message').length === 0 && !document.querySelector('.input').disabled); };
const gateNextState = () => { mode = 'gated'; return new Promise(resolve => { enteredState = resolve; }); };
try {
  const context = await browser.newContext({ timezoneId: 'Asia/Bangkok', reducedMotion: 'reduce' });
  await context.route('**/api/**', async route => {
    const req = route.request();
    if (req.url().endsWith('/api/chat') && req.method() === 'POST') {
      if (networkFailure) return route.abort('failed');
      if (badBackend) return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': origin, 'Content-Type': 'application/json' }, body: '{"invalid":true}' });
    }
    return route.continue({ url: `${api}${new URL(req.url()).pathname}` });
  });
  const open = async () => {
    const page = await context.newPage();
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('request', req => hosts.add(new URL(req.url()).hostname));
    await page.clock.install({ time: new Date('2026-10-05T05:00:00Z') });
    await page.goto(base);
    return page;
  };
  const page = await open();
  await page.getByRole('button', { name: 'Start chatting' }).click();
  await send(page, 'My name is Pat.'); await replies(page, 1);
  assert.equal(await page.locator('.message-text b').count(), 0);
  let state = await readState(page);
  assert.equal(state.meta.revision, 1); assert.equal(state.memory.items[0].text, 'The user is called Pat');
  assert.equal(state.relationship.familiarity, 1); assert.equal(state.mood.positive, 12);
  await page.reload(); await page.getByRole('button', { name: 'Continue chatting' }).waitFor();
  assert.equal(await input(page).isVisible(), false, 'reload is Home even with history');
  await page.getByRole('button', { name: 'Continue chatting' }).click();
  await replies(page, 1); assert.deepEqual(await readState(page), state);

  let entered = gateNextState(); await send(page, 'Do not commit before the state pass.'); await entered;
  assert.deepEqual(await readState(page), state);
  assert.equal(await page.locator('.pending-message .read-state').count(), 0);
  assert.equal(await page.locator('.mikiru-message').count(), 1);
  releaseState(); mode = 'success'; await replies(page, 2); state = await readState(page);

  for (const failure of ['invalid-state', 'rate-limit', 'malformed-backend', 'network']) {
    mode = failure; badBackend = failure === 'malformed-backend'; networkFailure = failure === 'network';
    await send(page, `Recover safely from ${failure}.`);
    await page.getByRole('button', { name: 'Retry message', exact: true }).waitFor();
    assert.deepEqual(await readState(page), state, failure);
    assert.equal(await page.locator('.pending-message .read-state').count(), 0);
    assert.equal(await page.locator('.status').innerText(), failure === 'rate-limit' ? 'Too many requests. Wait a moment, then retry.' : failure === 'network' ? 'Connection lost. Try again.' : 'The reply could not be completed. Try again.');
    mode = 'success'; badBackend = false; networkFailure = false;
    const placement=await page.locator('.failed-reply').evaluate(el=>{const bubble=el.querySelector('.message-bubble').getBoundingClientRect(),retry=el.querySelector('.retry').getBoundingClientRect();return {right:retry.left>=bubble.right+7,sameRow:retry.top<bubble.bottom&&retry.bottom>bubble.top,diameter:retry.width,height:retry.height,read:el.querySelector('.read-state')!==null};});
    assert.deepEqual(placement,{right:true,sameRow:true,diameter:44,height:44,read:false});
    await page.getByRole('button', { name: 'Retry message', exact: true }).click(); await replies(page, state.turns.length + 1);
    const committed = await readState(page);
    assert.equal(committed.meta.revision, state.meta.revision + 1); assert.equal(committed.turns.at(-1).user.text, `Recover safely from ${failure}.`);
    state = committed;
  }

  entered = gateNextState(); await send(page, 'Discard this pending turn on reset.'); await entered;
  const oldInstance = state.meta.instanceId; const callsBeforeReset = calls.length;
  await reset(page);
  state = await readState(page); assert.notEqual(state.meta.instanceId, oldInstance);
  assert.equal(state.meta.revision, 0); assert.deepEqual(state.turns, []); assert.deepEqual(state.memory.items, []); assert.equal(state.relationship.familiarity, 0);
  assert.equal(calls.length, callsBeforeReset, 'reset command remains application-level');
  releaseState(); mode = 'success'; await page.waitForTimeout(150);
  assert.deepEqual(await readState(page), state, 'late response cannot revive erased state');

  await page.clock.setSystemTime(new Date('2026-10-05T19:00:00Z'));
  const asleepCalls = calls.length;
  await send(page, 'UNDELIVERED_SLEEP_MESSAGE'); await page.locator('.sleep-fade').waitFor();
  assert.equal(calls.length, asleepCalls); assert.deepEqual(await readState(page), state);
  await page.clock.runFor(1601); assert.equal(await page.locator('.sleep-fade').count(), 0);
  await page.clock.setSystemTime(new Date('2026-10-06T05:00:00Z'));
  await send(page, 'Awake again.'); await replies(page, 1);
  assert.equal(JSON.stringify(calls).includes('UNDELIVERED_SLEEP_MESSAGE'), false);

  const second = await open(); await second.clock.setSystemTime(new Date('2026-10-06T05:00:00Z'));
  await second.getByRole('button', { name: 'Continue chatting' }).click(); await replies(second, 1);
  const beforeTabs = calls.length;
  await Promise.all([send(page, 'First tab turn.'), send(second, 'Second tab turn.')]);
  await replies(page, 3); await replies(second, 3);
  assert.deepEqual(await readState(page), await readState(second));
  assert.equal(calls.length, beforeTabs + 4);
  const recentLengths = calls.slice(beforeTabs).filter(c => !c.response_format).map(c => JSON.parse(c.messages[1].content).recentConversation.length);
  assert.deepEqual(recentLengths, [1, 2], 'Web Lock forces the waiting tab to use newly committed history');
  await reset(second); await replies(page, 0);
  assert.deepEqual(await readState(page), await readState(second));
  assert.deepEqual(browserErrors, []); assert.ok([...hosts].every(host => host === '127.0.0.1'));
  for (const measurement of measurements) {
    assert.equal(JSON.stringify(measurement).includes('PRIVATE_TEST_RUNTIME'), false);
    assert.equal(JSON.stringify(measurement).includes('Pat'), false);
  }
  console.log('Local browser flow passed: separate Groq HTTP/state calls, literal text, atomic commit, real IndexedDB refresh/state, failed state/provider/network/malformed responses, safe retry, reset cancellation, sleep non-delivery, and real multi-tab Web Locks/BroadcastChannel. No live provider calls.');
  await context.close();
} finally {
  releaseState?.(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
