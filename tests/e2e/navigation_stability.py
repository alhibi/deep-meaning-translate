"""Navigation and theme continuity regression.

Run with the app up (dev or production preview):

    python3 tests/e2e/navigation_stability.py

Checks, at a phone viewport:
  * internal navigation keeps one document;
  * the document/body background never changes during a transition;
  * returning to "/" paints the remembered draft and translation, with no translation POST;
  * the restored pair is the session's pair, not a later preference pair;
  * repeated and rapid cycles do not raise an error boundary or lose the draft;
  * the browser-chrome theme-color follows the active palette on /stats.

Uses ?sw=off so a preview service worker can never serve a stale shell during the run.
Exit code 1 on any failure.
"""
import asyncio
import json
import sys

from playwright.async_api import async_playwright

URL = "http://localhost:8080"
SESSION_TEXT = "Guten Morgen, wie geht es dir?"
SESSION_RESULT = "صباح الخير، كيف حالك؟"
failures = []
errors = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        failures.append(msg)


SEED = """
([text, translation]) => {
  localStorage.setItem("lingua.intro.seen.v1", "1");
  localStorage.setItem("lingua.install.dismissed", "1");
  localStorage.setItem("lingua.theme.v1", "dark");
  // Preferences deliberately disagree with the session: the session must win.
  localStorage.setItem("lingua.prefs.v1", JSON.stringify({ source: "auto", target: "en", style: "formal" }));
  localStorage.setItem("lingua.session.v1", JSON.stringify({
    text,
    source: "de",
    target: "ar",
    style: "natural",
    result: {
      sourceLanguage: "de",
      targetLanguage: "ar",
      translation,
      tone: "warm",
      formality: "neutral",
      confidence: 0.95,
      isAmbiguous: false,
      alternativeTranslations: [],
      notes: ""
    }
  }));
}
"""


async def backgrounds(page):
    return await page.evaluate(
        """() => ({
          doc: getComputedStyle(document.documentElement).backgroundColor,
          body: getComputedStyle(document.body).backgroundColor
        })"""
    )


async def open_app(page):
    await page.goto(URL + "/?sw=off", wait_until="networkidle")
    await page.evaluate(SEED, [SESSION_TEXT, SESSION_RESULT])
    await page.reload(wait_until="networkidle")
    await page.wait_for_selector("#composer")
    await page.wait_for_timeout(250)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        posts = []
        page.on(
            "request",
            lambda r: posts.append(r.url)
            if r.method == "POST" and "translate-stream" in r.url
            else None,
        )

        await open_app(page)

        check(
            await page.locator("#composer").input_value() == SESSION_TEXT,
            "draft restored on a cold load",
        )
        check(
            SESSION_RESULT in (await page.locator("body").inner_text()),
            "translation restored on a cold load",
        )
        check(await page.evaluate("performance.getEntriesByType('navigation').length") == 1, "one navigation entry at start")

        # -- normal cycle -----------------------------------------------------
        await page.locator('a[href="/stats"]').click()
        await page.wait_for_url("**/stats")
        await page.wait_for_timeout(350)
        check("/stats" in page.url, "statistics route opens")

        posts.clear()
        samples = []

        async def sample():
            samples.append(await backgrounds(page))

        await page.evaluate(
            """() => {
              window.__navFrames = [];
              let n = 0;
              const tick = () => {
                window.__navFrames.push([
                  getComputedStyle(document.documentElement).backgroundColor,
                  getComputedStyle(document.body).backgroundColor
                ].join("|"));
                if (++n < 30) requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }"""
        )
        await page.locator('a[href="/"]').click()
        await page.wait_for_selector("#composer")
        await page.wait_for_timeout(400)
        frames = await page.evaluate("window.__navFrames")
        unique = sorted(set(frames))
        check(len(unique) == 1, "background is constant across the transition (one candidate)")
        check(all(part == unique[0].split("|")[0] for part in unique[0].split("|")), "html and body share the same background")
        check(await page.locator("#composer").input_value() == SESSION_TEXT, "draft restored on return")
        check(SESSION_RESULT in (await page.locator("body").inner_text()), "translation restored on return")
        check(len([u for u in posts if "translate-stream" in u]) == 0, "no translation POST on return")
        check(await page.evaluate("performance.getEntriesByType('navigation').length") == 1, "still one document after return")
        check(await page.locator('[data-testid="error-boundary"]').count() == 0, "no error boundary on return")

        # -- repeated and rapid cycles ----------------------------------------
        cycle_errors = 0
        for _ in range(5):
            await page.locator('a[href="/stats"]').click()
            await page.wait_for_timeout(150)
            await page.locator('a[href="/"]').click()
            await page.wait_for_timeout(150)
            if await page.locator('[data-testid="error-boundary"]').count():
                cycle_errors += 1
            if not await page.locator("#composer").count():
                cycle_errors += 1
        check(cycle_errors == 0, "repeated/rapid cycles keep the screen usable")

        # -- light theme chrome on /stats -------------------------------------
        await page.evaluate('localStorage.setItem("lingua.theme.v1", "light")')
        await page.reload(wait_until="networkidle")
        await page.wait_for_selector("#composer")
        await page.locator('a[href="/stats"]').click()
        await page.wait_for_timeout(300)
        chrome = await page.evaluate(
            """() => ({
              meta: document.querySelector('meta[name="theme-color"]')?.content,
              bg: getComputedStyle(document.documentElement).getPropertyValue("--background").trim()
            })"""
        )
        check(chrome["bg"] != "", "a background token exists")
        check(chrome["meta"] == chrome["bg"], "theme-color matches the palette on /stats")

        await browser.close()

    check(not errors, "no page errors: " + "; ".join(errors[:3]))
    print()
    if failures:
        print(f"{len(failures)} check(s) failed")
        sys.exit(1)
    print("navigation stability: all checks passed")


if __name__ == "__main__":
    asyncio.run(main())
