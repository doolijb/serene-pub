# REPORT — lane `sense-clk3` — 2026-11-11 (saved by the lead; condensed from the supervisor's and worker w1's messages)

## Part B — a ruleset conversion keeps a renamed value's stamp: DONE

- `GIVEN_WRITE_STAMP`, a `unique symbol` in `src/lib/server/state/write.ts`. `setValue`'s change becomes
  `ValueChange & { readonly [GIVEN_WRITE_STAMP]?: ValueWriteStamp | null }`. Absent: stamps now, as before. A stamp:
  its five clock columns and `createdAt` are written, the session clock is not read. `null`: no stamp. A symbol
  cannot travel in JSON, so no plugin or socket payload can forge it; `applyChange` and every other caller are
  unchanged.
- `sessions/convertRuleset.ts`: the renamed value (~189) passes the old row's stamp; the added default (~244) passes
  `null`.
- Tests: `convertRuleset.int`, `valueStamp.int`, `writtenAgo.int` — 26 passed. A renamed value's minutes count from
  the original write (120, not 90 from the conversion); an added default's five columns are null. The scope review's
  branch test was added and **passes** (an as-of read at a copied line in a branch returns the copied value).
  `tsc` clean. `docs/rulesets.md:129` one sentence; NOMENCLATURE §25 records the symbol.
- **★CLK3-1:** an added default's real seconds start at the conversion (`created_at` is NOT NULL); only its story
  minutes read unknown. Recommended: accept.

## Part A — the Lair's Words only clock: built, blocked on a store defect, handed to `sense-clk4`

- On disk: Words only registers the round tick in `core-catalog/src/seed/presets.ts`
  (`register: [register(coreEvents.roundEnded, roundTickSpec())]`, no new export). The round tick gained a third
  gate: `core:query/session-settings@1` (`modes`) and a junction `keeper` on
  `routineModes.core:spec/lair-keeper` with empty branches `review` and `full` and an otherwise branch `tick` holding
  `advance`. Docs sentences in `docs/genre-lair.md`, `docs/lorebook-time.md`, `guides/time.md`. SDK digest re-pinned
  `1270b6f1409384bb` → `4347914b6a33b299`.
- **Blocker:** `boot/store.ts` `chainsOf` rebuilds chains from members only, so empty branches vanish on load, the
  default fires, and Words only with the keeper on moves the clock twice (two `tick` rows, 09:05 and 09:10).
- Red until `sense-clk4` lands: `clockOwners.int` 5/6; `coreGenreDefaults` 15/17 (old outlet key; parity list);
  `specHashes` (`core:spec/round-tick@1.0.0` recorded `123220d7c924ea`, code `1bbd2ef958b218`).
- **★CLK3-2:** the shared round tick names the Lair keeper's id in its gate. A plugin genre whose routine owns the
  clock should not register the tick. Recommended: keep; a published "owns the clock" fact would be a new name.

## Noticed, not done

- `sessions/rewind.ts:851` comment is stale.
- Story's round tick now runs one `session-settings` read each round that has a clock (placed after both gates).
- A keeper on the per-turn cadence moves the round worth every turn (already so under Rules).
- Generated docs (`src/lib/generated/docs/manifest.json`, `search.json`) list the old outlet key.
- No scope review yet for clk2, clk3 or clk4.
