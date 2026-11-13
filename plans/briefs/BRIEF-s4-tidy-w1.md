# BRIEF s4-tidy-w1 — one writer for the stored member name; next-chapter carry of card-less seats (server)

Supervisor: lane `s4-tidy` (seat-cast S4, wave 6). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back in your final message (the supervisor reads it); do not write a report file.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You have no reason to run `sdk:build` in this task.)

**Prettier:** run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file. If a file fails only on lines you didn't touch, leave it and say so.

## Goal

### 1. One writer of `lorebook_bindings.name` (owner/lead ruling ★s4-fixes-2, 2026-11-08: "lead: yes" — one writer, Principle P2 "A module owns its data and every write to it … Two writers of one thing is a bug.")

Background (owner ★cp-names-1 "Both, via base name", 2026-11-08): members claim vocabulary names by their **undated-Main** shown name; a **dated** rename on Main is written back to `lorebook_bindings.name` for **sort and search only**. That write-back is the private `writeBackShownName(tx, memberId)` in `src/lib/server/characters/versions.ts` (~1690). Today two other paths write or move the stored name without it:

- `src/lib/server/utils/characterBindingSync.ts` ~174–217: on every card edit it computes the base shown name and writes `name` (with `aliases`) — this **undoes a dated rename**. Its comment ~177–178 ("A dated rename on Main is not stored here (held back: ★cp-names-1)") is stale.
- Session Back/Forward in `src/lib/server/state/write.ts`: ~977 (`retireOrTakeVersions` call, inside the retract function) takes story-written cast versions back, and ~1222 (`restoreVersions` call, inside the restore function) puts them back — neither writes the shown name back, so after Back the stored name keeps a rename that no longer reads, and Forward doesn't restore it.

Do:
- In `versions.ts`: **export** `writeBackShownName` (mark it 🚧 in its JSDoc; keep the JSDoc to what it does, and add that the card sync and session Back/Forward call it too). No other change to `versions.ts` — export only.
- In `characterBindingSync.ts`: keep the aliases write and the base-name computation if still needed for aliases, but the stored `name` must end up as `writeBackShownName` says (the member's shown name at its book's present on Main). Simplest shape: after the per-row update (and after any `writeCastVersion` for aliases), call `writeBackShownName(tx, row.id)`; stop writing `name` yourself if the write-back then covers it. Be careful: `writeBackShownName` reads via `membersAsRead` and only writes when the shown name is non-empty and differs — check that a member whose card was just renamed (undated) still gets the new name (the shown name follows the card via the base's parent card version). Fix the stale comment so it says what the code now does.
- In `write.ts`: **edit only the two call sites' enclosing functions, and only around those calls** — lane `s4-fold` is editing other parts of `write.ts` at the same time (its re-home / re-file writers). After `retireOrTakeVersions` returns, call `writeBackShownName` once per distinct `castMemberId` of the taken/retired rows whose `branchId` is null (Main) — mirror `versions.ts` ~2279 (`if (row.branchId == null) await writeBackShownName(tx, row.castMemberId!)`). Same after `restoreVersions(t, castVersions)` (use the `t` handle there). Use dynamic `import()` like the neighbouring code does. If an Edit fails because the file changed under you, re-read just that range and retry; never overwrite the file.
- **Hard rule:** inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently).
- Check `src/lib/server/characters/versionsWriter.guard.test.ts` and `frozenColumns.guard.test.ts` — if a guard lists who may call or write these, keep it green and say what you changed.

