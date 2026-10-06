import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sleepInterval, sleepState } from '../src/client/sleep.ts';
import { runInNewContext } from 'node:vm';
import { Appearance, APPEARANCE_KEY } from '../src/client/appearance.ts';
import { Settings } from '../src/client/settings.ts';

test('saved/System appearance resolves in the head before application or stylesheet loading', async () => {
  const html = await readFile('index.html', 'utf8');
  const script = html.match(/<script data-appearance-init>([\s\S]*?)<\/script>/)![1]!;
  assert.ok(html.indexOf('data-appearance-init') < html.indexOf('type="module"'));
  assert.match(html, /html\[data-appearance="dark"\]/);
  for (const [saved, dark, expected] of [[null,false,'light'],[null,true,'dark'],['dark',false,'dark'],['light',true,'light'],['system',true,'dark'],['invalid',false,'light']] as const) {
    const dataset: Record<string,string> = {}; const meta = { content:'' };
    runInNewContext(script, { localStorage:{getItem:(key:string)=>{assert.equal(key,APPEARANCE_KEY);return saved;}}, matchMedia:()=>({matches:dark}), document:{documentElement:{dataset},querySelector:()=>meta} });
    assert.equal(dataset.appearance,expected); assert.equal(meta.content,expected==='dark'?'#000000':'#ffe0e0');
  }
  const dataset: Record<string,string> = {};
  runInNewContext(script,{localStorage:{getItem:()=>{throw new Error();}},matchMedia:()=>({matches:true}),document:{documentElement:{dataset},querySelector:()=>({})}});
  assert.equal(dataset.appearance,'dark','unavailable storage still follows System before paint');
});

test('appearance has no clock-dependent switching; orientation alone selects layout', async () => {
  const css = await readFile('src/client/style.css', 'utf8');
  const main = await readFile('src/client/main.ts', 'utf8');
  assert.doesNotMatch(css, /data-phase|transition-atmosphere|layout-mode|@media \((?:max|min)-(?:width|height):/);
  assert.doesNotMatch(main, /startTheme|phaseAt|nextPhaseBoundary/);
  assert.match(css, /@media \(max-aspect-ratio: 1\/1\)/);
  for (const color of ['#91533e', '#ffe0e0', '#ffffff', '#000000']) assert.ok(css.includes(color));
  assert.doesNotMatch(css, /#f6dde1|#eed0d6|#fff7f8|color-ambient|color-input-focus|landing-hook/i);
});

test('Appearance follows live OS changes only in System; overrides persist separately from Scene Detail', () => {
  const data = new Map<string,string>(); const listeners: (()=>void)[] = []; const modes: string[] = [];
  const storage = {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
  const settings = new Settings(storage); settings.setDescriptions(true);
  const system = {matches:false,addEventListener:(_type:string,listener:unknown)=>{listeners.push(listener as ()=>void);}};
  const appearance = new Appearance(storage,system,mode=>modes.push(mode));
  assert.equal(appearance.preference,'system'); assert.equal(appearance.resolved,'light');
  system.matches=true;listeners.forEach(fn=>fn());assert.equal(modes.at(-1),'dark');
  appearance.setPreference('light');system.matches=false;listeners.forEach(fn=>fn());system.matches=true;listeners.forEach(fn=>fn());
  assert.equal(modes.at(-1),'light');assert.equal(data.get(APPEARANCE_KEY),'light');
  assert.equal(new Appearance(storage,system,()=>{}).resolved,'light');
  appearance.setPreference('system');assert.equal(data.has(APPEARANCE_KEY),false);assert.equal(appearance.resolved,'dark');
  assert.equal(settings.descriptions,true);
  data.set(APPEARANCE_KEY,'dark');appearance.refresh();assert.equal(appearance.preference,'dark','another tab override can be reloaded');
});

test('Appearance tolerates unavailable/invalid storage and reports failed persistence without affecting other preferences', () => {
  const system = {matches:true,addEventListener:()=>{}};
  const bad = new Appearance({getItem:()=>'{invalid',setItem:()=>{throw new Error();},removeItem:()=>{throw new Error();}},system,()=>{});
  assert.equal(bad.preference,'system');assert.equal(bad.resolved,'dark');
  assert.equal(bad.setPreference('light'),false);assert.equal(bad.resolved,'light','a failed save still applies the current session choice');
  assert.equal(bad.setPreference('system'),false);assert.equal(bad.resolved,'dark');
  const blocked = new Appearance({getItem:()=>{throw new Error();},setItem:()=>{},removeItem:()=>{}},system,()=>{});
  assert.equal(blocked.preference,'system');
});

test('sleep jitter and just-woke context remain deterministic independently of appearance', () => {
  const date = new Date(2026, 9, 5); const interval = sleepInterval('seed', date);
  assert.deepEqual(sleepInterval('seed', date), interval);
  assert.equal(sleepState('seed', interval.start).asleep, true);
  assert.deepEqual(sleepState('seed', interval.wake), { asleep: false, justWoke: true });
  assert.equal(sleepState('seed', new Date(2026, 9, 6, 8, 10)).asleep, true);
});
