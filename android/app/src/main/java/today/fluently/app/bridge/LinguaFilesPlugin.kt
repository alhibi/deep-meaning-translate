package today.fluently.app.bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.IOException

/**
 * Backup import and export through the Storage Access Framework.
 *
 * The app never asks for a broad storage permission: the person picks one document, and
 * Android grants access to exactly that file. Nothing is written into shared storage
 * silently, and the source file is never deleted after an import.
 */
@CapacitorPlugin(name = "LinguaFiles")
class LinguaFilesPlugin : Plugin() {

    @PluginMethod
    fun exportBackup(call: PluginCall) {
        val filename = call.getString("filename") ?: "today-backup.json"
        if (call.getString("content") == null) {
            call.reject("nothing to export")
            return
        }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, filename)
        }
        startActivityForResult(call, intent, "exportResult")
    }

    @ActivityCallback
    fun exportResult(call: PluginCall?, result: androidx.activity.result.ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(JSObject().put("saved", false))
            return
        }
        val uri: Uri = result.data?.data ?: return call.resolve(JSObject().put("saved", false))
        val content = call.getString("content") ?: return call.resolve(JSObject().put("saved", false))
        try {
            context.contentResolver.openOutputStream(uri, "wt")?.use { stream ->
                stream.write(content.toByteArray(Charsets.UTF_8))
                stream.flush()
            } ?: throw IOException("no stream")
            call.resolve(JSObject().put("saved", true).put("name", displayName(uri)))
        } catch (error: Exception) {
            call.reject("could not write the backup file")
        }
    }

    @PluginMethod
    fun pickBackup(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf("application/json", "text/plain", "application/octet-stream"),
            )
        }
        startActivityForResult(call, intent, "pickResult")
    }

    @ActivityCallback
    fun pickResult(call: PluginCall?, result: androidx.activity.result.ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(JSObject().put("content", null))
            return
        }
        val uri: Uri = result.data?.data ?: return call.resolve(JSObject().put("content", null))
        try {
            val text = context.contentResolver.openInputStream(uri)?.use { stream ->
                // A backup is a small JSON document; refuse anything that is not.
                val buffer = ByteArray(1 shl 20)
                val builder = StringBuilder()
                var total = 0
                while (true) {
                    val read = stream.read(buffer)
                    if (read <= 0) break
                    total += read
                    if (total > 8 * 1024 * 1024) throw IOException("too large")
                    builder.append(String(buffer, 0, read, Charsets.UTF_8))
                }
                builder.toString()
            }
            if (text == null) {
                call.resolve(JSObject().put("content", null))
            } else {
                call.resolve(JSObject().put("content", text).put("name", displayName(uri)))
            }
        } catch (error: Exception) {
            call.reject("could not read the backup file")
        }
    }

    private fun displayName(uri: Uri): String {
        return try {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else uri.lastPathSegment
            } ?: (uri.lastPathSegment ?: "backup.json")
        } catch (error: Exception) {
            uri.lastPathSegment ?: "backup.json"
        }
    }
}
