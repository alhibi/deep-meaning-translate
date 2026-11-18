package today.fluently.app.bridge

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
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
 *
 * Lifecycle contract (A2-05): every event is scoped to the one active utterance, a stop
 * is reported exactly once, and nothing is emitted or started after `handleOnDestroy`.
 * Android's `stop()` only reports `onStop` (the base implementation is empty), so an
 * un-overridden listener left the web layer believing a stopped voice was still speaking,
 * and a late event from a replaced utterance could end the next one.
 */
@CapacitorPlugin(name = "LinguaTts")
class LinguaTtsPlugin : Plugin(), TextToSpeech.OnInitListener {
    private val tracker = UtteranceTracker()
    private var tts: TextToSpeech? = null
    private var ready = false
    private var audioManager: AudioManager? = null
    private var focusRequest: AudioFocusRequest? = null
    private var hasFocus = false

    @Volatile
    private var destroyed = false

    override fun load() {
        destroyed = false
        ready = false
        tracker.cancel()
        // load() is called once per bridge, but keep it idempotent: a second engine would
        // keep audio focus after the bridge is gone.
        if (tts != null) return
        tts = TextToSpeech(context) { status -> onInit(status) }
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                if (!tracker.isCurrent(utteranceId)) return
                emit("start", utteranceId)
            }

            override fun onDone(utteranceId: String?) {
                if (!tracker.finish(utteranceId)) return
                dropAudioFocus()
                emit("end", utteranceId)
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                if (!tracker.finish(utteranceId)) return
                dropAudioFocus()
                emit("fail", utteranceId)
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
                if (!tracker.finish(utteranceId)) return
                dropAudioFocus()
                emit("fail", utteranceId)
            }

            // A queued utterance stopped by QUEUE_FLUSH or by stop()/pause reports here,
            // never through onDone; without this the JS speaking state stayed open.
            override fun onStop(utteranceId: String?, interrupted: Boolean) {
                if (!tracker.finish(utteranceId)) return
                dropAudioFocus()
                emit("end", utteranceId)
            }
        })
    }

    override fun onInit(status: Int) {
        // The engine may finish initialising after the bridge was destroyed.
        if (destroyed) return
        ready = status == TextToSpeech.SUCCESS
        if (ready) {
            // Speech routing/ducking needs speech attributes, not the media default.
            runCatching {
                tts?.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
            }
        }
    }

    /**
     * Transient focus with ducking: a voice must be heard over music without stopping it,
     * and it must release focus the moment the utterance ends. Without this, speech mixed
     * with other audio at full volume and no other player knew a voice was speaking.
     */
    private fun takeAudioFocus() {
        if (hasFocus || destroyed) return
        val manager =
            audioManager
                ?: (context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)?.also {
                    audioManager = it
                }
                ?: return
        val attributes =
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        hasFocus =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val request =
                    focusRequest
                        ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                            .setAudioAttributes(attributes)
                            .setOnAudioFocusChangeListener { }
                            .build()
                            .also { focusRequest = it }
                manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            } else {
                @Suppress("DEPRECATION")
                manager.requestAudioFocus(
                    null,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
                ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            }
    }

    private fun dropAudioFocus() {
        if (!hasFocus) return
        hasFocus = false
        val manager = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { manager.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            manager.abandonAudioFocus(null)
        }
    }

    /** Never touch a released bridge: a late engine callback must be dropped, not posted. */
    private fun emit(event: String, id: String?) {
        if (destroyed || id == null) return
        notifyListeners(event, JSObject().put("id", id))
    }

    @PluginMethod
    fun available(call: PluginCall) {
        call.resolve(JSObject().put("ready", ready && !destroyed))
    }

    @PluginMethod
    fun speak(call: PluginCall) {
        if (destroyed) {
            call.reject("tts-unavailable")
            return
        }
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
        // Register before speaking: onStart can fire before speak() returns.
        tracker.begin(id)
        takeAudioFocus()
        val queued = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
        if (queued == TextToSpeech.ERROR) {
            tracker.cancel()
            dropAudioFocus()
            call.reject("speak-failed")
        } else {
            call.resolve()
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val engine = tts
        val stopped = tracker.cancel()
        dropAudioFocus()
        if (!destroyed) {
            runCatching { engine?.stop() }
            // The web layer asked for silence; tell it the utterance is over once.
            emit("end", stopped)
        }
        call.resolve()
    }

    override fun handleOnPause() {
        // Backgrounding must not leave a voice talking to an empty room, and the web layer
        // must learn that the utterance ended even though it did not call stop().
        val stopped = tracker.cancel()
        dropAudioFocus()
        runCatching { tts?.stop() }
        emit("end", stopped)
    }

    override fun handleOnDestroy() {
        if (destroyed) return
        destroyed = true
        tracker.cancel()
        dropAudioFocus()
        focusRequest = null
        audioManager = null
        val engine = tts
        tts = null
        ready = false
        runCatching { engine?.stop() }
        runCatching { engine?.setOnUtteranceProgressListener(null) }
        runCatching { engine?.shutdown() }
    }
}