Tests (new file(s) next to the code, e.g. `src/lib/server/utils/characterBindingSync.shownName.int.test.ts` and `src/lib/server/state/retractCastVersions.shownName.int.test.ts`, or extend `state/retractCastVersions.int.test.ts` / `cast/characterRows.storedNames.int.test.ts` — reuse their fixtures):
- a card edit (e.g. description or the card's own name change) does **not** undo a dated Main rename of a member following that card: the stored name stays the dated name; an undated card rename still reaches a member with no dated rename;
- Back over a story-written (session-anchored, Main) rename puts the stored name back to the base name; Forward puts the renamed name back;
- second identical call writes nothing (row unchanged).

### 2. Next-chapter carry of card-less seats

`src/lib/server/sessions/creationModes.ts` ~165–220 (step 2 "Attribute values, as the old session reads them now") walks `fromLinks.cast` only, so a **card-less character seat** (a seat holding a cast member with no character card; owner ★6/★4, built in lanes s4-seat / s4-seat-live) loses its `nextChapter` stats. `sessionLinks(...)` also returns `seatedMembers?: SeatedMemberLink[]` (`state/resolve.ts` ~213: `seatMemberId`, `castMemberId`, `ownBookMemberId`, `seatActiveCardId`, …), whose state owner is the member form (`seated_member:<id>`; see `castOwnerOf`, `memberFormOf`, `loadSeatMap` already used in this block and in `state/handEdits.ts` / `state/durable.ts` for how card-less seats are owned).

Do: for each `decl` that applies to `cast`, also walk `fromLinks.seatedMembers ?? []`: find the new session's seat on the same member (match `seatMemberId` against the new session's `seatedMembers` and against `newLinks.cast[].seatMemberId` — the member may hold a card seat there; first in link order wins, as the existing comment says) and `carry(from, to, decl.id)` with the old seat's member-form owner and the new seat's owner. Skip when no new seat holds that member. Keep the existing card branch unchanged. Only under the flip (`memberFormOn()`); the off branch has no card-less seats.

Test: extend `src/lib/server/sessions/creationModes.seatMember.int.test.ts` (or a new `creationModes.cardlessCarry.int.test.ts` reusing its fixtures): a card-less character seat with a `nextChapter: true` cast stat carries its value into the next chapter's seat on the same member; a member not seated in the new session carries nothing. DB-in-`it` tests need a 60 s timeout.

## Files owned (edit only these)

- `src/lib/server/characters/versions.ts` — the `export` keyword + its JSDoc only
- `src/lib/server/utils/characterBindingSync.ts`
- `src/lib/server/state/write.ts` — only around the `retireOrTakeVersions` call (~977) and the `restoreVersions` call (~1222)
- `src/lib/server/sessions/creationModes.ts`
- new or extended test files next to these (listed above)

## Files readable

Anything. Useful: `src/lib/server/cast/memberAsRead.ts` (`membersAsRead`, `shownName`), `state/resolve.ts` (`sessionLinks`, `SeatedMemberLink`), `state/memberForm.ts`, `state/seatRefs.ts`, `plans/REPORT-s4-fixes-2026-11-08.md`.

## Out of scope

Clock-aware stored names (`membersAsRead` reads Main head — known, leave it). Anything else in `write.ts`. Any NOMENCLATURE or docs edit (the supervisor does canon). No new names beyond exporting `writeBackShownName`.

## Stop and ask (put it in your report and stop that part) when

a new name, setting, migration or file outside the list would be needed; a guard test needs an allowlist change you are unsure of; the write-back would change behaviour beyond the stored name (e.g. aliases).

## Tests — how to run

Only your targeted files, capped, logged:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-tidy-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-tidy-w1-tests.log'`
Never pipe vitest into `head`. Also run the existing neighbours: `characterBindingSync*.test.ts`, `state/retractCastVersions.int.test.ts`, `cast/characterRows.storedNames.int.test.ts`, `characters/versions.int.test.ts`, `characters/versionsWriter.guard.test.ts`, `sessions/creationModes.*.int.test.ts`, `annotations/baseNameVocabulary.int.test.ts`, and `src/lib/server/**/castMemberLifecycle.int.test.ts` (find it).

## Done means

The tests above pass; the neighbours stay green; prettier clean on your lines.

## Report (final message)

Changed files with one line each; tests run with pass/fail counts; decisions you made; anything you stopped on; Noticed, not done.
