import asyncio,json,time
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True)
  for size in [{'width':390,'height':844}]:
   ctx=await b.new_context(viewport=size);page=await ctx.new_page();errors=[];requests=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('request',lambda r:requests.append(r.url) if '/api/eleven-speak' in r.url else None)
   await page.goto('http://localhost:8080')
   await page.evaluate("""()=>{localStorage.setItem('lingua.intro.v1','done');localStorage.setItem('lingua.intro.seen.v1','1');localStorage.setItem('lingua.ui-locale','en');localStorage.setItem('lingua.prefs.v1',JSON.stringify({source:'ar',target:'de',style:'natural'}));localStorage.removeItem('lingua.voice.v2');localStorage.removeItem('lingua.voice.v1');} """)
   await page.reload();await page.wait_for_timeout(1200)
   for label in ['Start translating','ابدأ الترجمة']:
    loc=page.get_by_role('button',name=label,exact=True)
    if await loc.count():await loc.click();await page.wait_for_timeout(1300)
   await page.get_by_role('textbox').first.fill('صباح الخير، هل تريد أن نلتقي غداً في المقهى؟')
   listen=page.get_by_role('button',name='Listen',exact=True)
   await listen.wait_for(timeout=60000);await page.wait_for_timeout(3500)
   before=len(requests);await listen.click();await page.wait_for_timeout(900)
   await page.screenshot(path=f'/tmp/browser/eleven/{size["width"]}_playing.png')
   states=[]
   for i in range(12):
    await page.wait_for_timeout(500);states.append(await page.locator('.spoken-word[data-state="said"]').count())
   print('viewport',size,'prefetch requests',before,'after listen',len(requests),'said words',states,'errors',errors)
   assert max(states)>0 and not errors
   await listen.click(button='right');await page.get_by_role('dialog').wait_for()
   await page.get_by_role('radio',name='Roger',exact=False).click()
   await page.get_by_role('radio',name='Fast',exact=True).click()
   await page.screenshot(path=f'/tmp/browser/eleven/{size["width"]}_settings.png')
   print('saved settings',await page.evaluate("JSON.parse(localStorage.getItem('lingua.voice.v2'))"))
   await page.get_by_role('button',name='Close',exact=True).click()
   # Real German input to Arabic output, with a different voice and faster model.
   await page.evaluate("()=>{localStorage.setItem('lingua.prefs.v1',JSON.stringify({source:'de',target:'ar',style:'natural'}));const v=JSON.parse(localStorage.getItem('lingua.voice.v2'));v.quality='fast';localStorage.setItem('lingua.voice.v2',JSON.stringify(v));}")
   await page.reload();await page.wait_for_timeout(1000)
   await page.get_by_role('textbox').first.fill('Guten Morgen, ich wünsche dir einen schönen Tag.')
   await listen.wait_for(timeout=40000);await page.wait_for_timeout(3000);await listen.click()
   await page.wait_for_timeout(1300)
   await page.screenshot(path=f'/tmp/browser/eleven/{size["width"]}_arabic.png')
   arabic_states=[]
   for i in range(8):
    await page.wait_for_timeout(250);arabic_states.append(await page.locator('.spoken-word[data-state="said"]').count())
   print('Arabic read-along',arabic_states,'errors',errors)
   assert max(arabic_states)>0 and not errors
   # Stop and replay reuse prepared speech rather than sending another paid request.
   stop=page.get_by_role('button',name='Stop',exact=True)
   if await stop.count():await stop.click()
   count=len(requests);await listen.click();await page.wait_for_timeout(500)
   assert len(requests)==count

   await ctx.close()
  await b.close()
asyncio.run(main())
