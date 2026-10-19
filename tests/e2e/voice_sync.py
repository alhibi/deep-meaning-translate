"""Deterministic audible PCM/read-along regression; no paid provider requests."""
import asyncio, base64, json, math, struct
from pathlib import Path
from playwright.async_api import async_playwright

TEXT = 'Hallo schöne Welt'
FULL = dict(translation=TEXT, sourceLanguage='ar', targetLanguage='de', tone='neutral', formality='neutral', confidence=1, isAmbiguous=False, alternativeTranslations=[], notes='', situation='general')
RATE = 24000
# A real playable PCM waveform with known word timestamps and an opening pause.
AUDIO = base64.b64encode(b''.join(struct.pack('<h', int(4500 * math.sin(2*math.pi*330*i/RATE))) for i in range(RATE*4))).decode()
STARTS = [0.6 if i < 5 else 1.3 if i < 12 else 2.0 for i in range(len(TEXT))]
PACKET = json.dumps(dict(audio_base64=AUDIO, alignment=dict(characters=list(TEXT), character_start_times_seconds=STARTS, character_end_times_seconds=[s+0.15 for s in STARTS]))) + '\n'

async def main():
 async with async_playwright() as p:
  browser = await p.chromium.launch(headless=True)
  for width,height in [(424,758),(1280,1800)]:
   context=await browser.new_context(viewport=dict(width=width,height=height))
   page=await context.new_page(); errors=[]; speech=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   await page.route('**/_serverFn/**', lambda r:r.fulfill(status=200,content_type='application/json',headers={"x-tss-serialized":"true"},body='{"t":10,"i":0,"p":{"k":["result","error","context"],"v":[{"t":10,"i":1,"p":{"k":["ok","result"],"v":[{"t":2,"s":2},{"t":10,"i":2,"p":{"k":["sourceLanguage","targetLanguage","translation","tone","formality","confidence","isAmbiguous","alternativeTranslations","notes","situation"],"v":[{"t":1,"s":"de"},{"t":1,"s":"de"},{"t":1,"s":"Hallo schöne Welt"},{"t":1,"s":"neutral"},{"t":1,"s":"neutral"},{"t":0,"s":1},{"t":2,"s":3},{"t":9,"i":3,"a":[],"o":0},{"t":1,"s":""},{"t":1,"s":"general"}]},"o":0}]},"o":0},{"t":2,"s":1},{"t":11,"i":4,"p":{"k":[],"v":[]},"o":0}]},"o":0}'))
   await page.route('**/api/translate-stream', lambda r:r.fulfill(status=200,content_type='text/plain',body=json.dumps(FULL) if '"full"' in (r.request.post_data or '') else TEXT))
   async def voice(r):
    speech.append(r.request.url)
    await r.fulfill(status=200,content_type='application/x-ndjson',body=PACKET)
   await page.route('**/api/eleven-speak',voice)
   await page.goto('http://localhost:8080')
   await page.evaluate("""()=>{localStorage.setItem('lingua.ui-locale','en');localStorage.setItem('lingua.prefs.v1',JSON.stringify({source:'ar',target:'de',style:'natural'}));localStorage.removeItem('lingua.voice.v2');}""")
   await page.reload()
   if await page.get_by_test_id('intro-enter').count():
    await page.get_by_test_id('intro-enter').click();await page.wait_for_timeout(1600)
   await page.get_by_role('textbox').first.fill('مرحبا كيف حالك اليوم؟')
   listen=page.get_by_role('button',name='Listen',exact=True)
   await listen.wait_for(timeout=15000); await page.wait_for_timeout(1800)
   assert len(speech)==1, speech
   await listen.click()
   await page.wait_for_timeout(1100)
   assert await page.locator('.spoken-word[data-state="now"]').inner_text()=='Hallo'
   await page.wait_for_timeout(600)
   assert await page.locator('.spoken-word[data-state="now"]').inner_text()=='schöne'
   await page.screenshot(path=f'/tmp/browser/voice-sync/{width}_playing.png')
   await page.get_by_role('button',name='Stop',exact=True).click()
   assert await page.locator('.spoken-word').count()==0
   await listen.click();await page.wait_for_timeout(180)
   assert await page.locator('.spoken-word[data-state="now"]').inner_text()=='Hallo'
   await page.wait_for_timeout(4500)
   assert await listen.count()==1 and await page.locator('.spoken-word').count()==0
   assert len(speech)==1, 'Replay issued duplicate synthesis'
   assert await page.evaluate('document.documentElement.scrollWidth')<=width
   assert not errors, errors
   print('PASS',width,'audible PCM playback, known timestamps, stop/replay, cache, no overflow/errors')
   await context.close()
  await browser.close()
asyncio.run(main())
