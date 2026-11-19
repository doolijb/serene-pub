# REPORT — lane `perf-2` (2026-11-17): statements per reply, second pass (programme 0.5)

Four of five cuts in; cut 4 rejected. Every prompt fingerprint byte-identical to `plans/perf-1-shas-c2.txt` after each cut and in the final run. Second-world statements per reply: **Story 1396 → 1036 (−26 %); the Lair 3932 → 2500 (−36 %)**. (From the day's start: Story 2076 → 1036, the Lair 4668 → 2500.)

## Cuts
1. **Variable templates read once per build** (`config/world.ts`): `readVariableLayoutRows` makes one `IN (…)` read; `variableLayoutLookups` answers in memory what `pubLayoutOf`, `layoutByReference`, `defaultVariableTemplateFor`, `layoutOfValue` / `resolveVariableTemplate`, `isAutomaticRow`, `referencedLayoutOf` answered. Story −303, Lair −838. Proof: 869 scratch worlds (every preset × every spec, plus a session with a preset-level and a pub-wide layout for one variable) byte-identical. Invalidation: none needed (rows live for one build). Tests in `variableResolution.int.test.ts` (one statement per build; precedence; each in-memory lookup equals its database helper).
2. **The run's settings read uses the run's host** (`sessions/settings.ts`, `runTurn.ts`): the run creates its host first and passes `{ host }`; `readCast` drops the two keys only a run's scope adds (`viewerUserId`, `turnChannelVoice`), so the settings document is unchanged. Story −57, Lair −109 (below the estimate: only the reply run read the cast twice). Invalidation: a cast-table write outside the host between the settings read and the run's first cast read (none found); host writes are covered by the memo's clears. Test `sessions/sessionSettings.runHost.int.test.ts`.
3. **`rowNaming` builds the narrator name only when the own voice needs it** (`sessions/turnYield.ts`): asks `ownVoiceName({ envoys })` against `ownVoiceName(null)` first. Lair −285. No memo. Test `sessions/turnYield.rowNaming.int.test.ts`.
4. **Rejected:** `runTurn.ts:996` runs once per run; the "two builds" are two runs (the reply, and a routine through `sessionEvents.ts:1018`) with different specs.
5. **The actions push reads the session's functions once per list** (`sessionActions.ts` `formCollectsOf` gains `opts.offered`; `buildSessionActions`): Lair −200. Proof: owner and guest payloads serialised byte-identical. Test `sockets/sessions.actionsOnce.int.test.ts`.

| | Story a (1st/2nd) · c · d · e | Lair a (1st/2nd) · c · d · e |
|---|---|---|
| before | 2122/1396 · 2104 · 2044 · 1711 | 3936/3932 · 3932 · 3299 · 3948 |
| cut 1 | 1642/1093 · 1624 · 1514 · 1345 | 3098/3094 · 3097 · 2520 · 3107 |
| cut 2 | 1585/1036 · 1567 · 1457 · 1288 | 2989/2985 · 2988 · 2411 · 2998 |
| cut 3 | = | 2704/2700 · 2703 · 2125 · 2713 |
| cut 5 | = | 2504/2500 · 2503 · 1925 · 2513 |

## Tests
Baselines after each cut (`plans/perf-2-c{0,1,2,3,5}.log`; shas `plans/perf-2-shas-*.txt`). Grouped run `plans/perf-2-final.log`: 16 files, 137/137. `tsc` 0.

## What remains
- `host.ts:2280`, the `session-settings` query case: passing `{ host }` saves one narrator build and one cast read in the Lair.
- `sessionSpeech.ts:22` reads settings on its own host after the turn.
- `rewind.ts`: `rewindStateOf` runs `turnUnitOf` twice (~300 statements per push); in a genre with no fallback envoy each check still builds the narrator name.
- `actionsPush.ts`: `listSessionFunctions` ignores `userId`: once per push rather than once per member.
- `turnDeleteRefusedThrough`; the per-member `reading` reads `perf-1` rejected.

## Noticed, not done
- ★ `world.ts` now holds in-memory twins of five helper rules (a parity test guards them); one rule in one home would mean pure extractions in `entities/variableTemplates.ts` and `boot/seedVariableTemplates.ts`.
- A worker imports `isForeignPackageRow` statically where the block imported it dynamically before.
- A worker ran `prettier --write` on its own new test file.

## Scope review and fix task

The scope review found no behaviour difference in any cut. Cut 3 saves nothing in Story, which still builds the narrator name on each rewind check (listed under What remains).

The review found one structural fault: `world.ts` re-implemented six variable-layout rules in memory, so each rule had two homes. Each rule now has one pure function in the module that owns it. The database helper reads rows and calls it, and `variableLayoutLookups` calls the same function over its batched rows.

- `pubLayoutAmong`, `layoutAmongByReference` and `layoutOfRow` are in `entities/variableTemplates.ts`. `pubLayoutOf`, `layoutByReference` and `resolveVariableTemplate` call them.
- `defaultSeedKeysOf`, `firstDefaultCandidate` and `defaultTemplateAmong` are in `boot/seedVariableTemplates.ts`. `defaultVariableTemplateFor` keeps its queries.
- `layoutOfValueRow` is in `registrations/values.ts`, and `layoutOfValue` calls it.
- `referencedLayoutFrom` is in `entities/variableLayouts.ts`, and `referencedLayoutOf` calls it.
- `isAutomaticRow` was already pure and shared.

`variableLayoutLookups` lost its `seedKeysOf` parameter, and `readVariableLayoutRows` no longer imports dynamically. The two comments (`variableLayouts.ts` `referencedLayoutOf`, `variableTemplates.ts` section header) now describe the shared functions.

The parity test (`variableResolution.int.test.ts`) now compares against `pubLayoutOf`, `layoutByReference`, `defaultVariableTemplateFor`, `referencedLayoutOf` and `layoutOfValue` themselves. It gained five fixtures: a seed row on another variable, an empty-string reference, a deleted layout's reference, a disabled plugin's only row, and a withdrawn row that is no plugin's.

Evidence: `plans/perf-2-fix-*.log`. Fingerprints are byte-identical to `plans/perf-2-shas-final.txt`. Story second world is 1036 statements and the Lair is 2500. The one unexplained difference is in a non-baseline variant ("kn-2 story e"): 1288 became 1287, stable across three runs.
