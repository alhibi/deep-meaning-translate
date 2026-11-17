package today.fluently.app.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A2-05 regression: the TTS bridge used to broadcast every engine callback to every JS
 * listener. A late event for a stop()ped/replaced utterance could end the next utterance
 * in the UI while it was still speaking, and a stop()ed utterance never reported an end
 * at all. The tracker is the single place those transitions are decided.
 */
class UtteranceTrackerTest {
    @Test
    fun `a replaced utterance cannot report an event for the new one`() {
        val tracker = UtteranceTracker()
        tracker.begin("a")
        tracker.begin("b")

        assertFalse("late end for the replaced utterance", tracker.finish("a"))
        assertTrue("the active utterance still ends", tracker.finish("b"))
    }

    @Test
    fun `an utterance is reported at most once`() {
        val tracker = UtteranceTracker()
        tracker.begin("a")

        assertTrue(tracker.finish("a"))
        assertFalse("a duplicate end must be dropped", tracker.finish("a"))
        assertFalse("a callback for an unknown id must be dropped", tracker.finish("unknown"))
        assertNull(tracker.cancel())
    }

    @Test
    fun `cancel reports the active utterance exactly once`() {
        val tracker = UtteranceTracker()
        tracker.begin("a")

        assertEquals("a", tracker.cancel())
        assertNull("a second stop is a no-op", tracker.cancel())
    }

    @Test
    fun `isCurrent ignores null and stale ids`() {
        val tracker = UtteranceTracker()
        tracker.begin("a")

        assertTrue(tracker.isCurrent("a"))
        assertFalse(tracker.isCurrent(null))
        assertFalse(tracker.isCurrent("b"))
    }

    @Test
    fun `a new utterance starts cleanly after cancel`() {
        val tracker = UtteranceTracker()
        tracker.begin("a")
        tracker.cancel()
        tracker.begin("b")

        assertFalse("the cancelled utterance stays closed", tracker.finish("a"))
        assertTrue(tracker.isCurrent("b"))
    }
}
