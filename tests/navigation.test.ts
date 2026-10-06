import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { Navigation, landingAction, type View } from '../src/client/navigation.ts';
import { Controller } from '../src/client/controller.ts';
import { Storage } from '../src/client/storage.ts';
import type { Api } from '../src/client/api.ts';
import { response } from './fixtures.ts';

function setup(chat: Api['chat'], clock = () => new Date(2026, 9, 6, 12)) {
  const factory = new IDBFactory(), storage = new Storage(factory);
  const tabs = { exclusive: async <T>(_signal: AbortSignal, work: () => Promise<T>) => work(), resetExclusive: async <T>(work: () => Promise<T>) => work(), broadcast: () => {} };
  const controller = new Controller({ storage, tabs, api: { chat, compact: async () => { throw new Error('Unexpected compaction'); } }, changed: () => {}, now: clock, online: () => true });
  return { factory, storage, controller };
}

test('landing action uses only current committed turns; initialization/reload/reset needs no API', async () => {
  let calls = 0;
  const { factory, storage, controller } = setup(async request => { calls++; return response(request); });
  assert.equal(landingAction(null), 'Start chatting');
  await controller.initialize(); assert.equal(landingAction(controller.state), 'Start chatting'); assert.equal(calls, 0);
  await controller.send('A committed technical test turn.');
  assert.equal(landingAction(controller.state), 'Continue chatting');
  const committed = await storage.read(); storage.close();
  const reloaded = new Storage(factory);
  assert.equal(landingAction(await reloaded.initialize()), 'Continue chatting');
  assert.deepEqual(await reloaded.read(), committed); assert.equal(calls, 1);
  reloaded.close(); await controller.reset();
  assert.notEqual(controller.state?.meta.instanceId, committed.meta.instanceId);
  assert.equal(landingAction(controller.state), 'Start chatting'); assert.equal(calls, 1);
  storage.close();
});

test('pending and failed attempts cannot make the landing action Continue', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const { storage, controller } = setup(async () => { entered(); await gate; throw new Error('Technical test failure'); });
  await controller.initialize(); const pending = controller.send('Uncommitted attempt'); await started;
  assert.ok(controller.pending); assert.equal(landingAction(controller.state), 'Start chatting');
  release(); await pending;
  assert.equal(controller.pending?.status, 'failed'); assert.equal(landingAction(controller.state), 'Start chatting');
  assert.equal(landingAction(await storage.read()), 'Start chatting'); storage.close();
});

test('sleep-only attempts never count as a committed conversation', async () => {
  let calls = 0;
  const { storage, controller } = setup(async request => { calls++; return response(request); }, () => new Date(2026, 9, 6, 2));
  await controller.initialize(); await controller.send('An undelivered technical test attempt');
  assert.equal(controller.sleepAttempts.length, 1); assert.equal(calls, 0);
  assert.equal(landingAction(controller.state), 'Start chatting'); assert.equal(landingAction(await storage.read()), 'Start chatting');
  controller.abort(); storage.close();
});

test('navigation starts without choosing a stored view and reveals chat only after artwork settles', async () => {
  const events: string[] = []; let finish!: (completed: boolean) => void;
  const navigation = new Navigation({ changeView: (view, prepare) => {
    events.push(`art:${view}`); prepare(); return new Promise<boolean>(resolve => { finish = resolve; });
  } }, { prepare: view => events.push(`prepare:${view}`), reveal: view => events.push(`reveal:${view}`) });
  assert.deepEqual(events, []);
  const entering = navigation.show('chat');
  assert.deepEqual(events, ['art:chat', 'prepare:chat']);
  finish(true); await entering;
  assert.deepEqual(events, ['art:chat', 'prepare:chat', 'reveal:chat']);
});

test('reversal ignores obsolete completions; cancelled transitions never reveal an old view', async () => {
  const finishes: ((completed: boolean) => void)[] = [], revealed: View[] = [], prepared: View[] = [];
  const navigation = new Navigation({ changeView: (_view, prepare) => { prepare(); return new Promise<boolean>(resolve => finishes.push(resolve)); } }, { prepare: view => prepared.push(view), reveal: view => revealed.push(view) });
  const enter = navigation.show('chat'), home = navigation.show('landing');
  finishes[0]!(true); await enter; assert.deepEqual(revealed, []);
  finishes[1]!(true); await home; assert.deepEqual(prepared, ['chat', 'landing']); assert.deepEqual(revealed, ['landing']);
  const cancelled = navigation.show('chat'); finishes[2]!(false); await cancelled;
  assert.deepEqual(revealed, ['landing']);
});

test('reduced/no-artwork completion reveals chat immediately without a timer', async () => {
  const events: string[] = [];
  const navigation = new Navigation({ changeView: async (_view, prepare) => { prepare(); return true; } }, { prepare: view => events.push(`prepare:${view}`), reveal: view => events.push(`reveal:${view}`) });
  await navigation.show('chat'); assert.deepEqual(events, ['prepare:chat', 'reveal:chat']);
});
