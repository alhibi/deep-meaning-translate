"""Translation box growth: smooth expand, exact final fit, quick shrink, no clipping, reduced motion.
Run: python3 tests/e2e/grow_box.py  (provider replies intercepted; no paid requests)
"""
import asyncio,json
from playwright.async_api import async_playwright
failures=[];errors=[]
def check(ok,msg):
 print(('PASS ' if ok else 'FAIL ')+msg)
 if not ok: failures.append(msg)
SHORT='موعد غداً.'; LONG='هذا نص طويل جداً. '*30
TR={SHORT:'Termin morgen.',LONG:'Das ist ein sehr langer Text, der viele Zeilen füllt. '*14}
SAMPLER='''()=>{const b=document.querySelector('.grow-box');window.__h=[];const f=()=>{window.__h.push([performance.now(),b.getBoundingClientRect().height,b.firstElementChild.offsetHeight,b.classList.contains('is-growing')]);window.__raf=requestAnimationFrame(f)};f()}'''
async def run(p,reduced):
 b=await p.chromium.launch(headless=True);ctx=await b.new_context(viewport={'width':424,'height':758},reduced_motion='reduce' if reduced else 'no-preference')
 page=await ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 async def tr(r):
  if r.request.method=='GET': await r.fulfill(status=204);return
  d=r.request.post_data_json;t=TR.get(d['text'],'Ok.')
  v={'translation':t,'sourceLanguage':'ar','targetLanguage':d['target'],'tone':'neutral','formality':'neutral','confidence':1,'isAmbiguous':False,'alternativeTranslations':[],'notes':''}
  await r.fulfill(content_type='text/plain',body=json.dumps(v) if d['mode']=='full' else t)
 await page.route('**/api/translate-stream',tr)
 await page.route('**/_serverFn/**',lambda r:r.fulfill(status=503,body=''))
 await page.goto('http://localhost:8080');await page.evaluate('()=>{localStorage.setItem("lingua.intro.seen.v1","1");localStorage.setItem("lingua.prefs.v1",JSON.stringify({source:"ar",target:"de",style:"natural"}))}');await page.reload();await page.wait_for_timeout(1200)
 tag='reduced' if reduced else 'motion'
 box=page.locator('textarea').first
 await box.fill(SHORT);await page.wait_for_timeout(2500)
 h0=await page.evaluate("document.querySelector('.grow-box').getBoundingClientRect().height")
 await page.evaluate(SAMPLER);await box.fill(LONG);await page.wait_for_timeout(3500)
 grow=await page.evaluate('()=>{cancelAnimationFrame(window.__raf);return window.__h}')
 await page.screenshot(path=f'/tmp/browser/grow/{tag}_long.png')
 await page.evaluate(SAMPLER);await box.fill(SHORT);await page.wait_for_timeout(2500)
 shrink=await page.evaluate('()=>{cancelAnimationFrame(window.__raf);return window.__h}')
 fin=lambda s:s[-1]
 hs=[x[1] for x in grow];top=max(hs);end=fin(grow)
 check(end[1]>h0+150,f'{tag}: box grew for long text ({h0:.0f}->{end[1]:.0f}px)')
 check(abs(end[1]-end[2])<1,f'{tag}: final height fits content exactly, nothing clipped')
 check(not end[3],f'{tag}: growing glow switched off after settling')
 steps=[hs[i+1]-hs[i] for i in range(len(hs)-1) if hs[i+1]!=hs[i]]
 if reduced: check(max(abs(s) for s in steps)>100 if steps else False,f'{tag}: resizes instantly without animation')
 else:
  check(len(steps)>=10,f'{tag}: growth spread over {len(steps)} frames (smooth, not a jump)')
  check(max(steps)<0.6*(end[1]-h0),f'{tag}: largest single-frame step {max(steps):.0f}px')
  check(top-end[1]<0.08*end[1],f'{tag}: overshoot {top-end[1]:.0f}px stays subtle')
  check(any(x[3] for x in grow),f'{tag}: glow line shows while growing')
 se=fin(shrink);check(abs(se[1]-se[2])<1 and se[1]<end[1]-150,f'{tag}: shrinks back and fits ({se[1]:.0f}px)')
 if not reduced:
  t0=next(x[0] for x in shrink if x[1]<end[1]-1);t1=next(x[0] for x in shrink if abs(x[1]-se[1])<1)
  check(t1-t0<450,f'{tag}: shrink finishes quickly ({t1-t0:.0f}ms)')
 ow=await page.evaluate('document.documentElement.scrollWidth>innerWidth');check(not ow,f'{tag}: no sideways overflow')
 await b.close()
async def main():
 async with async_playwright() as p:
  await run(p,False);await run(p,True)
 check(not errors,f'no runtime errors {errors[:2]}')
 print('FAILURES',len(failures))
asyncio.run(main())
