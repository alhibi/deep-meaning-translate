"""Public translation guide must lead back to the working translator."""
import asyncio
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 1800})
        await page.goto("http://localhost:8080/arabic-german-translation")
        await page.get_by_role("link", name="Open translator", exact=True).first.click()
        await page.wait_for_url("http://localhost:8080/")
        await page.get_by_role("textbox").wait_for(state="visible")
        await page.get_by_role("link", name="Arabic–German translation", exact=True).wait_for()
        print("PASS public guide returns to the usable translator")
        await browser.close()


asyncio.run(main())