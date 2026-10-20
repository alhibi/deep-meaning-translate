"""Deterministic branched UI regressions with intercepted provider replies; no paid requests.
Run: python3 tests/e2e/adversarial.py
"""
import asyncio,json,random
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path('/tmp/browser/audit'); ROOT.mkdir(parents=True, exist_ok=True); failures=[]; errors=[]
def check(ok,msg):
 print(('PASS ' if ok else 'FAIL ')+msg)
 if not ok: failures.append(msg)
def encode(v,c):
 if v is None:return {'t':2,'s':1}
 if isinstance(v,bool):return {'t':2,'s':2 if v else 3}
 if isinstance(v,str):return {'t':1,'s':v}
 if isinstance(v,(int,float)):return {'t':0,'s':v}
 i=c[0];c[0]+=1
 if isinstance(v,list):return {'t':9,'i':i,'a':[encode(x,c) for x in v],'o':0}
 return {'t':10,'i':i,'p':{'k':list(v),'v':[encode(x,c) for x in v.values()]},'o':0}
def rpc(v):return json.dumps(encode({'result':v,'error':None,'context':{}},[0]),ensure_ascii=False)
A='يا حسرتاه على اللي فات، كانت أيام حلوة'; B='موعد جديد غداً.'
async def run(p,width,locale):
 browser=await p.chromium.launch(headless=True);ctx=await browser.new_context(viewport={'width':width,'height':758 if width==424 else 1800},reduced_motion='reduce')
 page=await ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));requests=[]
 async def translation(r):
  if r.request.method=="GET": await r.fulfill(status=204);return
  d=r.request.post_data_json;requests.append(d)
  t='Schade um die alten schönen Tage.' if d['text']==A else 'Ein neuer Termin morgen.'
  value={'translation':t,'sourceLanguage':'ar','targetLanguage':d['target'],'tone':'neutral','formality':'neutral','confidence':1,'isAmbiguous':False,'alternativeTranslations':[],'notes':''}
  await r.fulfill(content_type='text/plain',body=json.dumps(value) if d['mode']=='full' else t)
 async def serverfn(r):
  d=r.request.post_data or ''
  if 'translation' in d and ('uiLocale' in d or 'ui_locale' in d):
   loss={'id':'loss-1','category':'intensity','severity':2,'confidence':.9,'source':{'start':0,'end':10},'target':{'start':0,'end':6},'sourceQuote':'يا حسرتاه','targetQuote':'Schade','explanation':'Some regret may be lost.','restores':[{'text':'Wie sehr ich die alten schönen Tage vermisse.','note':'More regret','changed':{'start':0,'end':45}}]}
   v={'shadow':{'losses':[loss]}}
  else:v={'ok':True,'result':None,'lexicon':None}
  await r.fulfill(content_type='application/json',headers={'x-tss-serialized':'true'},body=rpc(v))
 await page.route('**/api/translate-stream',translation);await page.route('**/_serverFn/**',serverfn)
 await page.route('**/api/eleven-speak',lambda r:r.fulfill(status=503,content_type='application/json',body='{"ok":false,"kind":"config"}'))
 await page.route('**/api/speak',lambda r:r.fulfill(status=503,content_type='application/json',body='{"ok":false,"kind":"config"}'))
 await page.goto('http://localhost:8080');await page.evaluate('(locale)=>{localStorage.setItem("lingua.intro.seen.v1","1");localStorage.setItem("lingua.ui-locale",locale);localStorage.setItem("lingua.prefs.v1",JSON.stringify({source:"ar",target:"de",style:"natural"}));}',locale);await page.reload();await page.wait_for_timeout(1000);box=page.locator('textarea').first
 await box.fill(A);await page.wait_for_timeout(8000);await page.locator('.shadow-hit').first.wait_for(timeout=3000)
 await page.locator('.shadow-summary button').first.click();await page.get_by_test_id('shadow-map').wait_for()
 await page.get_by_test_id('shadow-map').locator('button').last.click();await page.wait_for_timeout(500)
 check(await page.get_by_test_id('shadow-sheet').count()==1,f'{width}/{locale} map → detail stays open')
 await page.screenshot(path=str(ROOT/f'{width}-{locale}-detail.png'))
 await page.get_by_test_id('shadow-sheet').locator('button.bg-signal').first.click();await page.wait_for_timeout(400)
 check('Wie sehr' in await page.locator('.result-text').first.inner_text(),f'{width}/{locale} apply reads back through UI')
 await box.fill(B);await page.wait_for_timeout(1600)
 undo=page.get_by_role('button',name='Undo',exact=True).or_(page.get_by_role('button',name='تراجع',exact=True))
 check(await undo.count()==0,f'{width}/{locale} old Undo hidden for different document')
 hist=await page.evaluate('JSON.parse(localStorage.getItem("lingua.history.v1")||"[]")')
 check(any(x['original']==B and x['translated']=='Ein neuer Termin morgen.' for x in hist),f'{width}/{locale} new archive row is not corrupted by old fix')
 # Deterministic adversarial input transitions: clear, singleton, very long text, scripts, rapid styles.
 rng=random.Random(71); samples=['','H','🙂','مرحبا','Guten Morgen.','漢字テスト','a'*5000,'نص\nمتعدد\nالأسطر']
 for i in range(50):
  await box.fill(rng.choice(samples))
  if i%5==0:await page.get_by_role('radio').nth(rng.randrange(3)).click()
  if i%7==0:await page.get_by_role('button',name='Next colour theme').or_(page.get_by_role('button',name='الثيم اللوني التالي')).click()
  if i%10==0:
   await page.get_by_role('button',name='Source language',exact=True).or_(page.get_by_role('button',name='لغة المصدر',exact=True)).click()
   await page.keyboard.press('Escape')
  await page.wait_for_timeout(35)
 await box.fill('H');await page.wait_for_timeout(1800)
 check(await page.locator('.result-text').count()==0,f'{width}/{locale} singleton never receives stale translation')
 check(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'{width}/{locale} no overflow after randomized actions')
 await page.screenshot(path=str(ROOT/f'{width}-{locale}-random.png'))
 await browser.close()
async def main():
 async with async_playwright() as p:
  await run(p,424,'en');await run(p,1280,'ar')
 check(not errors,'zero runtime errors across branches')
 print('Failures:',len(failures));assert not failures
asyncio.run(main())
