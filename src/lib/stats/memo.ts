/**
 * Identity-keyed memo for the statistics derivation.
 *
 * The statistics screen derives many numbers from the same `StatRecord[]`: the route
 * rebuilds that array only when the archive revision or the filters change, then asks for
 * several distributions, a rhythm, a practice profile and the records panel from it. Each
 * derivation is one full pass, so without a shared memo the archive is walked once per
 * derivation per interaction (TD25). Keying by the array object ties a memo to exactly the
 * revision/filter state the caller currently holds; a WeakMap keeps no released revision
 * alive.
 *
 * The per-owner key map is capped: a caller that feeds many time zones or dimensions must
 * not retain unbounded values — a cache without eviction is the defect this replaces.
 */
const MAX_KEYS_PER_OWNER = 32;
const byArray = new WeakMap<readonly object[], Map<string, unknown>>();
const byEntry = new WeakMap<object, Map<string, unknown>>();

function getOrCompute<T>(
  store: WeakMap<object, Map<string, unknown>>,
  owner: object,
  key: string,
  compute: () => T,
): T {
  let values = store.get(owner);
  if (!values) {
    values = new Map();
    store.set(owner, values);
  }
  if (values.has(key)) return values.get(key) as T;
  const value = compute();
  if (values.size >= MAX_KEYS_PER_OWNER) values.clear();
  values.set(key, value);
  return value;
}

/** Memoise a derivation keyed by the records array it was computed from. */
export function memoArray<T>(rows: readonly object[], key: string, compute: () => T): T {
  return getOrCompute(byArray, rows, key, compute);
}

/** Memoise a per-row derivation keyed by the history entry object (classification is the expensive part). */
export function memoEntry<T>(entry: object, key: string, compute: () => T): T {
  return getOrCompute(byEntry, entry, key, compute);
}
