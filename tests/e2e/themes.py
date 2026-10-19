"""Check the real theme button: clay dark and light only, cycling, persistence, removed themes."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

URL = "http://localhost:8080"
SHOTS = Path("/tmp/browser/themes")

EXPECTED = {
    "dark": {"--background": [18, 16, 15], "--surface": [24, 22, 20], "--card": [30, 27, 24]},
    "light": {"--background": [247, 243, 236], "--surface": [240, 235, 226], "--card": [255, 253, 249]},
}

PALETTE_JS = """() => {
  const style = getComputedStyle(document.documentElement);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const rgb = key => {
    ctx.fillStyle = style.getPropertyValue(key).trim();
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  return Object.fromEntries(['--signal','--signal-text','--signal-foreground',
    '--background','--surface','--card','--foreground','--muted-foreground']
    .map(key => [key, rgb(key)]));
}"""


def luminance(rgb):
    values = [v / 255 for v in rgb]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]
    return sum(a * b for a, b in zip(linear, [.2126, .7152, .0722]))


def contrast(a, b):
    x, y = sorted([luminance(a), luminance(b)])
    return (y + .05) / (x + .05)


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
            assert await page.locator("html").get_attribute("data-theme") == "light"
            backgrounds = []
            for theme in ["light", "dark", "light"]:
                if len(backgrounds):
                    await button.click()
                await page.wait_for_function("t => document.documentElement.dataset.theme === t", arg=theme)
                await page.wait_for_timeout(850)
                assert await button.get_attribute("data-theme-choice") == theme
                assert await page.evaluate("getComputedStyle(document.documentElement).colorScheme") == ("light" if theme == "light" else "dark")
                palette = await page.evaluate(PALETTE_JS)
                for key, rgb in EXPECTED[theme].items():
                    assert palette[key] == rgb, (theme, key, palette[key], rgb)
                # The attention hue stays warm clay, distinct from the surfaces it sits on.
                assert palette["--signal"][0] > palette["--signal"][2], (theme, palette["--signal"])
                assert contrast(palette["--signal"], palette["--signal-foreground"]) >= 4.3, (theme, palette)
                for surface in ["--background", "--surface", "--card"]:
                    for text in ["--signal-text", "--foreground", "--muted-foreground"]:
                        assert contrast(palette[text], palette[surface]) >= 4.5, (theme, text, surface, contrast(palette[text], palette[surface]))
                assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                backgrounds.append(await page.evaluate("getComputedStyle(document.body).backgroundColor"))
                await page.screenshot(path=str(SHOTS / f"{width}-{theme}.png"))
            assert len(set(backgrounds)) == 2 and backgrounds[0] == backgrounds[2], backgrounds
            # One click returns light -> dark, and the choice survives a reload and navigation.
            await button.click()
            await page.wait_for_timeout(850)
            await page.reload()
            await button.wait_for()
            assert await page.locator("html").get_attribute("data-theme") == "dark"
            await page.goto(URL + "/stats")
            assert await page.locator("html").get_attribute("data-theme") == "dark"
            await page.goto(URL)
            await button.wait_for()
            # Rapid clicks are counted sequentially: dark -> light -> dark -> light.
            await button.evaluate("b => { b.click(); b.click(); b.click(); }")
            await page.wait_for_timeout(1200)
            assert await page.locator("html").get_attribute("data-theme") == "light"
            assert await page.evaluate("localStorage.getItem('lingua.theme.v1')") == "light"
            # Removed themes fall back to clay dark instead of showing an empty palette.
            for removed in ["navy", "burgundy"]:
                await page.evaluate("t => localStorage.setItem('lingua.theme.v1', t)", removed)
                await page.reload()
                await button.wait_for()
                assert await page.locator("html").get_attribute("data-theme") == "dark", removed
                assert await button.get_attribute("data-theme-choice") == "dark", removed
            assert not errors, errors
            print(f"PASS {width}px: clay dark + light only, cycling, contrast, persistence, navigation, rapid clicks, removed themes fall back; no page errors")
            await context.close()
        await browser.close()

asyncio.run(main())
