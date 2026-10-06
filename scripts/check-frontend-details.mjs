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
  for (const [width, height] of [[320,568],[390,500],[740,360],[1920,1200]]) {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'Asia/Bangkok', reducedMotion });
      const page = await context.newPage(); const errors = []; let inferenceRequests = 0;
      page.on('pageerror', error => errors.push(error.message));
      // These checks only exercise local UI. Never send an inference request.
      await page.route('**/api/chat', route => { inferenceRequests++; return route.abort(); });
      await page.clock.install({ time: new Date('2026-10-06T05:00:00Z') });
      await page.goto(base);
      const settled = () => page.waitForFunction(() => document.querySelector('.artwork')?.classList.contains('is-ready') && document.querySelector('.artwork').getAnimations().length === 0);
      await settled();
      const image = await page.locator('.portrait').elementHandle();
      const art = () => image.evaluate(el => {
        const surface = el.closest('.artwork'); const rect = el.getBoundingClientRect();
        const ancestors = []; for (let node = el; node; node = node.parentElement) {
          const s = getComputedStyle(node); ancestors.push({ display:s.display, visibility:s.visibility, opacity:s.opacity, hidden:node.hidden??false });
        }
        return { identity:el === document.querySelector('.portrait'), images:document.querySelectorAll('img').length, src:el.currentSrc,
          rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}, ancestors,
          animations:surface.getAnimations().length+el.getAnimations().length };
      });
      const checkUnchangedArt = async baseline => {
        const current = await art();
        assert.equal(current.identity, true); assert.equal(current.images, 1); assert.equal(current.src, baseline.src);
        assert.deepEqual(current.ancestors, baseline.ancestors, 'panels must not hide or additionally fade the artwork');
        assert.equal(current.animations, 0, 'opening/closing a panel must not replay artwork motion');
        for (const key of Object.keys(current.rect)) assert.ok(Math.abs(current.rect[key]-baseline.rect[key])<.1, 'panel cannot change the art pose');
      };
      const checks = [];
      for (const view of ['landing', 'chat']) {
        const baseline = await art();
        await page.getByRole('button', { name:view==='landing'?'About':'About Mikiru', exact:true }).click();
        await page.waitForFunction(() => document.querySelector('.about-dialog').getAnimations().length === 0);
        await checkUnchangedArt(baseline);
        const scroll = await page.locator('.about-content').evaluate(el => {
          const shell = el.closest('.about-surface'); const header = shell.querySelector('.about-header');
          const r = node => { const x=node.getBoundingClientRect(); return {left:x.left,top:x.top,right:x.right,bottom:x.bottom}; };
          return { body:r(el), shell:r(shell), header:r(header), bodyStyle:{x:getComputedStyle(el).overflowX,y:getComputedStyle(el).overflowY},
            shellOverflow:getComputedStyle(shell).overflow, radius:getComputedStyle(shell).borderRadius,
            overflowY:el.scrollHeight>el.clientHeight, overflowX:el.scrollWidth>el.clientWidth,
            shellScroll:Math.abs(shell.scrollHeight-shell.clientHeight), scrollTop:el.scrollTop };
        });
        assert.equal(scroll.shellOverflow, 'hidden'); assert.equal(scroll.radius, '24px');
        assert.deepEqual(scroll.bodyStyle, {x:'hidden',y:'auto'}); assert.equal(scroll.overflowX, false); assert.ok(scroll.shellScroll<=1);
        assert.ok(scroll.body.left>=scroll.shell.left+20 && scroll.body.right<=scroll.shell.right-20, 'scrollbar is inset inside the rounded shell');
        assert.ok(scroll.body.top>=scroll.header.bottom && scroll.body.bottom<=scroll.shell.bottom-20);
        if (scroll.overflowY) {
          await page.locator('.about-content').hover(); await page.mouse.wheel(0, 700);
          await page.waitForFunction(() => document.querySelector('.about-content').scrollTop>0);
          assert.deepEqual(await page.locator('.about-header').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};}),scroll.header,'header and close control stay fixed while scrolling');
          await page.getByRole('switch', { name:'Scene Detail' }).focus();
          await page.locator('.about-content').evaluate(el=>el.scrollTop=0); await page.keyboard.press('PageDown');
          await page.waitForFunction(() => document.querySelector('.about-content').scrollTop>0);
          assert.equal(await page.locator('.about-surface').evaluate(el=>el.scrollTop), 0, 'only the internal body scrolls');
        }
        await page.screenshot({path:`.private/screenshots/details-about-${view}-${width}-${reducedMotion}.png`});
        await page.getByRole('button', {name:'Close',exact:true}).click();
        await page.getByRole('dialog').waitFor({state:'hidden'}); await checkUnchangedArt(baseline);
        checks.push({view, scroll});
        if (view==='landing') {
          await page.getByRole('button',{name:'Start chatting'}).click(); await settled();
        }
      }
      const input = page.getByRole('textbox', {name:'Message'}); const send = page.getByRole('button', {name:'Send',exact:true});
      const arrowStates = [];
      for (const enabled of [false,true,false]) {
        await input.fill(enabled?'Local icon check':'');
        assert.equal(await send.isDisabled(), !enabled);
        const geometry = await send.evaluate(el => {
          const svg=el.querySelector('svg'); const path=svg.querySelector('path'); const b=el.getBoundingClientRect(),s=svg.getBoundingClientRect(),p=path.getBBox(),style=getComputedStyle(svg);
          return {button:{width:b.width,height:b.height},icon:{width:s.width,height:s.height},
            center:{x:s.x+s.width/2-(b.x+b.width/2),y:s.y+s.height/2-(b.y+b.height/2)},
            path:{x:p.x,y:p.y,width:p.width,height:p.height}, viewBox:svg.getAttribute('viewBox'), namespace:svg.namespaceURI,
            stroke:style.strokeWidth,linecap:style.strokeLinecap,linejoin:style.strokeLinejoin,fill:style.fill,
            pseudo:getComputedStyle(svg,'::before').content,padding:getComputedStyle(el).padding };
        });
        assert.deepEqual(geometry.button, {width:44,height:44}); assert.deepEqual(geometry.icon,{width:20,height:20});
        assert.ok(Math.abs(geometry.center.x)<.1 && Math.abs(geometry.center.y)<.1);
        assert.deepEqual(geometry.path,{x:6,y:5,width:12,height:14});
        assert.equal(geometry.viewBox,'0 0 24 24'); assert.equal(geometry.namespace,'http://www.w3.org/2000/svg');
        assert.equal(geometry.stroke,'2px'); assert.equal(geometry.linecap,'round'); assert.equal(geometry.linejoin,'round');
        assert.equal(geometry.fill,'none'); assert.equal(geometry.pseudo,'none'); assert.equal(geometry.padding,'0px');
        assert.ok(geometry.path.x>=2 && geometry.path.y>=2 && geometry.path.x+geometry.path.width<=22 && geometry.path.y+geometry.path.height<=22,'uniform stroke fits well inside the SVG viewport');
        await page.screenshot({path:`.private/screenshots/details-send-${enabled?'enabled':'disabled'}-${width}-${reducedMotion}.png`});
        arrowStates.push({enabled,...geometry});
      }
      const baseline = await art();
      for (const dismissal of ['cancel','escape','backdrop']) {
        await input.fill('reset yourself'); await input.press('Enter');
        await page.waitForFunction(() => document.querySelector('.reset-dialog').getAnimations().length === 0);
        await checkUnchangedArt(baseline);
        assert.equal(await page.getByRole('button',{name:'Cancel',exact:true}).evaluate(el=>el===document.activeElement),true);
        assert.deepEqual(await page.locator('.reset-dialog').evaluate(el=>{const s=getComputedStyle(el,'::backdrop');const c=document.createElement('canvas').getContext('2d');c.fillStyle=s.backgroundColor;c.fillRect(0,0,1,1);return {fill:[...c.getImageData(0,0,1,1).data],blur:s.backdropFilter};}),{fill:[0,0,0,48],blur:'blur(4px)'});
        if(dismissal==='cancel')await page.getByRole('button',{name:'Cancel',exact:true}).click();
        else if(dismissal==='escape')await page.keyboard.press('Escape');
        else await page.mouse.click(2,2);
        await page.getByRole('dialog').waitFor({state:'hidden'}); await checkUnchangedArt(baseline);
        assert.equal(await input.evaluate(el=>el===document.activeElement),true);
      }
      await page.getByRole('button',{name:'Mikiru Home'}).click(); await settled();
      assert.equal(await image.evaluate(el=>el===document.querySelector('.portrait') && !!el.closest('.art-slot')),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(inferenceRequests,0); assert.deepEqual(errors,[]);
      results.push({width,height,reducedMotion,checks,arrowStates,inferenceRequests,errors}); await context.close();
    }
  }
  await writeFile('.private/screenshots/frontend-details-results.json',JSON.stringify(results,null,2));
  console.log('8 desktop/mobile/short-height cases passed: centered SVG in both send states, internally clipped keyboard/wheel scrolling with fixed header, unchanged shared art behind About/Reset, focus restoration, both navigation directions and reduced motion. No inference requests.');
} finally { await browser.close(); }
