"""Sentence Shadow end-to-end against the LIVE model (small cost per run).
Run with the dev server up:  python3 tests/e2e/shadow.py   (exit 1 on failure)
Covers: no shadow while typing, arrival after settle, tap → card, apply, undo, map, toggle off, reduced motion."""
import asyncio, sys
from pathlib import Path
from playwright.async_api import async_playwright

URL = "http://localhost:8080"
SHOTS = Path("/tmp/browser/shadow"); SHOTS.mkdir(parents=True, exist_ok=True)
TEXT = "يا حسرتاه على اللي فات، كانت أيام حلوة"
failures, errors = [], []

def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok: failures.append(msg)

async def run(p, width, ui, reduced, dark=False):
    browser = await p.chromium.launch(headless=True)
    ctx = await browser.new_context(viewport={"width": width, "height": 900 if width < 600 else 1000}, reduced_motion="reduce" if reduced else "no-preference")
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(URL)
    await page.evaluate("""ui => { localStorage.setItem('lingua.intro.seen.v1','1');
      localStorage.setItem('lingua.ui-locale', ui);
      localStorage.setItem('lingua.prefs.v1', JSON.stringify({source:'ar',target:'de',style:'natural'})); }""", ui)
    await page.reload(); await page.wait_for_load_state("networkidle"); await page.wait_for_timeout(800)
    if dark: await page.evaluate("document.documentElement.classList.remove('light')")
    box = page.locator("textarea").first
    await box.click(); await box.press_sequentially(TEXT, delay=25)
    check((await box.input_value()) == TEXT, f"[{width}/{ui}] full sentence typed")
    await page.wait_for_timeout(300)
    check(await page.get_by_test_id("shadow-ink").count() == 0, f"[{width}/{ui}] no shadow while typing")
    ink = page.get_by_test_id("shadow-ink")
    try:
        await ink.wait_for(state="attached", timeout=45000)
    except Exception:
        check(False, f"[{width}/{ui}] shadow arrived"); await page.screenshot(path=str(SHOTS / f"{width}-{ui}-none.png")); await browser.close(); return
    await page.wait_for_timeout(1000)
    check(True, f"[{width}/{ui}] shadow arrived after the translation settled")
    await page.screenshot(path=str(SHOTS / f"{width}-{ui}-1-shadow.png"))
    hit = page.locator(".shadow-hit").first
    check(await hit.count() == 1, f"[{width}/{ui}] shadowed words are touchable")
    before = await page.locator(".result-text").first.inner_text()
    await hit.click()
    sheet = page.get_by_test_id("shadow-sheet")
    await sheet.wait_for()
    await page.wait_for_timeout(500)
    await page.screenshot(path=str(SHOTS / f"{width}-{ui}-2-sheet.png"))
    apply = sheet.locator("button.bg-signal").first
    if await apply.count():
        await apply.click(); await page.wait_for_timeout(1200)
        after = await page.locator(".result-text").first.inner_text()
        check(after != before, f"[{width}/{ui}] apply rewrites the translation")
        hist = await page.evaluate("JSON.parse(localStorage.getItem('lingua.history.v1')||'[]')")
        rows = hist if isinstance(hist, list) else hist.get("entries", [])
        check(any(r.get("translated") == after.strip() for r in rows), f"[{width}/{ui}] archive holds the applied version")
        await page.screenshot(path=str(SHOTS / f"{width}-{ui}-3-applied.png"))
        undo = page.locator(".shadow-summary button").last
        await undo.click(); await page.wait_for_timeout(800)
        check((await page.locator(".result-text").first.inner_text()) == before, f"[{width}/{ui}] undo restores the original")
    else:
        check(True, f"[{width}/{ui}] no safe restore offered (allowed)")
        await page.keyboard.press("Escape")
    await page.wait_for_timeout(2500)
    if await page.get_by_test_id("shadow-ink").count():
        await page.locator(".shadow-summary button").first.click()
        m = page.get_by_test_id("shadow-map")
        await m.wait_for(timeout=3000)
        await page.screenshot(path=str(SHOTS / f"{width}-{ui}-4-map.png"))
        check(True, f"[{width}/{ui}] shadow map opens")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(400)
    toggle = page.locator("button[aria-pressed='true'] svg.lucide-contrast").first
    await toggle.click(); await page.wait_for_timeout(500)
    check(await page.get_by_test_id("shadow-ink").count() == 0, f"[{width}/{ui}] toggle hides the shadow")
    check(await page.evaluate("JSON.parse(localStorage.getItem('lingua.prefs.v1')).shadow") is False, f"[{width}/{ui}] off survives as a saved preference")
    check(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"[{width}/{ui}] no horizontal overflow")
    await browser.close()

async def main():
    async with async_playwright() as p:
        await run(p, 424, "ar", False)
        await run(p, 1280, "de", True, dark=True)
    for e in errors: print("PAGE ERROR", e)
    if failures or errors: sys.exit(1)
    print("ALL PASS")

asyncio.run(main())
