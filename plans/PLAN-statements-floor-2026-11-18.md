# Statements per reply: lowering the floor (lanes p6-0 … p6-5) — 2026-11-18

Status: **GO to plan and build (owner 2026-11-18: "a modder should be able to narrow them considerably. A setup that doesn't have everything enabled already shouldn't be making as many calls" · "Look at what quiries we can gate when a setup doesn't support it." · "actively optimize as you go" · "Are there more database views we can leverage?").** Cold review owed before p6-1 onward; p6-0 (measurement only) starts at once. Measurement: `INVENTORY-statements-floor-2026-11-18.md`. From a read-only pass; every saving is an estimate. Paths under `src/lib/server/`.

## Three findings that change the picture
- **The baselines do not measure production.** Under Vitest the registrations cache is off (`pipelines/registrations/resolve.ts` ~317) and routines are off (`pipelines/routines/runs.ts` ~39): tests over-count `effectiveRegistrations` (4 statements × 21 calls in Story, ~28 in the Lair) and never count routine evaluation, which is why Living measured the same as Minimal.
- **The floor is per-run overhead times three runs.** One small run costs about 200 statements (the Lair's turn-order ask run: 224 = genre catalogue 18, three document loads 24, world build ~60, cast read ~45, registrations 14). Story's ~406 after the reply is two such runs (`story-turn-order`, `round-tick`).
- **The baselines print counts and assert none.** Nothing can regress them today.

## 1. Repeated reads (memos hang on the `createHost` closure, `pipelines/runtime/host.ts` 802–870, where the earlier lanes put theirs; one object `RunReads` with two lifetimes: whole run, and between host boundaries)
| Read | Calls per reply | Changes mid-run? | Read once by | Saved (Story during + after / the Lair) |
|---|---|---|---|---|
| `listSessionGenres` (`pipelines/entities/sessionGenres.ts` 145; 3 statements, the whole catalogue) | 23 [36] | no | whole-run memo; `genreFieldsFor` / `playerLabelFor` take `{ genre }` | ~55 + 30 / ~85 |
| `sessionReadingOf` + `linePresentOf` (`state/reading.ts` 331, 408) | 45 [70]; one cast read calls it 4 times | yes: clock outlets, own-book creation, forks | read once in the cast read and pass `opts.reading` (`cast/memberAsRead.ts` ~502); a boundary-lifetime memo across reads | ~45 + 15 / ~70 |
| `cardsNow` (`cast/seatedCast.ts` 68) | 26 | another request's card edit only | speaker name once per run; one read inside `scriptExtras` | ~20 / ~20 |
| `loadDocument` (`pipelines/boot/store.ts` 1032; 7 + presets statements) | Story 11, the Lair 33 (+80 via `registrations/door.ts` 96 `unservedPipelines`) | no | whole-run memo by version id; pass the loaded document down; one joined query | ~80 + 44 / ~220 |
| `membersAsRead` (`cast/memberAsRead.ts` 747) | twice per cast read | with the cast | once per cast read | ~20 / ~30 |
| `overlayChainOf` (`state/reading.ts` 307) | 15 [27] | with the reading | folded into the reading statement | ~22 / ~40 |
| `effectiveRegistrations` | 21 [28] | generation-keyed already | baselines turn the cache on; pass `registrations` in hand | ~63 measurement + 15 / ~80 + 20 |
| `declarationsAndVariableKeys` (`config/panel/declarations.ts` 964) | twice per build | no | once per build | ~15 + 8 / ~20 |

## 2. Gates (work done today for a setup that does not use it)
| # | What runs | Declared by | Gate | Saves |
|---|---|---|---|---|
| G1 | the round-tick run costs a whole run, then finds no clock or zero round worth | genre field `roundWorth`, the lorebook's Timeline switch, a set clock | a registration `when`, judged before the run starts | ~190 per round |
| G2 | the turn-order ask would start a run for causes an option ignores | the registration | `when` on `event.asked` (built in tc-1d) | ~224 per ask avoided |
| G3 | every run builds the settings document (cast, narrator name) even when its document wires neither | the document's edges | a structural check at `runTurn.ts` ~1068 | ~110 per such run |
| G4 | the cast read builds the narrate world for the narrator's name in genres that never narrate | a narration registration | changes the cast document: **not built; needs the owner** | ~45 × runs |
| G5 | scene context built twice per landed line, in full before the cheap checks (`scenes/boundaryWatcher.ts` 734, 823) | genre shape, scene mode, scene routines | cheap facts first; build once | ~28 per line |
| G6 | `unservedPipelines` (`registrations/unserved.ts` 147) loads whole documents to read node kinds | actions and routines | one joined read of oracle nodes | the Lair ~80–200 |
| G7 | `scriptExtras` and portrayals (`runTurn.ts` 845, 1158) for runs with no script point or speaker | the document | structural | ~15 per run |
| G8 | read-aloud settings on each settled line | speech fields | skip when the genre declares none | ~5 |
Already gated: routine evaluation returns after one registrations read; the ask is raised only where an option is registered; lore, vector, sprite, graph and state reads run only when a pipeline has the node (that gate is the modder's pipeline).

## 2b. Views and fewer round trips
There are no views today. Joined queries that save round trips: `loadDocument` 8 → 1 (`json_agg` subselects); reading + own lorebook + line clock + overlay chain 4 → 1; `cardsNow` 2 → 1. A view adds nothing over the joined query in code for any of them (one caller each; a view costs a migration). A materialized view would be recomputed in the writer's transaction on the one connection and cannot target one session: for effective registrations and the line tree **a per-run memo beats it** (no storage, no migration, cannot go stale across runs). No view enters the lanes.

## 3. Lanes and estimated targets (during + after the reply)
| After lane | Story | Chat | The Lair | Lean genre |
|---|---|---|---|---|
| today | 780 + 406 | 780 + 406 | 1793 + 114 | not measured (guess ~350) |
| p6-1 | ~705 + 380 | same | ~1680 + 110 | −15 |
| p6-2 | ~575 + 290 | same | ~1300 + 100 | −60 |
| p6-3 | ~545 + 290 | same | ~1150 + 95 | — |
| p6-4 | ~520 + 100 | same | ~1100 + 90 | ~180–220 |
- **p6-0 measure (no product code; starts now).** A permanent stack-attributing counter; the after-reply phase counted (`settleSessionEvents`); a Chat baseline; a lean-genre baseline (one reply step, nothing else registered); `<=` ceilings on all four; a variant with the registrations cache on and routines enabled. Files: new `utils/statementProfile.ts`, new `utils/leanGenreFixture.ts`, `pipelines/runtime/unknownEntries.reply.int.test.ts`, `sockets/sessions.lairUnknownEntries.int.test.ts`, new `pipelines/runtime/statementFloor.chat.int.test.ts`, new `pipelines/runtime/statementFloor.leanGenre.int.test.ts`.
- **p6-1 value in hand.** Section 1's reading, overlay, genre, `cardsNow`, `membersAsRead` rows. Files: `pipelines/runtime/host.read.sessionCast.ts`, `cast/memberAsRead.ts`, `state/reading.ts`, `state/storyTime.ts`, `pipelines/runtime/host.loreWrites.ts`, `pipelines/prompt/seatCards.ts`, `pipelines/entities/sessionGenres.ts` (430–480), `pipelines/runtime/runStatus.ts`, `pipelines/scripts/chains.ts`, tests. Not `host.helpers.ts` (tc-1d).
- **p6-2 `RunReads` and documents.** New `pipelines/runtime/runReads.ts`, `host.ts` (memo block), `pipelines/boot/store.ts` (`loadDocument` joined), `config/panel/declarations.ts`, `config/world.ts`, `sessions/settings.ts`, `host.read.lorebookEntries.ts`, `runTurn.ts` (pass the loaded document; this edit before rg-1d starts or after it ends).
- **p6-3 gates outside turn control.** G5, G6: `scenes/boundaryWatcher.ts`, `sessions/sceneSettings.ts`, `registrations/unserved.ts`, `registrations/door.ts`; a test that a preset switched mid-session takes effect on the next line.
- **p6-4 run and event gates (after tc-1g; SDK part after tc-1e).** G1, G3, G7, registrations in hand through `sessionEvents.ts`; SDK `core-catalog/src/shared/roundTick.ts`, `genres/defaults.ts`.
- **p6-5 catalogue cache (after rg-1b).** A generation-keyed genre list with writer invalidation, as `resolve.ts` already does for registrations.

## 4. Proof
Per memo, three tests in the style of `host.sessionCastMemo.int.test.ts`: a write inside the run is seen by the next read in that run; a write between two runs is seen by the second; a failed read is not remembered. Value-in-hand changes are proved by frozen documents captured before the change. Both prompt fingerprints byte-identical in every lane. Memos live in one host closure; two sessions' runs share nothing (p6-5 excepted, invalidated by its writers).

## 5. Decided by the lead
A round tick skipped by its gate leaves no receipt (a declared gate declining is the normal case). A single-seat session still runs its turn order (the push and auto-advance depend on it). The genre list may be cached across runs with writer invalidation (it is the pub's catalogue, not a session's data). **Not built without the owner:** G4 (the cast document would omit the narrator's name where a genre never narrates); the Lair's cast memo miss after embed calls (an outside write seen at the next boundary).

## Cold review corrections (2026-11-18) — these rule over the text above

1. **G7 is dropped.** Portrayals are pinned for every run, speaker or not (`pipelines/runtime/runTurn.ts` 305–310, 842): addressed forms (`host.ts` ~1859), a persona's presence (`host.ts` 3578–3620) and form fires (`runTurn.ts` 1436–1438, 1513) read them. `scriptExtras` is already behind `scriptsOn` (970, 1148). Nothing to build.
2. **G1 is not built without the owner, and its saving is smaller than stated.** (a) Core already writes a receipt when every registration on an event fails its `when` (`sessionEvents.ts` 942–951, `skippedReceipt` 1265–1310; R24): skipping it is a change to a ruling. (b) The gate has nothing to read for "a set clock" (the `round-ended` payload carries only `round` and `speakers`, `routines/moments.ts` 430–435): a new payload field or published value is a new name. (c) A real Story session has a clock (a dated lorebook starts at today), so the round tick does real work there; the saving applies to Chat and clockless sessions only. p6-4's "Story ~520 + 100" was the empty-lorebook fixture: **Story's after-reply target is ~290, not ~100.** Asked of the owner with the receipt question (rulings page PF1, PF2).
3. **The reading memo uses the cast memo's rule, exactly.** Host boundaries (`host.ts` 863–869) are only `host.call` and `host.commit`; clock moves happen outside both, through `castWrite` (`bindings.state.ts` ~1070 `recordClockMove`, ~1088 `proposeClockChange`). So "between host boundaries" means: the `hostInFlight` bypass plus the `castWrite` epoch (`host.ts` 2606–2609). Every `RunReads` entry, the whole-run ones included, bypasses while a commit is in flight (a promise pending on the outer handle awaited inside a transaction hangs silently; `db/transactionGuard.ts` 14–20 only refuses queries issued inside the transaction's context). p6-2's brief lists every writer of the reading with file:line and tests that a `castWrite` clock move inside the run is seen by the next read in that run. This answers perf-1's earlier rejection of this memo ("host calls change with clock moves and forks").
4. **Order against cast Memory and phase 3.** p6-1 and p6-2 land BEFORE cm-C (cast Memory's read: `state/reading.ts`, `cast/memberAsRead.ts`, `host.read.lorebookEntries.ts`), and the reading memo is keyed so a speaker's swapped reading can never be served for the session's (key = session + line + moment, never session alone); cm-C is then written on top of it. **G8 is dropped**: read aloud becomes a droppable registration under G3C (phase 3.4). p6-4's SDK edit to `core-catalog/src/genres/defaults.ts` is sequenced after rg-1f.
5. **p6-5 is dropped.** After p6-2's whole-run memo it would save about three statements a run, it would need invalidation from the plugin lifecycle as well as database writes (`listSessionGenres` reads the live SDK registry, `sessionGenres.ts` ~205), and module-level state breaks on a dev reload.

**Lanes after the review:** p6-0 (running) → p6-1 → p6-2 → p6-3 (G5, G6) → p6-4 (G3, registrations in hand; G1 only if the owner says so). Estimated targets, during + after: Story and Chat ~545 + 290; the Lair ~1150 + 95; a lean genre ~200–250.

**Ruled (owner, 2026-11-18):** PF1 a condition that reads only the event declines with no run-list line; one that reads the session keeps its line. PF2 the round tick is skipped where there is no clock to move (G1 is go; one new fact on the round's event; a clockless or Chat session saves ~190 a round). PF3 the narrator's name is left out where the genre registers no narration (G4 is go). Both join p6-4.
