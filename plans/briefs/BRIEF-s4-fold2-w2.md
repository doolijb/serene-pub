# BRIEF s4-fold2-w2 — branching a folded session carries its line; folding a branch whose ancestors hold member overlays (2026-11-08)

Supervisor: lane `s4-fold2`. Report back in your final message (the supervisor saves it). Repo: `/home/jody/github/serene-pub`.

## Background (read, don't re-derive)

Owner ruling **★bk-fold-1 (2026-11-08): "a session on its own notes reads them on its own line and moment, like any book."** `lorebooks/foldInParent.ts` (lane s4-fold) merges a session's attached book P into its own notes O; afterwards the session S has `lorebook_id = null` and `lorebook_branch_id` = the copy (in O) of the line it stood on. `state/reading.ts` `sessionReadingOf` reads O on that line at the session's moment (`onOwnBook: true`). Two gaps remain, both yours:

**A. Branching.** `sessions/branch.ts` `branchSession` copies `lorebookBranchId: original.lorebookBranchId` (~129) and calls `lorebooks/ownBook.ts` `copyOwnBookToBranch` (~682), which copies only O's **main** entries into the branch's new own book O2 (`isNull(branchId)`). For a folded S on a line L of O, the branch B then carries a line id of O that is not a line of O2 → its reading falls back to O2's main, without L's rows: B doesn't read what S read at the fork.

**B. Branch of a branch.** If S is itself a branch whose ancestors' own books hold **member overlays** of a member M of P (`lorebook_bindings.overlay_of = M`, rows in an ancestor's own book), S reads them through the overlay chain (`reading.ts` `overlayChainOf`, `cast/memberAsRead.ts` `pickVersions`: chain books read at their main, nearer holder wins a date tie). The fold re-points S onto M′ (the copy), so those ancestors' overlays (of M, not M′) stop being read → the in-transaction guard finds a difference and refuses (`FOLD_REFUSALS.readsDifferently`). `carryOverlays` (~1449) already carries **S's own** overlays onto M′.

## Goal

