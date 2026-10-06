import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless:true });
const base = process.env.MIKIRU_PREVIEW_URL ?? 'http://127.0.0.1:5173/';
const results=[]; const initialResults=[];
await mkdir('.private/screenshots',{recursive:true});
try {
  // Hold the application and stylesheet, exposing the real pre-paint head resolver.
  for(const [saved,os,expected] of [[null,'light','light'],[null,'dark','dark'],['light','dark','light'],['dark','light','dark'],['invalid','dark','dark']]) {
    const context=await browser.newContext({colorScheme:os,reducedMotion:'reduce'});const page=await context.newPage();
    await page.addInitScript(saved=>{if(saved===null)localStorage.removeItem('mikiru.appearance');else localStorage.setItem('mikiru.appearance',saved);},saved);
    let release;const gate=new Promise(resolve=>release=resolve);
    await page.route(/(?:\/src\/client\/main\.ts|\/assets\/index-.*\.(?:js|css))$/,async route=>{await gate;await route.continue();});
    await page.goto(base,{waitUntil:'commit'});await page.waitForFunction(()=>!!document.documentElement.dataset.appearance);
    const early=await page.evaluate(()=>({mode:document.documentElement.dataset.appearance,ground:getComputedStyle(document.documentElement).backgroundColor,scheme:getComputedStyle(document.documentElement).colorScheme,children:document.querySelector('#app').children.length,meta:document.querySelector('meta[name="theme-color"]').content}));
    assert.deepEqual(early,{mode:expected,ground:expected==='dark'?'rgb(0, 0, 0)':'rgb(255, 224, 224)',scheme:expected,children:0,meta:expected==='dark'?'#000000':'#ffe0e0'});
    release();await page.getByRole('button',{name:'Start chatting'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.appearance),expected);
    initialResults.push({saved,os,early});await context.close();
  }
  // Live System updates, explicit overrides, keyboard selection and cross-tab synchronization.
  {
    const context=await browser.newContext({colorScheme:'light',reducedMotion:'reduce'});const page=await context.newPage();await page.goto(base);
    await page.getByRole('button',{name:'About',exact:true}).click();const select=page.getByRole('combobox',{name:'Appearance'});
    assert.equal(await select.inputValue(),'system');
    await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.appearance==='dark');
    await select.focus();await select.press('Home');await select.press('ArrowDown');assert.equal(await select.inputValue(),'light');
    await page.waitForFunction(()=>document.documentElement.dataset.appearance==='light');
    await page.emulateMedia({colorScheme:'light'});await page.emulateMedia({colorScheme:'dark'});assert.equal(await page.evaluate(()=>document.documentElement.dataset.appearance),'light');
    await select.selectOption('dark');await page.reload();await page.getByRole('button',{name:'About',exact:true}).click();assert.equal(await select.inputValue(),'dark');
    const other=await context.newPage();await other.goto(base);await other.getByRole('button',{name:'About',exact:true}).click();
    await other.getByRole('combobox',{name:'Appearance'}).selectOption('light');await page.waitForFunction(()=>document.documentElement.dataset.appearance==='light');assert.equal(await select.inputValue(),'light');
    await select.selectOption('system');assert.equal(await page.evaluate(()=>localStorage.getItem('mikiru.appearance')),null);
    await other.waitForFunction(()=>document.documentElement.dataset.appearance==='light');
    await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.appearance==='dark');
    await page.getByRole('switch',{name:'Scene Detail'}).check();await select.selectOption('light');assert.equal(await page.getByRole('switch',{name:'Scene Detail'}).isChecked(),true);
    await context.close();
  }
  for(const mode of ['light','dark']) for(const [width,height] of [[320,568],[390,844],[800,800],[800,801],[801,800],[1920,1200],[3440,1440]]) {
    const context=await browser.newContext({viewport:{width,height},colorScheme:mode,reducedMotion:'reduce',timezoneId:'Asia/Bangkok'});
    const page=await context.newPage();const errors=[];const requests=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(mode=>localStorage.setItem('mikiru.appearance',mode),mode);
    await page.clock.install({time:new Date('2026-10-06T05:00:00Z')});
    page.on('request',req=>{if(req.url().endsWith('/api/chat')&&req.method()==='POST')requests.push({descriptions:req.postDataJSON().descriptions,appearanceSent:'appearance' in req.postDataJSON()});});
    await page.goto(base);await page.waitForFunction(()=>document.querySelector('.artwork')?.classList.contains('is-ready'));
    const image=await page.locator('.portrait').elementHandle();const light=mode==='light';const interactions=[];
    const shot=async state=>{await page.evaluate(()=>getSelection()?.removeAllRanges());await page.screenshot({path:'.private/screenshots/appearance-'+mode+'-'+width+'x'+height+'-'+state+'.png'});};
    const contrast=async (locator,pseudo)=>locator.evaluate((el,pseudo)=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');
      c.fillStyle=getComputedStyle(document.documentElement).backgroundColor;c.fillRect(0,0,1,1);
      const chain=[];for(let node=el;node;node=node.parentElement)chain.unshift(getComputedStyle(node).backgroundColor);
      for(const fill of chain){c.fillStyle=fill;c.fillRect(0,0,1,1);}if(pseudo){c.fillStyle=getComputedStyle(el,pseudo).backgroundColor;c.fillRect(0,0,1,1);}const bg=[...c.getImageData(0,0,1,1).data];
      c.clearRect(0,0,1,1);c.fillStyle=pseudo?getComputedStyle(el,pseudo).color:el.matches('.setting-switch')?getComputedStyle(el,'::before').backgroundColor:getComputedStyle(el).color;c.fillRect(0,0,1,1);const fg=[...c.getImageData(0,0,1,1).data];
      const l=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      return (Math.max(l(bg),l(fg))+.05)/(Math.min(l(bg),l(fg))+.05);
    },pseudo);
    const control=async (locator,name,minimum=4.5)=>{
      const states=[];
      for(const state of ['normal','hover','focus','pressed']) {
        await page.mouse.move(2,2);
        if(state==='normal')await locator.evaluate(el=>el.blur());
        if(state==='hover')await locator.hover();
        if(state==='focus'){await page.keyboard.press('Tab');await locator.focus();}
        if(state==='pressed'){await locator.hover();await page.mouse.down();}
        const style=await locator.evaluate(el=>{const s=getComputedStyle(el);return {fill:s.backgroundColor,color:s.color,outline:s.outline,shadow:s.boxShadow,focused:document.activeElement===el};});
        assert.ok(await contrast(locator)>=minimum,name+' '+state+' contrast');
        if(state==='focus'){assert.equal(style.focused,true);assert.ok(style.shadow!=='none'||!style.outline.includes('none')||style.fill!==states[0].fill,name+' perceivable custom keyboard focus');}
        states.push({state,...style});
        if(state==='pressed'){await page.mouse.move(2,2);await page.mouse.up();}
      }
      interactions.push({name,states});
    };
    const landing=await page.evaluate(()=>({mode:document.documentElement.dataset.appearance,ground:getComputedStyle(document.documentElement).backgroundColor,layout:getComputedStyle(document.querySelector('.landing')).getPropertyValue('--layout-view').trim(),lighting:getComputedStyle(document.querySelector('.artwork'),'::before').backgroundImage,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.equal(landing.mode,mode);assert.equal(landing.ground,light?'rgb(255, 224, 224)':'rgb(0, 0, 0)');
    assert.equal(landing.layout,width>height?'desktop':'mobile');assert.equal(landing.overflow,false);assert.match(landing.lighting,/radial-gradient/);
    if(!light){
      const core=Number(landing.lighting.match(/rgba\(255, 255, 255, ([\d.]+)\)/)[1]);
      const falloff=Number(landing.lighting.match(/rgba\(145, 83, 62, ([\d.]+)\)/)[1]);
      assert.ok(core>=.49&&core<=.51,'dark neutral illumination is twice the former intensity');
      assert.ok(falloff>=.26&&falloff<=.28,'soft warm falloff separates the portrait from black');
    }
    assert.equal(await page.locator('.landing-hook').count(),0);await shot('landing');
    await control(page.getByRole('button',{name:'Start chatting'}),'Start chatting');await control(page.getByRole('button',{name:'About',exact:true}),'About');
    assert.equal(interactions.find(item=>item.name==='About').states.find(item=>item.state==='hover').fill,light?'rgb(241, 234, 230)':'rgb(48, 48, 48)','shared About hover has a warm/neutral fill, never green');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).accentColor),'rgb(145, 83, 62)','native accent is explicitly brown');
    await page.getByRole('button',{name:'About',exact:true}).click();
    const about=await page.locator('.about-dialog').evaluate(el=>{
      const shell=el.querySelector('.about-surface'),body=el.querySelector('.about-content');const c=document.createElement('canvas').getContext('2d');c.fillStyle=getComputedStyle(el,'::backdrop').backgroundColor;c.fillRect(0,0,1,1);
      return {backdrop:[...c.getImageData(0,0,1,1).data],blur:getComputedStyle(el,'::backdrop').backdropFilter,shadow:getComputedStyle(shell).boxShadow,border:getComputedStyle(shell).borderWidth,outline:getComputedStyle(shell).outlineWidth,introColor:getComputedStyle(body.querySelector('.about-intro')).color,infoColor:getComputedStyle(body.querySelector('.about-data p')).color,clip:getComputedStyle(shell).overflow,bodyX:getComputedStyle(body).overflowX,
        order:[...body.children].map(node=>node.className),headings:[...body.querySelectorAll('h3')].map(node=>[node.textContent,getComputedStyle(node).fontSize]),bodySizes:[...body.querySelectorAll('p,.setting-row,code')].map(node=>getComputedStyle(node).fontSize),footerInside:!!shell.querySelector('.credit-line')&&el.children.length===1};
    });
    assert.deepEqual(about.backdrop,[0,0,0,48]);assert.equal(about.blur,'blur(4px)');assert.equal(about.shadow,'none');assert.equal(about.border,'0px');assert.equal(about.outline,'0px');assert.equal(about.introColor,about.infoColor);assert.equal(about.clip,'hidden');assert.equal(about.bodyX,'hidden');
    assert.deepEqual(about.order,['about-intro','about-data','about-settings','about-start-over','about-footer']);
    assert.deepEqual(about.headings,[['Your privacy','16px'],['Settings','16px'],['Start over','16px']]);assert.ok(about.bodySizes.every(size=>size==='14px'));assert.equal(about.footerInside,true);
    assert.equal(await page.locator('.setting-help,.setting-value,.setting-control').count(),0);
    assert.equal(await page.locator('.reset-command').evaluate(el=>el.tagName==='CODE'&&getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)'),true);
    const scene=page.getByRole('switch',{name:'Scene Detail'});assert.equal(await scene.isChecked(),false);
    await control(page.getByRole('button',{name:'Close',exact:true}),'Close',3);await control(scene,'Scene Detail Off',3);
    await scene.check();await control(scene,'Scene Detail On',3);await shot('about-detail-on');
    await scene.uncheck();await control(page.getByRole('combobox',{name:'Appearance'}),'Appearance');
    await page.getByRole('combobox',{name:'Appearance'}).evaluate(el=>el.blur());await page.mouse.move(2,2);
    const appearanceButton=await page.locator('.appearance-select').evaluate(el=>{
      const s=getComputedStyle(el),icon=el.parentElement.querySelector('svg'),i=getComputedStyle(icon);
      return {appearance:s.appearance,fill:s.backgroundColor,text:s.color,border:s.borderWidth,outline:s.outlineWidth,shadow:s.boxShadow,radius:s.borderRadius,icon:i.stroke,iconPointer:i.pointerEvents,iconHidden:icon.getAttribute('aria-hidden'),focusable:icon.getAttribute('focusable')};
    });
    assert.equal(appearanceButton.appearance,'none','closed control avoids platform chrome');
    assert.equal(appearanceButton.fill,light?'rgb(255, 255, 255)':'rgb(21, 21, 21)');
    assert.equal(appearanceButton.border,'0px');assert.equal(appearanceButton.outline,'0px');assert.equal(appearanceButton.shadow,'none');
    assert.equal(appearanceButton.text,light?'rgb(77, 52, 43)':'rgb(238, 238, 238)');
    assert.equal(appearanceButton.icon,light?'rgb(107, 91, 84)':'rgb(189, 183, 180)');
    assert.equal(appearanceButton.radius,'12px');assert.equal(appearanceButton.iconPointer,'none');assert.equal(appearanceButton.iconHidden,'true');assert.equal(appearanceButton.focusable,'false');
    for(const selector of ['.about-intro','.about-data p','.setting-row','.reset-command','.credit-line'])assert.ok(await contrast(page.locator(selector).first())>=4.5,selector+' contrast');
    await control(page.getByRole('link',{name:'GitHub',exact:true}),'GitHub');await shot('about');
    assert.equal(await image.evaluate(el=>el===document.querySelector('.portrait')&&!el.hidden),true);
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Start chatting'}).click();await shot('empty-chat');
    const chat=await page.evaluate(()=>{
      const h=document.querySelector('.chat-header'),b=document.querySelector('.bottom'),t=document.querySelector('.transcript'),i=document.querySelector('.input-wrap');
      const style=node=>({fill:getComputedStyle(node).backgroundColor,blur:getComputedStyle(node).backdropFilter});
      return {header:style(h),bottom:style(b),topHeight:h.getBoundingClientRect().height,bottomHeight:b.getBoundingClientRect().height,
        transcriptTop:t.getBoundingClientRect().top,headerBottom:h.getBoundingClientRect().bottom,transcriptBottom:t.getBoundingClientRect().bottom,bottomTop:b.getBoundingClientRect().top,
        composerBottomGap:innerHeight-i.getBoundingClientRect().bottom,composer:style(i).fill,artBlur:getComputedStyle(document.querySelector('.artwork')).filter,artOpacity:getComputedStyle(document.querySelector('.artwork')).opacity};
    });
    assert.deepEqual(chat.header,{fill:'rgba(0, 0, 0, 0)',blur:'none'});assert.deepEqual(chat.bottom,chat.header);
    assert.equal(chat.topHeight,92);assert.equal(chat.bottomHeight,92);assert.ok(chat.transcriptTop>=chat.headerBottom&&chat.transcriptBottom<=chat.bottomTop);assert.equal(chat.composerBottomGap,24);
    assert.equal(chat.composer,light?'rgb(250, 250, 250)':'rgb(41, 41, 41)');assert.equal(chat.artBlur,'blur(20px)');assert.equal(chat.artOpacity,'0.15');
    const input=page.getByRole('textbox',{name:'Message'});const send=page.getByRole('button',{name:'Send',exact:true});assert.equal(await send.isDisabled(),true);
    const normal=await page.locator('.input-wrap').evaluate(el=>getComputedStyle(el).backgroundColor);
    for(const focus of ['mouse','keyboard','programmatic']){
      if(focus==='mouse')await input.click();else {await page.keyboard.press('Tab');await input.focus();}
      await input.fill('A local appearance check');
      const s=await page.locator('.input-wrap').evaluate(el=>({fill:getComputedStyle(el).backgroundColor,shadow:getComputedStyle(el).boxShadow,transition:getComputedStyle(el).transitionDuration,inputOutline:getComputedStyle(el.querySelector('.input')).outlineWidth}));
      assert.deepEqual(s,{fill:normal,shadow:'none',transition:'0s',inputOutline:'0px'});
    }
    const home=page.getByRole('button',{name:'Mikiru Home'});const brand=await home.evaluate(el=>({fill:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
    await home.hover();assert.deepEqual(await home.evaluate(el=>({fill:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color})),brand);
    await control(page.getByRole('button',{name:'About Mikiru'}),'Information',3);await control(send,'Send',3);
    await input.fill('First local visual turn');await send.click();await page.waitForFunction(()=>document.querySelectorAll('.mikiru-message').length===1);
    const surfaces=await page.locator('.message').evaluateAll(els=>els.map(el=>({user:el.classList.contains('user-message'),fill:getComputedStyle(el.querySelector('.message-bubble')).backgroundColor})));
    assert.equal(surfaces.find(s=>s.user).fill,'rgb(145, 83, 62)');assert.equal(surfaces.find(s=>!s.user).fill,chat.composer);
    assert.notEqual(surfaces.find(s=>s.user).fill,surfaces.find(s=>!s.user).fill,'assistant uses a distinct muted surface');
    for(const selector of ['.user-message .message-text','.mikiru-message .message-text','.message-meta'])assert.ok(await contrast(page.locator(selector).first())>=4.5);
    assert.ok(await contrast(page.locator('.user-message .message-text').first(),'::selection')>=4.5,'selected user text stays readable without native blue highlighting');
    await shot('populated-chat');
    await page.getByRole('button',{name:'About Mikiru'}).click();await scene.check();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
    let fail=true;await page.route('**/api/chat',route=>fail?route.fulfill({status:429,headers:{'Access-Control-Allow-Origin':'*','Content-Type':'application/json'},body:JSON.stringify({error:{code:'RATE_LIMITED'}})}):route.continue());
    await input.fill('Local retry appearance check');await send.click();const retry=page.getByRole('button',{name:'Retry message'});await retry.waitFor();
    assert.equal(await page.locator('.mikiru-message').count(),1);await control(retry,'Retry',3);
    const retryBox=await retry.boundingBox(),bubble=await page.locator('.failed-reply .message-bubble').boundingBox();assert.ok(retryBox.x>=bubble.x+bubble.width+7&&retryBox.y<bubble.y+bubble.height);
    assert.equal(await retry.evaluate(el=>getComputedStyle(el).borderRadius),'50%');await shot('failed-retry');
    await page.getByRole('button',{name:'About Mikiru'}).click();await scene.uncheck();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
    fail=false;await retry.click();await page.waitForFunction(()=>document.querySelectorAll('.mikiru-message').length===2);assert.equal(await retry.count(),0);
    assert.deepEqual(requests.map(r=>r.descriptions),[false,true,true]);assert.ok(requests.every(r=>!r.appearanceSent));
    await input.fill('reset yourself');await input.press('Enter');const cancel=page.getByRole('button',{name:'Cancel',exact:true});await cancel.waitFor();
    assert.deepEqual(await page.locator('.reset-dialog').evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderWidth,outline:s.outlineWidth,shadow:s.boxShadow};}),{border:'0px',outline:'0px',shadow:'none'});
    assert.equal(await cancel.evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineWidth==='0px'),true);
    await control(cancel,'Cancel');await control(page.getByRole('button',{name:'Reset',exact:true}),'Reset');await shot('reset');
    assert.equal(await image.evaluate(el=>el===document.querySelector('.portrait')&&!el.hidden),true);
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.locator('.mikiru-message').count(),2);
    if([390,1920].includes(width)) {
      for(let turn=0;turn<8;turn++) {
        const count=await page.locator('.mikiru-message').count();
        await input.fill(('Local scroll/layout verification '+turn+'. This is ordinary fixture text used to inspect line wrapping, brown user bubbles, neutral metadata and the reserved composer region.\n').repeat(4));
        await send.click();await page.waitForFunction(count=>document.querySelectorAll('.mikiru-message').length===count+1,count);
      }
      assert.equal(await page.locator('.transcript').evaluate(el=>el.scrollHeight>el.clientHeight),true,'long conversation scrolls within reserved regions');
      assert.equal(await page.locator('.transcript').evaluate(el=>el.scrollWidth>el.clientWidth),false,'long text cannot create horizontal overflow');
      await shot('long-chat');
    }
    await home.focus();await home.press('Enter');assert.equal(await page.locator('.landing').isVisible(),true);assert.equal(await page.locator('img').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
    results.push({mode,width,height,landing,about,chat,surfaces,interactions,requests,errors});await context.close();
  }
  await writeFile('.private/screenshots/appearance-results.json',JSON.stringify({initialResults,systemLiveAndCrossTab:true,results},null,2));
  console.log('Both appearances passed 14 responsive/state cases, 5 pre-paint saved/System cases, live OS changes, override/reload/cross-tab persistence, keyboard controls and contrast, About structure, invisible reservations, bubbles/composer, retry and shared artwork. Fixture inference only.');
} finally {await browser.close();}
