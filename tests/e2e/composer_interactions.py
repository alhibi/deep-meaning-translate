"""Editing + real incremental response rendering, without a paid provider.

E2E_URL=http://localhost:8080 python3 tests/e2e/composer_interactions.py
Optional CHROMIUM_PATH/CHROMIUM_ARGS select a system browser; see browser_support.py.
The fetch boundary is faked, NOT the hook, scheduler, parser or rendering components.
"""
import asyncio
import json
import os
import platform
from pathlib import Path

from playwright.async_api import async_playwright
from browser_support import launch_chromium

URL = os.environ.get("E2E_URL", "http://localhost:8080").rstrip("/")
OUT = Path(os.environ.get("E2E_ARTIFACTS", "output/composer"))
checks = 0
errors = []
# Undo is a platform accelerator, not a portable one: macOS uses Command, others Control.
UNDO = "Meta+z" if platform.system() == "Darwin" else "Control+z"


def check(ok, message):
    global checks
    assert ok, message
    checks += 1
    print("PASS", message)


# A controllable ReadableStream exercises exactly the browser's production fetch reader.
# Abort rejects its reader, just as a real cancelled response does. All other traffic
# stays native; server functions are explicitly refused, never sent to a provider.
FEED = r"""() => {
  const original = window.fetch.bind(window);
  window.__feeds = [];
  window.__copied = null;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async value => { window.__copied = value; },
    readText: () => new Promise(resolve => { window.__paste = resolve; }),
  }});
  window.fetch = async (input, options = {}) => {
    if (new URL(String(input), location.href).pathname !== '/api/translate-stream')
      return original(input, options);
    if (!options.method || options.method === 'GET') return new Response(null, {status: 204});
    const data = JSON.parse(options.body);
    let controller;
    const entry = {data, at: performance.now(), aborted: false, closed: false};
    const stream = new ReadableStream({ start(c) { controller = c; } });
    const abort = () => {
      entry.aborted = true;
      if (!entry.closed) { entry.closed = true; controller.error(new DOMException('Aborted', 'AbortError')); }
    };
    options.signal?.addEventListener('abort', abort, {once: true});
    entry.push = text => { if (!entry.closed) controller.enqueue(new TextEncoder().encode(text)); };
    entry.end = () => {
      if (!entry.closed) { entry.closed = true; controller.close(); }
      options.signal?.removeEventListener('abort', abort);
    };
    window.__feeds.push(entry);
    if (options.signal?.aborted) abort();
    return new Response(stream, {headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  };
}"""


async def open_app(browser, width=390, height=844, locale="en", theme="light", target="de", motion="reduce"):
    context = await browser.new_context(
        viewport={"width": width, "height": height}, reduced_motion=motion,
    )
    page = await context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    seed = {"locale": locale, "theme": theme, "target": target}
    await page.add_init_script("""(seed => {
      localStorage.setItem('lingua.intro.seen.v1', '1');
      localStorage.setItem('lingua.ui-locale', seed.locale);
      localStorage.setItem('lingua.theme.v1', seed.theme);
      localStorage.setItem('lingua.prefs.v1', JSON.stringify({
        source: seed.target === 'ar' ? 'de' : 'auto', target: seed.target, style: 'natural', shadow: false
      }));
    })(""" + json.dumps(seed) + ");")
    await page.add_init_script("(" + FEED + ")()")
    await page.route("**/_serverFn/**", lambda route: route.fulfill(status=503, body=""))
    await page.goto(URL + "/?sw=off")
    await page.wait_for_function("""() => {
      const el = document.querySelector('#composer');
      return el && Object.keys(el).some(k => k.startsWith('__reactProps$'));
    }""")
    await page.wait_for_function("() => document.documentElement.lang === " + json.dumps(locale))
    await page.wait_for_function("() => document.documentElement.classList.contains(" + json.dumps(theme) + ")")
    # The pre-paint html[data-intro] flag is absent for returning visitors even BEFORE
    # restoration. Wait for the actual SSR intro component to unmount in the boot effect.
    await page.wait_for_function("() => document.querySelector('main') && !document.querySelector('.intro-screen')")
    await page.evaluate("document.fonts.ready")
    return context, page, page.locator("#composer")


