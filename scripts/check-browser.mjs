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
  for (const [width, height] of [[320,568],[375,667],[390,844],[430,932],[740,360],[768,1024],[1024,768],[1280,720],[1440,900],[1920,1080],[2560,1440],[640,450],[679,600],[680,600],[899,601],[900,601],[1920,1200],[3440,1440],[1199,800],[1200,800],[1700,1000],[1701,1000],[320,320],[800,800],[1080,1920],[600,601],[600,599],[340,320]]) {
    const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'Asia/Bangkok', reducedMotion: 'reduce' });
    const page = await context.newPage(); const errors = []; const urls = new Set();
    page.on('pageerror', error => errors.push(error.message)); page.on('request', req => urls.add(req.url()));
    await page.clock.install({ time: new Date('2026-10-05T05:00:00Z') });
    await page.goto(base); await page.getByRole('button', { name: 'Start chatting' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.portrait')?.naturalWidth > 0 && document.querySelector('.art-slot').classList.contains('is-ready'));
    await page.locator('.portrait').evaluate(el=>el.decode());
    const layout = await page.evaluate(() => {
      const r = el => { const a = el.getBoundingClientRect(); return { x:a.x,y:a.y,width:a.width,height:a.height,right:a.right,bottom:a.bottom }; };
      const intro = document.querySelector('.intro'); const art = document.querySelector('.art-slot'); const landing = document.querySelector('.landing');
      const image = document.querySelector('.portrait'); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 300;
      const c = canvas.getContext('2d'); c.drawImage(image, 0, 0, 300, 300); const data = c.getImageData(0, 0, 300, 300).data;
      let left = 300, right = 0;
      for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) if (data[(y * 300 + x) * 4 + 3] > 8) { left = Math.min(left, x); right = Math.max(right, x + 1); }
      const rect = r(image);
      const introStyle=getComputedStyle(intro);
      return { intro:r(intro),introContentWidth:intro.clientWidth-parseFloat(introStyle.paddingLeft)-parseFloat(introStyle.paddingRight),art:r(art),portrait:rect,painted:{left:rect.x+left/300*rect.width,right:rect.x+right/300*rect.width},landing:r(landing), view:getComputedStyle(landing).getPropertyValue('--layout-view').trim(), titleSize:getComputedStyle(document.querySelector('.landing-title')).fontSize, overflow:document.documentElement.scrollWidth>innerWidth, position:getComputedStyle(image).position };
    });
    assert.equal(layout.overflow, false, `${width}×${height}: overflow`); assert.equal(layout.position, 'static');
    const wide = width > height;
    assert.equal(layout.view,wide?'desktop':'mobile');
    const space=layout.introContentWidth;const title=space<=120?40:space<=180?56:space<=260?80:space<=360?104:wide?136:104;
    assert.equal(layout.titleSize,`${title}px`,'discrete typography fits its region without changing orientation layout');
    if(width===1920&&height===1200){assert.ok(layout.portrait.height>1050);assert.ok(layout.art.y<height*.2,'tall desktop uses its upper space');}
    if(width/height>=1.7 && [1920,2560,3440].includes(width)){
      assert.equal(layout.landing.width,1536);assert.ok(layout.portrait.height>=1050,'desktop portrait is substantially larger');assert.ok(layout.portrait.height<=1360,'ultrawide artwork remains bounded');
      assert.ok(Math.abs(layout.landing.x-(width-1536)/2)<.1,'composition remains centered and bounded');
    }
    assert.ok(Math.abs(layout.art.bottom-layout.landing.bottom)<1, `${width}×${height}: art anchored to composition bottom`);
    assert.ok(layout.portrait.bottom >= layout.art.bottom+47, 'source cutout edge stays below the crop');
    assert.ok(layout.painted.left >= layout.art.x+1 && layout.painted.right <= layout.art.right-1, `${width}×${height}: painted portrait fits both edges without accidental clipping`);
    const sharedArtwork = await page.locator('.portrait').elementHandle(); assert.equal(await page.locator('img').count(), 1);
    if (!wide) { assert.ok(layout.art.y >= layout.intro.bottom+15); assert.ok(layout.art.width <= 720); assert.ok(layout.art.y-layout.intro.bottom<=layout.intro.y+1,'portrait spare height is balanced rather than left in the former description gap'); }
    else { assert.ok(layout.art.x >= layout.intro.right); assert.ok(layout.art.x - layout.intro.right <= 48.1); assert.ok(layout.art.right <= layout.landing.right); }
    assert.equal(await page.locator('.landing-hook').count(),0,'landing contains only title/actions/art');
    if ([320,390,740,768,1440,1920,2560,3440].includes(width)) await page.screenshot({ path: `.private/screenshots/landing-${width}x${height}.png`, fullPage: true });
    await page.getByRole('button', { name: 'About', exact: true }).click(); await page.getByRole('dialog').waitFor();
    assert.ok((await page.getByRole('dialog').innerText()).includes("Mick's Lab"));
    assert.equal(await page.locator('.about-intro').innerText(),'Mikiru is blunt, observant, occasionally troublesome, and not especially interested in pretending otherwise.');
    assert.equal(await page.locator('.about-content > section').count(),3,'privacy/settings/start-over groups');
    assert.equal(await page.locator('.about-surface .credit-line').count(),1,'credits are inside the panel');
    assert.equal(await page.locator('.about-dialog > .about-footer').count(),0,'no text outside the panel');
    assert.equal(await page.locator('.settings-controls').evaluate(el=>getComputedStyle(el).borderRadius),'16px');
    assert.equal(await page.locator('.about-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight;}),true,'About fits the viewport and scrolls internally');
    const closeFill=await page.locator('.close-about').evaluate(el=>getComputedStyle(el).backgroundColor);
    await page.getByRole('button', { name: 'Close', exact: true }).hover();
    assert.equal(await page.locator('.close-about').evaluate(el=>getComputedStyle(el).backgroundColor),closeFill);
    assert.equal(await page.locator('.close-about').evaluate(el=>getComputedStyle(el).filter),'brightness(0.9)');
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>document.getAnimations().length),0,'reduced motion disables entrance/backdrop animation');
    await page.getByRole('button', { name: 'Start chatting' }).click();
    assert.equal(await sharedArtwork.evaluate(el=>el===document.querySelector('.portrait') && !!el.closest('.scene')),true,'the same decoded image adapts into chat');
    assert.equal(await page.locator('img').count(),1);
    assert.equal(await sharedArtwork.evaluate(el=>el.getAnimations().length),0,'reduced motion applies the final art pose immediately');
    await page.getByRole('textbox', { name: 'Message' }).fill('Hello from a local technical test'); await page.getByRole('button', { name: 'Send', exact:true }).click();
    await page.getByText('[Local fixture] The technical chat flow is working.', { exact:true }).waitFor();
    const chatLayout=await page.evaluate(()=>{
      const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,bottom:r.bottom};};
      const header=document.querySelector('.chat-header');const transcript=document.querySelector('.transcript');const input=document.querySelector('.input-wrap');const face=getComputedStyle(document.querySelector('.artwork'));
      const bottom=document.querySelector('.bottom');
      return {view:getComputedStyle(document.querySelector('.chat')).getPropertyValue('--layout-view').trim(),header:rect(header),bottom:rect(bottom),transcript:rect(transcript),transcriptPadding:parseFloat(getComputedStyle(transcript).paddingTop),transcriptBottomPadding:parseFloat(getComputedStyle(transcript).paddingBottom),input:rect(input),headerBlur:getComputedStyle(header).backdropFilter,bottomBlur:getComputedStyle(bottom).backdropFilter,headerFill:getComputedStyle(header).backgroundColor,faceOpacity:face.opacity,faceBlur:face.filter,firstMessage:rect(transcript.firstElementChild),bubbleWidths:[...document.querySelectorAll('.message')].map(el=>el.getBoundingClientRect().width)};
    });
    assert.ok(chatLayout.transcript.width<=896); assert.ok(Math.abs((width-chatLayout.transcript.width)/2-chatLayout.transcript.x)<1);
    assert.ok(chatLayout.transcript.y>=chatLayout.header.bottom); assert.ok(chatLayout.transcriptPadding>=16); assert.ok(chatLayout.bubbleWidths.every(w=>w<=680));
    assert.equal(chatLayout.view,wide?'desktop':'mobile');
    assert.equal(chatLayout.faceOpacity,'0.15');assert.equal(chatLayout.faceBlur,'blur(20px)');assert.equal(chatLayout.header.bottom,92);
    assert.equal(chatLayout.transcriptPadding,chatLayout.transcriptBottomPadding);
    assert.equal(chatLayout.bottom.bottom-chatLayout.bottom.y,92,'normal top and bottom reservations are balanced');
    assert.equal(chatLayout.bottomBlur,'none');
    assert.equal(await page.locator('.chat-header h1').evaluate(el=>getComputedStyle(el).fontSize),'40px');
    assert.equal(chatLayout.headerBlur,'none');assert.equal(chatLayout.headerFill,'rgba(0, 0, 0, 0)');
    await page.getByRole('textbox',{name:'Message'}).focus();
    const focus=await page.locator('.input-wrap').evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderWidth,shadow:s.boxShadow,outline:s.outlineStyle,height:el.getBoundingClientRect().height};});
    assert.equal(focus.border,'1px');assert.equal(focus.outline,'none');assert.equal(focus.shadow,'none');assert.equal(focus.height,56);
    if([390,740,1440].includes(width))await page.screenshot({path:`.private/screenshots/chat-${width}.png`,fullPage:true});
    await page.reload(); await page.getByRole('button', { name: 'Continue chatting' }).click();
    await page.getByText('[Local fixture] The technical chat flow is working.', { exact:true }).waitFor();
    await page.getByRole('textbox', { name: 'Message' }).fill('reset yourself'); await page.getByRole('button', { name: 'Send', exact:true }).click();
    const cancelFocus=await page.getByRole('button',{name:'Cancel',exact:true}).evaluate(el=>{const s=getComputedStyle(el);return {outline:s.outlineWidth,border:s.borderWidth,shadow:s.boxShadow,focused:document.activeElement===el};});
    assert.equal(cancelFocus.focused,true);assert.equal(cancelFocus.outline,'0px');assert.equal(cancelFocus.border,'1px');assert.ok(!cancelFocus.shadow.includes('inset'));assert.notEqual(cancelFocus.shadow,'none');
    await page.keyboard.press('Tab');
    const resetFocus=await page.getByRole('button',{name:'Reset',exact:true}).evaluate(el=>{const s=getComputedStyle(el);return {outline:s.outlineStyle,shadow:s.boxShadow,focused:document.activeElement===el};});
    assert.equal(resetFocus.focused,true);assert.equal(resetFocus.outline,'none');assert.match(resetFocus.shadow,/inset/);
    if(width===390)await page.screenshot({path:'.private/screenshots/reset-390.png',fullPage:true});
    await page.getByRole('button', { name: 'Reset', exact:true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.transcript .message').length === 0);
    assert.deepEqual(errors, []); assert.ok([...urls].every(url => ['127.0.0.1'].includes(new URL(url).hostname)));
    results.push({ width,height,layout,chatLayout,errors,networkHosts:[...new Set([...urls].map(url=>new URL(url).host))] });
    await context.close();
  }
  // Verify real transitions separately; layout checks above intentionally use reduced motion.
  const motionContext=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Bangkok',reducedMotion:'no-preference'});
  const motionPage=await motionContext.newPage();const motionErrors=[];motionPage.on('pageerror',e=>motionErrors.push(e.message));
  await motionPage.clock.install({time:new Date('2026-10-05T05:00:00Z')});await motionPage.goto(base);
  await motionPage.waitForFunction(()=>document.querySelector('.artwork')?.classList.contains('is-ready'));
  await motionPage.getByRole('button',{name:'About',exact:true}).click();
  await motionPage.screenshot({path:'.private/screenshots/about-390.png',animations:'disabled'});
  const closing=await motionPage.evaluate(()=>{
    document.querySelector('.close-about').click();const d=document.querySelector('.about-dialog');
    return {open:d.open,closing:d.classList.contains('is-closing'),duration:d.getAnimations().at(-1)?.effect.getTiming().duration};
  });
  assert.deepEqual(closing,{open:true,closing:true,duration:120});
  await motionPage.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await motionPage.evaluate(()=>document.activeElement?.textContent),'About');
  const firstArtwork=await motionPage.locator('.portrait').elementHandle();
  const transition=await motionPage.evaluate(()=>{const el=document.querySelector('.portrait');const before=el.getBoundingClientRect();document.querySelector('.landing-actions .primary').click();const after=el.getBoundingClientRect();return {duration:el.closest('.artwork').getAnimations().at(-1)?.effect.getTiming().duration,dx:Math.abs(after.x-before.x),dy:Math.abs(after.y-before.y),dw:Math.abs(after.width-before.width),images:document.querySelectorAll('img').length};});
  assert.equal(transition.duration,620);assert.equal(transition.images,1);
  assert.ok(transition.dx<1 && transition.dy<1 && transition.dw<1,'FLIP starts at the previous artwork pose, without a jump');
  await motionPage.waitForFunction(()=>document.querySelector('.artwork').getAnimations().length===0);
  await motionPage.getByRole('textbox',{name:'Message'}).fill('First appearance');await motionPage.getByRole('button',{name:'Send',exact:true}).click();
  await motionPage.waitForFunction(()=>document.querySelectorAll('.mikiru-message').length===1);
  await motionPage.waitForFunction(()=>[...document.querySelectorAll('.message')].every(el=>el.getAnimations().length===0));
  const firstReply=await motionPage.locator('.mikiru-message').first().elementHandle();
  await motionPage.getByRole('textbox',{name:'Message'}).fill('Second appearance');await motionPage.getByRole('button',{name:'Send',exact:true}).click();
  await motionPage.waitForFunction(()=>document.querySelectorAll('.mikiru-message').length===2);
  assert.equal(await firstReply.evaluate(el=>el===document.querySelector('.mikiru-message') && el.getAnimations().length===0),true,'old replies keep their nodes and do not animate again');
  const artwork=await motionPage.locator('.portrait').elementHandle();
  await motionPage.getByRole('button',{name:'Mikiru Home'}).click();
  assert.equal(await firstArtwork.evaluate(el=>el===document.querySelector('.portrait')),true,'one element survives round-trip navigation');
  assert.equal(await artwork.evaluate(el=>el===document.querySelector('.portrait') && el.closest('.artwork').getAnimations().at(-1)?.effect.getTiming().duration===620 && !!el.closest('.scene')),true,'Home reverses the same shared-art transition');
  await motionPage.waitForFunction(()=>document.querySelector('.artwork').getAnimations().length===0);
  assert.equal(await motionPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const rapid=await motionPage.evaluate(()=>{
    const art=document.querySelector('.portrait');document.querySelector('.landing-actions .primary').click();
    const before=art.getBoundingClientRect();document.querySelector('.brand-home').click();const after=art.getBoundingClientRect();
    return {dx:Math.abs(before.x-after.x),dy:Math.abs(before.y-after.y),dw:Math.abs(before.width-after.width),images:document.querySelectorAll('img').length};
  });
  assert.equal(rapid.images,1);assert.ok(rapid.dx<1&&rapid.dy<1&&rapid.dw<1,'rapid navigation reverses from the current pose without jumping');
  await motionPage.waitForFunction(()=>document.querySelector('.artwork').getAnimations().length===0);
  await motionPage.getByRole('button',{name:'Continue chatting'}).click();
  await motionPage.setViewportSize({width:844,height:390});
  await motionPage.waitForFunction(()=>document.querySelector('.artwork').getAnimations().length===0,{},{timeout:150});
  assert.equal(await motionPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'resize during the morph cannot overflow');
  assert.equal(await motionPage.locator('.chat').evaluate(el=>getComputedStyle(el).getPropertyValue('--layout-view').trim()),'desktop','rotating to landscape changes the chat layout');
  await motionPage.getByRole('button',{name:'Mikiru Home'}).click();
  await motionPage.waitForFunction(()=>document.querySelector('.artwork').getAnimations().length===0);
  await motionPage.setViewportSize({width:390,height:844});
  assert.equal(await motionPage.locator('.landing').evaluate(el=>getComputedStyle(el).getPropertyValue('--layout-view').trim()),'mobile','rotating Home back to portrait restores normal-flow art');
  await motionPage.getByRole('button',{name:'Continue chatting'}).click();
  await motionPage.emulateMedia({reducedMotion:'reduce'});
  await motionPage.waitForFunction(()=>document.querySelector('.artwork').getAnimations().length===0,{},{timeout:150});
  assert.equal(await artwork.evaluate(el=>el.getAnimations().length),0,'changing reduced-motion during an art transition settles it immediately');
  await motionPage.emulateMedia({reducedMotion:'no-preference'});
  const input=motionPage.getByRole('textbox',{name:'Message'});
  const cancel=motionPage.getByRole('button',{name:'Cancel',exact:true});
  const resetDialog=motionPage.locator('.reset-dialog');
  const settledFocus=async()=>{
    await motionPage.waitForFunction(()=>document.querySelector('.reset-dialog').getAnimations().length===0 && document.querySelector('.reset-dialog .secondary').getAnimations().length===0);
    return cancel.evaluate(el=>{const s=getComputedStyle(el);return {outline:s.outline,shadow:s.boxShadow,border:s.border,fill:s.backgroundColor};});
  };
  await input.fill('reset yourself');await input.press('Enter');
  const firstFocus=await settledFocus();assert.match(firstFocus.outline,/none 0px/);assert.ok(!firstFocus.shadow.includes('inset'));
  await motionPage.keyboard.press('Tab');await motionPage.keyboard.press('Shift+Tab');
  assert.deepEqual(await settledFocus(),firstFocus,'initial programmatic and subsequent keyboard focus use the same treatment');
  await motionPage.screenshot({path:'.private/screenshots/reset-keyboard-first-390.png',fullPage:true});
  await motionPage.locator('#reset-title').click();assert.equal(await resetDialog.evaluate(el=>el.open),true,'inside click keeps confirmation open');
  const box=await resetDialog.boundingBox();
  await motionPage.mouse.click(box.x+8,box.y+8);assert.equal(await resetDialog.evaluate(el=>el.open),true,'inside padding stays open');
  await motionPage.mouse.move(box.x+16,box.y+16);await motionPage.mouse.down();await motionPage.mouse.move(8,8);await motionPage.mouse.up();
  assert.equal(await resetDialog.evaluate(el=>el.open),true,'dragging from inside to backdrop does not dismiss');
  const underlying=await motionPage.getByRole('button',{name:'About Mikiru'}).boundingBox();
  await motionPage.mouse.click(underlying.x+underlying.width/2,underlying.y+underlying.height/2);
  await resetDialog.waitFor({state:'hidden'});
  assert.equal(await motionPage.locator('.about-dialog').evaluate(el=>el.open),false,'backdrop dismissal cannot activate the underlying About control');
  assert.equal(await input.evaluate(el=>el===document.activeElement),true,'backdrop dismissal restores composer focus');
  assert.equal(await motionPage.locator('.mikiru-message').count(),2,'backdrop dismissal never resets the conversation');
  await input.press('Enter');assert.deepEqual(await settledFocus(),firstFocus,'later openings keep the same focus');
  await cancel.click();await resetDialog.waitFor({state:'hidden'});
  await motionPage.getByRole('button',{name:'Send',exact:true}).click();assert.deepEqual(await settledFocus(),firstFocus,'pointer-opened confirmation uses the same focus');
  await motionPage.keyboard.press('Escape');await resetDialog.waitFor({state:'hidden'});
  assert.equal(await motionPage.locator('.mikiru-message').count(),2,'cancel keeps the committed conversation');
  assert.equal(await motionPage.getByRole('textbox',{name:'Message'}).inputValue(),'reset yourself');
  await motionPage.emulateMedia({reducedMotion:'reduce'});
  await input.press('Enter');await motionPage.mouse.click(8,8);await resetDialog.waitFor({state:'hidden'});
  assert.equal(await input.evaluate(el=>el===document.activeElement),true);
  assert.equal(await motionPage.locator('.mikiru-message').count(),2,'reduced motion backdrop dismissal also preserves history');
  await motionPage.emulateMedia({reducedMotion:'no-preference'});
  await motionPage.getByRole('button',{name:'About Mikiru'}).click();
  await motionPage.getByRole('button',{name:'Close',exact:true}).click();
  await motionPage.emulateMedia({reducedMotion:'reduce'});
  await motionPage.getByRole('dialog').waitFor({state:'hidden'});
  {
    await motionPage.getByRole('button',{name:'About Mikiru'}).click();
    const fill=await motionPage.locator('.close-about').evaluate(el=>getComputedStyle(el).backgroundColor);
    await motionPage.getByRole('button',{name:'Close',exact:true}).hover();
    assert.equal(await motionPage.locator('.close-about').evaluate(el=>getComputedStyle(el).backgroundColor),fill);
    assert.equal(await motionPage.locator('.about-surface').evaluate(el=>getComputedStyle(el).borderRadius),'24px');
    assert.ok(await motionPage.locator('button, .message-text, .message-meta, .about-surface p, .credit-line').evaluateAll(els=>els.every(el=>parseFloat(getComputedStyle(el).fontSize)>=13)));
    await motionPage.screenshot({path:'.private/screenshots/about-fixed-mobile.png',fullPage:true});
    await motionPage.keyboard.press('Escape');await motionPage.getByRole('dialog').waitFor({state:'hidden'});
  }
  assert.deepEqual(motionErrors,[]);await motionContext.close();
  const missingContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const missingPage=await missingContext.newPage();await missingPage.route('**/api/art/mikiru',route=>route.fulfill({status:404,headers:{'Access-Control-Allow-Origin':'*'},body:''}));await missingPage.goto(base);
  await missingPage.waitForFunction(()=>document.querySelector('.portrait').hidden);
  assert.equal(await missingPage.locator('.art-slot').evaluate(el=>el.getBoundingClientRect().height),results.find(r=>r.width===390).layout.art.height,'missing artwork keeps its reserved slot');
  await missingPage.getByRole('button',{name:'Start chatting'}).click();await missingPage.getByRole('button',{name:'Mikiru Home'}).click();
  assert.equal(await missingPage.locator('img').count(),1,'missing artwork navigation does not create another image');
  await missingContext.close();
  const context = await browser.newContext({ timezoneId:'Asia/Bangkok', reducedMotion:'reduce' });
  const page = await context.newPage(); await page.clock.install({ time:new Date('2026-10-05T05:00:00Z') }); await page.goto(base); await page.getByRole('button',{name:'Start chatting'}).click();
  const second = await context.newPage(); await second.clock.install({time:new Date('2026-10-05T05:00:00Z')}); await second.goto(base); await second.getByRole('button',{name:'Start chatting'}).click();
  await Promise.all([page,second].map(async (tab,index) => { await tab.getByRole('textbox',{name:'Message'}).fill(`Tab ${index+1}`); await tab.getByRole('button',{name:'Send',exact:true}).click(); }));
  await page.waitForFunction(()=>document.querySelectorAll('.transcript .mikiru-message').length===2);
  await second.waitForFunction(()=>document.querySelectorAll('.transcript .mikiru-message').length===2);
  await page.getByRole('textbox',{name:'Message'}).fill('reset yourself'); await page.getByRole('button',{name:'Send',exact:true}).click(); await page.getByRole('button',{name:'Reset',exact:true}).click();
  await second.waitForFunction(()=>document.querySelectorAll('.transcript .message').length===0);
  await writeFile('.private/browser-isolation-probe.txt', 'SYNTHETIC_PRIVATE_BOUNDARY_TEST');
  for (const path of ['spec/mikiru.md','.private/art/source/mikiru-original.png','.private/art/source/prepare-webp.py','.private/art/mikiru.webp',`@fs/${process.cwd().replaceAll('\\','/')}/spec/mikiru.md`,'.private/browser-isolation-probe.txt']) {
    const response = await context.request.get(new URL(path,base).href);
    if (response.status() !== 403) {
      // Absent private inputs may reach Vite's HTML SPA fallback; that is not a
      // private-file response. The real synthetic probe must always be denied.
      assert.notEqual(path, '.private/browser-isolation-probe.txt');
      assert.equal(response.status(), 200, path);
      assert.match(response.headers()['content-type'] ?? '', /text\/html/);
      assert.match(await response.text(), /<main id="app"><\/main>/);
    }
  }
  const removedPng=await context.request.get(new URL('mikiru-art.png',base).href);
  assert.doesNotMatch(removedPng.headers()['content-type']??'',/image\//,'removed root PNG cannot be served as artwork (Vite may return its HTML fallback)');
  await context.close();
  await writeFile('.private/screenshots/browser-results.json', JSON.stringify(results,null,2));
  console.log(`Passed ${results.length} orientation layouts, balanced chat reservations, keyboard/focus and reduced/normal motion, fixed surfaces, missing art, literal chat/persistence/reset, real Web Locks/BroadcastChannel coordination, and private-file isolation checks.`);
} finally { await browser.close(); }
