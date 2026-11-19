# REPORT — lane `fnd-2d` (2026-11-16): `sockets/narrativeGraph.ts` split by area

Saved by the lead from the supervisor's report. All 5 steps done in order, each green before the next; moves by
the fnd-2c move tool (byte-identical blocks; the file changed nowhere else outside its imports).
`registerNarrativeGraphHandlers` untouched.

| Step | New file (lines, units) | `narrativeGraph.ts` after |
|---|---|---|
| 0 | — | 6,194 |
| 1 | `narrativeGraph.shared.ts` (508; 15) | 5,739 |
| 2 | `narrativeGraph.apply.ts` (1,873; 39) | 3,949 |
| 3 | `narrativeGraph.merge.ts` (1,820; 16) | 2,180 |
| 4 | `narrativeGraph.build.ts` (1,041; 4) + the test path | 1,156 |
| 5 | `narrativeGraph.relationships.ts` (734; 15) | **453** |

Checks per step: `tsc` 0; export set 16 names, identical; no new file imports `narrativeGraph.ts`; registration
text identical; 51 test files (`plans/fnd-2d-0..5.log`), the only failures two that belong to other lanes
(`wiring.test.ts` §3 run options: fixed by the lead, `stepTimeLimitsOff` recorded; `commentHistory` on
`pipelines/boot/sessionOverrideFold.ts`: lane ss-2a's in-flight comment). Proofs: all 96 top-level units verbatim
exactly once across the six modules. `npm run check` 0 errors.

Module-level state: `buildResumeStates`, `buildResumeScopes` only in `narrativeGraph.build.ts`;
`buildsBeingApplied` only in `narrativeGraph.apply.ts`. `rewriteMergeLogCastTags`, `deleteMemberStats` live in
merge (the node delete, which stays, imports them). Stays in `narrativeGraph.ts`: imports and re-exports, the
list handler, node delete, merge-references check, merge-log list, the two duplicate handlers, the old notes,
the registration.

Other files: `activity.connectionLeak.test.ts` (one path string); `commentHistory.ratchet.json` (10 → apply 3,
build 6, relationships 1).

## Noticed, not done

- `endpointColumns` (in `relationships`) has no caller.
- Comments in `activity.ts:28`, `castTags.ts:230`, `graphBuilder.ts:660`, `entries.ts:675`,
  `scenes.ts:82/1736/2438` still point at `narrativeGraph.ts` for moved code.
