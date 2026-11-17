"""Sentence Shadow end-to-end against the LIVE model (small cost per run).
Run with the dev server up:  python3 tests/e2e/shadow.py   (exit 1 on failure)
Covers: no shadow while typing, arrival after settle, the two-text map with linked spans,
severity and confidence shown separately, diff preview before apply, apply + undo, map
layout (side-by-side wide / stacked phone), toggle off, reduced motion."""
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
        await ink.wait_for(state="attached", timeout=60000)
    except Exception:
        check(False, f"[{width}/{ui}] shadow arrived"); await page.screenshot(path=str(SHOTS / f"{width}-{ui}-none.png")); await browser.close(); return
    await page.wait_for_timeout(1000)
    check(True, f"[{width}/{ui}] shadow arrived after the translation settled")
    await page.screenshot(path=str(SHOTS / f"{width}-{ui}-1-shadow.png"))
    hit = page.locator(".shadow-hit").first
    check(await hit.count() == 1, f"[{width}/{ui}] shadowed words are touchable")
    translated = (await page.locator(".result-text").first.inner_text()).strip()

    # ── the two-text map: full texts, linked ids, counterpart highlight ──────────
    await page.locator(".shadow-summary button").first.click()
    shadow_map = page.get_by_test_id("shadow-map")
    await shadow_map.wait_for(timeout=3000)
    await page.wait_for_timeout(400)
    await page.screenshot(path=str(SHOTS / f"{width}-{ui}-2-map.png"))
    source_marks = shadow_map.locator('[data-side="source"]')
    target_marks = shadow_map.locator('[data-side="target"]')
    n_marks = await source_marks.count()
    check(n_marks >= 1, f"[{width}/{ui}] map marks the original")
    check(await target_marks.count() == n_marks, f"[{width}/{ui}] every mark has a translation counterpart")
    source_section = shadow_map.locator("section").first
    target_section = shadow_map.locator("section").nth(1)
    def plain(value):
        # The numbered superscripts are part of the marked span's rendered text; drop them
        # and normalise spacing so the comparison is about the words, not the chips.
        return " ".join("".join(ch for ch in value if not ch.isdigit()).split())
    source_text = plain(await source_section.inner_text())
    target_text = plain(await target_section.inner_text())
    check(plain(TEXT.split("،")[0].strip()) in source_text, f"[{width}/{ui}] the original is shown in full")
    check(plain(translated) in target_text, f"[{width}/{ui}] the translation is shown in full")
    await source_marks.first.click()
    await page.wait_for_timeout(250)
    check(await target_marks.first.get_attribute("data-active") == "true", f"[{width}/{ui}] clicking a span highlights its counterpart")
    await source_marks.first.click()
    await page.wait_for_timeout(150)
    check(await target_marks.first.get_attribute("data-active") is None, f"[{width}/{ui}] clicking again clears the highlight")
    await target_marks.first.click()
    await page.wait_for_timeout(250)
    check(await source_marks.first.get_attribute("data-active") == "true", f"[{width}/{ui}] the link works in both directions")

    # Layout: the relationship is primary — side by side wide, stacked on a phone.
    source_box = await source_section.bounding_box()
    target_box = await target_section.bounding_box()
    if source_box and target_box:
        if width >= 1280:
            check(abs(source_box["y"] - target_box["y"]) < 8 and target_box["x"] > source_box["x"], f"[{width}/{ui}] original and translation sit side by side")
        else:
            check(target_box["y"] >= source_box["y"] + source_box["height"] - 2, f"[{width}/{ui}] stacked layout keeps reading order")

    # ── detail: kind, separate measures, diff preview, apply, undo ──────────────
    await shadow_map.locator("ul button").first.click()
    sheet = page.get_by_test_id("shadow-sheet")
    await sheet.wait_for(timeout=3000)
    await page.wait_for_timeout(500)
    await page.screenshot(path=str(SHOTS / f"{width}-{ui}-3-detail.png"))
    check(await sheet.get_by_test_id("shadow-measures").count() == 1, f"[{width}/{ui}] severity and confidence shown as separate measures")
    check(await sheet.locator("h3").count() >= 2, f"[{width}/{ui}] both original and translation are shown in the detail")
    before = await page.locator(".result-text").first.inner_text()
    apply = sheet.locator("button.bg-signal").first
    if await apply.count():
        # The diff preview exists before anything visible changes: a removed word is struck
        # through and the alternative's words are marked with the signal tint.
        preview = await sheet.locator("del").count() + await sheet.locator(".shadow-change").count()
        check(preview >= 1, f"[{width}/{ui}] apply previews the diff before changing the translation")
        check((await page.locator(".result-text").first.inner_text()) == before, f"[{width}/{ui}] translation is unchanged before apply")
        await apply.click(); await page.wait_for_timeout(1200)
        after = await page.locator(".result-text").first.inner_text()
        check(after != before, f"[{width}/{ui}] apply rewrites the translation")
        hist = await page.evaluate("JSON.parse(localStorage.getItem('lingua.history.v1')||'[]')")
        rows = hist if isinstance(hist, list) else hist.get("entries", [])
        check(any(r.get("translated") == after.strip() for r in rows), f"[{width}/{ui}] archive holds the applied version")
        await page.screenshot(path=str(SHOTS / f"{width}-{ui}-4-applied.png"))
        undo = page.locator(".shadow-summary button").last
        await undo.click(); await page.wait_for_timeout(800)
        check((await page.locator(".result-text").first.inner_text()) == before, f"[{width}/{ui}] undo restores the original")
    else:
        check(True, f"[{width}/{ui}] no safe restore offered (allowed)")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(400)

    # Close whatever is still open, then the preference toggle.
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
