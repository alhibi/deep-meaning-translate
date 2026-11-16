package today.fluently.app.bridge

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

/**
 * Read a user-picked backup as one UTF-8 document.
 *
 * The bug this replaces decoded every 1 MiB buffer independently, so a multi-byte Arabic
 * or German character split across a read boundary became U+FFFD, the SHA-256 digest no
 * longer matched, and a perfectly valid backup was refused as "changed after export"
 * (A5-03). Decoding must happen once, after the whole (bounded) stream is read.
 */
object BackupReader {
    /** Matches the TS import cap: a backup is a small JSON document, never a media file. */
    const val MAX_BYTES = 8 * 1024 * 1024

    fun readUtf8(stream: InputStream): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var total = 0
        while (true) {
            val read = stream.read(buffer)
            if (read < 0) break
            total += read
            if (total > MAX_BYTES) throw IOException("backup too large")
            output.write(buffer, 0, read)
        }
        // One decode for the whole byte sequence: no split code points.
        return output.toByteArray().toString(Charsets.UTF_8)
    }
}
