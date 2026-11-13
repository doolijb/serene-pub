# BRIEF — `s4-review-fix-w2` (2026-11-09) — `seat-members` fast path matches what settling can fill

Supervisor: lane `s4-review-fix`. You are a lane-worker. Project: `/home/jody/github/serene-pub`. Use absolute paths.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
(You need no `sdk:build` for this task.)

## Background

`src/lib/server/sessions/seatMembers.ts` is the ⏳ `seat-members` boot pass. Its promise: **"A second boot changes nothing and, with nothing new to settle, reads one query."** One query (`found`, ~93–107) names candidate sessions; each is settled by `settleSeats` (`sessions/seats.ts` ~1042). The `resolvable(seat, card)` SQL (~62–92) must name a live carded seat **only when `settleSeats` can fill it** — if it names a seat settling leaves empty, that session is re-selected on every boot.

How `settleSeats` fills a live seat (read `resolveSeatMember`, `seats.ts` ~352–392, with `seatBookOf` ~213 and `findSeatMembers` ~288; `findOrInsertBinding`, `utils/characterBindingSync.ts` ~365, answers null for a deleted or missing card):
1. the card's member **in the attached book** (`sessions.lorebook_id`; a linked binding or a dated card — `memberOfCard`) → filled;
2. else, **if the attached book is mintable** (`attachedMintable`: it exists, `user_id` = the session's owner, and `markedBook(extra_json, uuid)` is null — `plugins/providedMarks.ts` ~100: a mark counts only when `provided` is an object whose `plugin`, `slug`, `version` are strings and `uuid` equals the book's uuid) → mint there; **a deleted/missing card gets null here and settling stops — it does NOT fall through to the own book**;
3. else the card's member in the own book (or an ancestor's) → filled;
4. else, if there is an own book, mint there (null for a deleted card).

The supervisor's reading: today's SQL treats "the card has a member in the own book" (the `lorebook_bindings` / `character_versions` branches' own-book halves) as resolvable even when the attached book is mintable and the card is deleted — step 2 answers null, so the seat stays empty and the session is re-selected every boot. Also the SQL's mintable test (`(extra_json::jsonb -> 'provided' ->> 'uuid') is distinct from l.uuid::text`) is not exactly `markedBook`.

## Goal

1. **Prove it first.** Add a test to `src/lib/server/sessions/seatMembers.int.test.ts`: a session with an attached book owned by the session's owner (not provided) and an own book; a live character seat (`session_characters`, `cast_member_id` NULL) whose card is **soft-deleted** (`characters.is_deleted = true`) and whose member exists **only in the own book** (a `lorebook_bindings` row in the own book linked to that card). Run `seatMembers` twice and record `report.sessions` / `report.unexplained` each run. Follow the file's existing helpers and the test at ~433 ("a deleted card no member has is counted and left") and ~471/~492 for own-book setups.
   - If the second run still selects the session (sessions ≥ 1): the reading is right — do step 2.
   - If it does not: keep the test as proof, change no source, and report what you saw.
2. **Fix (only if step 1 confirms):** rewrite `resolvable` in `seatMembers.ts` so it is exactly:
   `attached-find OR (attached-mintable AND card live) OR (NOT attached-mintable AND (own-find OR (own book exists AND card live)))`
   where *attached-find* = today's bindings/versions halves on `s.lorebook_id`; *own-find* = their halves on `lorebooks o where o.session_id = s.id`; *card live* = the card row exists and `not is_deleted`; *attached-mintable* = `exists (select 1 from lorebooks l where l.id = s.lorebook_id and l.user_id = s.user_id and not coalesce(<genuine mark>, false))` with *genuine mark* = `jsonb_typeof(p) = 'object' and jsonb_typeof(p->'plugin') = 'string' and jsonb_typeof(p->'slug') = 'string' and jsonb_typeof(p->'version') = 'string' and p->>'uuid' = l.uuid::text`, `p = l.extra_json::jsonb -> 'provided'`. Mind SQL NULL logic (`extra_json` may be NULL; a NULL `s.lorebook_id` must make attached-mintable false, not NULL). Keep the third union branch (duplicate members) as is. Update the code comment above `resolvable` and the module JSDoc's fast-path bullet so they state the rule exactly (no new names).
   The test from step 1 then asserts: first run `sessions === 0` (the seat is not a candidate), nothing written to that seat. Add one more test that the **other** side still works: same shape but the card **live** → selected once, filled (minted in the attached book), second run selects nothing.
3. All existing `seatMembers.int.test.ts` tests stay green (they cover the dated-card, own-book, merge and one-query cases).

Do not change `seats.ts` or any other file. If you think `resolveSeatMember` should fall through to the own-book member instead, say so under **Noticed, not done** — do not change it.

## Tests

```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/sessions/seatMembers.int.test.ts src/lib/server/sessions/seatKeys.int.test.ts src/lib/server/sessions/seatKeys.attic.int.test.ts src/lib/server/sessions/seatKeys.gate.int.test.ts src/lib/server/sessions/seatKeys.json.int.test.ts src/lib/server/sessions/seatKeys.memberMove.int.test.ts src/lib/server/sessions/branch.seatMembers.int.test.ts --maxWorkers=2 > \$S/s4-review-fix-w2-tests.log 2>&1; echo test-exit=\$? >> \$S/s4-review-fix-w2-tests.log"
```
Never pipe vitest into `head`. DB-opening tests need a 60 s timeout (the file already sets it). Do not run tsc or svelte-check; the supervisor does.

## Rules your work depends on (CLAUDE.md, quoted)

- "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing." (This pass is that boot pass; your tests check the second run.)
- "Inside `db.transaction(async (tx) => …)` use only `tx`."
- "It is a **session**, never a *chat*." Memory rule: there is always a lorebook — say own book / attached book, never "no lorebook".
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file. If a file fails only on lines you didn't touch, leave it and say so.
- No new exported names, settings, events, tables or migrations.

## Files owned

`src/lib/server/sessions/seatMembers.ts`, `src/lib/server/sessions/seatMembers.int.test.ts`. Readable: anything. **Never edit** image-generation files (`dispatchImage.ts`, `imageGen/**`, `matting.ts`, `KoboldCppManagedAdapter.ts`, `sprites/fillAction.ts`, `characters/portrait.ts`).

## Stop and ask (in your report) when

The code doesn't match this description; the proof test shows a different failure; a fix would need another file.

## Report (your final message)

Proof-test result (both runs' report numbers, before any fix), changed files with line ranges, tests run with pass/fail counts and the log path, deviations and why, **Noticed, not done**.
