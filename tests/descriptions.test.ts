import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnMessages } from '../backend/prompts.ts';
import { chatRequestSchema } from '../src/shared/contracts.ts';
import { Settings } from '../src/client/settings.ts';
import { Controller } from '../src/client/controller.ts';
import { Storage } from '../src/client/storage.ts';
import { indexedDB, IDBKeyRange, IDBFactory } from 'fake-indexeddb';
import { request, response } from './fixtures.ts';

test('Descriptions default Off is strict conversation; On is adaptive; state instructions stay identical', () => {
  const r = request();
  const { descriptions: _, ...olderRequest } = r;
  assert.equal(chatRequestSchema.parse(olderRequest).descriptions, false);
  const off = turnMessages(r, 'SYNTHETIC_CHARACTER');
  const on = turnMessages({ ...r, descriptions: true }, 'SYNTHETIC_CHARACTER');
  assert.match(off[0]!.content, /Descriptions Off: pure conversational text only/);
  assert.match(off[0]!.content, /No narrated actions, asterisk stage directions/);
  assert.match(on[0]!.content, /Descriptions On: use adaptive descriptions/);
  assert.match(on[0]!.content, /emotionally significant scenes/);
  assert.match(on[0]!.content, /must not overwhelm dialogue/);
  assert.deepEqual(off[1], on[1]);
  const style = /Descriptions (?:On|Off):[^\n]+/;
  assert.equal(off[0]!.content.replace(style, ''), on[0]!.content.replace(style, ''), 'only presentation changes; memory/progression/mood instructions remain identical');
  assert.equal(chatRequestSchema.safeParse({ ...r, descriptions: 'on' }).success, false);
});

test('Descriptions persists separately and safely defaults Off for unavailable or malformed storage', () => {
  const data = new Map<string, string>();
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const settings = new Settings(store);
  assert.equal(settings.descriptions, false);
  assert.equal(settings.setDescriptions(true), true);
  assert.equal(new Settings(store).descriptions, true);
  settings.setDescriptions(false); assert.equal(new Settings(store).descriptions, false);
  store.getItem = () => '{bad'; assert.equal(settings.descriptions, false);
  const blocked = new Settings({ getItem: () => { throw new Error(); }, setItem: () => { throw new Error(); } });
  assert.equal(blocked.descriptions, false); assert.equal(blocked.setDescriptions(true), false);
});

test('new turns capture current Descriptions; retry preserves its style and committed history', async () => {
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
  const storage = new Storage(new IDBFactory());
  let descriptions = false; let failing = false;
  const sent: boolean[] = [];
  const controller = new Controller({ storage, api: { chat: async r => { sent.push(r.descriptions); if (failing) throw new Error('fixture failure'); return response(r); }, compact: async () => { throw new Error(); } },
    tabs: { exclusive: async (_signal, action) => action(), resetExclusive: async action => action(), broadcast: () => {} },
    changed: () => {}, online: () => true, now: () => new Date(2026, 9, 5, 12), descriptions: () => descriptions });
  await controller.initialize(); await controller.send('first technical turn');
  const committed = JSON.stringify(controller.state);
  descriptions = true; failing = true; await controller.send('second technical turn');
  assert.equal(JSON.stringify(controller.state), committed);
  descriptions = false; failing = false; await controller.retry();
  await controller.send('third technical turn');
  assert.deepEqual(sent, [false, true, true, false]);
  assert.equal(controller.state!.turns[0]!.assistant.text, 'Hi.');
  await controller.reset(); storage.close();
});
