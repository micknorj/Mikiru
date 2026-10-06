import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: true });
const base = process.env.MIKIRU_PREVIEW_URL ?? 'http://127.0.0.1:5173/';
const results = [];
await mkdir('.private/screenshots', { recursive: true });
try {
  for (const appearance of ['light','dark']) for (const [width, height] of [[390,844],[1920,1200],[3440,1440]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: appearance, timezoneId: 'Asia/Bangkok', reducedMotion: 'no-preference' });
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-10-05T05:00:00Z') }); await page.goto(base);
    await page.waitForFunction(() => document.querySelector('.artwork')?.classList.contains('is-ready') && document.querySelector('.artwork').getAnimations().length === 0);
    const image = await page.locator('.portrait').elementHandle();
    for (const view of ['chat', 'landing']) {
      await page.evaluate(view => {
        document.querySelector(view === 'chat' ? '.landing-actions .primary' : '.brand-home').click();
        const animation = document.querySelector('.artwork').getAnimations()[0]; window.__artAnimation = animation; animation.pause(); animation.currentTime = 0;
      }, view);
      assert.deepEqual(await page.evaluate(()=>{const timing=window.__artAnimation.effect.getTiming();return {duration:timing.duration,easing:timing.easing};}),{duration:620,easing:'cubic-bezier(0.77, 0, 0.175, 1)'},'one coordinated easeInOutQuart timeline');
      for (const time of [0,155,310,465,620]) {
        const pose = await page.evaluate(time => {
          const surface = document.querySelector('.artwork'); const portrait = document.querySelector('.portrait');
          window.__artAnimation.currentTime = time;
          const a = surface.getBoundingClientRect(), b = portrait.getBoundingClientRect(), s = getComputedStyle(surface);
          const crop=s.clipPath.slice(6,-1).split(' ').map(parseFloat);
          return { time, sourceDifference: Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y),Math.abs(a.width-b.width),Math.abs(a.height-b.height)),
            containerAnimations:surface.getAnimations().length,imageAnimations:portrait.getAnimations().length,
            staged:surface.classList.contains('is-transitioning')&&surface.parentElement.classList.contains('scene'),
            images:document.querySelectorAll('img').length,fill:s.backgroundColor,border:s.borderWidth,shadow:s.boxShadow,
            opacity:s.opacity,filter:s.filter,clip:s.clipPath,cropEdges:[crop[0],crop[1]??crop[0],crop[3]??crop[1]??crop[0]],lighting:getComputedStyle(surface,'::before').backgroundImage,overflow:document.documentElement.scrollWidth>innerWidth };
        }, time);
        assert.ok(pose.sourceDifference < .1, 'container and artwork share every transform');
        assert.equal(pose.containerAnimations,time<620?1:0); assert.equal(pose.imageAnimations,0); assert.equal(pose.staged,true);
        assert.equal(pose.images,1); assert.equal(pose.fill,'rgba(0, 0, 0, 0)'); assert.equal(pose.border,'0px'); assert.equal(pose.shadow,'none'); assert.equal(pose.overflow,false);
        assert.notEqual(pose.clip,'none','the crop belongs to the same coordinated timeline');
        assert.deepEqual(pose.cropEdges,[0,0,0],'top and side viewport crops must never become visible rectangular edges');
        assert.match(pose.lighting,/radial-gradient/,'source-aligned light stays on the shared artwork throughout navigation');
        if(time===310)await page.screenshot({path:`.private/screenshots/art-${appearance}-${view}-${width}-midpoint.png`});
        if(time===310) {
          // Chat controls are intentionally hidden until the art settles. Exercise an
          // overlay programmatically to keep checking the independent art lifecycle.
          await page.evaluate(view=>document.querySelector(view==='chat'?'.information-button':'.landing-actions .secondary').click(),view);
          assert.equal(await page.locator('.scene').evaluate(el=>getComputedStyle(el).opacity),'1','About leaves the coordinated artwork visible behind its backdrop');
          assert.equal(await page.locator('.artwork').evaluate(el=>el.getAnimations().length),1,'the same coordinated art timeline continues');
          await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
        }
        results.push({ appearance,width,height,view,...pose });
      }
      const end=await image.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
      await page.evaluate(() => { window.__artAnimation.finish(); delete window.__artAnimation; });
      await page.waitForFunction(() => !document.querySelector('.artwork').classList.contains('is-transitioning'));
      const settled=await image.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
      assert.ok(Object.keys(end).every(key=>Math.abs(end[key]-settled[key])<1),'final handoff cannot jump');
      assert.equal(await image.evaluate(el => el === document.querySelector('.portrait')),true);
      assert.equal(await page.locator('.artwork').evaluate(el => el.style.length),0,'temporary stage styles are cleaned up');
      assert.equal(await page.locator('.portrait').evaluate(el => el.closest('.art-slot') !== null),view==='landing');
      if(view==='chat')assert.equal(await page.locator('.artwork').evaluate(el=>getComputedStyle(el).filter),'blur(20px)');
      const lighting=await page.locator('.artwork').evaluate(el=>{
        const s=getComputedStyle(el,'::before'),image=el.querySelector('img'),parent=getComputedStyle(el);
        return {width:parseFloat(s.width),height:parseFloat(s.height),imageWidth:image.offsetWidth,imageHeight:image.offsetHeight,opacity:s.opacity,filter:s.filter,mask:s.maskImage,imageOpacity:getComputedStyle(image).opacity,imageFilter:getComputedStyle(image).filter,imageMask:getComputedStyle(image).maskImage,groupOpacity:parent.opacity,groupFilter:parent.filter};
      });
      assert.ok(Math.abs(lighting.width-lighting.imageWidth)<1&&Math.abs(lighting.height-lighting.imageHeight)<1,'light and image have one source geometry at rest');
      assert.equal(lighting.opacity,'1');assert.equal(lighting.imageOpacity,'1');assert.equal(lighting.filter,'none');assert.equal(lighting.imageFilter,'none');assert.equal(lighting.mask,'none');assert.equal(lighting.imageMask,'none');
      assert.equal(lighting.groupOpacity,view==='chat'?'0.15':'1');assert.equal(lighting.groupFilter,view==='chat'?'blur(20px)':'blur(0px)');

    }
    await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Start chatting'}).click();
    assert.equal(await page.locator('.artwork').evaluate(el=>el.classList.contains('is-transitioning')||el.getAnimations().length>0),false);
    await page.getByRole('button',{name:'Mikiru Home'}).click();
    assert.equal(await page.locator('.portrait').evaluate(el=>!!el.closest('.art-slot')&&getComputedStyle(el).position==='static'),true);
    assert.deepEqual(errors,[]);await context.close();
  }
  await writeFile('.private/screenshots/art-transition-results.json',JSON.stringify(results,null,2));
  console.log('Both appearances/artwork directions passed 60 sampled poses across phone, desktop and ultrawide: one element/timeline, source-aligned lighting/image/mask/blur, synchronized transparent container/crop, clean final handoff and reduced motion.');
} finally { await browser.close(); }
