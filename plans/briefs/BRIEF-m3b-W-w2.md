# BRIEF m3b-W-w2 — docs and vocabulary for the world-scope landing on the session's own book

Worker for lane **m3b-W**. Work from `/home/jody/github/serene-pub`. Report to `plans/briefs/REPORT-m3b-W-w2.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no build and no tests.)

## Goal

The code half (worker w1, in parallel) changes where a **world-scope attribute** (a ruleset attribute with owner `cast`, scope `world` — e.g. a game's _age_) is kept for a seated character the session's attached lorebook does not hold — the player's persona, or anyone else seated who is not one of the book's cast. Owner ruling 2026-11-05: _"the player's persona is a cast member of the session's own book"_; the value files on that row; a provided (pub-wide) book stays untouched and gains no member rows for anyone. Your task is the words: one doc sentence and the NOMENCLATURE §25 rows.

**The rule as built (write it exactly this way, no more):**
- `worldOwnerOf` (`src/lib/server/state/worldScope.ts`): a world-scope write for a **player's seat** with a persona card is the persona's; a card-less seat keeps the refusal _A player's seat holds nothing that lives on the world._ A character the session does not seat is refused (_that character is not in this session's cast._). A seated character the attached book holds lands, as before, on that book's cast member row under its write mode. A seated character it does **not** hold (or, with no attached book, any seated character) lands on **that character's cast member in the session's own book**, found or made through `resolveOrCreateBindingRow` (the lorebook binding door `runLorebookBindingCheck` uses) — one row per character, never a second. Retired refusal: _This character is not in this world's cast, so a value that lives on the world has nowhere to go._ now only for a deleted card.
- `assertSessionOwner` (`state/write.ts`): a `cast_member` owner may be a member of the attached book **or of the session's own book** (`lorebooksReadBy`).
- Reads: `CastMemberLink.ownBookMemberId` 🚧 (`state/resolve.ts`, set by `sessionLinks`) — the character's cast member in the session's own book when the attached book holds none; the read chain (`chainFor`) falls back to it, so the value reads back for the seat.

## Files owned (only these)

- `docs/lorebooks.md` — **dirty at HEAD, other lanes edit it concurrently**: re-read the section immediately before the edit; one additive sentence; never reformat the file.
- `NOMENCLATURE.md` — **dirty at HEAD; lanes s22-C and s22-V may append §25 rows at the same time**: re-read the end of the §25 table immediately before the edit, append your rows as new lines directly after the current last table row (before the `⚠ **What the layering build left in the interface copy**` paragraph), additive only, never reformat, never touch another row except the one named below.

## What to write

1. `docs/lorebooks.md`, section **Your session's own notes** (`## Your session's own notes`, ~line 220): add one sentence at the end of its first paragraph (the one beginning _Every session owns a lorebook of its own…_), in the doc's voice — user-facing words only (**Session notes**, _notes_, _lorebook_, _cast_; never "own book", never "binding", never "phantom", never "chat"). Recommended wording: _A world attribute of someone the lorebook doesn't hold, such as your own character's age in a game that reads a pub-wide lorebook, is kept in the notes too, on that character's place in the notes' cast._ — adjust only for flow. Its anchor and headings stay.

2. `NOMENCLATURE.md` §25 — append rows in the table's 3-column format `| Was | Now | When / who |` (look at the last rows for the shape: bold code names, 🚧 for provisional, a **Charter:** sentence set — purpose, why, owns, not):
   - Row A: Was `worldOwnerOf` refused a player's seat (_A player's seat holds nothing that lives on the world._) and a character outside the book's cast (_This character is not in this world's cast, …_) → Now the **world-scope landing** of `worldOwnerOf`, as in "The rule as built" above, in one paragraph; Charter: purpose, give a seated character the attached book does not hold — the player's persona above all — a place for a value that lives on the world; why, owner ruling 2026-11-05 (★M3b-S2-1, "Why not just cast/char attribute?"); owns, the landing decision; not, the provided book's write mode or its member gate (`runLorebookBindingCheck`), not the overlay of the attached book's own cast (★, not built). When/who: `M3b (lane m3b-W), 2026-11-05 (owner ★M3b-S2-1).`
   - Row B: Was _(new)_ → Now 🚧 **`ownBookMemberId`** on `CastMemberLink` (`state/resolve.ts`): the character's **cast member in the session's own book** (a `lorebook_bindings` row of the own book), present when the attached book holds none or the session reads no book; the read chain's fallback. ⚠ Not `castMemberId`, which stays the attached book's member (R1). When/who: same.
   - Edit the existing `carriedBy` row (search `` `worldOwnerOf` (a world-scope write from a session lands on the book, under its write mode) ``) **only** by appending, inside that cell, after that parenthesis: ` — or, for a seated character the book does not hold, on their cast member in the session's own book (M3b, 2026-11-05)`. Nothing else in that row.

   Words: the code word is **own book**; the interface word is **Session notes** (NOMENCLATURE §28). Never "phantom" (§23), never "outsider" or any other new coinage — say "a seated character the attached book does not hold".

## Rules (quoted)

- CLAUDE.md: _"When you add or rename a term, record it in **§25 Change ledger** in the same change."_ · _"Do what was asked, at the size asked."_ · Propose-and-wait (★) on any new name, behaviour, or copy beyond this brief.
- NOMENCLATURE R1 _one word, one meaning_ · R3 _qualify, never the bare noun_ · R6 _mark 🚧 provisional vocabulary_ · §24 _"Say what it is **not**, in the declaration, if a near-neighbour exists."_ · _"UI labels are prose and need not match internal names — but must not contradict them."_
- STYLE-GUIDE copy: plain words, no jargon in user docs.

## Done means

The doc sentence and the three NOMENCLATURE edits in place; `git diff -U0 docs/lorebooks.md NOMENCLATURE.md` shows only your added lines among this change's hunks (paste your hunks in the report); `grep -n "phantom" ` of your added lines prints nothing. Report: the hunks, assumptions, Noticed-not-done.
