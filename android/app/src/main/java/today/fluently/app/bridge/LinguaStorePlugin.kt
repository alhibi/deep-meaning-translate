package today.fluently.app.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import today.fluently.app.data.LinguaDatabase
import today.fluently.app.data.LinguaRepository
import today.fluently.app.data.Mapping
import today.fluently.app.data.SettingsStore

/**
 * The only bridge between the WebView and durable storage.
 *
 * Contracts:
 * - every call takes and returns JSON strings for collections, so one DTO version is
 *   explicit on both sides and no JS object is shared by reference;
 * - every call fails with a short, non-sensitive message; the app maps it to a calm
 *   state and keeps working in memory;
 * - all work happens on the IO dispatcher: SQLite never touches the main thread.
 */
@CapacitorPlugin(name = "LinguaStore")
class LinguaStorePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    /**
     * One operation at a time. The session had its own mutex, but whole-document writes
     * (phrasebook, memory, import) were independent coroutines and could land out of order,
     * so a stale list could overwrite a newer one (A3-04). Serializing the whole bridge
     * keeps arrival order = commit order; the work is small and already off the main thread.
     */
    private val operations = Mutex()
    private var database: LinguaDatabase? = null
    private var repo: LinguaRepository? = null
    private var initError: String? = null
    /**
     * Teardown is not reversible. It is set under the same lock that opens the database, so
     * a queued coroutine can never open a new Room database after the bridge is gone — the
     * old code cancelled the scope but a coroutine already past its last suspension point
     * could still call repository() and leak an open database for the rest of the process.
     */
    @Volatile
    private var destroyed = false

    /**
     * Open the database on the first real call, never in `load()`.
     *
     * `load()` runs while Capacitor is still wiring the bridge; opening Room and
     * DataStore there makes plugin availability depend on initialization order. Lazy
     * opening happens on the IO dispatcher, with the bridge fully alive.
     */
    private fun repository(): LinguaRepository {
        synchronized(this) {
            // Teardown and lazy opening share this lock, so a coroutine that was already
            // queued when the bridge died cannot reopen Room after handleOnDestroy closed it.
            check(!destroyed) { "storage-destroyed" }
            repo?.let { return it }
            try {
                val db = LinguaDatabase.open(context)
                database = db
                val settings = SettingsStore(context)
                val opened = LinguaRepository(db, settings)
                repo = opened
                initError = null
                return opened
            } catch (error: Throwable) {
                initError = "storage-init"
                throw IllegalStateException(initError)
            }
        }
    }

    /**
     * Idempotent teardown: cancel first (no new work is scheduled), then close the one open
     * database exactly once. Nothing resolves or rejects after this point — the WebView is
     * being torn down, so a late call.resolve() has no listener to answer.
     */
    override fun handleOnDestroy() {
        val openDatabase = synchronized(this) {
            if (destroyed) return
            destroyed = true
            val db = database
            database = null
            repo = null
            db
        }
        scope.cancel()
        openDatabase?.let { db -> runCatching { db.close() } }
    }
    private inline fun run(call: PluginCall, crossinline block: suspend (LinguaRepository) -> JSObject) {
        if (destroyed) {
            call.reject("device storage unavailable")
            return
        }
        scope.launch {
            operations.withLock {
                try {
                    if (destroyed) return@withLock
                    val result = block(repository())
                    if (!destroyed) call.resolve(result)
                } catch (error: CancellationException) {
                    // Teardown, not a storage failure: never turn cancellation into a reject
                    // on a bridge that is already gone.
                    throw error
                } catch (error: Throwable) {
                    // Never include SQL, values or stack traces in the message a person can see.
                    if (!destroyed) call.reject("device storage unavailable")
                }
            }
        }
    }

    @PluginMethod
    fun boot(call: PluginCall) = run(call) { repository ->
        val boot = repository.boot()
        val history = JSONArray()
        boot.history.forEach { history.put(Mapping.historyToJson(it)) }
        val saved = JSONArray()
        boot.saved.forEach { saved.put(Mapping.savedToJson(it)) }
        val memory = JSONArray()
        boot.memory.forEach { row -> Mapping.memoryToJson(row)?.let { memory.put(it) } }
        val settings = JSONObject()
        boot.settings.forEach { (key, value) -> settings.put(key, value) }
        JSObject()
            .put("settings", settings.toString())
            .put("prefs", boot.prefs)
            .put("session", boot.session)
            .put("history", history.toString())
            .put("historyTotal", boot.historyTotal)
            .put("saved", saved.toString())
            .put("memory", memory.toString())
            .put("sessionSeq", boot.sessionSeq)
            .put("schemaVersion", LinguaDatabase.VERSION)
    }

    @PluginMethod
    fun settingsWrite(call: PluginCall) = run(call) { repository ->
        val key = call.getString("key") ?: return@run JSObject().put("ok", false)
        val value = call.getString("value") ?: return@run JSObject().put("ok", false)
        JSObject().put("ok", repository.settingsPut(key, value))
    }

    @PluginMethod
    fun settingsRemove(call: PluginCall) = run(call) { repository ->
        val key = call.getString("key") ?: return@run JSObject().put("ok", false)
        JSObject().put("ok", repository.settingsRemove(key))
    }

    @PluginMethod
    fun settingsAll(call: PluginCall) = run(call) { repository ->
        val values = JSONObject()
        repository.settingsAll().forEach { (key, value) -> values.put(key, value) }
        JSObject().put("values", values.toString())
    }

    @PluginMethod
    fun prefsWrite(call: PluginCall) = run(call) { repository ->
        JSObject().put("ok", repository.putPrefs(call.getString("json")))
    }

    @PluginMethod
    fun sessionWrite(call: PluginCall) = run(call) { repository ->
        // Epoch-millisecond stamps arrive as a JSON Long, and PluginCall.getDouble refuses
        // Long values. The old getDouble fallback silently produced seq=0, so the repository
        // rejected every draft save and the session table stayed empty (A2-01).
        val seq = call.getLong("seq") ?: 0L
        JSObject().put("ok", repository.putSession(call.getString("json"), seq))
    }

    @PluginMethod
    fun historyPage(call: PluginCall) = run(call) { repository ->
        val limit = call.getInt("limit") ?: 50
        val offset = call.getInt("offset") ?: 0
        val (rows, total) = repository.historyPage(limit, offset)
        val json = JSONArray()
        rows.forEach { json.put(Mapping.historyToJson(it)) }
        JSObject().put("rows", json.toString()).put("total", total)
    }

    @PluginMethod
    fun historyCandidates(call: PluginCall) = run(call) { repository ->
        val target = call.getString("target") ?: ""
        val normalized = call.getString("normalized") ?: ""
        // Same Long-vs-Double trap as sessionWrite; a silent 0 would merge unrelated rows.
        val recentSince = call.getLong("recentSince") ?: 0L
        val rows = repository.historyCandidates(target, normalized, recentSince)
        val json = JSONArray()
        rows.forEach { json.put(Mapping.historyToJson(it)) }
        JSObject().put("rows", json.toString())
    }

    @PluginMethod
    fun historyUpsert(call: PluginCall) = run(call) { repository ->
        val raw = Mapping.array(call.getString("rows"))
        val rows = ArrayList<today.fluently.app.data.HistoryEntity>()
        if (raw != null) {
            for (i in 0 until raw.length()) {
                raw.optJSONObject(i)?.let { Mapping.historyFromJson(it)?.let(rows::add) }
            }
        }
        JSObject().put("total", repository.historyUpsert(rows))
    }

    @PluginMethod
    fun historyDelete(call: PluginCall) = run(call) { repository ->
        val ids = ArrayList<String>()
        val raw = Mapping.array(call.getString("ids"))
        if (raw != null) for (i in 0 until raw.length()) raw.optString(i).let { if (it.isNotBlank()) ids.add(it) }
        repository.historyDelete(ids)
        JSObject().put("ok", true)
    }

    @PluginMethod
    fun historyAll(call: PluginCall) = run(call) { repository ->
        val json = JSONArray()
        repository.historyAll().forEach { json.put(Mapping.historyToJson(it)) }
        JSObject().put("rows", json.toString())
    }

    @PluginMethod
    fun historyClear(call: PluginCall) = run(call) { repository ->
        repository.historyClear()
        JSObject().put("ok", true)
    }

    @PluginMethod
    fun savedWrite(call: PluginCall) = run(call) { repository ->
        val raw = Mapping.array(call.getString("rows"))
        val rows = ArrayList<today.fluently.app.data.SavedPhraseEntity>()
        if (raw != null) {
            for (i in 0 until raw.length()) {
                raw.optJSONObject(i)?.let { Mapping.savedFromJson(it)?.let(rows::add) }
            }
        }
        repository.savedWrite(rows)
        JSObject().put("ok", true)
    }

    @PluginMethod
    fun memoryWrite(call: PluginCall) = run(call) { repository ->
        val raw = Mapping.array(call.getString("rows"))
        val rows = ArrayList<today.fluently.app.data.MemoryRowEntity>()
        if (raw != null) {
            for (i in 0 until raw.length()) {
                raw.optJSONObject(i)?.let { Mapping.memoryFromJson(it)?.let(rows::add) }
            }
        }
        repository.memoryWrite(rows)
        JSObject().put("ok", true)
    }

    /**
     * Read every backup field under the plugin's operation lock. Calling the individual
     * endpoints from JavaScript allowed a save to split one export into two time slices.
     */
    @PluginMethod
    fun snapshot(call: PluginCall) = run(call) { repository ->
        JSObject().put("data", repository.snapshot().toString())
    }

    @PluginMethod
    fun replaceAll(call: PluginCall) = run(call) { repository ->
        val json = call.getString("json") ?: return@run JSObject().put("report", "null")
        val dataset = JSONObject(json)
        val report = repository.replaceAll(
            dataset = dataset,
            mode = call.getString("mode") ?: "merge",
            fileName = call.getString("fileName"),
            digest = call.getString("digest"),
            reportJson = call.getString("report"),
        )
        JSObject().put("report", report.toString())
    }

    @PluginMethod
    fun clearAll(call: PluginCall) = run(call) { repository ->
        repository.clearAll()
        JSObject().put("ok", true)
    }
}
