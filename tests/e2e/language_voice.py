"""Wrong-source hint (Arabic typed with English picked) and listen read-along, incl. an engine that never reports start/words."""
import asyncio, json
from playwright.async_api import async_playwright
MOCK = """(mode) => {
 const voices=[{lang:'ar_SA',name:'ar',localService:true},{lang:'de_DE',name:'de',localService:true}];
 const s={speaking:false,pending:false,paused:false,getVoices:()=>voices,addEventListener(){},removeEventListener(){},cancel(){this.speaking=false},resume(){},
  speak(u){this.speaking=true; window.__spoken=(window.__spoken||[]).concat([u.text+'|'+u.lang]);
   if(mode==='silent-start'){ /* engine never fires onstart nor boundaries */ setTimeout(()=>{this.speaking=false;u.onend&&u.onend()},6000); return;}
   u.onstart&&u.onstart();const words=[...u.text.matchAll(/\\S+/g)];let i=0;
   const step=()=>{ if(!this.speaking)return; if(i<words.length){u.onboundary({name:'word',charIndex:words[i].index});i++;setTimeout(step,450)} else {this.speaking=false;u.onend()}};step();}};
 Object.defineProperty(window,'speechSynthesis',{value:s,configurable:true});
 window.SpeechSynthesisUtterance=function(t){this.text=t};
}"""
FAILS = []
def check(ok, label):
    print(("PASS " if ok else "FAIL ") + label)
    if not ok: FAILS.append(label)

async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(headless=True); c=await b.new_context(viewport={"width":424,"height":758})
    pg=await c.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    await pg.goto("http://localhost:8080")
    await pg.evaluate("""()=>{localStorage.setItem('lingua.ui-locale','ar');localStorage.setItem('lingua.prefs.v1',JSON.stringify({source:'en',target:'de',style:'natural'}))}""")
    await pg.goto("http://localhost:8080"); await pg.wait_for_timeout(2500)
    if await pg.get_by_test_id("intro-enter").count():
      await pg.get_by_test_id("intro-enter").click(); await pg.wait_for_timeout(1800)
    await pg.locator("textarea").first.fill("وينك")
    await pg.wait_for_timeout(5000)
    n=pg.get_by_test_id("language-notice")
    txt = await n.inner_text() if await n.count() else ""
    check("بالعربية" in txt and "بالإنجليزية" in txt, "gentle wrong-language hint appears")
    await pg.screenshot(path="/tmp/e2e-notice.png")
    await n.get_by_role("button").first.click(); await pg.wait_for_timeout(800)
    check(await n.count() == 0 and '"source":"ar"' in (await pg.evaluate("()=>localStorage.getItem('lingua.prefs.v1')") or ""), "one tap switches the source to Arabic")
    # voice: precise word events
    await pg.evaluate(MOCK, "normal")
    await pg.get_by_role("button",name="استماع").click(); await pg.wait_for_timeout(1000)
    states = await pg.evaluate("()=>[...document.querySelectorAll('.spoken-word')].map(e=>e.dataset.state)")
    check("now" in states and "said" in states, "read-along follows the voice word by word")
    check(bool(await pg.evaluate("()=>window.__spoken")), "the voice is asked to speak the translation")
    await pg.wait_for_timeout(3000)
    # voice: engine that never reports start/words -> watchdog + estimate
    await pg.evaluate(MOCK, "silent-start")
    await pg.get_by_role("button",name="استماع").click()
    await pg.wait_for_timeout(3200)
    states = await pg.evaluate("()=>[...document.querySelectorAll('.spoken-word')].map(e=>e.dataset.state)")
    check("now" in states, "read-along still moves on an engine without word events")
    await pg.screenshot(path="/tmp/e2e-silent.png")
    check(not errs, "zero page errors")
    print(f"\n{len(FAILS)} failure(s)")
    await b.close()
asyncio.run(main())

import sys
sys.exit(1 if FAILS else 0)