1. **Branching carries the line** (`ownBook.ts` `copyOwnBookToBranch` + `branch.ts`). When the parent session has no attached book and `sessionReadingOf(tx, parentId)` returns `onOwnBook` with `branchId != null` (it reads its notes alone on a line L):
   - copy into O2 the `lorebook_branches` rows of L's chain (L and every ancestor line in O it forked through — `reading.line` has the steps; or walk `forked_from_branch_id`), root first, every column kept except ids and `lorebook_id` (mapped), `forked_from_branch_id` mapped;
   - copy O's entries on that chain (branch null **or** in the chain), with `branch_id` mapped onto the copies — keep the existing anchor rule (an entry anchored after the fork stays behind; unanchored comes across; anchors remapped) and the `anchorEntryId` remap;
   - copy those entries' **entry amendments** (`schema.entryAmendments`) that sit on the chain (branch null or in it), entry id and branch id mapped, any history-entry / entry reference mapped through the entry remap (read the table's columns; list every column you map and every one you leave in the report), applying the same "anchored after the fork stays behind" rule if amendments carry a source message;
   - return the mapped line id; `branch.ts` sets the new session's `lorebook_branch_id` to it (after the copy, inside the same transaction, `tx` only). In every other case `lorebook_branch_id` and the copy stay exactly as today — except that a parent with **no attached book on its notes' main** must give the branch `null`, never a line id of the parent's own book (check what it gives today and say).
   - Keep `lineOnFirstWrite` false for an own-notes parent (the branch's line in O2 is its own; no fork needed).
   - Update `copyOwnBookToBranch`'s doc comment ("The notes are never branched as a book: only main's rows" is no longer true).
   - **Not** in scope: copying O's durable values, configs, links, members or cast versions into O2 (today's copy doesn't either — "🚧 the notes' links and stat rows do not come across yet"). A branch reads the parent's people through the overlay chain (★CV-14, owner 2026-11-05: a branch seat "points at the member the parent's seat holds — the parent's own-book people included — never a new one"). **Known gap the supervisor will raise as ★:** `memberAsRead.ts` `pickVersions` reads a chain book other than the reading's own "at that book's main", so cast versions S read on L (in O) are not what B reads. Do NOT edit `memberAsRead.ts`; write that expectation as a `test.fails` (see Tests) so it flips when the reader is fixed, and describe the minimal reader change you'd propose (file:line, a few lines of sketch) in the report.
2. **Folding a branch whose ancestors hold overlays of M** (`foldInParent.ts`, `carryOverlays` and wherever the guard/refusal needs it). Make it foldable: for the folding session S only, the ancestors' member overlays of P's members (overlay rows in S's ancestors' own books — `overlayChainOf(S)` minus O — with `overlay_of` a member of P) have the versions **S reads** carried onto the copy M′ in O, on S's line (`c.lineId`), exactly as S's own overlays are:
   - which ancestor rows: on the ancestor book's main (`branch_id` null), passing S's session cut for that ancestor and the retire-mark rule (`shared/lorebooks/lineReading.ts` `rowPassesSessionCut` with S's `sessionCutsOf`; or `sessionCutSql` in `state/lineSql.ts`);
   - carried rows get `sourceSessionId = S`, `sourceMessageId = null`, `validFromMessageId = null` (so S's own session cuts don't cut them; the `character_versions_undated_base_check` refuses an undated row off main with a null source session, and `character_versions_anchor_source_check` needs a source session when `validFromMessageId` is set — read both in `db/schema.ts` ~9573–9610), `historyEntryId` mapped as the own carry does, `castMemberId` = M′, `lorebookId` = O, `branchId` = `c.lineId`, through `insertCharacterVersions` (the one INSERT);
   - priority: the pick is later date → nearer holder → life point → write order → id. Insert the deepest ancestor's rows first, then nearer ancestors', then S's own overlays' (so nearer gets the higher write order); the guard compare decides the rest — if a case still reads differently the fold refuses, which is acceptable (say which cases in the report);
   - the ancestors' overlays themselves are **never** written, re-pointed or deleted (they are the ancestors' and other branches read them).
   - If on contact this is not small (more than roughly 60–80 lines in `foldInParent.ts`, or it needs a file outside your list), stop, leave the refusal, and report why.
3. Tests, in `src/lib/server/lorebooks/foldInParent.int.test.ts` (reuse `world({ onNight: true })`, `fold`, `reads`, `personRead`, `overlayOf`; add new `describe` blocks at the end, don't restructure existing ones), every DB `test` with a 60 s timeout:
   - **branch after a fold on a non-main line reads the same as its parent at the fork message**: `world({ onNight: true })`, fold, then `branchSession` from S's last message; assert B's `lorebook_branch_id` is a line of B's own book named like S's line; B's entries as read (`sessionEntriesAsRead`, including amended text if the fixture has amendments — add one dated on the line if not) equal S's; B's story present/reading moment equals S's at the fork (e.g. `sessionReadingOf(B).moment` vs S's; the clock is stepped back to the fork by `stepBranchClockToFork`); a dated entry S writes on L **after** the fork is not in B;
   - the members part of the same comparison (`reads(...).members` / `personRead`) as a separate `test.fails(...)` with a one-line comment naming the ★ (chain books read at main in `memberAsRead.pickVersions`);
   - **a branch of an own-notes session on main** gets `lorebook_branch_id` null and the same entries as today;
   - **fold of a branch whose parent holds an overlay of M**: make S0 on P, give S0's own book an overlay of M with a dated/changed version (`overlayOf` helper), branch S from S0, fold S → succeeds, S reads the same as before (`reads`, `personRead`), the ancestor's overlay row and its versions are byte-identical after, and S0 reads the same; plus a second fold refused `alreadyOwn`.
   - Existing: `foldInParent.int`, `src/lib/server/sessions/branch.*.int.test.ts`, `src/lib/server/lorebooks/ownBook.int.test.ts`, `src/lib/server/sessions/seatKeys.*.int.test.ts`, `src/lib/server/sockets/ownBooks.fold.int.test.ts` stay green.

## Files owned (edit only these)

- `src/lib/server/sessions/branch.ts`
- `src/lib/server/lorebooks/ownBook.ts` — `copyOwnBookToBranch` (and a private helper beside it if needed)
- `src/lib/server/lorebooks/foldInParent.ts`
- `src/lib/server/lorebooks/foldInParent.int.test.ts`
- `src/lib/server/sessions/branch.*.int.test.ts` only if an existing assertion there pinned the old main-only behaviour (say which)

## Files readable

Anything: `state/reading.ts`, `state/lineSql.ts`, `shared/lorebooks/lineReading.ts`, `cast/memberAsRead.ts`, `characters/versions.ts` (`insertCharacterVersions`, `retireOrTakeVersions`), `lorebooks/tableRegistry.ts` (`copyLorebookTables`, how it maps branches/amendments), `db/schema.ts`.

## Out of scope (do not build)

`memberAsRead.ts`, `reading.ts`, `characters/versions.ts`, `state/durable.ts`, `pipelines/runtime/host.ts`, `sockets/**` (another worker holds versions/durable/host). Copying values/links/members into O2. Docs, NOMENCLATURE, copy. No new exported name, setting, event, column or migration (private helpers fine — name them).

## Stop and ask (in your report) when

A change is needed outside your files; goal 2 isn't small; a user-visible sentence would change; a migration seems needed.

## Rules your work depends on (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test."
- "Never seed a row at a hardcoded id."
- ★CV-14 / §33.3 (owner 2026-11-05): branches ride the parent's people; "its never-surfaced notes outlive it while any branch rides them … No hand-off, no re-pointing."
- §33.2 retire mark: "a row some descendant reads … marks the row retired … instead of deleting it." A reader passes a retired row only with a cut for its source whose `mark < retiredOrder`.
- Owner 2026-11-05: "Data wise, the session is a patron of the lorebook and branch, it doesn't own it." — P is never written by the fold.
- Memory rule "There is ALWAYS a lorebook": no comment or copy may frame a session as having no lorebook; say own book / own notes / attached book.
- "It is a **session**, never a *chat*."
- Tests capped and logged (never pipe vitest into `head`):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold2-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold2-w2-tests.log'`
  Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; …'` (baseline 0 errors; another worker edits other files at the same time — report errors in your files only, and name any elsewhere).
- Scratch files in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/` named `s4-fold2-w2-*`. The perf test in `foldInParent.int` is skipped unless `FOLD_PERF=1` — leave it skipped.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (No `sdk:build` expected.)
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.
- Another Claude session owns image generation: never touch `pipelines/runtime/dispatchImage.ts`, `imageGen/**`, `localModels/matting.ts`, `KoboldCppManagedAdapter.ts`.

## Done means

The new tests pass (the members `test.fails` "passes" by failing); goal 2 built or refused-with-reason; the existing files listed stay green; tsc no new errors in your files.

## Report (final message)

Changed files with hunks; columns mapped/left for branches and amendments; what a main-notes parent gives today vs now; goal 2 built or not and why, cases the guard still refuses; the minimal `memberAsRead` change you'd propose (sketch); private helpers named; tests with counts; tsc; prettier; stops; **Noticed, not done**.
