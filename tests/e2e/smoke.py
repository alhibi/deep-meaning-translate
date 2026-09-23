"""Phone-sized smoke check. Translation replies are faked, so it costs nothing and is repeatable.
Run with the dev server up:  python3 tests/e2e/smoke.py   (exit code 1 on any failure)"""
import asyncio, json, sys
from playwright.async_api import async_playwright

URL = "http://localhost:8080"
FAKE = '{"t":10,"i":0,"p":{"k":["result","error","context"],"v":[{"t":10,"i":1,"p":{"k":["ok","result"],"v":[{"t":2,"s":2},{"t":10,"i":2,"p":{"k":["sourceLanguage","targetLanguage","translation","tone","formality","confidence","isAmbiguous","alternativeTranslations","notes","situation"],"v":[{"t":1,"s":"de"},{"t":1,"s":"ar"},{"t":1,"s":"صباح الخير"},{"t":1,"s":"neutral"},{"t":1,"s":"neutral"},{"t":0,"s":1},{"t":2,"s":3},{"t":9,"i":3,"a":[],"o":0},{"t":1,"s":""},{"t":1,"s":"general"}]},"o":0}]},"o":0},{"t":2,"s":1},{"t":11,"i":4,"p":{"k":[],"v":[]},"o":0}]},"o":0}'
failures, errors = [], []

def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok: failures.append(msg)

async def overlaps_text(page, dialog):
    """True if any close (X) button's box intersects a text element in the same dialog."""
    return await dialog.evaluate("""d => {
      const btns=[...d.querySelectorAll('button')].filter(b=>b.querySelector('svg')&&!b.innerText.trim());
      const texts=[...d.querySelectorAll('p,span,h2,h3,input')].filter(e=>e.innerText?.trim()&&!e.closest('button'));
      const hit=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;
      return btns.some(b=>texts.some(t=>hit(b.getBoundingClientRect(),t.getBoundingClientRect())));
    }""")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await (await browser.new_context(viewport={"width": 390, "height": 844})).new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.route("**/_serverFn/**", lambda r: r.fulfill(status=200, content_type="application/json", body=FAKE))
        await page.goto(URL); await page.wait_for_timeout(1500)
        box = page.locator("textarea").first
        dir_before = await box.evaluate("e => getComputedStyle(e).direction")

        # 1. Text without punctuation still settles and shows the action buttons.
        await box.fill("Guten Morgen")
        await page.wait_for_timeout(3500)
        check(await page.get_by_text("صباح الخير").count() > 0, "translation appears")
        copy = page.get_by_role("button", name="نسخ").or_(page.get_by_role("button", name="Copy")).or_(page.get_by_role("button", name="Kopieren")).first
        check(await copy.count() > 0 and await copy.evaluate("e => getComputedStyle(e.parentElement).opacity") == "1", "Copy visible without final punctuation")

        # 2. Swapping languages keeps text and writing-box direction.
        swap = page.locator("button.animate-exchange, button[aria-label*='swap' i], button[aria-label*='تبديل'], button[aria-label*='tausch' i]").first
        if await swap.count():
            await swap.click(); await page.wait_for_timeout(600)
            check(await box.input_value() != "", "text kept after swap")
            check(await box.evaluate("e => getComputedStyle(e).direction") == dir_before, "box direction unchanged by swap")

        # 3. Sheets open, stay open, close, and X never covers text.
        for name in ["العبارات", "Saved", "Gespeichert", "الأخيرة", "Recent", "Verlauf"]:
            b = page.get_by_role("button", name=name, exact=False).first
            if not await b.count() or not await b.is_visible(): continue
            await b.click(); await page.wait_for_timeout(700)
            dlg = page.get_by_role("dialog").first
            opened = await dlg.count() > 0
            check(opened, f"sheet '{name}' opens and stays open")
            if opened:
                check(not await overlaps_text(page, dlg), f"sheet '{name}': X does not cover text")
            await page.keyboard.press("Escape"); await page.wait_for_timeout(600)

        check(not errors, "zero page errors" + (f": {errors[:3]}" if errors else ""))
        await page.screenshot(path="/tmp/smoke.png")
        await browser.close()
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)

asyncio.run(main())