async def feed_for(page, text, mode=None):
    handle = await page.wait_for_function("""({text, mode}) => {
      const index = window.__feeds.findIndex(f => f.data.text === text && (!mode || f.data.mode === mode) && !f.closed);
      return index < 0 ? null : {index};
    }""", arg={"text": text.strip(), "mode": mode})
    return (await handle.json_value())["index"]


def result_for(text, target="de"):
    return {"translation": text, "sourceLanguage": "de" if target == "ar" else "ar",
            "targetLanguage": target, "tone": "neutral", "formality": "neutral",
            "confidence": 1, "isAmbiguous": False, "alternativeTranslations": [], "notes": ""}


async def answer(page, index, text, target="de"):
    await page.evaluate("""({index, text, target, result}) => {
      const feed = window.__feeds[index];
      feed.push(feed.data.mode === 'full' ? JSON.stringify(result) : text);
      feed.end();
    }""", {"index": index, "text": text, "target": target, "result": result_for(text, target)})


async def editing(browser):
    context, page, field = await open_app(browser, motion="no-preference")
    idle_box = await field.bounding_box()
    check(await page.get_by_role("button", name="Translate now", exact=True).count() == 0,
          "automatic translation needs no manual send button")
    # The visible caption was removed as noise; the meaning must survive for a screen
    # reader only, in the composer's own description, and nowhere as painted text.
    check(await page.get_by_text("Translates as you type", exact=True).count() == 0,
          "no visible caption claims that translation is automatic")
    described = await field.get_attribute("aria-describedby")
    check(described == "composer-help composer-limit", "the composer keeps its described-by contract")
    help_text = await page.locator("#composer-help").text_content()
    check("Translates as you type" in (help_text or ""),
          "the automatic-translation meaning is still announced to screen readers")
    check(await page.locator("span[aria-hidden='true']").filter(has_text="Translates as you type").count() == 0,
          "the removed caption is not re-added as a hidden visual element")
    await field.fill("سأحضر غداً.")
    index = await feed_for(page, "سأحضر غداً.", "full")
    # Deliver the JSON string across frames, so partialTranslation and word arrival run.
    payload = json.dumps(result_for("Ich komme morgen."), ensure_ascii=False)
    split = payload.index("morgen")
    await page.evaluate("({i,s}) => window.__feeds[i].push(s)", {"i": index, "s": payload[:split]})
    await page.wait_for_function("() => document.querySelector('.result-text')?.textContent.includes('Ich komme')")
    before_font = await page.locator(".result-text").evaluate("e => getComputedStyle(e).fontSize")
    check(await page.get_by_role("button", name="Copy translation").count() == 0, "streaming controls are absent from the accessibility tree")
    check(await field.bounding_box() == idle_box, "first Arabic letter and partial output do not move the composer")
    await page.evaluate("({i,s}) => { window.__feeds[i].push(s); window.__feeds[i].end(); }", {"i": index, "s": payload[split:]})
    await page.get_by_role("button", name="Copy translation").wait_for()
    check(await field.bounding_box() == idle_box, "auto-detected language and settled output do not move the composer")
    check(await page.locator(".result-text").evaluate("e => getComputedStyle(e).fontSize") == before_font, "streaming and settled typography are identical")
    await page.wait_for_function("() => document.querySelectorAll('.result-text .word-in').length === 0")
    check(True, "finished word animations retire their classes/layers")
    await page.get_by_role("button", name="Copy translation").click()
    check(await page.evaluate("window.__copied") == "Ich komme morgen.", "Copy writes the exact settled answer")

    # An already-complete reading is local data, not invalidated by connectivity.
    await page.evaluate("""() => {
      Object.defineProperty(navigator, 'onLine', {value:false, configurable:true});
      window.dispatchEvent(new Event('offline'));
    }""")
    await page.get_by_role("button", name="Save", exact=True).click()
    await page.get_by_role("region", name="Translation", exact=True).get_by_role("button", name="Saved", exact=True).wait_for()
    await page.wait_for_function("""() => {
      const record = JSON.parse(localStorage.getItem('lingua.session.v1'));
      const saved = JSON.parse(localStorage.getItem('lingua.saved.v1') || '[]');
      return record?.result?.translation === 'Ich komme morgen.' && saved.some(p => p.translated === 'Ich komme morgen.');
    }""")
    check(True, "a settled answer remains saveable and persisted offline")
    await page.get_by_role("region", name="Translation", exact=True).get_by_role("button", name="Saved", exact=True).click()
    await page.evaluate("""() => {
      Object.defineProperty(navigator, 'onLine', {value:true, configurable:true});
      window.dispatchEvent(new Event('online'));
    }""")

    # An old result stays readable, but cannot be copied or persisted for a new source.
    await field.fill("سأحضر")
    await page.wait_for_function("() => document.querySelector('.result-panel').dataset.stale === 'true'")
    check(await page.get_by_role("button", name="Copy translation").count() == 0, "editing immediately makes the old result inert")
    await page.wait_for_function("""() => {
      const record = JSON.parse(localStorage.getItem('lingua.session.v1'));
      return record?.text === 'سأحضر' && record.result === null;
    }""")
    check(True, "device session never pairs the previous translation with a new draft")
    index = await feed_for(page, "سأحضر", "live")
    await page.evaluate("i => window.__feeds[i].push('Ja')", index)
    await page.wait_for_function("() => document.querySelector('.result-text')?.textContent === 'Ja'")
    check(True, "deleting words displays a shorter stream from its first chunk")

    # Native selection/undo stays native while React and provider work are active.
    await field.fill("Alpha beta gamma.")
    await field.evaluate("e => e.setSelectionRange(6, 10)")
    await page.keyboard.insert_text("delta")
    check(await field.input_value() == "Alpha delta gamma.", "replacement changes only the selected word")
    await page.keyboard.press(UNDO)
    check(await field.input_value() == "Alpha beta gamma.", "native undo restores the selected word")
    await page.keyboard.press("End")
    await page.keyboard.press("Shift+Enter")
    check("\n" in await field.input_value(), "Shift+Enter inserts a real newline")
    check(await field.evaluate("e => e.clientHeight === 2 * parseFloat(getComputedStyle(e).lineHeight) && e.scrollHeight <= e.clientHeight + 1"),
          "native newline expands the source by one full line without internal scrolling")
    await field.fill("١٢٣ Hallo")
    check(await field.get_attribute("dir") == "ltr", "Arabic numerals do not override the first Latin letter")
    await field.fill("123 مرحباً")
    check(await field.get_attribute("dir") == "rtl", "neutral prefixes do not override the first Arabic letter")

    # Enter from a candidate selector is not a submit; final composition re-enters the scheduler.
    await field.fill("")
    count = await page.evaluate("window.__feeds.length")
    await field.dispatch_event("compositionstart")
    await field.fill("にほん")
    await field.dispatch_event("keydown", {"key": "Enter", "keyCode": 229, "isComposing": True})
    await page.wait_for_timeout(1900)  # Crosses both debounce and watchdog deadlines intentionally.
    check(await page.evaluate("window.__feeds.length") == count, "composition blocks scheduler, watchdog and Enter submission")
    await field.dispatch_event("compositionend")
    await feed_for(page, "にほん")
    check(True, "a committed composition resumes automatic translation")

    await field.fill("a" * 4999)
    await field.press("End")
    await page.keyboard.insert_text("🙂")
    check(await field.evaluate("e => e.value.length <= 5000 && !/[\\uD800-\\uDBFF]$/.test(e.value)"), "character limit never leaves half an emoji")
    check(await field.get_attribute("maxlength") == "5000", "the browser enforces the same 5,000-unit limit as the server")

    await page.get_by_role("button", name="Clear text").click()
    check(await field.input_value() == "" and await field.evaluate("e => e === document.activeElement"), "Clear cancels the result and keeps input focus")
    check(await page.locator(".result-text").count() == 0, "cleared streams cannot resurrect a result")
    # Simulate a clipboard permission prompt resolving after the person started writing.
    await page.evaluate("document.dispatchEvent(new Event('copy'))")
    await page.get_by_role("button", name="Paste", exact=True).click()
    await field.fill("لا تستبدل كتابتي")
    await page.evaluate("window.__paste('نص قديم من الحافظة')")
    check(await field.input_value() == "لا تستبدل كتابتي", "late clipboard permission cannot overwrite newer writing")

    # A translated answer can legitimately be longer than the source input budget.
    # Swap must bound the new source too, without cutting the emoji at the boundary.
    await field.fill("هذه جملة للتبديل.")
    index = await feed_for(page, "هذه جملة للتبديل.", "full")
    long_answer = ("Ein längerer Absatz mit Inhalt. " * 180)[:4999] + "🙂 Ende."
    await answer(page, index, long_answer)
    await page.get_by_role("button", name="Copy translation").wait_for()
    await page.get_by_role("button", name="Swap languages", exact=True).click()
    check(await field.input_value() == long_answer[:4999], "swapping a long answer respects the source limit without splitting an emoji")
    await field.fill("مسودة جديدة")
    await page.get_by_role("button", name="Swap languages", exact=True).click()
    check(await field.input_value() == "مسودة جديدة", "swapping during editing never inserts the previous draft's translation")
    await context.close()


