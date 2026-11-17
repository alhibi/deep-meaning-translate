package today.fluently.app.bridge

/**
 * The one Android-TTS utterance the web layer is listening to.
 *
 * The engine reports start/done/error from its own thread and can still deliver an event
 * for an utterance the app already stopped, replaced or destroyed. The web layer owns one
 * utterance at a time (see `src/lib/tts.ts`): a late "end" from a replaced utterance would
 * end the new one in the UI while it is still speaking, and a stopped utterance must be
 * reported once so the screen can leave its speaking state (Android's `stop()` reports
 * `onStop`, whose default implementation is empty — it is not an "end" event by itself).
 *
 * A tiny synchronized state object rather than extra plugin state: the callbacks arrive on
 * the TTS thread while `stop`/`speak` arrive on the bridge thread, so every transition
 * happens under one lock and each utterance is reported at most once.
 */
internal class UtteranceTracker {
    private var current: String? = null

    /** Make [id] the only utterance whose events are reported. */
    @Synchronized
    fun begin(id: String) {
        current = id
    }

    /** True while [id] is the active utterance; leaves the tracker untouched. */
    @Synchronized
    fun isCurrent(id: String?): Boolean = id != null && id == current

    /**
     * Clear [id] if it is the active utterance and report whether it was.
     * Returns false for an already finished/replaced utterance, so its late callback is
     * dropped instead of being delivered to the next utterance's listeners.
     */
    @Synchronized
    fun finish(id: String?): Boolean {
        if (id == null || id != current) return false
        current = null
        return true
    }

    /** Clear the active utterance and return it, or null when nothing was active. */
    @Synchronized
    fun cancel(): String? = current.also { current = null }
}
