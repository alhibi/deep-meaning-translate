# Data import and export

Status: **Implemented** (web download/upload and Android SAF), covered by TypeScript
round-trip tests. On-device SAF interaction is **NOT_VERIFIED** (no device available).

The only user-facing controls live in `/privacy` → "Your data" (`DataControls.tsx`).
Nothing is uploaded: export writes a file the person chooses, import reads one file the
person chooses.

## Envelope

```json
{
  "format": "today-backup",
  "schemaVersion": 1,
  "appVersion": "1.0.0",
  "exportedAt": "2026-11-16T09:00:00.000Z",
  "encrypted": false,
  "payload": {
    "settings": { "lingua.theme.v1": "dark" },
    "prefs": { "source": "de", "target": "ar", "style": "natural" },
    "session": { "text": "…", "source": "de", "target": "ar", "style": "natural" },
    "history": [],
    "saved": [],
    "memory": []
  },
  "digest": "<sha-256 of the canonical payload>"
}
```

- `digest` is SHA-256 over the canonical JSON of `payload`. Import recomputes it; a
  mismatch is reported as "not a today backup, or it was changed after export".
- `encrypted: true` replaces `payload` with
  `{ algorithm: "AES-GCM", kdf: "PBKDF2-SHA256", iterations: 210000, salt, iv, ciphertext }`.
  The key is derived from the password with WebCrypto; there is no home-made cipher.
- A file from a newer `schemaVersion` is refused with a specific message; a file from an
  older known version is upgraded by the parser.
- `appVersion` is informational; it never gates import.

## Export

1. `port.snapshot()` reads the current records and settings through the active adapter.
2. `createBackup()` builds the envelope and, if a password was entered, encrypts it.
3. Web: a `Blob` download named `today-backup-YYYY-MM-DD.json`.
   Android: `ACTION_CREATE_DOCUMENT` through `LinguaFiles.exportBackup`; the person picks
   the folder and name. No storage permission is requested or needed.
4. A cancelled picker is a normal outcome (`saved: false`), not an error.

## Import

1. Web: hidden `<input type="file">`. Android: `ACTION_OPEN_DOCUMENT` through
   `LinguaFiles.pickBackup`, restricted to JSON/text MIME types.
2. `parseBackup()` validates shape, schema version, digest and (if present) password.
   It computes counts **before** touching storage.
3. The preview shows archive entries, saved phrases, memory rows and settings, and offers
   two explicit modes:
   - **Merge** (default): rows are matched by id; the newer `updated_at`/`created_at`
     wins; nothing is duplicated; existing rows are never deleted.
   - **Replace**: the current records and whitelisted settings are removed first, then the
     file's contents are written. The archive is capped at 2000.
4. The write is one Room transaction (`LinguaRepository.replaceAll`). Any failure rolls
   back, leaving the previous state intact; the import is recorded in `import_meta` with
   file name, digest, mode, counts and timestamp.
5. The UI reports added/skipped per entity and offers "Reload the app" so every store
   rehydrates from the new state.

## What is refused

| Input | Result |
| --- | --- |
| Not JSON / wrong `format` | "not a today backup" — no write |
| `schemaVersion` newer than supported | "from a newer version" — no write |
| Digest mismatch | "changed after export" — no write |
| Encrypted file without password | prompts once, then refuses — no write |
| Oversized file (> 8 MB) | refused while reading the stream |
| Rows failing validation | skipped and counted; valid rows still import |
| Write failure (disk full, corrupt DB) | rollback, previous data intact |

## Limits

- Archive 2000, saved phrases 300, memory 120 rows / 200 KB / 30 days, 5000 chars per
  text field.
- Passwords are never stored, logged or included in the backup metadata. Losing the
  password means the file cannot be opened — the UI states this before export.
