import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium }=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({headless:true});const results=[];
const base=process.env.MIKIRU_PREVIEW_URL??'http://127.0.0.1:5173/';await mkdir('.private/screenshots',{recursive:true});
const rect=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),scale=r.width/el.offsetWidth;return {x:r.x,y:r.y,width:r.width,height:r.height,opacity:Number(s.opacity),blur:parseFloat(s.filter.slice(5))*scale,light:getComputedStyle(el,'::before').backgroundImage};};
try {
 for(const mode of ['light','dark']) for(const [width,height] of [[390,844],[1920,1200]]) {
  const context=await browser.newContext({viewport:{width,height},colorScheme:mode,reducedMotion:'no-preference',timezoneId:'Asia/Bangkok'});const page=await context.newPage();
  await page.clock.install({time:new Date('2026-10-06T05:00:00Z')});await page.goto(base);await page.waitForFunction(()=>document.querySelector('.artwork')?.classList.contains('is-ready')&&!document.querySelector('.artwork').getAnimations().length);
  const image=await page.locator('.portrait').elementHandle();
  const start=async view=>page.evaluate(view=>{document.querySelector(view==='chat'?'.landing-actions .primary':'.brand-home').click();window.__motion=document.querySelector('.artwork').getAnimations()[0];window.__motion.pause();window.__motion.currentTime=0;},view);
  for(const view of ['chat','landing']){
   await start(view);await page.evaluate(()=>{window.__motion.currentTime=310;});
   const midpoint=await page.locator('.artwork').evaluate(rect);
   const progress=await page.evaluate(()=>{const e=window.__motion.effect;return {frames:e.getKeyframes().length,progress:e.getComputedTiming().progress};});assert.equal(progress.frames,2,'no early dimming or late relighting keyframe');assert.ok(progress.progress>0&&progress.progress<1);
   assert.ok(midpoint.opacity>.15&&midpoint.opacity<1,'opacity changes throughout zoom');
   // Hidden chat controls cannot be clicked by users during entry; open the existing
   // modal handler directly to verify it still cannot disturb a staged artwork pose.
   await page.evaluate(view=>document.querySelector(view==='chat'?'.information-button':'.landing-actions .secondary').click(),view);await page.waitForFunction(()=>!document.querySelector('.about-dialog').getAnimations().length);assert.deepEqual(await page.locator('.artwork').evaluate(rect),midpoint,'About cannot alter any group presentation property');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
   if(view==='chat'){
    await page.evaluate(()=>{document.querySelector('.input').value='reset yourself';document.querySelector('.composer').requestSubmit();});await page.waitForFunction(()=>!document.querySelector('.reset-dialog').getAnimations().length);assert.deepEqual(await page.locator('.artwork').evaluate(rect),midpoint,'Reset cannot alter any group presentation property');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.evaluate(()=>document.querySelector('.input').value='');
   }
   // Capture the last animated paint and the first settled paint, including lighting.
   await page.evaluate(()=>window.__motion.currentTime=619.999);const last=await page.screenshot();
   await page.evaluate(()=>window.__motion.finish());await page.waitForFunction(()=>!document.querySelector('.artwork').classList.contains('is-transitioning'));const settled=await page.screenshot();
   // Compare artwork pixels only; ordinary control hover has its own faster timeline.
   const region=await page.evaluate(view=>{if(view==='landing'){const r=document.querySelector('.art-slot').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}const r=document.querySelector('.transcript').getBoundingClientRect();return {x:0,y:r.y,width:innerWidth,height:r.height};},view);
   const delta=await page.evaluate(async ([first,second,region])=>{
    const load=async data=>{const i=new Image();i.src='data:image/png;base64,'+data;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
    const a=await load(first),b=await load(second);let sum=0,changed=0,max=0,count=0;
    for(let y=Math.max(0,Math.ceil(region.y));y<Math.min(innerHeight,Math.floor(region.y+region.height));y++)for(let x=Math.max(0,Math.ceil(region.x));x<Math.min(innerWidth,Math.floor(region.x+region.width));x++){
      const i=(y*innerWidth+x)*4;let d=0;for(let c=0;c<3;c++){const diff=Math.abs(a[i+c]-b[i+c]);sum+=diff;d=Math.max(d,diff);}if(d>5)changed++;max=Math.max(max,d);count++;
    }
    return {mean:sum/(count*3),changedFraction:changed/count,max};
   },[last.toString('base64'),settled.toString('base64'),region]);
   assert.ok(delta.mean<.3&&delta.changedFraction<.005,'settling must not blink or relight: '+JSON.stringify(delta));
   await page.getByRole('button',{name:view==='chat'?'About Mikiru':'About',exact:true}).click();assert.equal(await image.evaluate(el=>el===document.querySelector('.portrait')),true);await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
   if(view==='chat'){const input=page.getByRole('textbox',{name:'Message'});await input.fill('reset yourself');await input.press('Enter');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await input.fill('');}
   results.push({mode,width,height,view,midpoint,delta});
  }
  for(const time of [155,310,465]){
   await start('chat');await page.evaluate(time=>window.__motion.currentTime=time,time);const before=await page.locator('.artwork').evaluate(rect);
   await start('landing');const after=await page.locator('.artwork').evaluate(rect);
   for(const key of ['x','y','width','height','opacity','blur'])assert.ok(Math.abs(before[key]-after[key])<.15,'rapid reversal preserves '+key);assert.equal(before.light,after.light);
   await page.evaluate(()=>window.__motion.finish());await page.waitForFunction(()=>!document.querySelector('.artwork').getAnimations().length);
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Start chatting'}).click();assert.equal(await page.locator('.artwork').evaluate(el=>el.getAnimations().length),0);await page.getByRole('button',{name:'Mikiru Home'}).click();assert.equal(await image.evaluate(el=>el===document.querySelector('.portrait')),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await context.close();
 }
 await writeFile('.private/artwork-continuity-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({passed:true,endFrameCases:results.length,reversalCases:12,maxMeanPixelChange:Math.max(...results.map(r=>r.delta.mean)),maxChangedPixelFraction:Math.max(...results.map(r=>r.delta.changedFraction))}));
}finally{await browser.close();}
