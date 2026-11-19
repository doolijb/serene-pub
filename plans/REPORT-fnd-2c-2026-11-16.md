# REPORT — lane `fnd-2c` (2026-11-16): `sockets/sessions.ts` split by area

Saved by the lead from the supervisor's report. All 8 steps landed in order, each green before the next; moves
by the fnd-2b move tool (byte-identical blocks; `sessions.ts` changed nowhere else). `registerSessionHandlers`
untouched: every handler was already a top-level `export const`.

| Step | New file (lines, units) | `sessions.ts` after |
|---|---|---|
| 0 | — | 12,643 |
| 1 | `sessions.shared.ts` (1,666; 25) | 11,043 |
| 2 | `sessions.messages.ts` (2,467; 16) | 8,659 |
| 3 | `sessions.pipelines.ts` (1,508; 21) | 7,207 |
| 4 | `sessions.create.ts` (1,164; 2) | 6,071 |
| 5 | `sessions.update.ts` (1,196; 3) | 4,908 |
| 6 | `sessions.layout.ts` (1,002; 22) | 3,948 |
| 7 | `sessions.turns.ts` (799; 7) + the `fireTurnOnly` test path | 3,182 |
| 8a | `sessions.participants.ts` (946; 5) | 2,260 |
| 8b | `sessions.overlay.ts` (225; 6) | **2,059** |

Checks per step: `tsc` 0; export set 86 names, identical; no new file imports `sessions.ts`; registration text
identical; targeted tests (`plans/fnd-2c-*.log`); final list 118 files, 117 passed, `dungeonCrawlerWalk2` timed
out under load and passed alone; `ownBooks.fold` passed every run. Proofs: all 130 top-level units verbatim
exactly once across `sessions*.ts`; `sessions.ts` outside the import block equals the original minus the moved
units. Final `tsc` 0; `npm run check` 0 errors.

Decisions: single-area units moved with their area; `withSessionExtras` in shared; messages page, channel-lanes
and lane-read reads in messages; `heldRerunRefusal` in messages beside the presses it guards (turns imports it);
the busy door stays inline in `sessionsFireActionHandler` (pipelines); two duplicated comment lines removed from
`sessions.pipelines.ts`. No module-level mutable state; constants each in one module.

Stays in `sessions.ts`: list, typing, delete, view, get, annex, branch, share-as-lorebook, revision notice, side
character, favourite, narrator name, envoy seat; the guest handlers and `emitMemberEvent` (pinned by
`socketEgress.test.ts`'s path string).

Lead, after the lane: `characters/frozenColumns.guard.test.ts` now treats `sessions.*.ts` as session paths (the
nine new files escaped its stricter check).

## Noticed, not done

- Moving the guest handlers needs the path string in `socketEgress.test.ts` changed.
- `fireTurnOnly`'s negative checks read only `sessions.turns.ts`.
- A stray comment `// Registration function for all session handlers` sits in `sessions.participants.ts`.
- About 14 files' comments point at `sockets/sessions.ts` for code that moved.
- Wait loops must match `node .*bin/vitest`, not `vitest` (matches its own shell).
