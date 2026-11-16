package today.fluently.app.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A real upgrade, not a destructive reset: a version-1 database with a row is opened by
 * version 2 through MIGRATION_1_2, and the row survives with a usable merge key.
 *
 * The v1 tables are created directly here because v1 was the pre-normalization schema;
 * this is the exact shape the migration must accept.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MigrationTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun createV1(name: String): SQLiteDatabase {
        val file = context.getDatabasePath(name)
        file.parentFile?.mkdirs()
        if (file.exists()) file.delete()
        val db = SQLiteDatabase.openOrCreateDatabase(file, null)
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `history_entries` (" +
                "`id` TEXT NOT NULL, `source` TEXT NOT NULL, `target` TEXT NOT NULL, " +
                "`original` TEXT NOT NULL, `translated` TEXT NOT NULL, " +
                "`created_at` INTEGER NOT NULL, `updated_at` INTEGER NOT NULL, " +
                "`uses` INTEGER NOT NULL, `style` TEXT, `formality` TEXT, `situation` TEXT, " +
                "`tags_json` TEXT, `fix_json` TEXT, `version` INTEGER NOT NULL, PRIMARY KEY(`id`))"
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_history_entries_created_at` ON `history_entries` (`created_at`)")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_history_entries_updated_at` ON `history_entries` (`updated_at`)")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_history_entries_target` ON `history_entries` (`target`)")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `saved_phrases` (" +
                "`id` TEXT NOT NULL, `source` TEXT NOT NULL, `target` TEXT NOT NULL, " +
                "`original` TEXT NOT NULL, `translated` TEXT NOT NULL, " +
                "`created_at` INTEGER NOT NULL, `known` INTEGER NOT NULL, " +
                "`reviewed_at` INTEGER NOT NULL, PRIMARY KEY(`id`))"
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_saved_phrases_created_at` ON `saved_phrases` (`created_at`)")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `memory_rows` (" +
                "`cache_key` TEXT NOT NULL, `payload` TEXT NOT NULL, " +
                "`created_at` INTEGER NOT NULL, PRIMARY KEY(`cache_key`))"
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `session_state` (" +
                "`id` INTEGER NOT NULL, `json` TEXT, `seq` INTEGER NOT NULL, " +
                "`updated_at` INTEGER NOT NULL, PRIMARY KEY(`id`))"
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `import_meta` (" +
                "`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `fileName` TEXT, `digest` TEXT, " +
                "`mode` TEXT NOT NULL, `imported_at` INTEGER NOT NULL, " +
                "`added` INTEGER NOT NULL, `skipped` INTEGER NOT NULL)"
        )
        db.execSQL(
            "INSERT INTO history_entries (id, source, target, original, translated, created_at, " +
                "updated_at, uses, version) VALUES ('row-1', 'de', 'ar', ' Hallo  Welt ', 'مرحبا', 123, 123, 1, 2)"
        )
        db.version = 1
        db.close()
        return SQLiteDatabase.openOrCreateDatabase(file, null)
    }

    @Test
    fun `v1 rows survive the v2 migration with a normalized merge key`() = runBlocking {
        val name = "migration-test.db"
        createV1(name).close()
        val room = Room.databaseBuilder(context, LinguaDatabase::class.java, name)
            .addMigrations(LinguaDatabase.MIGRATION_1_2)
            .allowMainThreadQueries()
            .build()
        val rows = room.history().all()
        assertThat(rows).hasSize(1)
        val row = rows.first()
        assertThat(row.id).isEqualTo("row-1")
        assertThat(row.original).isEqualTo(" Hallo  Welt ")
        assertThat(row.normalized).isEqualTo("Hallo Welt")
        assertThat(row.translated).isEqualTo("مرحبا")
        // The archive's duplicate rule now answers from the index, not from JavaScript.
        assertThat(room.history().candidates("ar", "Hallo Welt", 0)).hasSize(1)
        room.close()
    }
}
