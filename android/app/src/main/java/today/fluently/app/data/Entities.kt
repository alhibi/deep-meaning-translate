package today.fluently.app.data

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room schema for everything the translator keeps.
 *
 * Rules that matter for durability:
 * - ids are the app's own ids, so a row imported twice updates instead of duplicating;
 * - every sortable time is an epoch-millisecond column with an index;
 * - `normalized` is the merge key the archive has always used (trimmed, collapsed
 *   whitespace), stored so the search happens in SQLite instead of in JavaScript;
 * - optional model metadata is kept as JSON text: it is read back through the app's
 *   validators, never trusted as a structure Room has to understand.
 */

@Entity(
    tableName = "history_entries",
    indices = [
        Index("created_at"),
        Index("updated_at"),
        Index("target"),
        Index(value = ["target", "normalized"]),
    ],
)
data class HistoryEntity(
    @PrimaryKey val id: String,
    val source: String,
    val target: String,
    val original: String,
    val translated: String,
    val normalized: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    val uses: Int = 1,
    val style: String? = null,
    val formality: String? = null,
    val situation: String? = null,
    @ColumnInfo(name = "tags_json") val tagsJson: String? = null,
    @ColumnInfo(name = "fix_json") val fixJson: String? = null,
    val version: Int = 2,
)

@Entity(
    tableName = "saved_phrases",
    indices = [Index(value = ["target", "normalized"]), Index("created_at")],
)
data class SavedPhraseEntity(
    @PrimaryKey val id: String,
    val source: String,
    val target: String,
    val original: String,
    val translated: String,
    val normalized: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    val known: Int,
    @ColumnInfo(name = "reviewed_at") val reviewedAt: Long,
)

@Entity(tableName = "memory_rows")
data class MemoryRowEntity(
    @PrimaryKey @ColumnInfo(name = "cache_key") val cacheKey: String,
    /** The validated TranslationResult, verbatim. */
    val payload: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

@Entity(tableName = "session_state")
data class SessionEntity(
    @PrimaryKey val id: Int = 1,
    val json: String?,
    /** Monotonic write stamp: an older save can never overwrite a newer session. */
    val seq: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
)

@Entity(tableName = "import_meta")
data class ImportMetaEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val fileName: String?,
    val digest: String?,
    val mode: String,
    @ColumnInfo(name = "imported_at") val importedAt: Long,
    val added: Int,
    val skipped: Int,
)
