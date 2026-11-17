"""Service-worker navigation regression: an active worker must not serve offline.html online.

Run against the production build:

    npm run build
    npm run preview
    python3 tests/e2e/pwa_navigation.py

Why this exists: `workbox.navigateFallback` registers a NavigationRoute before the
NetworkFirst document route, so every navigation is answered from the precached
offline page. A returning installed user then sees "Offline" while fully online.

The script performs two navigations after the worker controls the page:
  1. reload of "/"      -> translator must render, title must not be the offline page;
  2. navigation to "/stats" and back to "/" -> both must render the app.

Exit code 1 on any failure.
"""
import asyncio
import sys
import time

from playwright.async_api import async_playwright

URL = "http://localhost:8080"
failures = []
errors = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        failures.append(msg)


def is_offline(title):
    return title.strip().lower().startswith("offline")


async def controlled(page):
    try:
        return await page.evaluate("() => !!navigator.serviceWorker.controller")
    except Exception:
        return False


async def app_screen(page, label):
    title = await page.title()
    check(not is_offline(title), f"{label}: title is the app, not the offline page ('{title}')")
    check("Offline" not in (await page.locator("body").inner_text()), f"{label}: no offline copy")
    rendered = await page.locator("#composer").count()
    check(rendered == 1, f"{label}: translator composer is rendered")
    check(await controlled(page), f"{label}: the service worker still controls the page")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(URL + "/", wait_until="networkidle", timeout=90000)
        await page.evaluate("async () => { await navigator.serviceWorker.ready }")
        await page.wait_for_function("() => !!navigator.serviceWorker.controller", timeout=20000)
        check(True, "the service worker is ready and controlling the first load")
        await app_screen(page, "first load")

        # Navigation 1: reload, still controlled by the worker.
        await page.reload(wait_until="networkidle", timeout=90000)
        await app_screen(page, "reload")

        # The document must have been stored by the NetworkFirst route. Without this, a worker
        # that failed route registration would pass as a plain network proxy.
        cached = await page.evaluate(
            "async () => { const c = await caches.open('lingua-shell');"
            " return (await c.keys()).map((r) => new URL(r.url).pathname); }"
        )
        check("/" in cached, f"reload: the document is cached by the NetworkFirst route ({cached})")

        # Navigation 2: a different route, then back to the translator.
        await page.goto(URL + "/stats", wait_until="networkidle", timeout=90000)
        stats_title = await page.title()
        check(not is_offline(stats_title), f"/stats: title is the app, not the offline page ('{stats_title}')")
        check(await page.locator("main").count() >= 1, "/stats: main content is rendered")
        check(await controlled(page), "/stats: the service worker still controls the page")

        await page.goto(URL + "/", wait_until="networkidle", timeout=90000)
        await app_screen(page, "back to /")

        # Removing the cached document and cutting the network must still reach the offline shell:
        # the fallback belongs to a failed fetch, not to a successful navigation. Navigate to a
        # path this context has never loaded: reusing "/" can be satisfied by the browser's HTTP
        # cache even when the worker's own cache was deleted, which would test the HTTP cache
        # instead of the fallback.
        await page.evaluate("async () => { await caches.delete('lingua-shell') }")
        await context.set_offline(True)
        try:
            await page.goto(URL + "/offline-probe-" + str(int(time.time())), wait_until="domcontentloaded", timeout=60000)
            offline_title = await page.title()
            check(is_offline(offline_title), f"offline with no cached document: offline page is served ('{offline_title}')")
        except Exception as exc:
            check(False, f"offline with no cached document: navigation failed ({type(exc).__name__})")
        finally:
            await context.set_offline(False)

        check(not errors, f"no page errors {errors[:2]}")
        await browser.close()

    print(f"{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)


asyncio.run(main())
