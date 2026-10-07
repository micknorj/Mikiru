import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.MIKIRU_PREVIEW_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true }), results = [];
const zeroMood = { positive: 0, irritation: 0, sadness: 0, embarrassment: 0, concern: 0, jealousy: 0, suspicion: 0 };
const readState = page => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('mikiru'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try {
    const tx = db.transaction(['meta', 'turns', 'memory', 'characterState'], 'readonly');
    const read = (store, all = false) => new Promise((resolve, reject) => { const r = all ? tx.objectStore(store).getAll() : tx.objectStore(store).get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const [meta, turns, memory, character] = await Promise.all([read('meta'), read('turns', true), read('memory'), read('characterState')]);
    return { meta, turns, memory, ...character };
  } finally { db.close(); }
});
const visible = page => page.evaluate(() => ({ landing: !document.querySelector('.landing').hidden, chat: !document.querySelector('.chat').hidden, transcript: document.querySelector('.transcript').getBoundingClientRect().height > 0, composer: document.querySelector('.composer').getBoundingClientRect().height > 0 }));
const assertLanding = async (page, label) => {
  await page.getByRole('button', { name: label, exact: true }).waitFor();
  assert.deepEqual(await visible(page), { landing: true, chat: false, transcript: false, composer: false });
};
const send = async (page, text) => { const input = page.getByRole('textbox', { name: 'Message' }); await input.fill(text); await input.press('Enter'); };
await mkdir('.private/screenshots', { recursive: true });
try {
  for (const appearance of ['light', 'dark']) for (const [width, height] of [[390, 844], [1920, 1200]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: appearance, timezoneId: 'Asia/Bangkok', reducedMotion: 'no-preference' });
    let mode = 'success', unavailable = false, calls = 0, release, entered;
    const errors = [], hosts = new Set();
    await context.route('**/api/**', async route => {
      if (unavailable) return route.abort('failed');
      if (new URL(route.request().url()).pathname.endsWith('/api/art/mikiru')) return route.continue();
      assert.ok(route.request().url().endsWith('/api/chat'), 'navigation never compacts or calls another endpoint');
      calls++;
      if (mode === 'pending') { entered(); await new Promise(resolve => { release = resolve; }); }
      if (mode === 'failure') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      const request = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: crypto.randomUUID(), instanceId: request.instanceId, baseRevision: request.baseRevision, reply: 'A committed technical test reply.', acceptedStatePatch: { memoryOps: [], relationshipDelta: { familiarity: 0, trust: 0, closeness: 0 }, moodDelta: zeroMood } }) });
    });
    // Delay the actual first IndexedDB open, without changing application data. This
    // reproduces slow storage and proves the default CTA cannot flash before a read.
    await context.addInitScript(() => {
      const original = indexedDB.open.bind(indexedDB);
      indexedDB.open = (...args) => {
        const callbacks = {}; let actual;
        const proxy = new Proxy(callbacks, { get: (target, key) => key === 'result' || key === 'error' ? actual?.[key] : target[key] });
        window.__releaseDatabase = () => {
          indexedDB.open = original; actual = original(...args);
          for (const event of ['onsuccess', 'onerror', 'onblocked', 'onupgradeneeded']) actual[event] = e => callbacks[event]?.(e);
        };
        return proxy;
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message)); page.on('request', req => hosts.add(new URL(req.url()).hostname));
    await page.clock.install({ time: new Date('2026-10-06T05:00:00Z') });
    const releaseStorage = async () => {
      await page.waitForFunction(() => typeof window.__releaseDatabase === 'function');
      assert.deepEqual(await visible(page), { landing: true, chat: false, transcript: false, composer: false });
      assert.equal(await page.locator('.landing-actions .primary').isVisible(), false, 'only unresolved CTA is hidden, not the landing page');
      assert.equal(await page.getByRole('button', { name: 'About', exact: true }).isVisible(), true);
      await page.evaluate(() => window.__releaseDatabase());
    };
    await page.goto(base); await releaseStorage(); await assertLanding(page, 'Start chatting'); assert.equal(calls, 0);
    // Unrelated local fixture records cannot influence the current Mikiru instance.
    await page.evaluate(async () => {
      const r = indexedDB.open('unrelated-local-fixture', 1); r.onupgradeneeded = () => r.result.createObjectStore('turns');
      const db = await new Promise(resolve => { r.onsuccess = () => resolve(r.result); });
      const tx = db.transaction('turns', 'readwrite'); tx.objectStore('turns').put({ user: 'Unrelated fixture', assistant: 'Not this instance' }, 1);
      await new Promise(resolve => { tx.oncomplete = resolve; }); db.close();
    });
    await assertLanding(page, 'Start chatting');
    await page.waitForFunction(() => document.querySelector('.artwork').classList.contains('is-ready') && !document.querySelector('.artwork').getAnimations().length);
    const image = await page.locator('.portrait').elementHandle();
    const startPaused = async () => page.evaluate(() => {
      document.querySelector('.landing-actions .primary').click(); window.__motion = document.querySelector('.artwork').getAnimations()[0];
      window.__motion.pause(); window.__motion.currentTime = 0;
    });
    const finish = async () => {
      await page.evaluate(() => window.__motion.finish());
      await page.waitForFunction(() => !document.querySelector('.artwork').classList.contains('is-transitioning') && !document.querySelector('.chat').hidden);
      assert.equal(await page.getByRole('textbox', { name: 'Message' }).isVisible(), true);
      assert.equal(await page.locator('.portrait').evaluate((el, original) => el === original, image), true);
    };
    await startPaused();
    for (const time of [0, 310]) {
      await page.evaluate(time => window.__motion.currentTime = time, time);
      assert.deepEqual(await visible(page), { landing: false, chat: false, transcript: false, composer: false });
    }
    const repeated = await page.evaluate(() => { const old = window.__motion; document.querySelector('.landing-actions .primary').click(); return document.querySelector('.artwork').getAnimations()[0] === old; });
    assert.equal(repeated, true, 'same-target navigation must not restart artwork');
    await page.evaluate(() => window.__motion.currentTime = 619.999);
    assert.deepEqual(await visible(page), { landing: false, chat: false, transcript: false, composer: false });
    await finish(); assert.equal(calls, 0, 'chat entry itself sends no request');
    await page.getByRole('button', { name: 'Mikiru Home' }).click(); await assertLanding(page, 'Start chatting');
    await page.waitForFunction(() => !document.querySelector('.artwork').getAnimations().length);
    await startPaused(); await page.evaluate(() => window.__motion.currentTime = 310);
    await page.setViewportSize({ width, height: height + 1 });
    await page.getByRole('textbox', { name: 'Message' }).waitFor();
    assert.equal(await page.locator('.artwork').evaluate(el => el.getAnimations().length), 0, 'resize settles the art and releases entry');
    await page.setViewportSize({ width, height });
    mode = 'pending'; const pendingEntered = new Promise(resolve => { entered = resolve; }); await send(page, 'Pending technical test attempt'); await pendingEntered;
    await page.getByRole('button', { name: 'Mikiru Home' }).click(); await assertLanding(page, 'Start chatting');
    mode = 'failure'; release(); await page.waitForFunction(() => document.querySelector('.failed-reply') !== null); await assertLanding(page, 'Start chatting');
    assert.equal((await readState(page)).turns.length, 0);
    await page.getByRole('button', { name: 'Start chatting' }).click(); await page.getByRole('button', { name: 'Retry message' }).waitFor();
    mode = 'success'; await page.getByRole('button', { name: 'Retry message' }).click(); await page.waitForFunction(() => document.querySelectorAll('.mikiru-message').length === 1);
    const committed = await readState(page); const committedCalls = calls;
    await page.getByRole('button', { name: 'Mikiru Home' }).click(); await assertLanding(page, 'Continue chatting');
    assert.deepEqual(await readState(page), committed); assert.equal(calls, committedCalls);
    // Reverse an unfinished return-Home transition by pressing the real visible CTA.
    await page.getByRole('button', { name: 'Continue chatting' }).click();
    await page.getByRole('textbox', { name: 'Message' }).waitFor(); assert.deepEqual(await readState(page), committed);
    assert.equal(calls, committedCalls);
    await page.reload(); await releaseStorage(); await assertLanding(page, 'Continue chatting');
    assert.deepEqual(await readState(page), committed); assert.equal(calls, committedCalls);
    await page.waitForFunction(() => document.querySelector('.artwork').classList.contains('is-ready') && !document.querySelector('.artwork').getAnimations().length);
    await startPaused(); await page.evaluate(() => window.__motion.currentTime = 310); assert.equal((await visible(page)).chat, false);
    // Reduced motion changing mid-transition must settle and reveal, not strand entry.
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByRole('textbox', { name: 'Message' }).waitFor();
    assert.equal(await page.locator('.artwork').evaluate(el => el.getAnimations().length), 0);
    await page.getByRole('button', { name: 'Mikiru Home' }).click(); await assertLanding(page, 'Continue chatting');
    await page.getByRole('button', { name: 'Continue chatting' }).click();
    assert.equal((await visible(page)).chat, true, 'already-reduced entry has no normal animation delay');
    unavailable = true; await page.reload(); await releaseStorage(); await assertLanding(page, 'Continue chatting');
    assert.deepEqual(await readState(page), committed); assert.equal(calls, committedCalls);
    await page.getByRole('button', { name: 'Continue chatting' }).click();
    assert.equal((await visible(page)).chat, true, 'Continue works without API or available artwork');
    assert.equal(await page.locator('.mikiru-message').count(), 1); unavailable = false;
    await send(page, 'reset yourself'); await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.input').disabled && document.querySelectorAll('.message').length === 0);
    const blank = await readState(page); assert.notEqual(blank.meta.instanceId, committed.meta.instanceId);
    await page.clock.setSystemTime(new Date('2026-10-06T19:00:00Z')); const sleepCalls = calls;
    await send(page, 'Undelivered technical test attempt'); await page.locator('.sleep-fade').waitFor();
    await page.getByRole('button', { name: 'Mikiru Home' }).click(); await assertLanding(page, 'Start chatting');
    assert.equal(calls, sleepCalls); assert.deepEqual(await readState(page), blank);
    await page.reload(); await releaseStorage(); await assertLanding(page, 'Start chatting');
    assert.deepEqual(await readState(page), blank);
    // No API/artwork response is needed to determine either local CTA label or enter.
    unavailable = true; await page.reload(); await releaseStorage(); await assertLanding(page, 'Start chatting');
    await page.getByRole('button', { name: 'Start chatting' }).click(); assert.equal((await visible(page)).chat, true);
    assert.equal(calls, sleepCalls);
    await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await assertLanding(page, 'Start chatting'); assert.deepEqual(await readState(page), blank);
    // A transient BFCache reopen failure must clear after a successful reopen.
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (...args) => { indexedDB.open = open; throw new Error('SYNTHETIC_REOPEN_FAILURE'); };
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForFunction(() => document.querySelector('.status').textContent.includes('Local data could not be opened'));
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForFunction(() => document.querySelector('.status').textContent === '');
    await assertLanding(page, 'Start chatting'); assert.deepEqual(await readState(page), blank);
    // A rejected old reopen must not overwrite a newer successful page entry.
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      const open = indexedDB.open.bind(indexedDB);
      window.__staleOpen = {};
      indexedDB.open = () => { indexedDB.open = open; return window.__staleOpen; };
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await assertLanding(page, 'Start chatting');
    await page.evaluate(async () => {
      window.__staleOpen.error = new Error('SYNTHETIC_STALE_OPEN'); window.__staleOpen.onerror();
      // Drain the rejected open/initialize/UI chain, not an arbitrary visual timer.
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    assert.equal(await page.locator('.status').textContent(), '', 'stale initialization cannot replace recovered status');
    assert.deepEqual(await readState(page), blank);
    // Invalid local data is recoverable by explicit Reset. The startup-only error
    // must disappear afterward, including when returning to the landing page.
    await page.evaluate(async () => {
      const db = await new Promise(resolve => { const r=indexedDB.open('mikiru'); r.onsuccess=()=>resolve(r.result); });
      const tx=db.transaction('memory','readwrite'); tx.objectStore('memory').put({version:1,items:'SYNTHETIC_CORRUPT_DATA'},'current');
      await new Promise(resolve=>tx.oncomplete=resolve); db.close();
    });
    await page.reload(); await releaseStorage(); await assertLanding(page,'Start chatting');
    assert.equal(await page.locator('.landing-error').isVisible(),true);
    await page.getByRole('button',{name:'Start chatting'}).click(); await send(page,'reset yourself');
    await page.getByRole('button',{name:'Reset',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.input').disabled&&document.querySelector('.status').textContent==='');
    await page.getByRole('button',{name:'Mikiru Home'}).click(); await assertLanding(page,'Start chatting');
    assert.equal(await page.locator('.landing-error').isVisible(),false,'successful reset clears startup error presentation');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); assert.ok([...hosts].every(host => host === '127.0.0.1'));
    await page.screenshot({ path: `.private/screenshots/navigation-${appearance}-${width}-landing.png` });
    results.push({ appearance, width, height, passed: true, committedCalls, noNavigationInference: true, delayedStorageNoLabelFlash: true, atomicHistoryUnchanged: true, reducedMotion: true, unavailableApi: true });
    await context.close();
  }
  await writeFile('.private/navigation-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, browserCases: results.length, checks: 'fresh/reload/Continue, gated local storage, pending/failure/retry, reset/sleep, no inference for CTA/navigation, deterministic art completion/reversal/reduced motion, back-forward entry, unavailable API/artwork' }));
} finally { await browser.close(); }
