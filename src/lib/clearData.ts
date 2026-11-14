import { history } from "./history";
import { persist } from "./persist";
import { saved } from "./saved";
import { memoryClear } from "./translation/memory";

/**
 * Remove every Lingua store. Removing localStorage keys alone leaves module caches
 * alive, so a "forgotten" translation could still answer from memory in the same tab.
 */
export function clearDeviceData(): void {
  // Reset each store first (this also clears its cache), then remove every remaining key.
  saved.clear();
  history.clear();
  memoryClear();
  persist.clearAll();
}
