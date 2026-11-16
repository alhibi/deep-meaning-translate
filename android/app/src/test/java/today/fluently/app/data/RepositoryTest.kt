package today.fluently.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Storage contract tests. They run on the JVM with Robolectric, so every build (and CI)
 * proves the merge, trim, session guard and import transaction without a device.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RepositoryTest {
    private lateinit var context: Context
    private lateinit var db: LinguaDatabase
    private lateinit var repo: LinguaRepository
    private lateinit var settings: SettingsStore

    @Before
    fun setUp() = runTest {
        context = ApplicationProvider.getApplicationContext()
        settings = SettingsStore(context)
        settings.clear()
        db = Room.inMemoryDatabaseBuilder(context, LinguaDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repo = LinguaRepository(db, settings)
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun row(
        id: String,
        original: String,
        createdAt: Long,
        target: String = "ar",
        translated: String = "ترجمة $id",
    ) = HistoryEntity(
        id = id,
        source = "de",
        target = target,
        original = original,
        translated = translated,
        normalized = Mapping.normalize(original),
        createdAt = createdAt,
        updatedAt = createdAt,
        uses = 1,
    )

    @Test
    fun `a stale session save never replaces a newer one`() = runTest {
        assertThat(repo.putSession("""{"text":"new"}""", 200)).isTrue()
        assertThat(repo.putSession("""{"text":"old"}""", 100)).isFalse()
        val stored = JSONObject(repo.boot().session!!)
        assertThat(stored.getString("text")).isEqualTo("new")
    }

    @Test
    fun `history trim keeps the newest rows`() = runTest {
        repo.historyUpsert((1..5).map { row("id$it", "Satz $it", it.toLong()) })
        repo.historyTrim(2)
        val rows = repo.historyAll()
        assertThat(rows).hasSize(2)
        assertThat(rows.map { it.id }).containsExactly("id5", "id4")
    }

    @Test
    fun `candidates find the exact sentence and recent neighbours, nothing older`() = runTest {
        repo.historyUpsert(
            listOf(
                row("exact", "Guten Tag", 1_000),
                row("recent", "Guten Tag zusammen", 2_000),
                row("old", "Guten", 10),
            )
        )
        val hits = repo.historyCandidates("ar", Mapping.normalize("Guten Tag"), 1_500)
        assertThat(hits.map { it.id }).containsExactly("exact", "recent")
    }

    @Test
    fun `history upsert updates in place and keeps the archive bounded`() = runTest {
        repo.historyUpsert(listOf(row("same", "Hallo", 100)))
        repo.historyUpsert(listOf(row("same", "Hallo", 100, translated = "مرحبا")))
        val rows = repo.historyAll()
        assertThat(rows).hasSize(1)
        assertThat(rows.first().translated).isEqualTo("مرحبا")
    }

    @Test
    fun `replaceAll writes records and settings, and clearAll removes both`() = runTest {
        val dataset = JSONObject()
            .put(
                "settings",
                JSONObject().put("lingua.theme.v1", "light").put("lingua.ui-locale", "ar"),
            )
            .put("prefs", JSONObject().put("source", "de").put("target", "ar").put("style", "natural"))
            .put(
                "session",
                JSONObject().put("text", "Hallo").put("source", "de").put("target", "ar")
                    .put("style", "natural").put("result", JSONObject.NULL),
            )
            .put(
                "history",
                JSONArray().put(
                    JSONObject()
                        .put("id", "h1").put("source", "de").put("target", "ar")
                        .put("original", "Hallo").put("translated", "مرحبا")
                        .put("createdAt", 10).put("updatedAt", 10).put("uses", 1),
                ),
            )
            .put("saved", JSONArray())
            .put("memory", JSONArray())

        val report = repo.replaceAll(dataset, "replace", "backup.json", "abc")
        assertThat(report.getJSONObject("added").getInt("history")).isEqualTo(1)
        assertThat(repo.historyAll()).hasSize(1)
        assertThat(settings.get("lingua.theme.v1")).isEqualTo("light")

        val snapshot = repo.snapshot()
        assertThat(snapshot.getJSONObject("settings").getString("lingua.theme.v1")).isEqualTo("light")
        assertThat(snapshot.getJSONArray("history").length()).isEqualTo(1)

        repo.clearAll()
        assertThat(repo.historyAll()).isEmpty()
        assertThat(settings.get("lingua.theme.v1")).isNull()
    }

    @Test
    fun `invalid rows are refused before they reach the database`() {
        assertThat(Mapping.historyFromJson(JSONObject().put("id", ""))).isNull()
        assertThat(
            Mapping.historyFromJson(
                JSONObject()
                    .put("id", "x").put("source", "de").put("target", "english")
                    .put("original", "Hallo").put("translated", "مرحبا").put("createdAt", 1),
            ),
        ).isNull()
        assertThat(
            Mapping.historyFromJson(
                JSONObject()
                    .put("id", "x").put("source", "de").put("target", "ar")
                    .put("original", "Hallo").put("translated", "مرحبا").put("createdAt", 0),
            ),
        ).isNull()
        val valid = Mapping.historyFromJson(
            JSONObject()
                .put("id", "x").put("source", "de").put("target", "ar")
                .put("original", "  Hallo   Welt ").put("translated", "مرحبا").put("createdAt", 1),
        )
        assertThat(valid?.normalized).isEqualTo("Hallo Welt")
    }

    @Test
    fun `a settings write outside the lingua namespace is refused`() = runTest {
        assertThat(repo.settingsPut("other.key", "x")).isFalse()
        assertThat(repo.settingsPut("lingua.theme.v1", "vivid")).isTrue()
        assertThat(repo.settingsAll()["lingua.theme.v1"]).isEqualTo("vivid")
    }
}
