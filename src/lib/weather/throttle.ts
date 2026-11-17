/**
 * Per-purpose admission for the weather surfaces.
 *
 * A separate bucket, not a borrowed translation one: a screen that periodically
 * revalidates a forecast must never spend the budget the person needs to translate the
 * sentence they are typing. The buckets are still bounded so the routes cannot be used as
 * an unbounded request amplifier against the free providers.
 *
 * Thresholds live with the other purposes in `translation/throttle.ts` conceptually; the
 * limiter factory is reused from there so there is one implementation. Moving the two
 * exports into that file is a lead decision (it is outside this task's write scope); the
 * values are chosen so that file would not need to change if it does.
 */
import { createLimiter } from "@/lib/translation/throttle";

/**
 * One forecast per place per revalidation window (15 minutes fresh / 3 hours stale), so a
 * person needs a handful per hour. 30 burst / 0.5 per second is far above that and still
 * bounded for a scripted client.
 */
export const takeWeatherToken = createLimiter(30, 0.5);

/**
 * Geocoding: forward search is typed-ish (A05 debounces), reverse runs once per consent
 * refresh. Same shape; slightly smaller because each request costs a Nominatim slot too.
 */
export const takePlaceToken = createLimiter(20, 0.5);
