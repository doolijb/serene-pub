# BRIEF — lane `s4-fold2` (wave 6 follow-up) — own notes on the session's line for writes and branches too

Read `plans/briefs/BRIEF-s4-common.md`, the owner ruling **★bk-fold-1 (2026-11-08): "a session on its own notes reads them on its own line and moment, like any book"**, and **`plans/REPORT-s4-fold-2026-11-08.md` in full** (★s4-fold-1 list, ★s4-fold-2, ★s4-fold-4, its NOMENCLATURE queue), plus `plans/REPORT-s4-tidy-2026-11-08.md` ("Queued to the lead": the three doc links). Like any book means writes land where the session reads: on its line, dated at its clock.

## Goal

1. **Own-book writes land on the session's line** (★s4-fold-1), for a session with no attached book that stands on a line of its own book: `characters/versions.ts` ~1890 (own-book cast versions — on the line, dated at the clock), `state/durable.ts` ~205–210 (own-book captures), `pipelines/runtime/host.ts` ~1611–1622 (own-book lore writes; no literal `MAIN_LINE`), `sockets/storyClock.ts` ~80/93 (no early return for own-notes), `state/resolve.ts` ~865 `storyDateOf` (answers from the own reading), `sockets/narrativeGraph.ts` ~1053 (accepts the own book), `sockets/sessions.ts` ~6297 `sessionLinePatch` (a folded session may change line on its own book — **only that function**). A session on main behaves exactly as today (test).
2. **Branching a folded session carries its line:** `sessions/branch.ts` ~129 + `ownBook.ts` `copyOwnBookToBranch` copy the own book's rows the branch needs on the session's line (not just main) and give the branch a line that reads the same at the fork. Test: branch after a fold on a non-main line reads the same as its parent at the fork message.
3. **Branch of a branch whose ancestors hold overlays of M** (fold refuses it today): make it foldable if the fix is small (ancestors' overlays follow M→M′ for the folding session's reading only); else leave the refusal, list it, and say so.
4. **★s4-fold-2 (host reads):** `host.ts` ~4197 → `(await sessionReadingOf(db, sessionId)) ?? MAIN_HEAD`; ~4874 → `bookId === sessionReading?.lorebookId ? sessionReading : MAIN_HEAD`; add the test of a pipeline reading its own notes while a clock is set (~1119/~1139 behaviour). Grep `host.ts` and `bindings.ts` for other `MAIN_HEAD`/`attachedId` assumptions on lore reads and fix the ones that read a session's own notes.
5. **★s4-fold-4 copy:** `SHARE_REFUSALS.attached` → _"This session reads a lorebook, so its notes are shared to that lorebook, or that lorebook is merged into them."_ (lead decision; any further copy is ★).
6. **Docs & canon:** the three links (`docs/lorebooks.md:164`, `docs/sessions.md:142`, `docs/sessions.md:721` → "[Characters](./characters.md)" — check line numbers moved); merge every NOMENCLATURE row queued in `REPORT-s4-fold` (you hold the file) and add rows for anything new here; fix the "no lorebook" wording in the `sockets/state.ts` ~1305 comment; then `npm run docs:build` (regenerates the Clone paragraph away).

## Files owned

`src/lib/server/characters/versions.ts` (~1890 own-book branch only), `src/lib/server/state/{durable,resolve}.ts` (the named functions), `src/lib/server/pipelines/runtime/host.ts` (the named hunks), `src/lib/server/pipelines/runtime/bindings.ts` (own-notes lore reads only), `src/lib/server/sockets/{storyClock,narrativeGraph}.ts`, `src/lib/server/sockets/sessions.ts` (`sessionLinePatch` only), `src/lib/server/sessions/branch.ts`, `src/lib/server/lorebooks/{ownBook,foldInParent}.ts`, `src/lib/shared/lorebooks/sessionNotes.ts`, `src/lib/server/sockets/state.ts` (the comment), `docs/{lorebooks,sessions}.md`, `src/lib/generated/docs/**`, `NOMENCLATURE.md`, tests next to all of these.

**Another Claude session (serene-pub-43) owns image generation** — keep clear of `pipelines/runtime/dispatchImage.ts`, `imageGen/**`, `localModels/matting.ts`, `KoboldCppManagedAdapter.ts`. No other S4 lane is running.

## Done means

Tests: a folded session on a non-main line writes cast versions, captures and lore on its line, dated at its clock, and reads them back; storyClock and the graph work for it; it can change line; branching it reads the same at the fork; a session on main is unchanged; the pipeline own-notes read with a clock; `foldInParent.int` and `seatKeys.*` green; `docs:build` clean; tsc + check no new errors. Report `plans/REPORT-s4-fold2-2026-11-08.md`.
