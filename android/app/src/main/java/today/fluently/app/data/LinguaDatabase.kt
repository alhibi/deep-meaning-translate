package today.fluently.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * The device archive.
 *
 * There is no destructive fallback here, and there never should be: a schema change is a
 * migration with a test. Version 2 adds the normalized merge key (and its index) that
 * lets the archive's duplicate rule be answered by SQLite instead of by loading the whole
 * archive into JavaScript.
 */
@Database(
    entities = [
        HistoryEntity::class,
        SavedPhraseEntity::class,
        MemoryRowEntity::class,
        SessionEntity::class,
        ImportMetaEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
abstract class LinguaDatabase : RoomDatabase() {
    abstract fun history(): HistoryDao
    abstract fun saved(): SavedDao
    abstract fun memory(): MemoryDao
    abstract fun session(): SessionDao
    abstract fun imports(): ImportDao

    companion object {
        const val NAME = "lingua.db"
        const val VERSION = 2

        /**
         * 1 → 2: keep every row, add the merge key, index what the archive queries.
         *
         * The backfill reproduces the app's normalizer (trim, one space for every run of
         * whitespace, tabs and newlines included) so a sentence saved before the upgrade
         * still matches itself afterwards. Repeated REPLACE passes halve runs of spaces;
         * four passes cover 32 consecutive spaces, far wider than real prose. No row is
         * rewritten, re-keyed or deleted: the original text stays exactly as typed.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE history_entries ADD COLUMN normalized TEXT NOT NULL DEFAULT ''"
                )
                db.execSQL(
                    "ALTER TABLE saved_phrases ADD COLUMN normalized TEXT NOT NULL DEFAULT ''"
                )
                for (table in listOf("history_entries", "saved_phrases")) {
                    var expression =
                        "TRIM(REPLACE(REPLACE(REPLACE(original, char(10), ' '), char(13), ' '), char(9), ' '))"
                    repeat(4) { expression = "REPLACE($expression, '  ', ' ')" }
                    db.execSQL("UPDATE $table SET normalized = $expression")
                }
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_history_entries_target_normalized " +
                        "ON history_entries(target, normalized)"
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_saved_phrases_target_normalized " +
                        "ON saved_phrases(target, normalized)"
                )
            }
        }

        fun open(context: Context): LinguaDatabase =
            Room.databaseBuilder(context.applicationContext, LinguaDatabase::class.java, NAME)
                .addMigrations(MIGRATION_1_2)
                // No fallbackToDestructiveMigration: a missing migration is a build defect,
                // not permission to delete someone's archive.
                .build()
    }
}
