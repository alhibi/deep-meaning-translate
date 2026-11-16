package today.fluently.app.bridge

import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
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
                // certainly finished, so the strip matches the restored canvas too.
                activity.window.decorView.postDelayed(
                    { lastColor?.let { apply(activity, it) } },
                    4_000,
                )
                call.resolve()
            } catch (error: Throwable) {
                call.reject("chrome-unavailable")
            }
        }
    }

    private fun apply(activity: Activity, color: Int) {
        activity.window.setBackgroundDrawable(ColorDrawable(color))
    }
}
