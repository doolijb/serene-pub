# BRIEF pl — a place's world value lands in the session's notes when the session can't write its book; the own book is never made or touched by a refused write (owner ruling 2026-11-05 + m3b-V2 scope finding 1)

You are a `lane-supervisor` (fresh, Opus). Read `.claude/guides/multi-agent.md` first, then this brief, then plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §24 (its last bullets) and the top of §26, `plans/REPORT-m3b-V2-2026-11-05.md` (the landing rule, the read order, "Places" under Noticed, the scope review's finding 1 — in this brief below), `plans/REPORT-m3b-W-2026-11-05.md`, `src/lib/server/lorebooks/ownBook.ts` header (overlay, `loreWriteRoute`, how a lore write on someone else's book lands in Session notes — find whether the overlay already copies an **entry** (a place is a location entry) into the own book and how it links the copy to the original), `src/lib/server/state/worldScope.ts`. Lane id **pl**. Two workers at most (Sonnet). Work from `/home/jody/github/serene-pub`. Other programmes edit this tree (lane **sl** in the SDK may run `sdk:build` — if a test fails on an SDK dist import, wait and re-run; lane **ed** follows you in `state/**`): re-read a shared file before every edit; additive hunks; never reformat a file dirty at HEAD.

## Rulings
- Owner 2026-11-05: places — "Copy the place into the notes on first write": in a session that can't write its book (`keepsValuesInOwnBook`), a world-scope value on a place (`session_location` mapped to the attached book's place, or an explicit `location` owner on that book) lands on **the same place in the session's own notes**, copied there on first write the way the overlay copies lore (reuse it — no second copy mechanism, P2); reads take the notes' value first, then the book's. The attached book gains nothing.
- m3b-V2 scope finding 1 (accepted by the lead): a refused write must not create or update the own book. `worldOwnerOf` (`worldScope.ts` ~59 `session` branch, ~93 before the writer check at ~95) calls `ownBookFor`, which creates the own book (`insertOwnBook`) or updates its `overlay_of`/rules. Fix: read with `ownBookOf` (read-only) and check the writer **before** any `ownBookFor`; if the own book doesn't exist yet, only the session's owner (or a run) may cause it to be made.
- m3b-V2 scope finding 3 (accepted): `assertSessionOwner`'s `lorebook` branch admits the own book's row in every session, but nothing reads it on an owner's own-book session — admit the own book's `lorebook` row only when `keepsValuesInOwnBook` is true.

## Items
1. Places landing + read (as above); the place copy carries what the overlay's lore copy carries (name, the link to the original) — say exactly what; a second write updates, never duplicates.
2. Writer-first for the own book (finding 1).
3. The `lorebook` branch narrowed (finding 3).
4. Tests (int, 60 s timeouts, extend `state/worldScope.int.test.ts`): a member's session on a shared book — a place value lands on the notes' copy of that place, reads back, a second write updates; the shared book gains nothing; a guest's refused write leaves no own book and no copy (start from a session whose own book was deleted, if `ownBookFor`'s lazy path allows; else assert no update); the owner's own book: a `state:set` naming the own book's `lorebook` row is refused there. Keep the m3b-V2 tests green.
5. Docs/vocabulary: `docs/lorebooks.md` (Session notes keep a member's changes to places too); NOMENCLATURE §25 row.

## Files owned
`src/lib/server/state/**`, `src/lib/server/lorebooks/ownBook.ts` (additive, or a minimal hunk in the overlay copy helper if it must be exported), `docs/lorebooks.md`, `NOMENCLATURE.md` (§25 row).
## Out of scope
No SDK edit; no migration; no hand-edit permission changes (lane ed); no change to provided books (§26).
## Rules (quote into the worker brief)
CLAUDE.md Principles/Decisions/Hard rules; NOMENCLATURE R1–R6, §24, §23 retired words; `tx` only inside `db.transaction`; targeted tests only; never pipe vitest into `head`; 60 s int timeouts; delete only your own `/tmp/serene-pub-vitest-*` dirs by name.
Every implementation brief adds, verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
## Done means
Tests green; `tsc` clean on lane files. Report in your hand-back in full (the harness may refuse report files from subagents; the lead saves it to `plans/REPORT-pl-2026-11-05.md`).
