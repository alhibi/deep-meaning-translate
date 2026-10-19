import asyncio, json
from playwright.async_api import async_playwright
async def run(p, text, src, tgt):
    b = await p.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])
    ctx = await b.new_context(viewport={"width": 390, "height": 844})
    page = await ctx.new_page()
    reqs=[]
    page.on("response", lambda r: reqs.append((r.status, r.headers.get("content-type"))) if "/api/speak" in r.url else None)
    await page.goto("http://localhost:8080")
    await page.evaluate("""([s,t])=>{localStorage.setItem('lingua.intro.v1','done');localStorage.setItem('lingua.intro.seen','1');localStorage.setItem('lingua.prefs.v1',JSON.stringify({source:s,target:t,style:'natural'}))}""",[src,tgt])
    await page.goto("http://localhost:8080")
    await page.wait_for_timeout(1500)
    for btn in ["ابدأ","Start","Los"]:
        loc = page.get_by_role("button", name=btn)
        if await loc.count(): await loc.first.click(); await page.wait_for_timeout(1500)
    await page.get_by_role("textbox").first.fill(text)
    listen = page.get_by_role("button", name="استماع").or_(page.get_by_role("button", name="Listen")).or_(page.get_by_role("button", name="Anhören"))
    await listen.first.wait_for(state="visible", timeout=30000)
    await page.wait_for_timeout(2500)
    await listen.first.click()
    await page.wait_for_timeout(400)
    await page.screenshot(path=f"/tmp/browser/voice/{tgt}_loading.png")
    states=[]
    for i in range(16):
        await page.wait_for_timeout(500)
        n = await page.locator('.spoken-word[data-state="said"]').count()
        now = await page.locator('.spoken-word[data-state="now"]').count()
        states.append((n, now))
        if i==6: await page.screenshot(path=f"/tmp/browser/voice/{tgt}_playing.png")
    print(tgt, "speak responses:", reqs, "said/now:", states)
    await b.close()
async def main():
    async with async_playwright() as p:
        await run(p, "صباح الخير، هل تريد أن نلتقي غداً في المقهى؟", "ar", "de")
        await run(p, "Guten Morgen, wie geht es dir heute?", "de", "ar")
asyncio.run(main())
