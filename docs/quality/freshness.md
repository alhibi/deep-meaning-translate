# Dependency freshness

Status: **Report-only** (installed 2026-11-20; enforcement starts after the RED list is fixed or
waived). This is the project-level enforcement of the global `latest-tech-mandate` skill: every
dependency starts at the newest verified stable release, carries a source and a date in this ledger,
and can only stay behind through a dated waiver.

## Commands

```sh
npm run freshness          # report: never fails; prints RED/YELLOW and writes artifacts/freshness.json
npm run freshness:enforce  # gate: exits 1 on any RED or ERROR (wire once RED = 0)
```

The script compares the **resolved** version in `package-lock.json` — not the declared range — with
the latest stable release on the npm registry (`registry.npmjs.org/<pkg>/latest`), so it reports what
is actually installed. `artifacts/freshness.json` is the machine-readable evidence (gitignored).

## Status budget

| Status        | Meaning                                                               | Delivery                      |
| ------------- | --------------------------------------------------------------------- | ----------------------------- |
| FRONTIER      | Resolved version equals the latest stable release                     | allowed                       |
| YELLOW        | Same major, one minor or a patch behind                               | fix in this work stream       |
| RED           | Two or more minors behind, any major behind, or a prerelease resolved | blocked until fixed or waived |
| WAIVED        | RED with an unexpired, owner-approved waiver                          | allowed until expiry          |
| UNKNOWN/ERROR | Not in the lockfile, unparseable version, or registry lookup failed   | blocked until resolved        |

## Ledger — 2026-11-20 (first run)

| Metric            | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Packages compared | 49 (`dependencies` + `devDependencies`, resolved from `package-lock.json`) |
| FRONTIER          | 27                                                                         |
| YELLOW            | 13                                                                         |
| RED               | 9                                                                          |
| UNKNOWN / ERROR   | 0 / 0                                                                      |

RED items and their disposition (decision pending the owner):

| Package                     | Resolved        | Latest        | Why RED                           | Candidate action                                |
| --------------------------- | --------------- | ------------- | --------------------------------- | ----------------------------------------------- |
| `@tanstack/react-query`     | 5.104.5         | 5.108.2       | 4 minors behind                   | upgrade; peer-compatible with React 19          |
| `@testing-library/jest-dom` | 7.0.1           | 8.0.0         | major behind                      | upgrade with Vitest 5.1 (8.x requires Vitest 5) |
| `@typescript/native`        | 7.1.0-beta      | 7.0.2         | prerelease resolved               | deliberate TS 7 preview; waiver candidate       |
| `@vitejs/plugin-react`      | 6.1.2           | 6.3.0         | 2 minors behind                   | upgrade with Vite 8.3.8                         |
| `jsdom`                     | 30.1.3          | 31.0.1        | major behind                      | check jsdom 31 test-environment changes         |
| `lucide-react`              | 1.61.0          | 1.77.0        | 16 minors behind                  | upgrade; icon API is stable on 1.x              |
| `nitro`                     | 3.0.260603-beta | 3.0.261103-rc | prerelease resolved, no stable v3 | waiver candidate until Nitro v3 ships stable    |
| `typescript`                | 6.0.3           | 7.0.2         | major behind                      | native-compiler migration; separate change set  |
| `vite-plugin-pwa`           | 1.3.0           | 2.0.0         | major behind                      | check the 2.x service-worker/precache migration |

## Waivers

Machine-readable waivers live in [`freshness-waivers.json`](freshness-waivers.json): each entry needs
`package`, `reason`, `owner`, `approved`, `expires`, `remediation`. An expired waiver becomes RED
again. Waivers are the owner's decision — an agent must not approve its own exception.

## Staging (rollout)

1. **Report (installed 2026-11-20)**: `npm run freshness` runs locally and as a CI step; it writes
   the artifact and prints RED, but does not fail. This makes drift visible without blocking work.
2. **Burn-down**: fix the seven non-prerelease RED items in dependency-sized change sets, each with
   the gates that cover it (`typecheck`, `lint`, `test`, `build`); record the two prereleases as
   waivers or replace them when a stable release exists.
3. **Enforce**: run `npm run freshness:enforce` in CI and add it to the `verify` chain once RED = 0
   (or every RED has an unexpired waiver).
4. **Keep**: run a weekly scheduled audit and review this ledger whenever dependencies are added or
   upgraded; add the gate to the release Definition of Done at enforcement time.
