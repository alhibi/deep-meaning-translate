import { readDeviceValue, removeDeviceValue, writeDeviceValue } from "../persistence/settings";

/**
 * Optional personal DeepSeek key, used for a direct browser/WebView connection to
 * api.deepseek.com. It is device-only: never bundled in an APK, never sent to today's
 * server, never logged, and excluded from backups (the backup whitelist does not list
 * this key).
 *
 * This is a BYOK escape hatch, not the default provider path: with no key the app keeps
 * using the deployed service exactly as before.
 */
export const PROVIDER_KEY = "lingua.provider.v1";
const SHAPE = /^sk-[A-Za-z0-9_-]{16,200}$/;

export function validateProviderKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return SHAPE.test(key) ? key : null;
}

export function readProviderKey(): string | null {
  const raw = readDeviceValue(PROVIDER_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { deepseek?: unknown };
    return validateProviderKey(value?.deepseek);
  } catch {
    return null;
  }
}

export async function saveProviderKey(raw: string): Promise<boolean> {
  const key = validateProviderKey(raw);
  if (!key) return false;
  return writeDeviceValue(PROVIDER_KEY, JSON.stringify({ deepseek: key }));
}

export async function clearProviderKey(): Promise<boolean> {
  return removeDeviceValue(PROVIDER_KEY);
}

export const hasProviderKey = (): boolean => readProviderKey() !== null;
