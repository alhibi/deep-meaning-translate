import { history } from "./history";
import { persist } from "./persist";
import { saved } from "./saved";
import { memoryClear } from "./translation/memory";
import { forgetSettingsCache } from "./persistence/settings";

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
  await forgetSettingsCache();
}
