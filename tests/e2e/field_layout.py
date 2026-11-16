"""Field geometry: the canvas fills the screen, holds still, and never clips or overlaps.
Run with the dev server up:  E2E_URL=http://localhost:8080 python3 tests/e2e/field_layout.py
Provider replies are intercepted, so it makes no paid requests.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

URL = os.environ.get("E2E_URL", "http://localhost:8080")
SHORT = "موعد غداً."
LONG = "هذا نص طويل جداً. " * 30
LONG_TR = ("Das ist ein sehr langer Text, der viele Zeilen füllt. " * 14).strip()
failures, errors = [], []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        failures.append(msg)


GEOMETRY = """() => {
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  };
  const canvas = document.querySelector('.canvas-shell');
  const scroll = canvas?.parentElement;
  return {
    canvas: box('.canvas-shell'),
    source: box('.source-stage'),
    field: box('.source-stage textarea'),
    result: box('.result-stage'),
    panel: box('.result-panel'),
    text: box('.result-text'),
    actions: box('.result-panel .mt-auto'),
    growBox: !!document.querySelector('.grow-box'),
    scroll: scroll ? { height: scroll.scrollHeight, client: scroll.clientHeight } : null,
    docWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  };
}"""


STAGE_BOX = """() => {
  const r = document.querySelector('.source-stage').getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, height: r.height };
}"""

# The clear control is placed by the input's direction, the field reserves its width with
# the matching logical padding. Comparing the two catches mixed UI/input directions, where
# `end-3` followed the interface and the Arabic glyphs ran under the X.
CLEAR_SIDE = """() => {
  const ta = document.querySelector('.source-stage textarea');
  const clear = document.querySelector('.source-stage > button');
  if (!ta || !clear) return null;
  const cs = getComputedStyle(ta);
  const t = ta.getBoundingClientRect(), b = clear.getBoundingClientRect();
  return {
    rtl: ta.getAttribute('dir') === 'rtl',
    onLeft: b.left + b.width / 2 < t.left + t.width / 2,
    padLeft: parseFloat(cs.paddingLeft),
    padRight: parseFloat(cs.paddingRight),
    width: b.width,
  };
}"""


async def enter(page, field, text):
    """Fill after hydration, retrying until React's controlled value keeps the text."""
    for _ in range(6):
        await field.fill(text)
        await page.wait_for_timeout(350)
        if await field.input_value() == text:
            return
    raise AssertionError("the field did not keep the typed text")


