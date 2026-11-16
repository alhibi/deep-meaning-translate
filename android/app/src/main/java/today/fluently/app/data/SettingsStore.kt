package today.fluently.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

/**
 * Preferences DataStore for the small values: theme, interface locale, the last language
 * pair, dialect, voice, touch feedback, favourites and the intro gate.
 *
 * Keys are the app's existing `lingua.*` storage keys, so the web's validators and the
 * backup whitelist keep working unchanged. Values are strings for the same reason: the
 * app already knows how to validate each one.
 */
private val Context.linguaDataStore by preferencesDataStore(name = "lingua_settings")

class SettingsStore(private val context: Context) {
    suspend fun all(): Map<String, String> {
        val prefs = context.linguaDataStore.data.first()
        val out = LinkedHashMap<String, String>()
        for ((key, value) in prefs.asMap()) {
            if (value is String) out[key.name] = value
        }
        return out
    }

    suspend fun get(key: String): String? =
        context.linguaDataStore.data.first()[stringPreferencesKey(key)]

    suspend fun put(key: String, value: String) {
        context.linguaDataStore.edit { it[stringPreferencesKey(key)] = value }
    }

    suspend fun remove(key: String) {
        context.linguaDataStore.edit { it.remove(stringPreferencesKey(key)) }
    }

    /** Replace every setting in one DataStore transaction (used by a Replace import). */
    suspend fun replaceAll(values: Map<String, String>) {
        context.linguaDataStore.edit { prefs ->
            for (key in prefs.asMap().keys) prefs.remove(key)
            for ((key, value) in values) prefs[stringPreferencesKey(key)] = value
        }
    }

    suspend fun clear() {
        context.linguaDataStore.edit { it.clear() }
    }
}
