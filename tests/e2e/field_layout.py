"""Content-led field geometry: compact at rest, grows/shrinks without loops or overlap.
Run with the app up: E2E_URL=http://localhost:8080 python3 tests/e2e/field_layout.py
Provider replies are intercepted, so it makes no paid requests.
"""
import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright
from browser_support import launch_chromium

URL = os.environ.get("E2E_URL", "http://localhost:8080").rstrip("/")
SHORT = "موعد غداً."
LONG = "هذا نص طويل جداً. " * 30
LONG_TR = ("Das ist ein sehr langer Text, der viele Zeilen füllt. " * 14).strip()
failures, errors = [], []
checks = 0


def check(ok, msg):
    global checks
    checks += 1
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
    actions: box('.result-actions'),
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

FIELD = """e => {
  const cs = getComputedStyle(e), mirror = e.parentElement.querySelector('.composer-mirror');
  return {
    height: e.getBoundingClientRect().height, lh: parseFloat(cs.lineHeight),
    scroll: e.scrollHeight, client: e.clientHeight,
    max: parseFloat(cs.maxHeight), value: e.value, mirror: mirror.textContent,
    inlineHeight: e.style.height,
  };
}"""

# The clear control follows the INPUT's direction, not the interface's. Its logical
# padding must match that edge, including when the two directions disagree.
CLEAR_SIDE = """() => {
  const ta = document.querySelector('.source-stage textarea');
  const clear = document.querySelector('.source-stage > button');
  const cs = getComputedStyle(ta);
  const t = ta.getBoundingClientRect(), b = clear.getBoundingClientRect();
  return {
    rtl: ta.getAttribute('dir') === 'rtl',
    onLeft: b.left + b.width / 2 < t.left + t.width / 2,
    padLeft: parseFloat(cs.paddingLeft), padRight: parseFloat(cs.paddingRight),
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


async def settled_geometry(page):
    """Wait until finite transitions / quiet enrichment stop changing the panel."""
    previous = None
    for _ in range(40):
        geometry = await page.evaluate(GEOMETRY)
        shape = (geometry["canvas"]["height"], geometry["panel"]["height"])
        if previous == shape:
            return geometry
        previous = shape
        await page.wait_for_timeout(200)
    raise AssertionError("the panel never stopped changing size")


async def main():
    async with async_playwright() as p:
        browser = await launch_chromium(p)
        context = await browser.new_context(
            viewport={"width": 390, "height": 844}, reduced_motion="reduce"
        )
        page = await context.new_page()
        # Focus styles (:focus / :focus-visible) only match while the document itself has
        # focus; a headless page is not guaranteed to be the front document. Bring it to the
        # front once, so the focus-marker assertion runs in the state a real user is in.
        await page.bring_to_front()
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
                "translation": text, "sourceLanguage": "ar", "targetLanguage": data["target"],
                "tone": "neutral", "formality": "neutral", "confidence": 1,
                "isAmbiguous": False, "alternativeTranslations": [], "notes": "",
                "situation": "general",
            }
            await route.fulfill(status=200, content_type="text/plain", body=json.dumps(result))

        await page.route("**/api/translate-stream", reply)
        await page.route("**/_serverFn/**", lambda r: r.fulfill(status=503, body=""))
        # A previous measured grow box resized its own stretched child ~2,300 times.
        # CSS intrinsic sizing must never restore that feedback loop, even while typing.
        await page.add_init_script("""(() => {
          window.__roCalls = 0;
          const Native = window.ResizeObserver;
          if (Native) window.ResizeObserver = class extends Native {
            constructor(callback) {
              super(function (...args) { window.__roCalls++; return callback.apply(this, args); });
            }
          };
        })()""")
        await page.add_init_script("""try {
          localStorage.setItem('lingua.intro.seen.v1', '1');
          localStorage.setItem('lingua.ui-locale', 'en');
          localStorage.setItem('lingua.theme.v1', 'dark');
          localStorage.setItem('lingua.prefs.v1', JSON.stringify({source:'ar', target:'de', style:'natural'}));
        } catch (e) {}""")
        await page.goto(URL + "/?sw=off")
        await page.wait_for_function("""() => {
          const el = document.querySelector('#composer');
          return el && Object.keys(el).some(k => k.startsWith('__reactProps$'));
        }""", timeout=20000)
        await page.evaluate("document.fonts.ready")
        await page.wait_for_timeout(600)
        field = page.locator("#composer")

        # 1. Empty means compact: not a large rectangle stretched to the viewport.
        idle = await page.evaluate(GEOMETRY)
        check(not idle["growBox"], "canvas has no JS-measured grow box")
        check(idle["canvas"]["height"] < idle["scroll"]["client"] * 0.55,
              f"idle canvas hugs content instead of filling the screen ({idle['canvas']['height']:.1f}px)")
        check(idle["scroll"]["height"] <= idle["scroll"]["client"] + 1, "idle workspace needs no scrolling")
        empty_field = await field.evaluate(FIELD)
        check(abs(empty_field["height"] - empty_field["lh"]) < 1, "empty editor is one whole line")
        check(empty_field["inlineHeight"] == "", "native field has no JS-written height")
        decoration = await page.locator(".canvas-shell").evaluate("""e => {
          const cs = getComputedStyle(e);
          return cs.boxShadow === 'none' && ['Top','Right','Bottom','Left'].every(s => parseFloat(cs['border'+s+'Width']) === 0);
        }""")
        check(decoration, "canvas has neither a visible border nor an inset highlight")
        check(await page.get_by_role("button", name="Translate now", exact=True).count() == 0,
              "no manual send button competes with automatic translation")
        swap = page.get_by_role("button", name="Swap languages", exact=True)
        check(await swap.evaluate("""e => {
          const cs = getComputedStyle(e), r = e.getBoundingClientRect();
          return cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.boxShadow === 'none' &&
            parseFloat(cs.borderTopWidth) === 0 && r.width >= 44 && r.height >= 44;
        }"""), "bare swap retains a 44px accessible touch target")
        before_focus = await page.locator(".source-stage").evaluate("e => getComputedStyle(e).backgroundColor")
        # A headless page is not guaranteed to be the front document, and :focus / :focus-visible
        # only match while it is. Make that state explicit instead of depending on the runner.
        await page.bring_to_front()
        await page.wait_for_timeout(120)
        await field.focus()
        await page.wait_for_timeout(220)  # Check the final style, not the first frame of a fading placeholder.
        focus = await page.locator(".composer-editor").evaluate("""e => {
          const mark = getComputedStyle(e, '::after'), ta = e.querySelector('textarea');
          return {stroke: mark.backgroundColor !== 'rgba(0, 0, 0, 0)' && mark.height === '2px',
            placeholder: getComputedStyle(ta, '::placeholder').opacity,
            surface: getComputedStyle(e.closest('.source-stage')).backgroundColor};
        }""")
        check(before_focus == focus["surface"] and focus["stroke"], "focus uses a short solid marker, never a white surface/frame")
        check(focus["placeholder"] == "1", "focused placeholder keeps its contrast rather than fading")
        await page.wait_for_timeout(1500)
        check(idle == await page.evaluate(GEOMETRY), "empty/focused geometry holds still for 1.5s")
        check(await page.evaluate("window.__roCalls") == 0, "no ResizeObserver callbacks while idle")

        # 2. Exact whitespace and trailing blank lines size intrinsically in both scripts.
        for draft, lines in [("مرحبا", 1), ("مرحبا\nبك\n", 3), ("Hallo\nWelt", 2), ("\n\n", 3), ("", 1)]:
            await field.fill(draft)
            shape = await field.evaluate(FIELD)
            check(abs(shape["height"] - lines * shape["lh"]) < 1 and shape["scroll"] <= shape["client"] + 1
                  and shape["mirror"] == draft + "\u200b",
                  f"source fits {lines} real line(s), including whitespace: {draft!r}")

        # 3. Actual result changes must never resize or move an unchanged source.
        await enter(page, field, SHORT)
        arabic = await field.evaluate(FIELD)
        check(abs(arabic["height"] - arabic["lh"]) < 1, "short Arabic draft remains one line")
        still = [await page.evaluate(STAGE_BOX)]
        for _ in range(8):
            await page.wait_for_timeout(120)
            still.append(await page.evaluate(STAGE_BOX))
        check(all(box == still[0] for box in still), "source stays still while the answer arrives and settles")
        side = await page.evaluate(CLEAR_SIDE)
        check(side["rtl"] and side["onLeft"], "clear control follows the Arabic draft, not the English interface")
        check((side["padLeft"] if side["onLeft"] else side["padRight"]) >= side["width"],
              "the field reserves the clear control's full width (no overlap)")
        await page.get_by_role("button", name="Copy translation").wait_for()
        settled = await settled_geometry(page)
        check(settled == await settled_geometry(page), "settled geometry holds still after enrichment")
        check(settled["text"]["bottom"] <= settled["panel"]["bottom"] + 1, "translation stays inside the panel")
        check(settled["actions"]["bottom"] <= settled["panel"]["bottom"] + 1, "action row stays inside the panel")
        check(0 <= settled["actions"]["top"] - settled["text"]["bottom"] <= 16,
              "actions follow the answer without a viewport-sized gap")
        check(settled["source"]["bottom"] <= settled["result"]["top"] + 1, "source and result do not overlap")
        check(settled["docWidth"] <= settled["viewportWidth"], "short content has no horizontal overflow")

        # 4. Long content grows naturally; only the source is capped, not the answer.
        await enter(page, field, LONG)
        await page.wait_for_timeout(2800)
        long = await settled_geometry(page)
        check(long["panel"]["height"] > settled["panel"]["height"] + 40, "long answer grows the result")
        check(long["text"]["bottom"] <= long["panel"]["bottom"] + 1 and
              long["actions"]["bottom"] <= long["panel"]["bottom"] + 1, "long answer and actions are never clipped")
        capped = await field.evaluate(FIELD)
        check(abs(capped["height"] - 6 * capped["lh"]) < 1 and capped["height"] > arabic["height"],
              "long draft grows to the six-whole-line cap on a tall viewport")
        check(capped["scroll"] > capped["client"], "long draft scrolls natively inside the cap")
        check(long["scroll"]["height"] > long["scroll"]["client"], "long result scrolls the workspace instead of clipping")
        check(not long["growBox"] and await page.evaluate("window.__roCalls") == 0,
              "growing content does not introduce a measured grow box or resize loop")

        # 5. Deletion must reclaim the space, not retain the old tall rectangle.
        await enter(page, field, SHORT)
        await page.wait_for_function("() => document.querySelector('.result-text')?.textContent === 'Termin morgen.'")
        shrunk = await settled_geometry(page)
        check(shrunk["canvas"]["height"] < long["canvas"]["height"] - 80,
              "deleting to a short sentence shrinks the canvas and result again")
        short_field = await field.evaluate(FIELD)
        check(abs(short_field["height"] - short_field["lh"]) < 1 and short_field["scroll"] <= short_field["client"] + 1,
              "source returns to one line without a stale internal scroll extent")
        await page.get_by_role("button", name="Clear text").click()
        cleared = await settled_geometry(page)
        check(abs(cleared["canvas"]["height"] - idle["canvas"]["height"]) < 1 and cleared["text"] is None,
              "Clear restores the compact empty canvas and removes the result")
        check(await field.evaluate("e => e === document.activeElement"), "Clear leaves native editing focused")
        check(await page.evaluate("window.__roCalls") == 0, "zero ResizeObserver callbacks through growth, deletion and Clear")
        check(not errors, "zero page errors" + (f": {errors[:3]}" if errors else ""))
        await browser.close()
    print(f"\n{checks} checks, {len(failures)} failure(s)")
    sys.exit(1 if failures else 0)


asyncio.run(main())
