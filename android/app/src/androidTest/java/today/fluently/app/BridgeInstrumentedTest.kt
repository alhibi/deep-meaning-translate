package today.fluently.app

import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.getcapacitor.BridgeActivity
import org.json.JSONObject
import org.junit.Assert.assertEquals
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
}