async def adaptive_canvas(browser):
    context, page, field = await open_app(browser, motion="no-preference")
    idle = await page.locator(".canvas-shell").bounding_box()
    # Growing/shrinking must leave native undo in charge, without rewriting the textarea.
    multiline = "Erste\nZweite\nDritte"
    await field.fill(multiline)
    line = await field.evaluate("e => parseFloat(getComputedStyle(e).lineHeight)")
    check((await field.bounding_box())["height"] == 3 * line, "three real lines grow the source, not the viewport")
    await field.evaluate("e => e.setSelectionRange(0, e.value.length)")
    await page.keyboard.insert_text("Kurz")
    check((await field.bounding_box())["height"] == line, "replacing multiline text with a word shrinks the source")
    await page.keyboard.press(UNDO)
    check(await field.input_value() == multiline and (await field.bounding_box())["height"] == 3 * line,
          "native undo restores both multiline text and its intrinsic height")

    draft = "أحتاج إلى التأكد من الموعد."
    await page.evaluate("window.__typedAt = performance.now()")
    await field.fill(draft)
    index = await feed_for(page, draft, "full")
    scheduled = await page.evaluate("i => window.__feeds[i].at - window.__typedAt", index)
    check(scheduled < 1000, f"complete sentence starts automatically without Enter ({scheduled:.0f}ms client scheduling; mocked network)")
    check(await page.evaluate("text => window.__feeds.filter(f => f.data.text === text && f.data.mode === 'full').length", draft) == 1,
          "automatic full sentence is scheduled once, without a competing send action")
    source = await field.bounding_box()
    scroll_top = await page.locator(".translator-workspace").evaluate("e => e.scrollTop")
    translation = "Guten Morgen. " + "Wir sehen uns morgen zum vereinbarten Termin. " * 24
    payload = json.dumps(result_for(translation), ensure_ascii=False)
    first = payload.index("Morgen.") + len("Morgen.")
    await page.evaluate("({i,s}) => window.__feeds[i].push(s)", {"i": index, "s": payload[:first]})
    await page.wait_for_function("() => document.querySelector('.result-text')?.textContent === 'Guten Morgen.'")
    small = await page.locator(".canvas-shell").bounding_box()
    check(await field.bounding_box() == source, "first short stream chunk cannot stretch the source")
    middle = first + 240
    await page.evaluate("({i,s}) => window.__feeds[i].push(s)", {"i": index, "s": payload[first:middle]})
    await page.wait_for_function("() => document.querySelector('.result-text')?.textContent.length > 200")
    grown = await page.locator(".canvas-shell").bounding_box()
    check(grown["height"] > small["height"] + 40, "new streamed lines grow the canvas only as content arrives")
    check(await field.bounding_box() == source, "a longer stream leaves the source's bounds unchanged")
    await page.evaluate("({i,s}) => { window.__feeds[i].push(s); window.__feeds[i].end(); }", {"i": index, "s": payload[middle:]})
    await page.get_by_role("button", name="Copy translation", exact=True).wait_for()
    check(await field.bounding_box() == source, "settling a long answer never resizes the source")
    check(await page.locator(".translator-workspace").evaluate("e => e.scrollTop") == scroll_top,
          "stream growth never forces the active writer to the answer's bottom")
    long = await page.locator(".canvas-shell").bounding_box()
    await field.fill("صباح الخير.")
    index = await feed_for(page, "صباح الخير.", "full")
    await answer(page, index, "Hallo.")
    await page.get_by_role("button", name="Copy translation", exact=True).wait_for()
    short = await page.locator(".canvas-shell").bounding_box()
    check(short["height"] < long["height"] - 80, "shorter automatic answer releases the long result's empty space")
    await page.get_by_role("button", name="Clear text", exact=True).click()
    # The hook clears its external request/result snapshot in an effect. Observe that
    # completion before reading layout; a click resolving is not a React commit barrier.
    await page.wait_for_function("() => !document.querySelector('.result-text') && document.querySelector('#composer').value === ''")
    cleared = await page.locator(".canvas-shell").bounding_box()
    check(abs(cleared["height"] - idle["height"]) < 1, "clearing restores the original compact surface")
    await context.close()


