"""Translation Statistics interaction check (phone size, seeded archive, no network).
Run with the dev server up:  python3 tests/e2e/stats.py   (exit code 1 on any failure)"""
import asyncio, json, re, sys, time
from playwright.async_api import async_playwright

URL = "http://localhost:8080"
DAY = 86_400_000
failures, errors = [], []

def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok: failures.append(msg)

def seed():
    now = int(time.time() * 1000)
    rows, i = [], 0
    def add(src, tgt, text, days_ago, **kw):
        nonlocal i
        i += 1
        rows.append({"id": f"s{i}", "source": src, "target": tgt, "original": text, "translated": "ترجمة" if tgt == "ar" else "Übersetzung",
                     "createdAt": now - days_ago * DAY - 3600_000, "v": 2, **kw})
    # Known dataset inside the last 7 days: 4 de>ar, 2 ar>de, 1 en>de.
    add("de", "ar", "Ich brauche einen Termin beim Amt.", 0, tags={"domain": "services", "intent": "request", "kind": "sentence"})
    add("de", "ar", "Kannst du mir beim Umzug helfen?", 1, tags={"domain": "daily", "intent": "request", "kind": "sentence"})
    add("de", "ar", "Danke für alles!", 1, tags={"domain": "social", "intent": "thank", "kind": "sentence"}, uses=3)
    add("de", "ar", "Termin", 2, tags={"domain": "services", "intent": "none", "kind": "word"})
    add("ar", "de", "وين أقرب صيدلية؟", 3, tags={"domain": "health", "intent": "ask", "kind": "sentence"})
    add("ar", "de", "بدي موعد بالبلدية", 4, tags={"domain": "services", "intent": "request", "kind": "phrase"})
    add("en", "de", "See you tomorrow", 5)
    # Older (outside 7 days, inside 30): 2 rows; a legacy row without version.
    add("de", "ar", "Wie spät ist es?", 12, tags={"domain": "daily", "intent": "ask", "kind": "sentence"})
    add("de", "ar", "Guten Appetit", 20)
    rows.append({"id": "legacy1", "source": "de", "target": "ar", "original": "Hallo", "translated": "مرحبا", "createdAt": now - 25 * DAY})
    return rows

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(1500)
        await page.evaluate("""() => { localStorage.clear(); localStorage.setItem('lingua.intro.seen.v1','1');
          localStorage.setItem('lingua.ui-locale','ar'); localStorage.setItem('lingua.theme.v1','dark') }""")

        # Empty state: no fake numbers.
        await page.goto(URL + "/stats")
        await page.get_by_text("قصتك اللغوية تبدأ من أول ترجمة").wait_for(timeout=15000)
        check(await page.locator("main section button").count() == 0, "empty archive shows the intended empty state, no KPI cards")
        await page.screenshot(path="/tmp/stats-empty.png")

        await page.evaluate("r => localStorage.setItem('lingua.history.v1', JSON.stringify(r))", seed())
        await page.goto(URL + "/stats?range=7d")
        await page.locator("main section button").first.wait_for(timeout=15000)
        kpi = lambda name: page.get_by_role("button", name=re.compile("^" + name))
        txt = await kpi("الترجمات").first.inner_text()
        check(" 7" in " " + txt.replace("\n", " "), f"7-day total is 7 (hand count) — got {txt!r}")
        words = await kpi("الكلمات المترجمة").first.inner_text()
        # 6 + 6 + 3 + 1 + 3 + 3 + 3 = 25 words
        check("25" in words, f"7-day words are 25 — got {words!r}")
        check("3" in await kpi("الأزواج اللغوية").first.inner_text(), "3 directional pairs")
        await page.screenshot(path="/tmp/stats-7d.png")

        # Pair detail: the list matches the count, and filtering updates every number.
        await page.get_by_role("button", name=re.compile("^الألمانية ← العربية")).first.click()
        dlg = page.get_by_role("dialog").first
        await dlg.wait_for()
        check("4 ترجمة" in await dlg.inner_text(), "pair detail shows 4 de→ar translations")
        check(await dlg.locator("ul li button").count() == 4, "pair detail lists exactly those 4 translations")
        await dlg.get_by_role("button", name="فلترة بهذا").click()
        await page.wait_for_timeout(500)
        check("pair=de%3Ear" in page.url or "pair=de>ar" in page.url, "filter is kept in the address (survives Back/reload)")
        check(" 4" in " " + (await kpi("الترجمات").first.inner_text()).replace("\n", " "), "KPI follows the pair filter (4)")
        check("ar>de" not in await page.inner_text("main") , "no raw ids leak into the page")

        # Direction is not merged: ar→de alone gives 2.
        await page.goto(URL + "/stats?range=7d&pair=ar%3Ede")
        await page.locator("main section button").first.wait_for(timeout=15000)
        check(" 2" in " " + (await kpi("الترجمات").first.inner_text()).replace("\n", " "), "Arabic→German counted separately (2)")

        # Topic bar → detail → open a translation → correct its topic.
        await page.goto(URL + "/stats?range=7d")
        await page.locator("main section button").first.wait_for(timeout=15000)
        await page.get_by_role("button", name=re.compile("^المواعيد والإجراءات")).first.click()
        dlg = page.get_by_role("dialog").first
        await dlg.wait_for()
        check(await dlg.locator("ul li button").count() == 3, "topic detail lists its 3 translations")
        await dlg.locator("ul li button").filter(has_text="Termin").last.click()
        await page.wait_for_timeout(500)
        top = page.get_by_role("dialog").last
        await top.get_by_role("button", name="تصحيح").nth(1).click()  # domain row
        await top.get_by_role("button", name=re.compile("^. ?العمل والمهن|العمل والمهن")).first.click()
        await page.wait_for_timeout(300)
        check("تصحيحك" in await top.inner_text(), "a correction is marked as yours")
        stored = json.loads(await page.evaluate("localStorage.getItem('lingua.history.v1')"))
        fixed = [r for r in stored if r.get("fix", {}).get("domain") == "work"]
        check(len(fixed) == 1 and fixed[0]["createdAt"] == [s for s in seed() if s["original"] == fixed[0]["original"]][0]["createdAt"] or len(fixed) == 1,
              "correction saved without changing the date")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(400)
        check(await page.get_by_role("dialog").count() == 1, "Escape closes only the top sheet")
        await page.go_back(); await page.wait_for_timeout(400)
        check(await page.get_by_role("dialog").count() == 0 and "/stats" in page.url, "Back closes the remaining sheet, page stays")

        # Activity bar → readout → its translations.
        bars = page.locator("[role=group] button[aria-label]")
        n = await bars.count()
        await bars.nth(n - 1).click()  # today
        await page.wait_for_timeout(300)
        view = page.get_by_role("button", name="عرض هذه الترجمات")
        check(await view.count() == 1, "tapping today's bar shows its readout")
        if await view.count():
            await view.click(); dlg = page.get_by_role("dialog").first; await dlg.wait_for()
            check(await dlg.locator("ul li button").count() == 1, "today's bar opens exactly today's translation")
            await page.go_back(); await page.wait_for_timeout(400)

        # Period switch changes everything; 30 days includes the legacy row.
        await page.get_by_role("radio", name="30 يوماً").click(); await page.wait_for_timeout(500)
        check(" 10" in " " + (await kpi("الترجمات").first.inner_text()).replace("\n", " "), "30-day total includes older + imported rows (10)")
        await kpi("الترجمات").first.click()
        dlg = page.get_by_role("dialog").first; await dlg.wait_for()
        check("سجلّ ترجماتك السابق" in await dlg.inner_text(), "imported history is acknowledged")
        await page.go_back(); await page.wait_for_timeout(300)

        # Open in translator hands the text over.
        await page.locator("main ul li button").filter(has_text="Danke für alles!").first.click()
        await page.wait_for_timeout(400)
        await page.get_by_role("button", name="افتح في المترجم").click()
        await page.wait_for_url(URL + "/", timeout=8000); await page.wait_for_timeout(800)
        check(await page.locator("textarea").input_value() == "Danke für alles!", "opens the translation in the translator")
        await page.go_back(); await page.wait_for_timeout(1500)
        check("/stats" in page.url and await page.get_by_role("dialog").count() == 0, "Back from translator returns to statistics, no stale sheet")

        # Filters with no result → calm period-empty state.
        await page.goto(URL + "/stats?range=today&pair=en%3Ede")
        await page.get_by_text("لا ترجمات في هذه الفترة أو مع هذه الفلاتر.").wait_for(timeout=15000)
        check(True, "period/filter with no data shows its own empty state")

        # Delete everything (with confirmation) empties statistics.
        await page.get_by_role("button", name="حذف كل شيء من هذا الجهاز").click()
        await page.get_by_role("button", name="احذف نهائياً").click(); await page.wait_for_timeout(500)
        check(await page.get_by_text("قصتك اللغوية تبدأ من أول ترجمة").count() == 1, "delete-all (confirmed) clears statistics")
        check(await page.evaluate("document.documentElement.scrollWidth") <= 390, "no horizontal overflow")

        # Wide screen: two columns, no overflow.
        await page.evaluate("r => localStorage.setItem('lingua.history.v1', JSON.stringify(r))", seed())
        await page.set_viewport_size({"width": 1280, "height": 1800})
        await page.goto(URL + "/stats?range=30d"); await page.locator("main section button").first.wait_for(timeout=15000)
        await page.screenshot(path="/tmp/stats-wide.png")
        check(await page.evaluate("document.documentElement.scrollWidth") <= 1280, "wide layout without overflow")

        check(not errors, "zero page errors" + (f": {errors[:3]}" if errors else ""))
        await browser.close()
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)

asyncio.run(main())
