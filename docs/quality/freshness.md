# Dependency freshness

Status: **Report-only** (installed 2026-11-20; 46 of 49 packages on FRONTIER after the same-day
upgrade session; 3 RED remain and need an owner waiver or an upstream release). This is the
project-level enforcement of the global `latest-tech-mandate` skill: every dependency starts at the
newest verified stable release, carries a source and a date in this ledger, and can only stay behind
through a dated waiver.

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

## Ledger — 2026-11-20 (after the upgrade session)

| Metric            | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Packages compared | 49 (`dependencies` + `devDependencies`, resolved from `package-lock.json`) |
| FRONTIER          | 46                                                                         |
| YELLOW            | 0                                                                          |
| RED               | 3                                                                          |
| UNKNOWN / ERROR   | 0 / 0                                                                      |

Upgraded in the 2026-11-20 session (all gates green after each step): every in-range patch/minor
(Vite 8.3.8, Vitest 5.1.1, React 19.3.1, react-query 5.108.2, plugin-react 6.3.0, lucide-react 1.77.0,
Tailwind 4.3.5, Prettier 3.10.1, TanStack Router/Start/plugin, the pinned Lovable config), plus the
three majors **jest-dom 8.0.0**, **jsdom 31.0.1** and **vite-plugin-pwa 2.0.0**. TypeScript 7.0.2 was
installed and `tsc --noEmit` passed with zero errors, but `typescript-eslint` refuses to run against
TS 7.0 (`does not support TS 7.0`), so the repository keeps the TS 6 API for linting plus the
`@typescript/native` 7.1 preview alias for the native peer — the documented side-by-side mode.

RED items left after the session, with the evidence behind each (waiver decision still the owner's):

| Package              | Resolved        | Latest        | Why RED                           | Constraint / candidate action                                                                                                      |
| -------------------- | --------------- | ------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `typescript`         | 6.0.3           | 7.0.2         | major behind                      | `typescript-eslint` does not support TS 7.0; TS 7 passed `tsc` but lint crashed. Revisit when typescript-eslint supports TS >=7.1. |
| `@typescript/native` | 7.1.0-beta      | 7.0.2         | prerelease resolved               | Required peer for typescript-eslint 8.73 and the native compiler; pinned in `8361fc4` so clean `npm ci` works.                     |
| `nitro`              | 3.0.260603-beta | 3.0.261103-rc | prerelease resolved, no stable v3 | Nitro v3 has no stable release; the 2026-11-03 RC is the newest candidate.                                                         |

## Waivers

Machine-readable waivers live in [`freshness-waivers.json`](freshness-waivers.json): each entry needs
`package`, `reason`, `owner`, `approved`, `expires`, `remediation`. An expired waiver becomes RED
again. Waivers are the owner's decision — an agent must not approve its own exception.

## Staging (rollout)

1. **Report (installed 2026-11-20)**: `npm run freshness` runs locally and as a CI step; it writes
   the artifact and prints RED, but does not fail. This makes drift visible without blocking work.
2. **Burn-down (done 2026-11-20)**: six of the nine original RED items were upgraded in
   dependency-sized change sets, each verified with `typecheck`, `lint`, `test` and `build`; the
   remaining three are blocked by an upstream constraint (see the table above) and need the owner's
   dated waiver, or an upstream release.
3. **Enforce**: run `npm run freshness:enforce` in CI and add it to the `verify` chain once RED = 0
   (or every RED has an unexpired waiver).
4. **Keep**: run a weekly scheduled audit and review this ledger whenever dependencies are added or
   upgraded; add the gate to the release Definition of Done at enforcement time.
