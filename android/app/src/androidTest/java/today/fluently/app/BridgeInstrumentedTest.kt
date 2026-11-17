package today.fluently.app

import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.getcapacitor.BridgeActivity
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The bridge test TD20 asked for: the WebView, Capacitor's reflection layer and the
 * Kotlin plugins must work together on a real Android runtime, not only through Robolectric.
 *
 * The page is the packaged SPA served from https://localhost; every assertion here would
 * fail if the plugin were missing, the DTO shape changed, or the packaged assets were not
 * copied into the APK. Calls go through the same JavaScript API the app uses.
 */
@RunWith(AndroidJUnit4::class)
class BridgeInstrumentedTest {
    /** evaluateJavascript hands back the JSON encoding of the expression's value. */
    private fun decode(raw: String): String =
        try {
            JSONObject("{\"v\":$raw}").getString("v")
        } catch (error: Exception) {
            raw
        }

    private fun evaluate(webView: WebView, script: String): String {
        val latch = CountDownLatch(1)
        var value = ""
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            webView.evaluateJavascript(script) { result ->
                value = result ?: ""
                latch.countDown()
            }
        }
        assertTrue("WebView did not answer evaluateJavascript within 10s", latch.await(10, TimeUnit.SECONDS))
        return decode(value)
    }

    private fun jsStringLiteral(value: String): String = JSONObject.quote(value)

    /** evaluateJavascript cannot await a promise; park its value and poll for it. */
    private fun promise(webView: WebView, expression: String, timeoutMs: Long = 20_000): String {
        evaluate(
            webView,
            "window.__linguaTest = null; ($expression).then(function(v){window.__linguaTest = v;}).catch(function(e){window.__linguaTest = 'ERR:' + (e && e.message ? e.message : e);});",
        )
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val value = evaluate(webView, "JSON.stringify(window.__linguaTest)")
            if (value != "null" && value.isNotBlank()) return value
            Thread.sleep(200)
        }
        throw AssertionError("promise did not settle: $expression")
    }

    private fun waitForBridge(webView: WebView) {
        val deadline = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < deadline) {
            val ready = evaluate(webView, "String(typeof Capacitor !== 'undefined' && !!Capacitor.Plugins && !!Capacitor.Plugins.LinguaStore)")
            if (ready == "true") return
            Thread.sleep(250)
        }
        throw AssertionError("Capacitor bridge or LinguaStore plugin did not become available")
    }

    private fun launch(): Pair<ActivityScenario<MainActivity>, WebView> {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        lateinit var webView: WebView
        scenario.onActivity { activity ->
            webView = (activity as BridgeActivity).bridge.webView
        }
        waitForBridge(webView)
        return scenario to webView
    }

    @Test
    fun packagedShellLoadsFromTheLocalOrigin() {
        val (scenario, webView) = launch()
        scenario.use {
            assertEquals("https://localhost", evaluate(webView, "location.origin"))
            assertTrue(
                "packaged document title was ${evaluate(webView, "document.title")}",
                evaluate(webView, "document.title").contains("today"),
            )
            // The app shell is packaged, not fetched: the translator's own node exists.
            assertEquals("true", evaluate(webView, "String(!!document.getElementById(\"composer\"))"))
        }
    }

    @Test
    fun storagePluginRoundTripsThroughTheRealBridge() {
        val (scenario, webView) = launch()
        scenario.use {
            val key = "lingua.test.device"
            val write = promise(
                webView,
                "Capacitor.Plugins.LinguaStore.settingsWrite({key: ${jsStringLiteral(key)}, value: 'stored-on-device'})",
            )
            assertTrue("settingsWrite returned $write", write.contains("\"ok\":true"))
            val read = promise(webView, "Capacitor.Plugins.LinguaStore.settingsAll()")
            assertTrue("settingsAll did not contain the written key: $read", read.contains("stored-on-device"))
            // A key outside the app's namespace must be refused by the Kotlin boundary.
            val refused = promise(
                webView,
                "Capacitor.Plugins.LinguaStore.settingsWrite({key: 'not-lingua', value: 'x'})",
            )
            assertTrue("non-lingua key was accepted: $refused", refused.contains("\"ok\":false"))
            promise(webView, "Capacitor.Plugins.LinguaStore.settingsRemove({key: ${jsStringLiteral(key)}})")
        }
    }

    /**
     * A2-01: the draft's sequence stamp is an epoch-millisecond JSON number, which
     * Capacitor delivers as a Long. The old getDouble decode produced 0 and every session
     * write was rejected, so force-stopping the app lost the draft. This exercises the
     * real bridge decode and the stale-write guard end to end.
     */
    @Test
    fun sessionDraftRoundTripsAndAStaleWriteIsRejected() {
        val (scenario, webView) = launch()
        scenario.use {
            val stamp = System.currentTimeMillis()
            val draft = "{\"text\":\"Guten Tag, wie geht es dir?\",\"result\":null,\"source\":\"de\",\"target\":\"ar\",\"style\":\"natural\"}"
            val write = promise(
                webView,
                "Capacitor.Plugins.LinguaStore.sessionWrite({json: ${jsStringLiteral(draft)}, seq: $stamp})",
            )
            assertTrue("sessionWrite returned $write", write.contains("\"ok\":true"))
            val boot = promise(webView, "Capacitor.Plugins.LinguaStore.boot()")
            assertTrue("boot did not return the saved draft: $boot", boot.contains("Guten Tag"))
            // An older stamp must never replace the newer draft.
            val stale = promise(
                webView,
                "Capacitor.Plugins.LinguaStore.sessionWrite({json: ${jsStringLiteral(draft)}, seq: ${stamp - 1000}})",
            )
            assertTrue("stale session write was accepted: $stale", stale.contains("\"ok\":false"))
            // Leave the test device clean: an empty draft with a newer stamp clears the row.
            promise(
                webView,
                "Capacitor.Plugins.LinguaStore.sessionWrite({json: null, seq: ${stamp + 10_000}})",
            )
        }
    }

    /** Poll a JS expression until it answers with something other than null/empty. */
    private fun poll(webView: WebView, expression: String, timeoutMs: Long = 10_000): String {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val value = evaluate(webView, expression)
            if (value.isNotBlank() && value != "null") return value
            Thread.sleep(150)
        }
        return ""
    }

    private fun installTtsListeners(webView: WebView) {
        evaluate(
            webView,
            """
            window.__ttsEvents = [];
            window.__ttsReady = false;
            (async function () {
              var p = Capacitor.Plugins.LinguaTts;
              await p.addListener('start', function (e) { window.__ttsEvents.push('start:' + e.id); });
              await p.addListener('end', function (e) { window.__ttsEvents.push('end:' + e.id); });
              await p.addListener('fail', function (e) { window.__ttsEvents.push('fail:' + e.id); });
              window.__ttsReady = true;
            })();
            'installing'
            """.trimIndent(),
        )
        assertTrue("TTS listeners were not attached", poll(webView, "String(window.__ttsReady === true)") == "true")
    }

    private fun ttsAvailable(webView: WebView): Boolean {
        evaluate(
            webView,
            "window.__ttsAvailable = null; Capacitor.Plugins.LinguaTts.available().then(function (v) { window.__ttsAvailable = v.ready; }); 'asked'",
        )
        return poll(webView, "String(window.__ttsAvailable)", 15_000) == "true"
    }

    private fun ttsEvents(webView: WebView): String = evaluate(webView, "window.__ttsEvents.join(',')")

    /** Speak a text long enough that the voice is still going when the test stops it. */
    private fun speakLongText(webView: WebView) {
        val text = (
            "Good morning. This sentence is deliberately long so the voice is still speaking " +
                "when the app is asked to stop it. "
            ).repeat(4)
        evaluate(
            webView,
            "window.__speakResult = null; Capacitor.Plugins.LinguaTts.speak({text: ${jsStringLiteral(text)}, lang: 'en-US', rate: 0.5})" +
                ".then(function () { window.__speakResult = 'ok'; })" +
                ".catch(function (e) { window.__speakResult = 'ERR:' + (e && e.message ? e.message : e); }); 'started'",
        )
    }

    private fun firstStartEvent(webView: WebView): String {
        val events = poll(
            webView,
            "window.__ttsEvents.filter(function (s) { return s.indexOf('start:') === 0; }).join(',')",
            25_000,
        )
        return events.split(',').firstOrNull { it.startsWith("start:") } ?: ""
    }

    /**
     * A2-05: Android's TextToSpeech reports stop() through UtteranceProgressListener.onStop,
     * which the plugin did not override, so stopping a voice never told the web layer and
     * the speaking state stayed open. stop() must also be idempotent.
     */
    @Test
    fun nativeTtsStopEmitsOneEndAndIsIdempotent() {
        val (scenario, webView) = launch()
        scenario.use {
            org.junit.Assume.assumeTrue("device TTS has no English voice on this image", ttsAvailable(webView))
            installTtsListeners(webView)
            speakLongText(webView)
            val start = firstStartEvent(webView)
            org.junit.Assume.assumeTrue("device TTS did not start speaking (logcat has the engine status)", start.isNotEmpty())
            val id = start.removePrefix("start:")

            val stopped = promise(
                webView,
                "Capacitor.Plugins.LinguaTts.stop().then(function () { return 'stopped'; })",
            )
            assertTrue("the first stop() did not resolve: $stopped", stopped.contains("stopped"))
            val stoppedAgain = promise(
                webView,
                "Capacitor.Plugins.LinguaTts.stop().then(function () { return 'stopped'; })",
            )
            assertTrue("the second stop() did not resolve: $stoppedAgain", stoppedAgain.contains("stopped"))

            val end = poll(
                webView,
                "window.__ttsEvents.filter(function (s) { return s === 'end:' + ${jsStringLiteral(id)}; }).join(',')",
            )
            assertEquals(
                "the stopped utterance did not report an end once (events: ${ttsEvents(webView)})",
                "end:$id",
                end,
            )
            val ends = evaluate(
                webView,
                "String(window.__ttsEvents.filter(function (s) { return s === 'end:' + ${jsStringLiteral(id)}; }).length)",
            )
            assertEquals("stop() reported the same utterance more than once", "1", ends)
        }
    }

    /**
     * A2-05: backgrounding stops the synthesiser in handleOnPause. The web layer used to be
     * left with an open speaking state because the pause-stop emitted nothing; it must be
     * told the utterance ended even though it did not call stop().
     */
    @Test
    fun nativeTtsBackgroundingReportsEndForTheActiveUtterance() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        lateinit var webView: WebView
        scenario.onActivity { activity -> webView = (activity as BridgeActivity).bridge.webView }
        try {
            waitForBridge(webView)
            org.junit.Assume.assumeTrue("device TTS has no English voice on this image", ttsAvailable(webView))
            installTtsListeners(webView)
            speakLongText(webView)
            val start = firstStartEvent(webView)
            org.junit.Assume.assumeTrue("device TTS did not start speaking", start.isNotEmpty())
            val id = start.removePrefix("start:")

            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED)
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)

            val end = poll(
                webView,
                "window.__ttsEvents.filter(function (s) { return s === 'end:' + ${jsStringLiteral(id)}; }).join(',')",
                10_000,
            )
            assertEquals(
                "backgrounding did not report the stopped utterance (events: ${ttsEvents(webView)})",
                "end:$id",
                end,
            )
        } finally {
            scenario.close()
        }
    }

    /**
     * A2-05: storage work that was queued when the bridge is destroyed must not reopen Room
     * after teardown, reject on a dead bridge, or leave the next bridge unable to open the
     * store. The new bridge has to answer boot()/settingsAll() again.
     */
    @Test
    fun storageWorkQueuedAtTeardownLeavesTheStoreReopenable() {
        val first = ActivityScenario.launch(MainActivity::class.java)
        lateinit var firstWebView: WebView
        first.onActivity { activity -> firstWebView = (activity as BridgeActivity).bridge.webView }
        waitForBridge(firstWebView)
        evaluate(
            firstWebView,
            "for (var i = 0; i < 40; i++) { Capacitor.Plugins.LinguaStore.settingsWrite({key: 'lingua.test.teardown', value: String(i)}); } 'queued'",
        )
        first.close()

        val (second, secondWebView) = launch()
        second.use {
            val all = promise(secondWebView, "Capacitor.Plugins.LinguaStore.settingsAll()")
            assertTrue("storage did not reopen after teardown: $all", all.contains("\"values\""))
            val removed = promise(
                secondWebView,
                "Capacitor.Plugins.LinguaStore.settingsRemove({key: 'lingua.test.teardown'})",
            )
            assertTrue("settingsRemove failed: $removed", removed.contains("\"ok\":true"))
        }
    }

    /**
     * The lead-owned manifest declares ACCESS_COARSE_LOCATION only, and the patched
     * Capacitor WebChromeClient requests exactly that. The WebView must get past the
     * permission gate with coarse alone (code 1 = PERMISSION_DENIED must not appear);
     * a missing emulator location fix (code 2/3) is a device limit, not a denial.
     */
    @Test
    fun coarseOnlyGeolocationIsAccepted() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext
        instrumentation.uiAutomation.grantRuntimePermission(
            app.packageName,
            android.Manifest.permission.ACCESS_COARSE_LOCATION,
        )
        val (scenario, webView) = launch()
        scenario.use {
            evaluate(
                webView,
                "window.__geo = null; navigator.geolocation.getCurrentPosition(" +
                    "function (p) { window.__geo = {ok: true, accuracy: p.coords.accuracy}; }, " +
                    "function (e) { window.__geo = {ok: false, code: e.code, message: e.message}; }, " +
                    "{timeout: 15000, enableHighAccuracy: false}); 'started'",
            )
            val geo = poll(webView, "window.__geo ? JSON.stringify(window.__geo) : ''", 25_000)
            assertTrue("no geolocation answer: '$geo'", geo.isNotEmpty())
            assertFalse(
                "geolocation was denied with only ACCESS_COARSE_LOCATION granted: $geo",
                geo.contains("\"code\":1"),
            )
        }
    }
}
