# BRIEF pl3 — Clone with changes carries the notes' values into the copy; Back/Forward take the notes' book-layer values (owner rulings ★pl2-1, ★pl2-2, 2026-11-05)

You are a `lane-supervisor` (fresh, Opus). Read `.claude/guides/multi-agent.md` first, then this brief, then `plans/REPORT-pl2-2026-11-05.md` (★pl2-1, ★pl2-2), `plans/REPORT-m3b-V2-2026-11-05.md` (where the notes' values live: the notes' `lorebook` row, own-book cast member rows, `placeValues`), `plans/REPORT-ed-2026-11-05.md` (lane ed just changed `state/write.ts` — re-read it), `src/lib/server/lorebooks/ownBook.ts` `cloneWithChanges` (~989–1110), `src/lib/server/state/write.ts` `anchorFor` (and its "author layers are never anchored" rule), `isOwnBookOwner`, `retractStateAnchoredTo`/`retractImprints`/`restoreImprints`. Lane id **pl3**. Two workers at most (Sonnet). Work from `/home/jody/github/serene-pub`. Stage S1 of the seat-cast programme runs concurrently (`db/schema.ts`, `drizzle/**`, `sessions/seats.ts`, `sessions/seatMembers.ts`, seat-insert sites in `sockets/sessions.ts`, `sockets/import.ts`, `sessions/branch.ts`, `sessions/envoys.ts`, `sessions/seatBookCast.ts`, `startup/index.ts`) — don't edit those. Re-read shared files before each edit; additive hunks; never reformat files dirty at HEAD.

## Rulings
- **★pl2-1 → "Clone writes the notes' changes into the copy":** when a session that kept values in its notes (`keepsValuesInOwnBook`) uses **Clone with changes**, the same transaction writes the notes' values into the copy's own rows: the notes' `lorebook`-row world values → the copy's `lorebook` row; own-book cast member values (`ownBookMemberId`, by `characterId`/`overlay_of` match) → the copy's member rows; `placeValues[<book entry id>]` → the copy's place (`location`) rows via the clone's entry-id remap. Then the notes' copies are cleared (or left unread — say which and why), so nothing silently disappears and nothing double-reads.
- **★pl2-2 → "tie the notes' rows to the turn like session values":** a value written to the session's **own book's** book-layer rows (its `lorebook` row, its cast member rows) is anchored to the turn like a session value (`anchorFor`: `isOwnBookOwner` → the turn owner/message), so Back/Forward/swipe take and restore it; the "author layers are never anchored" rule stands for every real book.

## Items
1. Clone carry (★pl2-1) inside `cloneWithChanges`'s transaction (`tx` only), with dated values kept dated where the rows carry history.
2. Anchoring (★pl2-2) in `state/write.ts`'s `anchorFor` + whatever `retractStateAnchoredTo` needs to take those rows (they are `attribute_values` rows, so the existing retract should apply once anchored — confirm).
3. Tests (int, 60 s timeouts): a member's session with notes values (world, a person, a place) → Clone with changes → the copy reads the same values, the notes no longer shadow; Back after a notes write (world, person) restores the previous value, Forward re-applies; a real book's author-layer write is still never anchored.
4. Docs/vocabulary: `docs/lorebooks.md` (Clone with changes keeps your story's changes; Back undoes them), NOMENCLATURE §25 row.

## Files owned
`src/lib/server/lorebooks/ownBook.ts` (`cloneWithChanges` only), `src/lib/server/state/**`, `src/lib/server/rulesets/ties.ts` (overlay reader only, if the carry needs it), `docs/lorebooks.md`, `NOMENCLATURE.md` (§25 row), the tests.
## Out of scope
No SDK edit; no migration; nothing in S1's files.
## Rules (quote into the worker brief)
CLAUDE.md Principles/Decisions/Hard rules; NOMENCLATURE R1–R6, §24; `tx` only inside `db.transaction`; targeted tests only; never pipe vitest into `head`; 60 s int timeouts; delete only your own `/tmp/serene-pub-vitest-*` dirs by name.
Every implementation brief adds, verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
## Done means
Tests green (incl. `worldScope.int`, `cloneWithChanges.int`, `imprints.int`, `handEdits.int`, `write.int`); `tsc` clean on lane files. Full report in your hand-back (the lead saves it to `plans/REPORT-pl3-2026-11-05.md`).
