import registry from "./media-hosts.json";

/**
 * The single runtime allowlist for remote culture images.
 *
 * The same JSON file is read by tests/security/csp-image-hosts.mjs and by both CSP
 * generators, so the corpus, the runtime check and the two deployment policies cannot
 * drift apart. Only exact https hosts, no credentials, no ports, no wildcards.
 */
export const CULTURE_IMAGE_HOSTS: readonly string[] = registry.hosts;

const allowed = new Set(CULTURE_IMAGE_HOSTS.map((host) => host.toLowerCase()));

/** True only for an https URL on an allow-listed origin (no credentials, no explicit port). */
export function isAllowedCultureImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  return allowed.has(url.hostname.toLowerCase());
}

/** https URL with no credentials/port — for provenance links that are opened, not embedded. */
export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443")
  );
}
