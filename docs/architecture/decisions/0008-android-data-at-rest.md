# ADR 0008 — Data at rest in the Android app

Status: **Accepted** (2026-11-16). Supersedes the open question in TD19; it does not change the
persistence architecture of ADR 0006.

## Context

The installed app keeps the archive, phrasebook, translation memory, draft and settings in Room
`lingua.db` and Preferences DataStore inside the app's private sandbox. The product has no accounts,
no cloud sync and no server-side store of personal content; the archive never leaves the device
except through an explicit backup file. Provider keys stay on the Worker.

At-rest threats considered:

1. **Lost/stolen, locked device.** Android file-based encryption (FBE) protects the credential-encrypted
   storage while the device is locked.
2. **Unlocked device in someone else's hands.** The OS lock screen is the boundary; the app has no
   separate passcode and adding one would change the product's one-screen, frictionless promise.
3. **Rooted device, forensic image, or a compromised OS.** A plaintext SQLite file and DataStore XML
   are readable. App-level encryption with a keystore-wrapped key would raise the bar but not against
   a live, rooted device while the app is running.
4. **OS backup/transfer.** `android:allowBackup="false"` plus `data_extraction_rules.xml` exclude
   database, preferences and files from Google backup and device transfer.
5. **User-exported backup.** The envelope is integrity-checked; it can be password-encrypted with
   AES-256-GCM and PBKDF2-SHA256 (210 000 iterations), and the password is never stored.

## Decision

**Do not add SQLCipher or a second app-level encryption layer in 1.0.3.** The app relies on Android
FBE, the app sandbox, disabled OS backup and the explicit, optionally encrypted backup file. The
privacy page states the boundary instead of claiming application-level encryption.

## Consequences

- Rooted/forensic access to the archive remains possible; this is documented as accepted risk, not
  hidden.
- No schema/key migration is introduced, so existing Room data stays readable and no destructive
  migration path is needed.
- Revisit if the threat model changes (e.g. shared devices, enterprise deployment, regulated content):
  add SQLCipher with a Keystore-wrapped key and an **additive, tested migration** that preserves every
  row (the rule in ADR 0006 still applies — never `fallbackToDestructiveMigration`).
- `docs/security/privacy-and-threat-model.md` and `docs/android/network-and-security.md` describe the
  actual guarantee: OS-level encryption, not application-level encryption.
