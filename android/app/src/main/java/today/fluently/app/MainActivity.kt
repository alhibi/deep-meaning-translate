package today.fluently.app

import android.os.Bundle
import android.webkit.WebView
import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity
import today.fluently.app.bridge.LinguaChromePlugin
import today.fluently.app.bridge.LinguaFilesPlugin
import today.fluently.app.bridge.LinguaStorePlugin
import today.fluently.app.bridge.LinguaTtsPlugin

/**
 * The Android shell around the packaged translator.
 *
 * - plugins are registered before `super.onCreate`, as Capacitor requires;
 * - the system bars are transparent and the content draws behind them: the web shell
 *   already reserves safe areas with `env(safe-area-inset-*)`, so the canvas reaches the
 *   edges without hiding the text under a cutout;
 * - the splash screen is hidden by the web layer after it restores theme, direction,
 *   draft and archive (`src/lib/platform.ts`), never by a timer.
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(LinguaStorePlugin::class.java)
        registerPlugin(LinguaFilesPlugin::class.java)
        registerPlugin(LinguaChromePlugin::class.java)
        registerPlugin(LinguaTtsPlugin::class.java)
        super.onCreate(savedInstanceState)
        // Release builds keep the tracked capacitor config false. Debug builds are
        // debuggable by Gradle, so allow chrome://inspect there without ever shipping it.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        WindowCompat.setDecorFitsSystemWindows(window, false)
    }

    override fun onResume() {
        super.onResume()
        // Reapply the canvas-coloured strip if the window background was reset while we
        // were away (splash exit, theme recreation, OEM launcher transitions).
        LinguaChromePlugin.lastColor?.let { color ->
            window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(color))
        }
    }
}