async def keyboard_viewport(browser):
    context, page, field = await open_app(browser)
    await field.focus()
    await page.evaluate("""() => {
      window.__height = innerHeight;
      window.__scale = 1;
      Object.defineProperty(visualViewport, 'height', {get: () => window.__height});
      Object.defineProperty(visualViewport, 'scale', {get: () => window.__scale});
      window.__height = 480;
      visualViewport.dispatchEvent(new Event('resize'));
    }""")
    await page.wait_for_selector('.canvas-shell[data-keyboard="open"]')
    check(await field.evaluate("e => Math.abs(e.clientHeight - parseFloat(getComputedStyle(e).lineHeight)) < 1"),
          "keyboard opening does not inflate a short or empty source")
    draft = "سطر طويل للاختبار.\n" * 12
    await field.fill(draft)
    check(await field.evaluate("e => Math.abs(e.clientHeight - 3 * parseFloat(getComputedStyle(e).lineHeight)) < 1 && e.scrollHeight > e.clientHeight"),
          "keyboard caps long source at three whole lines, with native scrolling")
    index = await feed_for(page, draft, "full")
    await answer(page, index, "Ein langer übersetzter Absatz. " * 70)
    await page.get_by_role("button", name="Copy translation").wait_for(state="attached")
    visible = await field.evaluate("""e => {
      const r = e.getBoundingClientRect(), room = document.querySelector('.translator-workspace').getBoundingClientRect();
      return r.top >= room.top && r.bottom <= room.bottom;
    }""")
    check(visible, "a growing answer never scrolls the active composer off screen")
    await page.evaluate("window.__height = innerHeight; visualViewport.dispatchEvent(new Event('resize'))")
    await page.wait_for_selector('.canvas-shell:not([data-keyboard])')
    check(await field.evaluate("e => Math.abs(e.clientHeight - 6 * parseFloat(getComputedStyle(e).lineHeight)) < 1"),
          "closing keyboard restores the bounded six-line space for a long draft")
    await field.fill("قصير")
    check(await field.evaluate("e => Math.abs(e.clientHeight - parseFloat(getComputedStyle(e).lineHeight)) < 1"),
          "deleting after keyboard closing returns to one content-sized line")
    await page.evaluate("window.__scale = 2; window.__height = 300; visualViewport.dispatchEvent(new Event('resize'))")
    check(await page.locator('.canvas-shell[data-keyboard="open"]').count() == 0, "pinch zoom is not mistaken for a keyboard")
    await context.close()


