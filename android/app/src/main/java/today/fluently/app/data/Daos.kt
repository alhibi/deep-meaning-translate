package today.fluently.app.data

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert

@Dao
interface HistoryDao {
    @Query("SELECT * FROM history_entries ORDER BY created_at DESC LIMIT :limit OFFSET :offset")
    suspend fun page(limit: Int, offset: Int): List<HistoryEntity>

    @Query("SELECT * FROM history_entries ORDER BY created_at DESC")
    suspend fun all(): List<HistoryEntity>

    @Query("SELECT COUNT(*) FROM history_entries")
    suspend fun count(): Int

    @Upsert
    suspend fun upsert(rows: List<HistoryEntity>)

    @Query("DELETE FROM history_entries WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("DELETE FROM history_entries")
    suspend fun clear()

    /**
     * Keep the newest rows. The archive is bounded at 2,000 rows; trimming happens in
     * SQLite so a long-lived install never grows without limit.
     */
    @Query(
        "DELETE FROM history_entries WHERE id NOT IN " +
            "(SELECT id FROM history_entries ORDER BY created_at DESC LIMIT :limit)"
    )
    suspend fun trim(limit: Int)

    /**
     * The only rows a new settled translation can merge with: the same sentence, or a
     * row touched inside the typing window. Bounded, indexed by target, and the prefix
     * decision stays in TypeScript where the merge rule is defined once.
     */
    @Query(
        "SELECT * FROM history_entries WHERE target = :target " +
            "AND (normalized = :normalized OR updated_at >= :recentSince) " +
            "ORDER BY updated_at DESC LIMIT 50"
    )
    suspend fun candidates(target: String, normalized: String, recentSince: Long): List<HistoryEntity>
}

@Dao
interface SavedDao {
    @Query("SELECT * FROM saved_phrases ORDER BY created_at DESC")
    suspend fun all(): List<SavedPhraseEntity>

    @Upsert
    suspend fun upsert(rows: List<SavedPhraseEntity>)

    @Query("DELETE FROM saved_phrases")
    suspend fun clear()
}

@Dao
interface MemoryDao {
    @Query("SELECT * FROM memory_rows ORDER BY created_at DESC")
    suspend fun all(): List<MemoryRowEntity>

    @Upsert
    suspend fun upsert(rows: List<MemoryRowEntity>)

    @Query("DELETE FROM memory_rows")
    suspend fun clear()
}

@Dao
interface SessionDao {
    @Query("SELECT * FROM session_state WHERE id = 1")
    suspend fun get(): SessionEntity?

    @Upsert
    suspend fun put(row: SessionEntity)

    @Query("DELETE FROM session_state")
    suspend fun clear()
}

@Dao
interface ImportDao {
    @Query("SELECT * FROM import_meta ORDER BY imported_at DESC LIMIT 20")
    suspend fun recent(): List<ImportMetaEntity>

    @Upsert
    suspend fun insert(row: ImportMetaEntity)

    @Query("DELETE FROM import_meta")
    suspend fun clear()
}
