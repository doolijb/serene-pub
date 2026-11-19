# REPORT — lane `perf-1` (2026-11-17): statements per reply (programme 0.5)

Two per-run memos on the host. Every prompt fingerprint in both baselines byte-identical to `plans/wt-1b-fix-shas-sup.txt`. Statements per reply, second world: **Story 2076 → 1396 (−33 %), the Lair 4668 → 3932 (−16 %)**. Full profile: `plans/INVENTORY-statements-per-reply-2026-11-17.md`.

## Profile (second world)
| Bucket | Story | Lair |
|---|---|---|
| `narratorNameFor` → whole `buildWorld` (112 statements per call; 8 / 18 calls) | 896 | 2016 |
| `session_cast` read (~53 each; 8 / 13 reads) | 424 | 663 |
| Actions push after the turn (`sessionActions.ts`, `rewind.ts`) | 0 | 940 |
| `runTurn.ts:996` `buildWorld` ×2 per run | 160 | 199 |
| Other host reads and writes | 321 | 351 |
Top repeated shape: `pipeline_variable_templates` (548 in Story, 1152 in the Lair): `buildWorld` reads 4 times per variable on every build.

## Cuts
1. **Narrator name, once per host** (`narratorNameOf` in `host.ts`; `readSessionCast` takes it as a third argument; the narration outlet uses it). Story 2076 → 1612; Lair 4668 → 4088. Invalidation: nothing a run writes reaches its inputs (no host or binding writes config, prompts, presets, registrations, connections, or the session's genre or preset); a failed read is not remembered; the next run builds a new host. Test `host.narratorNameMemo.int.test.ts`.
2. **`session_cast`, once per host** (`sessionCastReads`; every caller gets a `structuredClone`). Story 1612 → 1396; Lair 4088 → 3932. Invalidation: cleared when any `host.call` or `host.commit` starts and again when it ends; a failed read is not remembered. Test `host.sessionCastMemo.int.test.ts` (a bench commit in the same run is seen by the next read).

| | Story a (1st/2nd) · c · d · e | Lair a (1st/2nd) · c · d · e |
|---|---|---|
| before | 2802/2076 · 2784 · 2554 · 2391 | 4672/4668 · 4668 · 3806 · 4681 |
| after cut 1 | 2338/1612 · 2320 · 2206 · 1927 | 4092/4088 · 4088 · 3458 · 4101 |
| after cut 2 | 2122/1396 · 2104 · 2044 · 1711 | 3936/3932 · 3932 · 3299 · 3948 |

## Rejected
A per-run memo of the session's reading (`state/reading.ts`: most calls come from `cast/memberAsRead.ts` with no run object; host calls change with clock moves and forks); memoising the lore read's session row / own book / reading (~1 %); merging the two `membersAsRead` calls in one cast read (~10 per read, structural).

## What remains (outside the lane's files: lane `perf-2`)
- `buildWorld` variable templates (`config/world.ts` 1276–1407): one `IN (…)` read per build: ~290 (Story) / ~700 (Lair).
- `resolveSessionSettings` builds its own host (`sessions/settings.ts:306`); `runTurn.ts:1064` reads settings before the run's host exists (:1137): ~330 / ~500.
- `turnYield.ts:243` builds the narrator name on each rewind check: ~560 in the Lair.
- Actions push (`sessionActions.ts` 311 / 325 / 506 / 902, via `sockets/sessions.pipelines.ts`): ~740 in the Lair.
- `runTurn.ts:996`: two builds per run: ~160 / ~200.

## Tests
Both baselines after each cut (`plans/perf-1-c1.log`, `perf-1-c2.log`; shas `plans/perf-1-shas-*.txt`): identical. Grouped run `plans/perf-1-final.log`: 12 files, 110/110 (genreParity, lairWalk, dungeonCrawler, envoyRoad, both baselines, both memo tests, nonCastLabels, setSeatBench, two guard tests). `tsc` 0.

## Noticed, not done
- The baselines count only `client.query`: statements run on a PGlite transaction's own handle are not counted.

## Scope review and fix task (perf-1-fix)

The cast memo could serve a read a write had overtaken. Fixed:

- **In-flight rule.** `host.call` / `host.commit` count in flight (`hostInFlight`, `host.ts`); while above 0 the `session_cast` memo is neither read nor written. It is cleared when the count rises from 0 and when it returns to 0.
- **Writers outside both wrappers** go through `castWrite` (new leaf `pipelines/runtime/sessionCastWrites.ts`): bypass while one is in flight, and an entry stored before one began or ended is dropped (epoch). Sites: `bindings.state.ts` `recordClockMove`, `proposeClockChange`, `applyAutomatic`, `proposeChange` (set-state outlet); `host.call.ts` tool `propose` door. The filing-tool doors (`fileLore`, `forgetLore`, `makeImage`) run only inside `host.call`, so the in-flight rule covers them. No other write on `db` in `bindings*.ts` / `host.call.ts`.
- Comment at `host.ts` narrowed. A write by another request is still not seen (as before the memo).
- Tests: `host.sessionCastMemo.int.test.ts` (clock commit, call that moves `replyCount`, set-state apply, tool propose door, read during a held call, `castWrite` window), `host.narratorNameMemo.int.test.ts` (same-run write). 13 passed (`plans/perf-1-fix-10.log`).
- Baselines (`plans/perf-1-fix-9.log`, `plans/perf-1-shas-fix.txt`): all eight fingerprints byte-identical to `perf-1-shas-final.txt`; statement counts unchanged (Story 2122 / second world 1396, Lair 3936 / 3932): no reads happen inside a call in these runs, so the bypass gave nothing back. `tsc` clean (`plans/perf-1-fix-tsc.log`).
- Worker 2's report file `REPORT-perf-1-w2.md` was never written; its log is `plans/perf-1-w2-1.log`.