async def caret_geometry(browser):
    """The only caret on screen is the native textarea's, drawn at the inline-start edge of
    its editable content box. That edge has to coincide with the first glyph's edge in both
    directions, and the invisible mirror has to measure the same paragraph — a mirror that
    wraps at a different width or resolves a different direction would size the editor from
    text the caret is not in, which is exactly the "caret far from where typing starts"
    defect class. No CSS caret is drawn anywhere in the composer.
    """
    for locale in ("en", "ar"):
        context, page, field = await open_app(browser, locale=locale, motion="no-preference")
        draft = "Hallo zusammen, schön dich zu sehen." if locale == "en" else "مرحباً بكم، سعيد بلقائكم."
        await field.fill(draft)
        await page.wait_for_timeout(150)
        metrics = await page.evaluate(r"""() => {
          const ta = document.querySelector('#composer');
          const mirror = document.querySelector('.composer-mirror');
          const box = el => {
            const s = getComputedStyle(el), r = el.getBoundingClientRect();
            return {
              left: r.left, right: r.right, width: r.width,
              padL: parseFloat(s.paddingLeft), padR: parseFloat(s.paddingRight),
              dir: s.direction, align: s.textAlign, font: s.fontSize, line: s.lineHeight,
              track: s.letterSpacing, space: s.whiteSpace, wrap: s.overflowWrap,
              render: s.textRendering,
            };
          };
          const node = [...mirror.childNodes].find(n => n.nodeType === 3);
          let first = null;
          if (node && node.data.length > 1) {
            const range = document.createRange();
            range.setStart(node, 0); range.setEnd(node, 1);
            const r = range.getBoundingClientRect();
            first = {left: r.left, right: r.right};
          }
          return {field: box(ta), mirror: box(mirror), first, dir: ta.getAttribute('dir')};
        }""")
        rtl = metrics["dir"] == "rtl"
        for prop in ("dir", "align", "font", "line", "track", "space", "wrap", "render", "padL", "padR"):
            check(metrics["field"][prop] == metrics["mirror"][prop],
                  f"{locale}: the mirror and the field agree on {prop} ({metrics['dir']} text)")
        check(abs(metrics["field"]["width"] - metrics["mirror"]["width"]) < 1,
              f"{locale}: the mirror wraps at the field's own width")
        edge = metrics["field"]["right"] - metrics["field"]["padR"] if rtl else metrics["field"]["left"] + metrics["field"]["padL"]
        glyph = metrics["first"]["right"] if rtl else metrics["first"]["left"]
        check(abs(glyph - edge) < 1.5,
              f"{locale}: the first glyph starts exactly at the caret's inline-start edge ({metrics['dir']})")
        check(metrics["field"]["left"] <= edge <= metrics["field"]["right"],
              f"{locale}: the caret's start edge is inside the field")
        # Nothing is painted under the reserved inline-end padding: that strip belongs to
        # the clear control, and text (or a caret) there would sit under the button.
        if rtl:
            check(metrics["first"]["left"] >= metrics["field"]["left"] + metrics["field"]["padL"] - 1.5,
                  f"{locale}: RTL text never starts under the clear control's reserved strip")
        else:
            check(metrics["first"]["right"] <= metrics["field"]["right"] - metrics["field"]["padR"] + 1.5,
                  f"{locale}: LTR text never runs under the clear control's reserved strip")
        await field.fill("")
        await field.focus()
        home = await page.evaluate("""() => {
          const ta = document.querySelector('#composer');
          const s = getComputedStyle(ta), r = ta.getBoundingClientRect();
          return {dir: ta.getAttribute('dir'), start: ta.selectionStart, end: ta.selectionEnd,
                  left: r.left, right: r.right, padL: parseFloat(s.paddingLeft), padR: parseFloat(s.paddingRight)};
        }""")
        home_edge = home["right"] - home["padR"] if home["dir"] == "rtl" else home["left"] + home["padL"]
        check(home["start"] == 0 and home["end"] == 0 and home["left"] <= home_edge <= home["right"],
              f"{locale}: an empty focused field puts the caret at the inline-start edge")
        await context.close()


