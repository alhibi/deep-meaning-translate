import { isNativeApp } from "../native/config";
import { nativePort } from "./native";
import { webPort } from "./web";
import type { PersistencePort } from "./port";

/**
 * The one port the app talks to. The choice is made once, from the runtime: inside the
 * Capacitor WebView Room/DataStore owns the data; in a browser tab the existing
 * localStorage keys do. Nothing writes to both.
 */
export const port: PersistencePort = isNativeApp() ? nativePort : webPort;

export const isNativePersistence = () => port.kind === "native";
export { webPort };
