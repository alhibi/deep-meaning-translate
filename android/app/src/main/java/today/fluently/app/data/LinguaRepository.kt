package today.fluently.app.data

import androidx.room.withTransaction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * The one place Room and DataStore are read or written.
 *
 * Every method runs on the IO dispatcher. The session has a monotonic guard so a delayed
 * save cannot replace a newer draft. Import is a Room transaction plus a DataStore write,
 * with the previous dataset kept in memory as a compensating rollback if the second step
 * fails; the app never leaves a half-imported archive behind.
 */
class LinguaRepository(
    private val db: LinguaDatabase,
    private val settings: SettingsStore,
) {
    private val io = Dispatchers.IO
    private val sessionMutex = Mutex()

    data class Boot(
        val settings: Map<String, String>,
        val prefs: String?,
        val session: String?,
        val history: List<HistoryEntity>,
        val historyTotal: Int,
        val saved: List<SavedPhraseEntity>,
        val memory: List<MemoryRowEntity>,
    )

    suspend fun boot(recentLimit: Int = 400): Boot = withContext(io) {
        val all = settings.all()
        val prefs = all[PREFS_KEY]
        Boot(
            settings = all - PREFS_KEY,
            prefs = prefs,
            session = db.session().get()?.json,
            history = db.history().page(recentLimit.coerceIn(1, 500), 0),
            historyTotal = db.history().count(),
            saved = db.saved().all(),
            memory = db.memory().all(),
        )
    }

    suspend fun settingsAll(): Map<String, String> = withContext(io) { settings.all() }

    suspend fun settingsPut(key: String, value: String): Boolean = withContext(io) {
        if (!key.startsWith("lingua.") || key.length > 128 || value.length > 200_000) return@withContext false
        settings.put(key, value)
        true
    }

    suspend fun settingsRemove(key: String): Boolean = withContext(io) {
        if (!key.startsWith("lingua.")) return@withContext false
        settings.remove(key)
        true
    }

    suspend fun putPrefs(json: String?): Boolean = withContext(io) {
        val clean = Mapping.blobOrNull(json)
        if (json != null && clean == null) return@withContext false
        if (clean == null) settings.remove(PREFS_KEY) else settings.put(PREFS_KEY, clean)
        true
    }

    /**
     * A session save carries the writer's sequence stamp. Writes are serialised here and
     * rejected when they are older than what the device already holds, so a slow save
     * from a previous screen can never overwrite the current draft.
     */
    suspend fun putSession(json: String?, seq: Long): Boolean = withContext(io) {
        sessionMutex.withLock {
            val clean = Mapping.blobOrNull(json)
            if (json != null && clean == null) return@withLock false
            val current = db.session().get()
            if (current != null && seq <= current.seq) return@withLock false
            db.session().put(
                SessionEntity(json = clean, seq = seq, updatedAt = System.currentTimeMillis())
            )
            true
        }
    }

    suspend fun historyPage(limit: Int, offset: Int): Pair<List<HistoryEntity>, Int> =
        withContext(io) {
            val size = limit.coerceIn(1, 2000)
            db.history().page(size, offset.coerceAtLeast(0)) to db.history().count()
        }

    suspend fun historyAll(): List<HistoryEntity> = withContext(io) { db.history().all() }

    suspend fun historyCandidates(target: String, normalized: String, recentSince: Long) =
        withContext(io) {
            db.history().candidates(target, normalized, recentSince)
        }

    suspend fun historyUpsert(rows: List<HistoryEntity>): Int = withContext(io) {
        if (rows.isEmpty()) return@withContext db.history().count()
        db.withTransaction {
            db.history().upsert(rows)
            db.history().trim(HISTORY_LIMIT)
        }
        db.history().count()
    }

    suspend fun historyDelete(ids: List<String>) = withContext(io) {
        if (ids.isNotEmpty()) db.history().deleteByIds(ids)
    }

    suspend fun historyTrim(limit: Int) = withContext(io) {
        db.history().trim(limit.coerceIn(1, HISTORY_LIMIT))
    }

    suspend fun historyClear() = withContext(io) { db.history().clear() }

    suspend fun savedWrite(rows: List<SavedPhraseEntity>) = withContext(io) {
        db.withTransaction {
            db.saved().clear()
            if (rows.isNotEmpty()) db.saved().upsert(rows.take(SAVED_LIMIT))
        }
    }

    suspend fun memoryWrite(rows: List<MemoryRowEntity>) = withContext(io) {
        db.withTransaction {
            db.memory().clear()
            if (rows.isNotEmpty()) db.memory().upsert(rows.take(MEMORY_LIMIT))
        }
    }

    suspend fun savedAll(): List<SavedPhraseEntity> = withContext(io) { db.saved().all() }

    suspend fun memoryAll(): List<MemoryRowEntity> = withContext(io) { db.memory().all() }

    /** Everything, for a backup. Runs when Data settings is opened, never at boot. */
    suspend fun snapshot(): JSONObject = withContext(io) {
        val all = settings.all()
        val prefs = all[PREFS_KEY]
        JSONObject().apply {
            put("settings", JSONObject().apply {
                for ((k, v) in all) if (k != PREFS_KEY) put(k, v)
            })
            put("prefs", Mapping.blobOrNull(prefs).let { if (it == null) JSONObject.NULL else JSONObject(it) })
            put(
                "session",
                db.session().get()?.json?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject.NULL,
            )
            put("history", JSONArray().apply { db.history().all().forEach { put(Mapping.historyToJson(it)) } })
            put("saved", JSONArray().apply { db.saved().all().forEach { put(Mapping.savedToJson(it)) } })
            put(
                "memory",
                JSONArray().apply {
                    db.memory().all().forEach { row -> Mapping.memoryToJson(row)?.let { put(it) } }
                },
            )
        }
    }

    /**
     * Apply an already-merged dataset. `merge` was decided in TypeScript from a full
     * snapshot, so both modes converge here; the mode is recorded in import metadata.
     * Room is transactional; DataStore is written after it and reverted if it fails.
     */
    suspend fun replaceAll(
        dataset: JSONObject,
        mode: String,
        fileName: String?,
        digest: String?,
    ): JSONObject = withContext(io) {
        val previousSettings = settings.all()
        val previousHistory = db.history().all()
        val previousSaved = db.saved().all()
        val previousMemory = db.memory().all()
        val previousSession = db.session().get()

        val history = dataset.optJSONArray("history").rows().mapNotNull { Mapping.historyFromJson(it) }
        val saved = dataset.optJSONArray("saved").rows().mapNotNull { Mapping.savedFromJson(it) }
        val memory = dataset.optJSONArray("memory").rows().mapNotNull { Mapping.memoryFromJson(it) }
        val settingsJson = dataset.optJSONObject("settings")
        val newSettings = LinkedHashMap<String, String>()
        if (settingsJson != null) {
            for (key in settingsJson.keys()) {
                val value = settingsJson.optString(key)
                if (key.startsWith("lingua.") && value.isNotEmpty()) newSettings[key] = value
            }
        }
        val prefsJson = dataset.opt("prefs")
        if (prefsJson is JSONObject) newSettings[PREFS_KEY] = prefsJson.toString()
        val sessionJson = dataset.opt("session")
        val sessionValue = if (sessionJson is JSONObject) sessionJson.toString() else null

        try {
            db.withTransaction {
                db.history().clear()
                db.saved().clear()
                db.memory().clear()
                db.session().clear()
                if (history.isNotEmpty()) db.history().upsert(history)
                if (saved.isNotEmpty()) db.saved().upsert(saved)
                if (memory.isNotEmpty()) db.memory().upsert(memory)
                db.session().put(
                    SessionEntity(
                        json = sessionValue,
                        seq = System.currentTimeMillis(),
                        updatedAt = System.currentTimeMillis(),
                    )
                )
                db.history().trim(HISTORY_LIMIT)
            }
            settings.replaceAll(newSettings)
        } catch (error: Throwable) {
            runCatching {
                db.withTransaction {
                    db.history().clear(); db.saved().clear(); db.memory().clear(); db.session().clear()
                    if (previousHistory.isNotEmpty()) db.history().upsert(previousHistory)
                    if (previousSaved.isNotEmpty()) db.saved().upsert(previousSaved)
                    if (previousMemory.isNotEmpty()) db.memory().upsert(previousMemory)
                    previousSession?.let { db.session().put(it) }
                }
                settings.replaceAll(previousSettings)
            }
            throw error
        }

        db.imports().insert(
            ImportMetaEntity(
                fileName = fileName,
                digest = digest,
                mode = mode,
                importedAt = System.currentTimeMillis(),
                added = history.size,
                skipped = 0,
            )
        )

        JSONObject().apply {
            put("added", JSONObject().put("history", history.size).put("saved", saved.size)
                .put("memory", memory.size).put("settings", newSettings.size - 1))
            put("skipped", JSONObject().put("history", 0).put("saved", 0).put("memory", 0))
            put("replaced", true)
        }
    }

    /** The explicit "forget everything": records and settings, in one call. */
    suspend fun clearAll() = withContext(io) {
        db.withTransaction {
            db.history().clear()
            db.saved().clear()
            db.memory().clear()
            db.session().clear()
        }
        settings.clear()
    }

    private fun JSONArray?.rows(): List<JSONObject> {
        val out = ArrayList<JSONObject>()
        if (this == null) return out
        for (i in 0 until length()) optJSONObject(i)?.let { out.add(it) }
        return out
    }

    companion object {
        const val HISTORY_LIMIT = 2000
        const val SAVED_LIMIT = 300
        const val MEMORY_LIMIT = 120
        const val PREFS_KEY = "lingua.prefs.v1"
    }
}