async def responsive(browser):
    cases = [(320, 568), (390, 844), (768, 1024), (1440, 900), (844, 390)]
    for i, (width, height) in enumerate(cases):
        for j, locale in enumerate(["en", "ar", "de"]):
            theme = ["light", "dark", "vivid"][(i + j) % 3]
            target = "ar" if j == 1 else "de"
            context, page, field = await open_app(browser, width, height, locale, theme, target)
            compact = await field.evaluate("""e => {
              const c = document.querySelector('.canvas-shell'), cs = getComputedStyle(c);
              return e.clientHeight === parseFloat(getComputedStyle(e).lineHeight) && c.getBoundingClientRect().height < 320 &&
                cs.boxShadow === 'none' && parseFloat(cs.borderTopWidth) === 0;
            }""")
            check(compact, f"{width}×{height} / {locale} / {theme}: empty canvas is compact and borderless")
            draft = ("Ein langer Text. " * 80 if target == "ar" else "هذا نص طويل. " * 80)
            draft = draft.rstrip() + "\nhttps://example.invalid/" + "source-path-" * 55
            await field.fill(draft)
            index = await feed_for(page, draft)
            # A single enormous token also covers URLs and German compounds in word-in spans.
            translation = ("ترجمة طويلة. " if target == "ar" else "Eine lange Übersetzung. ") * 65
            translation += "\nhttps://example.invalid/" + "long-path-" * 70
            await answer(page, index, translation, target)
            await page.wait_for_function("() => document.querySelector('.result-text')?.textContent.includes('example.invalid')")
            shape = await page.evaluate("""() => {
              const box = selector => document.querySelector(selector).getBoundingClientRect();
              const text = document.querySelector('.result-text');
              const field = document.querySelector('#composer');
              const c = box('.canvas-shell'), s = box('.source-stage'), r = box('.result-stage');
              const p = box('.result-panel'), t = box('.result-text'), a = box('.result-actions');
              return {
                overlap: s.bottom > r.top + 1,
                clipped: t.bottom > p.bottom + 1 || a.bottom > p.bottom + 1,
                overflow: text.scrollWidth > text.clientWidth + 1 || field.scrollWidth > field.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth,
                inside: p.left >= c.left && p.right <= c.right,
                scrolls: field.scrollHeight > field.clientHeight,
                lines: Math.abs(field.getBoundingClientRect().height -
                  (innerHeight <= 480 ? 3 : innerHeight <= 640 ? 4 : 6) * parseFloat(getComputedStyle(field).lineHeight)) < 1,
              };
            }""")
            check(not shape["overlap"] and not shape["clipped"] and not shape["overflow"] and shape["inside"] and shape["scrolls"] and shape["lines"],
                  f"{width}×{height} / {locale} / {theme}: long RTL/LTR text, URL, actions stay inside; source scrolls only at its viewport cap")
            if width == 390:
                OUT.mkdir(parents=True, exist_ok=True)
                await page.screenshot(path=str(OUT / f"{locale}-{theme}.png"))
            await context.close()


async def main():
    async with async_playwright() as p:
        browser = await launch_chromium(p)
        await editing(browser)
        await adaptive_canvas(browser)
        await keyboard_viewport(browser)
        await caret_geometry(browser)
        await responsive(browser)
        await browser.close()
    check(not errors, "zero browser runtime errors: " + repr(errors))
    print(f"\n{checks} checks passed (mocked transport; physical IMEs and keyboards are not verified)")


if __name__ == "__main__":
    asyncio.run(main())
