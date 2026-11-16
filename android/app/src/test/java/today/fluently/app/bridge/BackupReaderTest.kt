package today.fluently.app.bridge

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Regression for A5-03: the old reader decoded each 1 MiB buffer on its own, so a UTF-8
 * sequence split across two reads became two replacement characters and the backup's
 * SHA-256 digest no longer matched — a valid Arabic backup was rejected as tampered.
 */
class BackupReaderTest {
    /** Returns short reads so every multi-byte character can straddle a boundary. */
    private class TrickleStream(private val bytes: ByteArray, private val chunk: Int) : InputStream() {
        private var at = 0
        override fun read(): Int = if (at >= bytes.size) -1 else bytes[at++].toInt() and 0xff
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (at >= bytes.size) return -1
            val take = minOf(length, chunk, bytes.size - at)
            bytes.copyInto(buffer, offset, at, at + take)
            at += take
            return take
        }
    }

    @Test
    fun `multibyte text survives reads that split every character`() {
        val original = "{\"text\":\"طاب يومك، كيف حالك؟ Grüße aus Köln — ٣٧\"}"
        val bytes = original.toByteArray(Charsets.UTF_8)
        val decoded = BackupReader.readUtf8(TrickleStream(bytes, 1))
        assertEquals(original, decoded)
    }

    @Test
    fun `multibyte text survives a boundary at every possible split point`() {
        val original = "aطbيcü d€"
        val bytes = original.toByteArray(Charsets.UTF_8)
        for (chunk in 1..bytes.size) {
            assertEquals("chunk=$chunk", original, BackupReader.readUtf8(TrickleStream(bytes, chunk)))
        }
    }

    @Test
    fun `the import cap is enforced while streaming`() {
        val oversized = ByteArray(BackupReader.MAX_BYTES + 1) { 'a'.code.toByte() }
        assertThrows(IOException::class.java) {
            BackupReader.readUtf8(ByteArrayInputStream(oversized))
        }
    }
}
