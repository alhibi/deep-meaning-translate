package today.fluently.app.bridge

import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import androidx.core.graphics.ColorUtils
import androidx.core.view.WindowCompat
import android.view.View
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Keeps the window background (the strip behind the status/navigation bars) equal to the
 * app's canvas colour.
 *
 * Capacitor's SystemBars pads the WebView for the system bars on WebView < 140. The padded
 * strip is the Activity window background, which used to be a fixed clay black — so the
 * paper-light theme showed black bars on every launch. The colour is computed by the web
 * layer from the active theme and validated here; nothing else crosses the bridge.
 */
@CapacitorPlugin(name = "LinguaChrome")
class LinguaChromePlugin : Plugin() {
    private val hex = Regex("^#[0-9a-fA-F]{6}$")
    private var pendingRepaint: Runnable? = null
    private var pendingDecor: View? = null

    companion object {
        /** Last canvas colour, so the Activity can repaint the strip after the splash theme. */
        @Volatile
        var lastColor: Int? = null
            private set
    }

    @PluginMethod
    fun setBackground(call: PluginCall) {
        val value = call.getString("color")?.trim()
        if (value == null || !hex.matches(value)) {
            call.reject("color")
            return
        }
        val activity = activity
        if (activity == null) {
            call.reject("chrome-unavailable")
            return
        }
        activity.runOnUiThread {
            try {
                val color = Color.parseColor(value)
                lastColor = color
                apply(activity, color)
                // The Android 12 splash applies postSplashScreenTheme asynchronously after
                // hide(); that restores the launch window background. Repaint once it has
                // certainly finished, so the strip matches the restored canvas too. Keep at
                // most one scheduled repaint and cancel it with the bridge.
                pendingRepaint?.let { pendingDecor?.removeCallbacks(it) }
                val decor = activity.window.decorView
                val repaint = object : Runnable {
                    override fun run() {
                        lastColor?.let { apply(activity, it) }
                        if (pendingRepaint === this) {
                            pendingRepaint = null
                            pendingDecor = null
                        }
                    }
                }
                pendingDecor = decor
                pendingRepaint = repaint
                decor.postDelayed(repaint, 4_000)
                call.resolve()
            } catch (error: Throwable) {
                call.reject("chrome-unavailable")
            }
        }
    }

    private fun apply(activity: Activity, color: Int) {
        activity.window.setBackgroundDrawable(ColorDrawable(color))
        // The WebView surface is resized on every IME open/close. Its default background is
        // white, so a dark-theme resize could flash a white frame; match it to the canvas.
        bridge?.webView?.setBackgroundColor(color)
        // The system bars are transparent (edge-to-edge) and their icon appearance must
        // follow the *app* palette, not the phone's day/night setting. Deriving it from the
        // canvas luminance keeps the status/navigation icons legible on paper, clay and vivid.
        val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        val darkIcons = ColorUtils.calculateLuminance(color) > 0.5
        controller.isAppearanceLightStatusBars = darkIcons
        controller.isAppearanceLightNavigationBars = darkIcons
    }

    override fun handleOnDestroy() {
        pendingRepaint?.let { pendingDecor?.removeCallbacks(it) }
        pendingRepaint = null
        pendingDecor = null
    }
}
