/**
 * Storage health: the facts the privacy page shows about this device's local storage.
 *
 * The browser reports how much of this origin's quota is used and whether the origin's
 * storage is durable; the app knows how full its own archive is and whether its last save
 * was accepted. Both are exposed here as one derived value, so the component only renders
 * numbers it was given instead of re-deriving them from three stores.
 *
 * Pure: `readStorageHealth` is the only function that touches `navigator.storage`; the
 * derivation and formatting are testable without a browser. Absent or refused APIs are
 * reported as "not reported", never guessed.
 */

export interface StorageCounts {
  archiveRows: number;
  archiveLimit: number;
  savedRows: number;
  /** The archive's last durable write was accepted. */
  lastWriteOk: boolean;
  /** Rows the last archive write dropped from the oldest end to fit the quota. */
  lastEvicted: number;
}

export interface StorageHealthInput extends StorageCounts {
  /** `navigator.storage.estimate()` exists on this browser. */
  estimateSupported: boolean;
  usage: number | null;
  quota: number | null;
  /** The browser exposes `persist()` and `persisted()`. */
  durableSupported: boolean;
  /** null when unknown or not reported. */
  durable: boolean | null;
}

export interface StorageHealth extends StorageHealthInput {
  /** Percentage of the quota in use, 0–100; null until the browser reports both values. */
  fill: number | null;
  /** The last archive save dropped older rows to fit the device quota. */
  trimmed: boolean;
  /** There is something the person may want to act on (failed write or a trim). */
  needsAttention: boolean;
}

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
const BYTE_SCALES = [1, 1024, 1024 ** 2, 1024 ** 3] as const;

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Human-scaled bytes in the interface locale ("1,5 kB", "512 byte", "1.5 كيلوبايت"). */
export function formatStorageBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  let unitIndex = 0;
  while (unitIndex < BYTE_SCALES.length - 1 && bytes >= BYTE_SCALES[unitIndex + 1]!) unitIndex += 1;
  const value = bytes / BYTE_SCALES[unitIndex]!;
  const maximumFractionDigits = unitIndex === 0 || value >= 10 ? 0 : 1;
  const unit = BYTE_UNITS[unitIndex]!;
  try {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit,
      // Bytes read as words ("0 bytes"), larger units as the familiar short symbol.
      unitDisplay: unitIndex === 0 ? "long" : "short",
      maximumFractionDigits,
    }).format(value);
  } catch {
    // A browser without unit formatting still shows a usable number.
    return `${Math.round(value)} ${unit}`;
  }
}

/** A fill level as a percentage in the interface locale ("25 %", "٢٥٪"). */
export function formatStoragePercent(fill: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(fill / 100);
  } catch {
    return `${Math.round(fill)}%`;
  }
}

/** Derive everything the section shows from the raw reports. Pure and clamped. */
export function deriveStorageHealth(input: StorageHealthInput): StorageHealth {
  const usage = finiteOrNull(input.usage ?? undefined);
  const quota = finiteOrNull(input.quota ?? undefined);
  const fill =
    input.estimateSupported && usage !== null && quota !== null && quota > 0
      ? Math.min(100, Math.max(0, Math.round((usage / quota) * 100)))
      : null;
  const trimmed = Number.isFinite(input.lastEvicted) && input.lastEvicted > 0;
  return {
    ...input,
    usage,
    quota,
    fill,
    trimmed,
    needsAttention: !input.lastWriteOk || trimmed,
  };
}

/**
 * Read the browser's report and derive the section's value. Every call is best effort:
 * a missing API, a rejected promise or an absent field becomes "not reported" rather than
 * an error, because this surface exists to tell the truth about storage, not to fail.
 */
export async function readStorageHealth(counts: StorageCounts): Promise<StorageHealth> {
  const manager = typeof navigator === "undefined" ? undefined : navigator.storage;
  const estimateSupported = typeof manager?.estimate === "function";
  let usage: number | null = null;
  let quota: number | null = null;
  if (estimateSupported) {
    try {
      const estimate = await manager.estimate();
      usage = finiteOrNull(estimate.usage);
      quota = finiteOrNull(estimate.quota);
    } catch {
      /* the API exists but would not answer */
    }
  }
  const durableSupported =
    typeof manager?.persist === "function" && typeof manager?.persisted === "function";
  let durable: boolean | null = null;
  if (durableSupported) {
    try {
      durable = await manager.persisted();
    } catch {
      durable = null;
    }
  }
  return deriveStorageHealth({
    ...counts,
    estimateSupported,
    usage,
    quota,
    durableSupported,
    durable,
  });
}
