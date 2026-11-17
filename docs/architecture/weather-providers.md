# Weather Provider Selection

Status: **Researched and decided** on 2026-11-17 from the providers' official documentation (links in
[Sources](#sources), all accessed 2026-11-17) and one live probe per endpoint from this environment.
This is an architecture decision record for the phase-II weather surface; it is not product code.
Provider uptime, behaviour under load, DST-transition output and Android/WebView runtime behaviour are
**NOT_VERIFIED**; raw probe evidence is kept in `artifacts/phase2/task-12.md` (gitignored).

**Release visibility (2026-11-17):** the translator does not compose the weather surface in the
current release (`SHOW_WEATHER = false` in `src/lib/features.ts`); its adapter, routes, hooks,
cache and tests remain. This decision record still governs the module when the surface is turned on.
Classifications follow [testing](../quality/testing.md).

## Decision

**Use Open-Meteo as the provider, through our own same-origin server route, with MET Norway
(`api.met.no` locationforecast 2.0) as the fallback.** Do not use Bright Sky, OpenWeatherMap or
Visual Crossing for this feature today.

| Role | Provider | Why |
| --- | --- | --- |
| Primary (today, non-commercial) | **Open-Meteo free API** | No account or key; one request returns current + hourly + daily + IANA timezone + units; global (Berlin and Cairo probed); ~3.3 KB payload; CORS `*` and machine-readable rate-limit headers; CC BY 4.0 attribution only; free quota 10,000 calls/day is ample behind a cache |
| Fallback | **MET Norway locationforecast 2.0** | No key and free **including commercial use**; global (Berlin and Cairo probed); CC BY 4.0/NLOD 2.0; its `Expires` header and documented minimum repeat intervals fit a stale-while-revalidate cache; coarser (6-hourly outside the Nordics) but acceptable as a fallback |
| Rejected for this feature | Bright Sky (DWD) | Observations are Germany-only (Cairo `/current_weather` returned 404) and forecasts are much less dense outside Germany; single-maintainer public instance with no SLA |
| Rejected for this feature | OpenWeatherMap | Requires an account + API key, and the hourly/daily fields we normalize need the paid One Call subscription (probe: 401 "requires a separate subscription") — contradicts "no accounts" today |
| Re-evaluate at commercial launch | Visual Crossing | Free for commercial use and no key for basic access, but anonymous mode returned daily data only (no current/hourly), attribution is required on the low tiers, and the anonymous/fair-use allowances are not clearly documented |

The decision is deliberately split from licensing: Open-Meteo's free tier is **non-commercial only**.
The moment the product earns money (subscriptions, ads, a paid app, or a commercial product), the
implementation must move to the Open-Meteo customer endpoint or promote MET Norway to primary. Both
are configuration changes inside the adapter, never UI changes — that is the point of the boundary in
[Provider abstraction boundary](#provider-abstraction-boundary).

## Requirements the choice must satisfy

1. **No accounts, no API keys, no embedded secrets** for the web app and the Android shell (BYOK stays
   translation-only).
2. **Global coverage**, because an Arabic–German translator is used in Germany, in Arabic-speaking
   countries and by people who travel; at minimum Berlin and one Arabic-region city must work.
3. **Current, hourly and daily** weather in one normalized shape, with **timezone and units explicit**
   (the app already handles RTL, three interface locales and both numeral systems).
4. **A privacy boundary that this product can state honestly**: coordinates leave the device, so
   precision is reduced first and the provider must not receive a device identifier.
5. **On-device caching** with a bounded, validated cache; no polling in the background; no request
   storms from a mobile client.
6. **A licence that survives growth**: usable for free today, with a documented, legal path to a
   commercial release.
7. **No new secret management, CSP widening or Android permission** unless a product decision
   explicitly accepts them.

## Who was compared

| Provider | What it is | Model/data lineage |
| --- | --- | --- |
| Open-Meteo | Open-source weather API (AGPLv3 server, CC BY 4.0 data), runs national-model data | ICON/DWD, GFS/NOAA, IFS/ECMWF, JMA, MeteoSwiss, MET Norway and others; `best_match` selects the highest-resolution model for the coordinates |
| MET Norway | Norwegian Meteorological Institute's public Locationforecast 2.0 API | MET's own global/Nordic models; 9-day forecast, 90 hourly timesteps |
| Bright Sky | Open-source JSON gateway to DWD open data | DWD SYNOP observations and MOSMIX forecasts |
| OpenWeatherMap | Commercial weather platform | Own model aggregation; free plan limited to current + 3-hour/5-day forecast |
| Visual Crossing | Commercial weather data/API | "Weather Engine" combining models, stations, radar |

## Live probe evidence (2026-11-17, one request per row)

The command lines are in `artifacts/phase2/task-12.md`. `OBSERVED` values below are copied from the
raw headers/bodies.

| Probe | Status | Payload | What it showed |
| --- | --- | --- | --- |
| Open-Meteo Berlin (`timezone=Europe/Berlin`) | 200 | 3,303 B, 0.17 s | current/hourly/daily together; `utc_offset_seconds`, `timezone`, per-group units, `current.interval: 900`; grid-snapped coordinates (52.512604, 13.419517); rate headers 600 per 60 s window, cost 1.4, remaining 598.6 |
| Open-Meteo Cairo (`timezone=Africa/Cairo`) | 200 | 3,270 B | same shape; Cairo 18:45 local, 22.7 °C, WMO code 2; local sunrise/sunset |
| Open-Meteo Cairo (`timezone=auto`) | 200 | 337 B | IANA zone resolved from coordinates (`Africa/Cairo`, offset 7,200) |
| Open-Meteo Cairo (`timeformat=unixtime`) | 200 | 1,420 B | absolute epoch seconds; daily boundaries are local midnights as epochs; best input for DST-correct rendering |
| Open-Meteo CORS with `Origin: https://localhost` | 200 | — | `access-control-allow-origin: *`, `access-control-expose-headers: x-ratelimit-*, retry-after` |
| Open-Meteo customer endpoint, no key | **400** | 58 B | `{"reason":"The supplied API key is invalid.","error":true}` — commercial endpoint is key-gated |
| MET Norway Berlin (identifying UA + Origin) | 200 | 39,416 B | `properties.meta.updated_at`; 90 hourly UTC timesteps to 2026-11-27; `next_1_hours`/`next_6_hours` with `symbol_code`; `Expires` 20 minutes after the fetch |
| MET Norway Cairo | 200 | 40,015 B | global coverage; air_temperature 23.6 °C; `Expires` 8 minutes after the fetch, `age: 1432` |
| MET Norway with curl's default UA | 200 | 39,416 B | the documented 403-for-bad-UA rule was not exercised; treat the UA requirement as documented, not probed |
| Bright Sky Berlin `/current_weather` | 200 | 1,328 B | DWD SYNOP station `Berlin-Tempelhof`, `distance` 5,858 m; condition strings/icons |
| Bright Sky Cairo `/current_weather` | **404** | 43 B | `{"detail":"No sources match your criteria"}` — no station near Cairo |
| Bright Sky Cairo `/weather` (forecast) | 200 | 4,932 B | the worldwide forecast path answers, but with low-density DWD data |
| OpenWeatherMap One Call, no key | **401** | 338 B | "using One Call 3.0 requires a separate subscription to the One Call by Call plan" |
| Visual Crossing, no key | **400** | 93 B | "Anonymous requests require gzip response support" |
| Visual Crossing `--compressed` Berlin / Cairo | 200 / 200 | 3,171 B / 744 B | global; `timezone` + `tzoffset`; 8 daily entries but `currentConditions: null` (anonymous mode has no current/hourly) |

All providers are plain HTTPS JSON GET endpoints: no client SDK, no exotic TLS, so both the PWA and the
Android WebView can call them. CORS `*` was observed on every provider that answered, including the
401/400 responses, so **direct browser access is technically possible** — the recommendation is still
the same-origin server route, for the privacy, caching and CSP reasons in
[Integration constraints](#integration-constraints-in-this-repository).

## Comparison matrix

Legend: **VERIFIED** = probed from this environment or read in the official page on 2026-11-17;
**documented** = stated by the provider but not reproduced; **NOT_VERIFIED** = not established here.

| Criterion | Open-Meteo (free) | MET Norway | Bright Sky (DWD) | OpenWeatherMap (free) | Visual Crossing |
| --- | --- | --- | --- | --- | --- |
| Global coverage | VERIFIED (Berlin + Cairo 200) | VERIFIED (Berlin + Cairo 200; Nordic denser) | partial: forecasts global but sparse (Cairo forecast 200, current 404), observations Germany-focused | documented global; NOT_VERIFIED by probe (401) | VERIFIED (Berlin + Cairo 200, daily) |
| current + hourly + daily in one call | VERIFIED | hourly timeseries + next_1h/6h; daily must be derived | current + hourly forecast; daily must be derived | current + 3-hourly free; hourly/daily are paid products | no: anonymous mode returns daily only (current null) |
| Timezone handling | VERIFIED: `timezone=auto` gives IANA + `utc_offset_seconds`; `timeformat=unixtime` available | UTC timestamps only (`Z`); adapter must supply the place timezone | UTC timestamps only; no timezone field observed | documented; NOT_VERIFIED | VERIFIED: `timezone` + `tzoffset` |
| Units | per-group `*_units`, metric by default, overrideable | SI (celsius, m/s, mm, %, hPa, degrees) | implied metric (°C, km/h, mm, m) | `units=metric` | `unitGroup=metric` |
| Update cadence | current `interval: 900` s (OBSERVED); hourly rows 1 h; model runs every 1–6 h (documented model table) | Nordic hourly, rest of world every 6 h; identical requests not before `Expires`, min 30 min Nordic / 3 h rest (documented) | not documented on the pages checked — NOT_VERIFIED | not documented on the pages checked — NOT_VERIFIED | not documented on the pages checked — NOT_VERIFIED |
| No account/key | VERIFIED (no key used) | VERIFIED (no key; identifying UA/Origin required) | VERIFIED (no key) | no: account + API key required (401 probe) | VERIFIED anonymous, gzip required |
| Licence / commercial use | data CC BY 4.0; **free tier non-commercial only**; commercial requires paid subscription | NLOD 2.0 + CC BY 4.0; **free including commercial** | DWD data CC BY 4.0; API free for all purposes | commercial per FAQ with attribution; free-plan data terms beyond the FAQ NOT_VERIFIED | commercial allowed on all plans; attribution required for Pay-as-you-go/Pro; exact free-tier terms NOT_VERIFIED |
| Attribution required | CC BY 4.0: credit, link to licence, indicate changes | credit "Data from MET Norway"/"Based on data from MET Norway" + link | DWD source acknowledgement (CC BY 4.0) | "Weather data provided by OpenWeather" + link, Free–Professional plans | "Weather Data Provided by Visual Crossing" for Pay-as-you-go/Pro |
| Quotas / limits | 600/min, 5,000/h, 10,000/day, 300,000/month; headers expose the budget | <20 requests/second total per application; no quota headers | not documented (public instance run by one maintainer; "2M requests/day" claim on its page) | 60/min, 1,000,000/month (free plan) | 1,000 records/day with a free account; anonymous allowance unclear |
| Provider sees | IP + request; free-API logs may keep coordinates up to 90 days | IP + coordinates in access logs (Oslo) if called directly; proxy recommended | IP + coordinates (policy not checked — NOT_VERIFIED) | account-linked IP + coordinates (NOT_VERIFIED) | per-application aggregate; logging NOT_VERIFIED |
| Probe payload size | 3.3 KB | 39–40 KB | 1.3 KB current / 4.9 KB forecast | n/a (401) | 0.7–3.2 KB daily |
| CORS | `*` (VERIFIED) | `*` (VERIFIED) | `*` (VERIFIED) | `*` (on 401, VERIFIED) | `*` (VERIFIED) |

## Decision matrix (judgement on top of the evidence above)

Scores 1–5, higher is better; weights encode today's requirements. The factual basis for every score is
the comparison matrix, not provider marketing.

| Criterion | Weight | Open-Meteo | MET Norway | Bright Sky | OpenWeatherMap | Visual Crossing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| No account/key for today's use | 20 | 5 | 5 | 5 | 1 | 4 |
| Global coverage | 20 | 5 | 5 | 2 | 5 | 5 |
| current+hourly+daily in one call | 15 | 5 | 3 | 3 | 2 | 2 |
| Timezone/units without extra work | 10 | 5 | 2 | 2 | 3 | 5 |
| Licence suitable for commercial growth | 15 | 2 | 5 | 5 | 3 | 3 |
| Privacy boundary | 10 | 3 | 2 | 3 | 2 | 2 |
| Quota/reliability for a small app | 5 | 5 | 5 | 3 | 4 | 2 |
| Payload/latency | 5 | 5 | 2 | 5 | 3 | 5 |
| **Weighted total (/500)** | **100** | **435** | **395** | **350** | **280** | **360** |

Open-Meteo leads on today's constraints. MET Norway leads on the one constraint where Open-Meteo fails
today (commercial use), which is exactly why it is the fallback and the commercial successor. Visual
Crossing is the closest alternative on paper, but its anonymous mode lacks current/hourly data, so it
would still need an account and a plan — it does not beat the recommended pair today.

## Recommendation and fallback policy

### Today (non-commercial, no accounts)

- Primary: **Open-Meteo free API**, requested by our own server route, normalized to the snapshot
  contract. One request per place: `current`, `hourly`, `daily`, `timezone=auto`,
  `timeformat=unixtime`, metric units. Request only the fields the UI shows (the probe used 5 current,
  3 hourly and 7 daily variables → 3.3 KB; Open-Meteo's rate-limit cost grows with variables and
  length, so do not over-request).
- Cache: fresh for **15 minutes**, serve stale for **up to 3 hours** while revalidating (both already
  encoded in the phase-II contract as `WEATHER_FRESH_MS` / `WEATHER_STALE_MS`). No background polling,
  no refetch while the surface is hidden, no refetch because the person moved a few metres.
- No key, no account, no provider identifier beyond what the request itself contains.

### Fallback

- Ordered provider list: `["open-meteo", "met-no"]`. Use the next provider only on transient
  failures — network error, timeout, HTTP 5xx, HTTP 429 — **not** on a 4xx that means invalid input.
- At most one fallback attempt per read; never merge two providers into one snapshot; the snapshot
  carries the provider that actually answered, and the UI credits that provider (see
  [Attribution](#attribution-the-ui-must-show)).
- Circuit breaker: after two consecutive primary failures, skip the primary for 30 minutes and serve
  the fallback (or the cached snapshot); reset on the first primary success. Weather is not
  safety-critical, so a calm "current conditions are unavailable" with a retry is better than a
  hidden retry loop.
- If no provider answers and the cache is beyond the 3-hour stale window, show the calm unavailable
  state, not old numbers dressed as current. The product rule applies unchanged: failure is a product
  surface, no status codes or provider messages in front of the person.
- MET Norway fallback runs **only through the server route**, because it must send an identifying
  `User-Agent` with contact information (for example `today-weather/1.0 (+https://fluently.today)`; a
  browser cannot set that header) and its licence expects coordinates truncated to at most 4 decimals
  (we send 2).

### Licensing switch when the project becomes commercial

Do this before the first monetised release, not after:

1. Either subscribe to Open-Meteo (customer endpoint + server-held key, same syntax), or
2. Promote MET Norway to primary; it is free for commercial use and needs no subscription.

In both cases the client contract, UI and cache are unchanged. The Open-Meteo **free** endpoint must not
remain in use in a monetised product — its terms say free use is non-commercial. Keep the provider list
and endpoint configuration in one module so the switch is reviewed in one diff.

## Attribution the UI must show

Attribution is a licence obligation, so it is part of the feature, not a legal footnote. The snapshot
carries the exact attribution for the provider that answered; the UI never hard-codes a provider.

| Provider | Required credit | Link(s) | Where |
| --- | --- | --- | --- |
| Open-Meteo | e.g. `Weather data by Open-Meteo.com` (Arabic/German wording may be translated; indicate the data is adapted) | https://open-meteo.com/ and the CC BY 4.0 licence https://creativecommons.org/licenses/by/4.0/ | A quiet line attached to the weather surface (visible without opening a menu), plus the `/about` third-parties section |
| MET Norway (fallback) | `Data from MET Norway` / `Based on data from MET Norway` (translation allowed) | https://www.met.no/ and the NLOD 2.0 / CC BY 4.0 licences | Same inline line, switching text with the snapshot's provider; plus `/about` |
| Visual Crossing (only if re-evaluated) | `Weather Data Provided by Visual Crossing` | https://www.visualcrossing.com/ | Inline, visible |
| Bright Sky / DWD (only if ever used) | Acknowledge `Deutscher Wetterdienst (DWD)` as the source | https://www.dwd.de/ | Inline + `/about` |
| OpenWeatherMap (only if ever used) | `Weather data provided by OpenWeather` with a hyperlink | https://openweathermap.org/ | Visible part of the product, Free–Professional plans |

Implementation rules:

- Render `snapshot.attribution.text` and `snapshot.attribution.url` from the normalized snapshot, so a
  fallback answers with the fallback's credit.
- The inline credit is part of the weather surface (for example one quiet line under the forecast), not
  only `/about`: CC BY asks for credit "in any reasonable manner", and MET's FAQ allows a separate page
  only when it is easy to find and navigate to. An inline line plus `/about` satisfies both without a
  second door in the footer.
- `/about#third-parties` (owned by the public-page work) must add: the provider name and purpose; what
  is sent (rounded coordinates, request time; no account, no device identifier); the provider's
  retention statement; the on-device cache; links to the provider's terms/privacy/licence; and the
  review date must move only after the copy is checked against the implementation. The product privacy
  promise must not claim "no data leaves the device" once weather exists.
- Do not claim the data is official, complete or suitable as the sole basis for safety decisions —
  every provider disclaims this, and MET's terms explicitly prohibit implying official status.

## Privacy: what leaves the device and what the provider may keep

- **Coordinates are the only user-derived value.** Round to **2 decimals (~1 km)** before they leave the
  device or the server route. Weather grids are 1–11 km (Open-Meteo) and MET requires at most 4
  decimals, so extra precision is pure exposure with no accuracy benefit. The phase-II contract already
  stores 2 decimals.
- **Do not send** device identifiers, the translation draft, or the interface language unless a provider
  actually localizes (Open-Meteo does not; its condition codes are WMO numbers, so descriptions are
  localized locally with a COPY map).
- **Prefer the same-origin server route** over a direct browser call. A direct call sends the person's
  IP address together with the coordinates: Open-Meteo's privacy notice says free-API webserver logs
  "may contain sensitive information such as geographical coordinates" for 90 days, and MET explicitly
  says direct app/browser calls store the user's IP and coordinates and recommends a proxy. Through our
  route the provider sees the Worker's IP; the Worker sees the coordinates in memory only and **must not
  log them** (the existing log contract is event/mode/outcome/duration/count only).
- On device: the cache stores **rounded coordinates and the normalized snapshot only**, never the raw
  fix, and it must be cleared by "forget everything" (see
  [Integration constraints](#integration-constraints-in-this-repository)).
- **Location is a parallel, consented decision.** When this research started the web response set
  `Permissions-Policy: geolocation=()` and the Android manifest had no location permission; while it
  ran (2026-11-17) the location/privacy work changed that to `geolocation=(self)` plus
  `ACCESS_COARSE_LOCATION` with a coarse-only Capacitor patch, gated on an explicit opt-in. The
  forecast-provider decision is independent of that choice, but the privacy rules stay: consent first,
  coarse fix only (`enableHighAccuracy: false`, no `watchPosition`, no background tracking), quantize
  to 2 decimals before anything is stored or sent, and keep manual place search for people who decline.
  Any change to those rules is a product/privacy decision, not a weather side effect.
- **Geocoding is a second third-party endpoint and must be disclosed too.** The in-progress location work
  routes place search through our own same-origin route and its comments name Nominatim as the geocoder
  (its usage policy is outside this document and NOT_VERIFIED here). `/about#third-parties` must
  therefore name the geocoding service, the forecast provider and what each receives — a typed place
  name and/or rounded coordinates — not only "weather".

## Freshness, caching and update cadence

Provider rules and the cache policy they permit:

| Provider | Provider's cadence/rules | Minimum repeat interval | What we may cache | Recommended on-device |
| --- | --- | --- | --- | --- |
| Open-Meteo | current interval 900 s (OBSERVED); hourly rows 1 h; model runs every 1–6 h; no documented minimum repeat interval, only daily/hourly/minute quotas | none stated; the quota is the real limit | current + hourly + daily snapshot | fresh 15 min, stale ≤3 h, revalidate on visibility only |
| MET Norway | Nordic hourly, rest of world 6 h; "never repeat requests until the time indicated in the `Expires` header" (observed `Expires` 8–32 min ahead during probes); identical requests not more often than 30 min Nordic / 3 h rest | 30 min Nordic / 3 h elsewhere + `Expires`, whichever is later | snapshot | when MET is the active provider: fresh no earlier than `Expires`, revalidate no earlier than 3 h for non-Nordic coordinates |
| Bright Sky | not documented — NOT_VERIFIED | — | — | not selected |
| OpenWeatherMap | not documented on the pages checked — NOT_VERIFIED | — | — | not selected |
| Visual Crossing | not documented on the pages checked — NOT_VERIFIED | — | — | not selected |

Rules that apply regardless of provider:

- One cache entry per rounded place + provider-independent place id; at most **8 places**; a single
  validated JSON document under `lingua.weather.v1` (schema-versioned; a snapshot with another schema
  version is discarded on read, never migrated in place).
- Serve fresh from cache without a request; serve stale immediately with an "as of HH:MM" label and
  revalidate quietly; never show a snapshot older than 3 hours as current. Show the retrieval time where
  the UI normally shows "updated" — MET's terms ask for this and it is honest everywhere.
- No timers that poll weather; refetch only when the weather surface is visible and the freshness window
  expired, after an explicit retry tap, or when the chosen place changes. On Android, no request while
  the app is not in use (MET requires it, and it is right for battery too).
- The server route may keep a **5-minute** in-memory per-rounded-place entry and must send
  `Cache-Control: no-store` to the client, then let the client cache decide. The route's own cache is an
  outage/limit buffer, not a second source of truth.
- Respect provider signals when present: Open-Meteo's `X-RateLimit-*` headers and `Retry-After` (exposed
  via CORS), MET's `Expires`/`If-Modified-Since`. Never retry a 429 in a loop; fall back or serve the
  cache.

## Provider abstraction boundary

The boundary already sketched by the phase-II contract (`src/lib/weather/types.ts` at the time of
writing) is the right shape: **the UI renders a normalized snapshot and never talks to a provider**.
Recommended module layout:

```text
src/lib/weather/types.ts          normalized snapshot + query + provider interface (schema version)
src/lib/weather/provider.ts       provider registry, ordered fallback, circuit breaker, typed errors
src/lib/weather/openMeteo.server.ts    build request → fetch → normalize → snapshot (server-only)
src/lib/weather/metNorway.server.ts    fallback adapter (server-only, adds identifying UA)
src/lib/weather/cache.ts          validated on-device cache (lingua.weather.v1), TTL, bounds
src/lib/weather/useWeather.ts     read cache → maybe revalidate → state machine (no polling)
src/routes/api/weather.ts         same-origin route: validate query, rate-limit, no coordinate logs
src/components/weather/           UI: renders snapshot, local COPY for en/de/ar, attribution line
```

At authoring time (2026-11-17, work in progress, untracked) the phase-II tree already contained:
`types.ts` (snapshot/query/provider contract, schema version 1, fresh 15 min / stale 3 h),
`provider.ts` (the snapshot validator plus typed weather errors, deadlines and unit conversion; default
provider id `open-meteo`), `throttle.ts` (`takeWeatherToken`, `takePlaceToken`), `location.ts` and
`geocode.ts` (consent, coarse fix, same-origin place routes, 2-decimal quantization) and
`components/weather/copy.ts` (local COPY). The Open-Meteo server adapter and the `/api/weather` route
were still missing, and no MET fallback adapter exists yet.

Interface rules:

- One adapter owns one provider's URL, parameters, headers (MET's UA!), response parsing and unit
  conversion. Nothing outside the adapter knows a provider name, endpoint or field name.
- The adapter returns a **complete, validated snapshot or throws a typed error** — never a partial
  snapshot, never a raw provider body. Raw provider JSON is never persisted.
- The UI consumes `WeatherSnapshot`, `WeatherSymbol` and the `useWeather` state machine only. A provider
  change touches one adapter file plus configuration.
- Fallback selection lives in `provider.ts` (ordered list, transient-only triggers, one attempt, circuit
  breaker); the snapshot's `provider`/attribution fields must reflect who answered.
- Prompts/COPY rule: weather condition descriptions are feature copy, so they live in a local
  `COPY`/`copy` object in the weather components (precedent: `DataControls`, `ProviderKey`) and are
  mapped from `WeatherSymbol`, **not** added to `src/lib/i18n.ts`.

Recommended normalized fields (extends the in-progress contract; additions marked +):

- Envelope: `version`, `provider`, `place` (`id`, `name`, `latitude`, `longitude` rounded to 2 decimals,
  optional `countryCode`/`admin`, `timeZone`), `units` (metric; the UI owns display conversion),
  `fetchedAt` (epoch ms), `issuedAt` (provider update time when supplied, ISO; Open-Meteo omits it, MET
  supplies `meta.updated_at`), +`expiresAt` (when this snapshot stops being current), `current`,
  `hourly`, `daily`, `attribution`.
- `current`: `time` (provider observation time), `temperature`, optional `apparentTemperature`,
  `humidity`, `windSpeed` (km/h), `windDirection` (degrees), `symbol` (normalized `WeatherSymbol`),
  `isDay`; +optional `precipitation`.
- `hourly[]`: `time`, `temperature`, optional `precipitationProbability`, `symbol`; +optional
  `precipitation`; the UI shows the next 24 hours (the in-progress validator caps the array at 48).
- `daily[]`: `date` (local `YYYY-MM-DD` in the place's timezone), `min`, `max`, optional
  `precipitationProbability`, `symbol`, `sunrise`/`sunset` (ISO with offset); the UI shows 7 days (the
  in-progress validator caps the array at 16).
- `attribution`: `provider`, `text`, `url`; **+`license` and +`licenseUrl`** (CC BY requires a link to
  the licence, and the text/URL must switch with the fallback).
- +Query addition: `timeZone?: string` — Open-Meteo resolves it with `timezone=auto`, but the MET adapter
  cannot (it returns UTC only) and needs the place's IANA zone from the caller; without it the fallback
  either cannot render local times or would have to import a timezone database.
- Normalization rules: map provider codes to `WeatherSymbol` in one shared table (Open-Meteo WMO codes,
  MET `symbol_code`, any future provider); convert everything to metric; timestamps must be **ISO 8601
  with an explicit numeric offset** (the in-progress validator's `ISO_WITH_OFFSET` accepts neither a
  bare `Z` nor a raw epoch), so a UTC-only provider's timestamps are converted through the place's IANA
  zone — which is why `timeZone` must be part of the query; use the zone-correct offset for that
  instant, not one request-time offset, so a DST transition cannot shift the hour; the UI formats with
  `Intl` in the place's `timeZone`, and one formatter decides the numeral system (the statistics code
  deliberately uses Latin digits for alignment — pick one policy and keep weather consistent with it).

Contract gaps found at authoring time, confirmed against the in-progress validator: `WeatherAttribution`
has `provider`/`text`/`url` but no **`licenseUrl`** (CC BY needs the licence link), `WeatherSnapshot`
has no **`expiresAt`**, `WeatherQuery` has no **`timeZone`** (the offset-qualified ISO rule makes a
UTC-only fallback impossible without it), and the units field says only `metric | imperial` while the
normalized values need explicit display units (°C, km/h, mm, %). The in-progress code already assumes
`"open-meteo"` as the default provider id in `weatherPlaceId`, so the recommendation matches the moving
implementation.

Tests the boundary must carry (deterministic, no live network in CI):

- Adapter unit tests with recorded fixtures for **Berlin and Cairo**, plus one DST-transition date:
  assert normalized symbols/units/epochs, that daily boundaries land on local midnight, and that a
  missing optional field never becomes `undefined` in a render path.
- Cache tests: corrupt/foreign/old-version JSON is discarded; a valid snapshot survives a reload; no
  request from cache when fresh; stale serves immediately and revalidates once.
- Fallback tests: 429/5xx/timeout switches provider and **attribution follows the snapshot**; a 4xx
  invalid input does not switch; two failures open the circuit; snapshots are never merged.
- Privacy tests: the request contains rounded coordinates only, the server route logs no coordinates,
  and "forget everything" clears the weather cache.
- UI: the weather surface requests nothing while hidden, renders with no provider body fields, and shows
  the attribution line from the snapshot.

## Integration constraints in this repository

These are facts about the current tree, checked 2026-11-17; each is a constraint the integration must
satisfy or an explicit product decision must change it.

- **CSP.** Web headers set `connect-src 'self'` (`scripts/build-headers.mjs`), and the packaged app's meta
  CSP lists only the API origin, DeepSeek and AssemblyAI (`scripts/prepare-native-web.mjs`). A direct
  browser→provider request would require widening both; the recommended same-origin `/api/weather` route
  requires **no CSP change** and keeps the packaged policy narrow.
- **Permissions-Policy / Android (changed while this research ran).** The working tree now sets
  `Permissions-Policy: geolocation=(self)` (`scripts/build-headers.mjs`) and adds
  `ACCESS_COARSE_LOCATION` to the manifest with a coarse-only Capacitor patch
  (`patches/@capacitor+android+8.6.2+001+geolocation-coarse.patch`); there is no FINE and no background
  location. The weather surface must still be built on consent + coarse fix + 2-decimal quantization,
  and the public disclosure in `/about` must move in the same change. An IP/network fallback is not a
  substitute for a consented place in this product.
- **Server owns providers.** Provider calls belong in a server route/module, like the translation and
  speech boundaries. That also gives MET the identifying User-Agent it requires, keeps the future
  commercial Open-Meteo key server-side, gives one place for caching and fallback, and prevents a client
  bundle from ever growing a provider key.
- **Admission control.** The in-progress work already adds separate weather buckets (`takeWeatherToken =
  createLimiter(30, 0.5)`, `takePlaceToken = createLimiter(20, 0.5)` in `src/lib/weather/throttle.ts`,
  reusing the shared limiter factory); moving them beside the other purposes is a lead decision. A
  weather read must never spend the translation typing budget. Bound the query server-side:
  latitude −90..90, longitude −180..180, 2 decimals, fixed units/provider list, no free-form URLs.
- **Logging.** The route may log event/outcome/duration/count only; never coordinates, place names or
  provider bodies.
- **Persistence.** Use the device-settings API (`readDeviceValue`/`writeDeviceValue` from
  `src/lib/persistence/settings.ts`) with a `lingua.weather.*` key, so the web path and Android DataStore
  both clear it through "forget everything"; a bare `localStorage` key would survive the Android clear.
  The in-progress location module already stores `lingua.weather.place.v1` this way; the snapshot cache
  should follow the same rule. Do not add either to the backup whitelist.
- **Copy and numerals.** Feature copy stays in a local COPY object (no `src/lib/i18n.ts` change); weather
  descriptions are mapped from `WeatherSymbol`; numbers go through one formatting helper so German/Arabic
  numerals cannot drift between card and sheet.
- **No secrets.** No provider key in the client, the APK or the repository; Open-Meteo free needs none
  today, and the future customer key is server-only.
- **Attribution is code, not documentation.** The credit line ships with the surface; `/about` and the
  privacy copy are updated in the same change.

## Risks and NOT_VERIFIED

- **Licensing is a legal boundary, not a technical one.** Open-Meteo's free tier forbids commercial use;
  if a monetised release ships on the free endpoint, the project is in breach. The switch in "Licensing
  switch" is mandatory and should be enforced by configuration review.
- Open-Meteo free API has **no uptime guarantee** (documented); measured uptime/latency under load is
  NOT_VERIFIED. The fallback and stale cache are the mitigation.
- Exact Open-Meteo paid-plan prices were not readable (client-rendered page) — NOT_VERIFIED. The plan
  limits are documented (Standard 1M/month, Professional 5M, Enterprise >50M, unlimited rate).
- MET Norway: the documented 403 for a missing/blocked User-Agent was **not** reproduced (curl's default
  UA answered 200) — treat it as documented policy; MET's global model resolution is NOT_VERIFIED on the
  checked pages; 6-hourly non-Nordic cadence is documented.
- Bright Sky: update cadence, rate limits, reliability of a single-maintainer public instance and
  privacy/logging are NOT_VERIFIED; outside Germany its observation path returns 404 (probed).
- OpenWeatherMap: data licence beyond the FAQ, caching terms and free-plan coverage are NOT_VERIFIED (no
  key available for a valid probe).
- Visual Crossing: free/anonymous allowances, free-tier attribution and terms for a no-account production
  app are NOT_VERIFIED; anonymous mode lacked current/hourly (probed).
- **DST transitions** were not probed live (the probes were on one date). Mitigation: store absolute
  instants and render through the returned IANA timezone; add the DST fixture test before shipping.
- **Android/WebView runtime** for the weather route is NOT_VERIFIED (nothing was built or run for this
  research; the phase-II feature is being implemented separately). The route reuses the existing
  same-origin transport, so no new native bridge surface is implied.
- **Location source** is decided by the location/privacy work, not here. If it ends up being device
  geolocation, the header/manifest/privacy checklist above must be completed and this document updated.
- Provider terms can change; before a commercial release re-check the licence pages and the attribution
  strings, and record the new review date.

## Sources

All accessed 2026-11-17.

- Open-Meteo docs: https://open-meteo.com/en/docs
- Open-Meteo terms of use / privacy: https://open-meteo.com/en/terms
- Open-Meteo pricing: https://open-meteo.com/en/pricing
- Open-Meteo about: https://open-meteo.com/en/about
- MET Norway terms of service: https://api.met.no/doc/TermsOfService
- MET Norway licensing and data policy: https://api.met.no/doc/License
- MET Norway FAQ: https://api.met.no/doc/FAQ
- MET Norway locationforecast 2.0 documentation: https://api.met.no/weatherapi/locationforecast/2.0/documentation
- Bright Sky API description (OpenAPI): https://api.brightsky.dev/openapi.json
- Bright Sky project page: https://brightsky.dev/
- DWD legal notice / terms: https://www.dwd.de/EN/service/legal_notice/legal_notice.html
- OpenWeatherMap pricing: https://openweathermap.org/price
- OpenWeatherMap FAQ (licence/attribution): https://openweathermap.org/faq
- Visual Crossing Weather API: https://www.visualcrossing.com/weather-api
- Visual Crossing plans and attribution: https://www.visualcrossing.com/weather-data-editions
- Visual Crossing weather-services terms: https://www.visualcrossing.com/weather-services-terms/
- Nominatim usage policy (geocoding referenced by the in-progress location work; outside this
  document's provider decision and NOT_VERIFIED here): https://operations.osmfoundation.org/policies/nominatim/
- Probe record and commands: `artifacts/phase2/task-12.md` (gitignored, not authoritative for the
  product)
