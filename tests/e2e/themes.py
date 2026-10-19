"""Check the real theme button, sequential cycling and restored dark choices."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

URL = "http://localhost:8080"
SHOTS = Path("/tmp/browser/themes")

async def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        for width, height in [(424, 758), (1280, 1800)]:
            context = await browser.new_context(viewport={"width": width, "height": height}, color_scheme="light", service_workers="block")
            page = await context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(URL)
            await page.evaluate("""() => {
              localStorage.setItem('lingua.intro.seen.v1', '1');
              localStorage.setItem('lingua.ui-locale', 'ar');
              localStorage.setItem('lingua.theme.v1', 'light');
            }""")
            await page.reload()
            button = page.get_by_role("button", name="الثيم اللوني التالي", exact=True)
            await button.wait_for()
            assert await page.locator("html").get_attribute("data-theme") == "dark"
            backgrounds = []
            for theme in ["dark", "forest", "rose", "dark"]:
                if len(backgrounds):
                    await button.click()
                await page.wait_for_function("t => document.documentElement.dataset.theme === t", arg=theme)
                await page.wait_for_timeout(850)
                assert await button.get_attribute("data-theme-choice") == theme
                assert await page.evaluate("getComputedStyle(document.documentElement).colorScheme") == "dark"
                assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                backgrounds.append(await page.evaluate("getComputedStyle(document.body).backgroundColor"))
                await page.screenshot(path=str(SHOTS / f"{width}-{theme}.png"))
            assert len(set(backgrounds[:3])) == 3
            await button.click()
            await page.wait_for_timeout(850)
            await page.reload()
            await button.wait_for()
            assert await page.locator("html").get_attribute("data-theme") == "forest"
            await page.goto(URL + "/stats")
            assert await page.locator("html").get_attribute("data-theme") == "forest"
            await page.goto(URL)
            await button.wait_for()
            await button.evaluate("b => { b.click(); b.click(); b.click(); b.click(); b.click(); }")
            await page.wait_for_timeout(1200)
            assert await page.locator("html").get_attribute("data-theme") == "dark"
            assert await page.evaluate("localStorage.getItem('lingua.theme.v1')") == "dark"
            assert not errors, errors
            print(f"PASS {width}px: three dark colours, cycling, persistence, legacy migration, navigation, rapid clicks; no page errors")
            await context.close()
        await browser.close()

asyncio.run(main())