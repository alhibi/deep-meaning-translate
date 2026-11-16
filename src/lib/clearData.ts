import { history } from "./history";
import { persist } from "./persist";
import { saved } from "./saved";
import { memoryClear } from "./translation/memory";
import { forgetSettingsCache } from "./persistence/settings";
import { resetFeelPrefs } from "./feel/prefs";
import { resetVoicePrefs } from "./voice/prefs";

/**
 * Remove every Lingua store: archive, phrasebook, translation memory, session and the
 * small settings. Removing storage keys alone leaves module caches alive, so a
 * "forgotten" translation could still answer from memory in the same tab.
 *
 * The caller must treat this as destructive: it is only wired to the explicit
 * "forget everything" control, never to a migration or a failed import.
 */
export async function clearDeviceData(): Promise<void> {
  // Reset each store first (this also clears its cache), then remove every remaining key.
  await saved.clear();
  await history.clear();
  await memoryClear();
  await persist.clearAll();
  // In-memory settings caches must be dropped too, or the next toggle in this session
  // can write an old value back after everything was "forgotten" (A2-06).
  resetFeelPrefs();
  resetVoicePrefs();
  await forgetSettingsCache();
}
