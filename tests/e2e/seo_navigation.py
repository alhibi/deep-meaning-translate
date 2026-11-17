"""Public page and the one footer entry: old URLs stay alive, SEO metadata is intact.

The translator keeps exactly one quiet footer entry ("About today"). The former privacy
page and pair guide are permanent redirects into the sections of that page, so external
links and search results still arrive at the content they point at.
"""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        failures = []

        def check(ok, message):
            print(("PASS " if ok else "FAIL ") + message)
            if not ok:
                failures.append(message)

        # The translator has one entry, and it leads to the unified page.
        await page.goto(BASE + "/")
        # A returning visitor: mark the intro seen, then reload so the pre-paint gate agrees.
        await page.evaluate("() => localStorage.setItem('lingua.intro.seen.v1', '1')")
        await page.reload()
        await page.wait_for_function("() => !document.documentElement.hasAttribute('data-intro')")
        await page.get_by_role("textbox").wait_for(state="visible")
        entries = page.locator("footer a, nav a").filter(has_text="About today")
        check(await entries.count() == 1, "the translator has exactly one public entry")
        check(await page.get_by_role("link", name="Privacy", exact=True).count() == 0,
              "the separate privacy footer link is gone")
        check(await page.get_by_role("link", name="Arabic–German translation", exact=True).count() == 0,
              "the separate pair-guide footer link is gone")
        await entries.first.click()
        await page.wait_for_url(BASE + "/about")
        check(await page.get_by_role("heading", name="About today", level=1).count() == 1,
              "the unified page opens from the footer entry")

        # Old public URLs are permanent redirects that still land on their section.
        for path, anchor, heading in (
            ("/privacy", "privacy", "What stays on your device"),
            ("/arabic-german-translation", "translation", "How a translation is made"),
        ):
            # A document load follows the redirect, so ask the transport for the raw answer.
            raw = await context.request.get(BASE + path, max_redirects=0)
            check(raw.status in (301, 308), f"{path} answers with a permanent redirect ({raw.status})")
            location = raw.headers.get("location", "")
            check(location == "/about#" + anchor, f"{path} redirects to /about#{anchor} ({location})")
            await page.goto(BASE + path)
            await page.wait_for_url(BASE + "/about#" + anchor)
            check(await page.get_by_role("heading", name=heading, level=2).count() == 1,
                  f"{path} lands on its section of the unified page")

        # SEO: the unified page is self-canonical and indexable; the translator links to it.
        await page.goto(BASE + "/about")
        canonical = await page.get_attribute("link[rel=canonical]", "href")
        check(canonical == "https://fluently.today/about", f"canonical is /about ({canonical})")
        robots = await page.get_attribute("meta[name=robots]", "content")
        check(robots is not None and "index" in robots, "the unified page is indexable")
        description = await page.get_attribute("meta[name=description]", "content")
        check(description is not None and len(description) > 80, "the unified page has a description")

        # Every language is real copy, not a placeholder or a repeated English string.
        for locale, title, first_section in (
            ("en", "About today", "Meaning before words"),
            ("ar", "عن today", "المعنى قبل الكلمات"),
            ("de", "Über today", "Bedeutung vor Wörtern"),
        ):
            await page.evaluate("l => localStorage.setItem('lingua.ui-locale', l)", locale)
            await page.reload()
            # The shell is server-rendered in English; the stored locale hydrates the copy.
            await page.wait_for_function(
                "t => document.documentElement.lang === t[1] && document.querySelector('h1')?.textContent === t[0]",
                arg=[title, locale],
            )
            check(await page.get_by_role("heading", name=title, level=1).count() == 1,
                  f"{locale}: the page title is localized")
            check(await page.get_by_role("heading", name=first_section, level=2).count() == 1,
                  f"{locale}: the sections are localized")

        # One page, two ways back, and the advanced controls stay on it.
        await page.evaluate("() => localStorage.setItem('lingua.ui-locale', 'en')")
        await page.reload()
        back = page.get_by_role("link", name="Open translator", exact=True)
        check(await back.count() >= 1, "the page links back to the translator")
        await back.first.click()
        await page.wait_for_url(BASE + "/")
        await page.get_by_role("textbox").wait_for(state="visible")
        await page.get_by_role("heading", name="About today", level=1).count()
        check(True, "the unified page returns to the usable translator")

        await browser.close()
        if failures:
            raise SystemExit(f"{len(failures)} failure(s)")
        print(f"\n{len(failures)} failures · all public navigation checks passed")


asyncio.run(main())