async def settled_geometry(page, timeout=8000):
    """Wait until the panel stops changing (quiet enrichment may add content once)."""
    previous = None
    for _ in range(40):
        geometry = await page.evaluate(GEOMETRY)
        shape = (geometry["canvas"]["height"], geometry["panel"]["height"])
        if previous == shape:
            return geometry
        previous = shape
        await page.wait_for_timeout(200)
    return geometry


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Reduced motion keeps the timed wordmark gust out of the stillness samples and
        # exercises the accessibility path, where the stage transitions are disabled too.
        context = await browser.new_context(
            viewport={"width": 390, "height": 844}, reduced_motion="reduce"
        )
        page = await context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        async def reply(route):
            if route.request.method == "GET":
                await route.fulfill(status=204)
                return
            data = route.request.post_data_json
            text = LONG_TR if len(data["text"]) > 40 else "Termin morgen."
            if data.get("mode") != "full":
                await route.fulfill(status=200, content_type="text/plain", body=text)
                return
            result = {
                "translation": text,
                "sourceLanguage": "ar",
                "targetLanguage": data["target"],
                "tone": "neutral",
                "formality": "neutral",
                "confidence": 1,
                "isAmbiguous": False,
                "alternativeTranslations": [],
                "notes": "",
                "situation": "general",
            }
            await route.fulfill(status=200, content_type="text/plain", body=json.dumps(result))

        await page.route("**/api/translate-stream", reply)
        await page.route("**/_serverFn/**", lambda r: r.fulfill(status=503, body=""))
        # The regression this test exists for was a feedback loop: a box observed its own
        # stretched child and resized itself on every callback. Count the callbacks so a
        # reintroduced observer fails the test even when the panel happens to look still.
        await page.add_init_script(
            "window.__roCalls = 0;"
            " const Native = window.ResizeObserver;"
            " if (Native) {"
            "   window.ResizeObserver = class extends Native {"
            "     constructor(callback) {"
            "       super(function (...args) {"
            "         window.__roCalls++;"
            "         return callback.apply(this, args);"
            "       });"
            "     }"
            "   };"
            " }"
        )
        await page.add_init_script(
            "try { localStorage.setItem('lingua.intro.seen.v1', '1');"
            " localStorage.setItem('lingua.prefs.v1',"
            " JSON.stringify({source: 'ar', target: 'de', style: 'natural'})); } catch (e) {}"
        )
        await page.goto(URL)
        # A fill before hydration is reset by the first re-render, so wait for React's
        # props on the field instead of guessing a delay.
        await page.wait_for_function(
            "() => { const el = document.querySelector('#composer');"
            " return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$')); }",
            timeout=20000,
        )
        await page.wait_for_timeout(600)

        # 1. Idle: no measured box, the canvas fills the height, nothing moves on its own.
        idle = await page.evaluate(GEOMETRY)
        check(not idle["growBox"], "canvas has no JS-measured grow box")
        check(
            idle["scroll"]["height"] <= idle["scroll"]["client"] + 1,
            f"idle canvas fills without overflow ({idle['scroll']['height']}/{idle['scroll']['client']})",
        )
        composer = await page.evaluate(
            """() => {
              const el = document.querySelector('.source-stage textarea');
              const lh = parseFloat(getComputedStyle(el).lineHeight);
              return { height: el.getBoundingClientRect().height, lh };
            }"""
        )
        check(
            abs(composer["height"] - 3 * composer["lh"]) < 1,
            f"composer is a compact three-line field ({composer['height']:.1f}px for {composer['lh']:.1f}px lines)",
        )
        await page.wait_for_timeout(1500)
        idle_later = await page.evaluate(GEOMETRY)
        check(idle == idle_later, "idle geometry holds still for 1.5s")
        check(await page.evaluate("window.__roCalls") == 0, "no ResizeObserver callbacks while idle")

        # 2. A short answer settles and stops moving; nothing renders outside its surface.
        field = page.locator("textarea").first
        await enter(page, field, SHORT)
        # Arabic raises the line height; measure this script's strip before asserting that a
        # later long draft does not change it.
        arabic_composer = await page.evaluate(
            """() => {
              const el = document.querySelector('.source-stage textarea');
              const lh = parseFloat(getComputedStyle(el).lineHeight);
              return { height: el.getBoundingClientRect().height, lh };
            }"""
        )
        check(
            abs(arabic_composer["height"] - 3 * arabic_composer["lh"]) < 1,
            f"Arabic composer is also a compact three-line field ({arabic_composer['height']:.1f}px)",
        )
        # The regression this guards: the canvas used to animate the composer's and the
        # result's heights between writing/translating/settled, so the field moved under
        # the thumb on every request. Sample across the whole request and settle.
        still = [await page.evaluate(STAGE_BOX)]
        for _ in range(8):
            await page.wait_for_timeout(120)
            still.append(await page.evaluate(STAGE_BOX))
        check(
            all(box == still[0] for box in still),
            "composer holds perfectly still while the answer streams and settles",
        )
        side = await page.evaluate(CLEAR_SIDE)
        check(bool(side and side["rtl"]), "Arabic draft is right-to-left")
        check(bool(side and side["onLeft"]), "clear control follows the Arabic reading edge")
        check(
            bool(side) and (side["padLeft"] if side["onLeft"] else side["padRight"]) >= side["width"],
            "the field reserves the clear control's width on that side (no overlap)",
        )
        await page.get_by_text("Termin morgen.").first.wait_for(timeout=15000)
        settled = await settled_geometry(page)
        settled_later = await settled_geometry(page)
        check(settled == settled_later, "settled geometry holds still after enrichment")
        check(settled["text"]["bottom"] <= settled["panel"]["bottom"] + 1, "translation stays inside the panel")
        check(
            settled["actions"]["bottom"] <= settled["panel"]["bottom"] + 1,
            "action row stays inside the panel",
        )
        check(
            settled["source"]["bottom"] <= settled["panel"]["top"] + 1,
            "composer and result never overlap",
        )
        check(
            await page.evaluate("window.__roCalls") == 0,
            "no ResizeObserver callbacks while typing and settling",
        )
        check(settled["docWidth"] <= settled["viewportWidth"], "no horizontal overflow")

        # 3. Long text grows the result and scrolls inside the capped composer, never clipped.
        before = settled["panel"]["height"]
        await enter(page, field, LONG)
        await page.wait_for_timeout(2800)
        long = await settled_geometry(page)
        check(long["panel"]["height"] > before + 40, "long answer grows the result")
        check(long["text"]["bottom"] <= long["panel"]["bottom"] + 1, "long answer is not clipped")
        long_field = await page.evaluate(
            "() => document.querySelector('.source-stage textarea').getBoundingClientRect().height"
        )
        check(
            abs(long_field - arabic_composer["height"]) < 1,
            "long draft never grows the composer; it scrolls instead",
        )
        check(
            await field.evaluate("e => e.scrollHeight > e.clientHeight"),
            "long draft scrolls inside its capped composer",
        )
        check(not long["growBox"], "no grow box returns with long content")
        check(
            await page.evaluate("window.__roCalls") == 0,
            "no ResizeObserver callbacks with long content",
        )

        check(not errors, "zero page errors" + (f": {errors[:3]}" if errors else ""))
        await browser.close()
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)


asyncio.run(main())
