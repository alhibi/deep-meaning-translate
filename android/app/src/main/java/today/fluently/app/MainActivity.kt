package today.fluently.app

import android.os.Bundle
import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity
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
        registerPlugin(LinguaTtsPlugin::class.java)
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
    }
}
