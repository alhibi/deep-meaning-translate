package today.fluently.app.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * JSON ↔ Room mapping, validated on both directions.
 *
 * The bridge carries JSON because the app's own validators are the single definition of
 * what a row is. Kotlin still refuses anything that could corrupt the database: a row
 * without an id, a target that is not a language code, a time that is not a time. Nothing
 * here logs a translation.
 */
object Mapping {
    const val MAX_TEXT = 5000
    private const val MAX_JSON = 400_000
    private val LANG = Regex("^[a-z]{2}$")
    private val SOURCE = Regex("^([a-z]{2}|auto)$")

    fun normalize(value: String): String = value.trim().replace(Regex("\\s+"), " ")

    fun historyFromJson(o: JSONObject): HistoryEntity? {
        val id = o.optString("id")
        if (id.isBlank() || id.length > 128) return null
        val original = o.optString("original").take(MAX_TEXT)
        val translated = o.optString("translated").take(MAX_TEXT)
        if (original.isBlank() || translated.isBlank()) return null
        val target = o.optString("target")
        if (!LANG.matches(target)) return null
        val source = o.optString("source").ifBlank { "auto" }
        if (!SOURCE.matches(source)) return null
        val createdAt = o.optLong("createdAt", -1)
        if (createdAt <= 0) return null
        val updatedAt = o.optLong("updatedAt", createdAt)
        val uses = o.optInt("uses", 1).coerceAtLeast(1)
        return HistoryEntity(
            id = id,
            source = source,
            target = target,
            original = original,
            translated = translated,
            normalized = normalize(original),
            createdAt = createdAt,
            updatedAt = if (updatedAt > 0) updatedAt else createdAt,
            uses = uses,
            style = o.optString("style").takeIf { it.isNotBlank() },
            formality = o.optString("formality").takeIf { it.isNotBlank() },
            situation = o.optString("situation").takeIf { it.isNotBlank() },
            tagsJson = o.optJSONObject("tags")?.toString(),
            fixJson = o.optJSONObject("fix")?.toString(),
            version = if (o.optInt("v", 0) == 2) 2 else 1,
        )
    }

    fun historyToJson(e: HistoryEntity): JSONObject = JSONObject().apply {
        put("id", e.id)
        put("source", e.source)
        put("target", e.target)
        put("original", e.original)
        put("translated", e.translated)
        put("createdAt", e.createdAt)
        if (e.version == 2) put("v", 2)
        put("updatedAt", e.updatedAt)
        put("uses", e.uses)
        e.style?.let { put("style", it) }
        e.formality?.let { put("formality", it) }
        e.situation?.let { put("situation", it) }
        e.tagsJson?.let { runCatching { put("tags", JSONObject(it)) } }
        e.fixJson?.let { runCatching { put("fix", JSONObject(it)) } }
    }

    fun savedFromJson(o: JSONObject): SavedPhraseEntity? {
        val id = o.optString("id")
        val original = o.optString("original").take(MAX_TEXT)
        val translated = o.optString("translated").take(MAX_TEXT)
        val target = o.optString("target")
        val source = o.optString("source").ifBlank { "auto" }
        val createdAt = o.optLong("createdAt", -1)
        if (id.isBlank() || original.isBlank() || translated.isBlank()) return null
        if (!LANG.matches(target) || !SOURCE.matches(source) || createdAt <= 0) return null
        return SavedPhraseEntity(
            id = id,
            source = source,
            target = target,
            original = original,
            translated = translated,
            normalized = normalize(original),
            createdAt = createdAt,
            known = o.optInt("known", 0).coerceAtLeast(0),
            reviewedAt = o.optLong("reviewedAt", 0).coerceAtLeast(0),
        )
    }

    fun savedToJson(p: SavedPhraseEntity): JSONObject = JSONObject().apply {
        put("id", p.id)
        put("source", p.source)
        put("target", p.target)
        put("original", p.original)
        put("translated", p.translated)
        put("createdAt", p.createdAt)
        put("known", p.known)
        put("reviewedAt", p.reviewedAt)
    }

    fun memoryFromJson(o: JSONObject): MemoryRowEntity? {
        val key = o.optString("k")
        val at = o.optLong("at", -1)
        val payload = o.optJSONObject("v") ?: return null
        if (key.isBlank() || at <= 0) return null
        val translation = payload.optString("translation")
        if (translation.isBlank()) return null
        val text = payload.toString()
        if (text.length > MAX_JSON) return null
        return MemoryRowEntity(cacheKey = key.take(2000), payload = text, createdAt = at)
    }

    fun memoryToJson(row: MemoryRowEntity): JSONObject? {
        val payload = runCatching { JSONObject(row.payload) }.getOrNull() ?: return null
        return JSONObject().apply {
            put("k", row.cacheKey)
            put("v", payload)
            put("at", row.createdAt)
        }
    }

    /** Prefs/session are stored verbatim, but only when they are parseable JSON of a sane size. */
    fun blobOrNull(json: String?): String? {
        if (json == null) return null
        if (json.length > MAX_JSON) return null
        return runCatching { JSONObject(json) }.getOrNull()?.toString()
    }

    fun array(json: String?): JSONArray? = runCatching { JSONArray(json ?: "[]") }.getOrNull()
}
