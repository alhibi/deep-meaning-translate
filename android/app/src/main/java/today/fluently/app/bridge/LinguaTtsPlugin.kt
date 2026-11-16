package today.fluently.app.bridge

import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.Locale

/**
 * Android's own text-to-speech, used only as a fallback branch from `src/lib/tts.ts`.
 * Cloud voice (Gemini PCM, ElevenLabs timestamps) stays the primary path; this exists
 * for devices whose WebView has no speech synthesis at all.
 *
 * The engine is created once, stopped when the app leaves the foreground, and shut down
 * with the bridge — a synthesiser left running holds audio focus and drains the battery.
 */
@CapacitorPlugin(name = "LinguaTts")
class LinguaTtsPlugin : Plugin(), TextToSpeech.OnInitListener {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var current: String? = null

    override fun load() {
        tts = TextToSpeech(context) { status -> onInit(status) }
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                notifyListeners("start", JSObject().put("id", utteranceId))
            }

            override fun onDone(utteranceId: String?) {
                current = null
                notifyListeners("end", JSObject().put("id", utteranceId))
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                current = null
                notifyListeners("fail", JSObject().put("id", utteranceId))
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
                current = null
                notifyListeners("fail", JSObject().put("id", utteranceId))
            }
        })
    }

    override fun onInit(status: Int) {
        ready = status == TextToSpeech.SUCCESS
    }

    @PluginMethod
    fun available(call: PluginCall) {
        call.resolve(JSObject().put("ready", ready))
    }

    @PluginMethod
    fun speak(call: PluginCall) {
        val engine = tts
        val text = call.getString("text")
        if (!ready || engine == null) {
            call.reject("tts-unavailable")
            return
        }
        if (text.isNullOrBlank()) {
            call.reject("empty")
            return
        }
        val lang = call.getString("lang") ?: "en-US"
        val rate = (call.getDouble("rate") ?: 0.95).toFloat().coerceIn(0.5f, 2.0f)
        val locale = Locale.forLanguageTag(lang.replace('_', '-'))
        val result = engine.setLanguage(locale)
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            call.reject("language-unavailable")
            return
        }
        engine.setSpeechRate(rate)
        val id = "today-${System.nanoTime()}"
        current = id
        val queued = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
        if (queued == TextToSpeech.ERROR) call.reject("speak-failed") else call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        tts?.stop()
        current = null
        call.resolve()
    }

    override fun handleOnPause() {
        // Backgrounding must not leave a voice talking to an empty room.
        tts?.stop()
        current = null
    }

    override fun handleOnDestroy() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        ready = false
        current = null
    }
}
