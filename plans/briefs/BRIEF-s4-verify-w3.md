# BRIEF — `s4-verify-w3` (worker of lane s4-verify) — bring `sessions.castFromLorebook.int` up to S4's seat-the-book rule — 2026-11-08

Repo `/home/jody/github/serene-pub`. Supervisor: lane `s4-verify`. Absolute paths; your cwd resets between shell calls.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## The red (full suite, 2026-11-08)

`src/lib/server/sockets/sessions.castFromLorebook.int.test.ts` fails 5 of 7 tests: e.g. `expected [2, 4, 5, 3] to deeply equal [2, 3]` (seated card ids: one, persona, plain, two).

Cause (supervisor's reading — verify it): the test is M3b-era. S4 changed `src/lib/server/sessions/seatBookCast.ts` `bookCastToSeat` (read its header comment, lines 1–21): it seats **members** (card-less included); **"A provided book seats all its members (owner ★S4-1; its plugin-stamped cards stay hidden, so the card is no filter)"**; "Never a member whose active card is a persona card" — decided through `membersAsRead` (`cast/memberAsRead.ts`), which **leaves out a member with no character version** (logs `[cast] cast member N has no character version at all`). The fixture's `members()` helper raw-inserts `lorebook_bindings` rows with no version, and `card()` raw-inserts `characters` rows with no card version, so the persona filter can't see the persona.

## Task

Change only the test file (production code stays as it is):

1. Make the fixture realistic: cards through the app's card writer if it gives a card its v1 (look for `insertCard` in `src/lib/server/characters/`), keeping the persona flag and the provided `extensions.serenepub.provided` mark; members through `insertCastMember` (`src/lib/server/characters/versions.ts`) so each has its base version linked to its card. Keep book order = insertion order.
2. Update expectations to the S4 rule: a provided book seats all its members except one whose active card is a persona card → `[one, plain, two]` (book order: one, persona, plain, two); the picked-character test → `[two, one, plain]`; the new-persona-per-game test → `[one, plain, two]`, still no persona seated, still no binding row added; the own-book test stays `[a, b]`. Rename the titles that say "exactly the provided-marked cards … unmarked not seated" / "the same admin-owned cards" to say what is asserted now (e.g. "the admin: every member but the persona, in book order (★S4-1)"). Update the file's header comment sentence "for a provided book only its provided-marked cards" to "for a provided book every member but a persona's (★S4-1, plan §34.2)".
3. If, with versions in place, the persona **is still seated**, stop: don't loosen the assertion — report it (that would be a production bug in `bookCastToSeat`).
4. Don't touch the "switch off" and "binding gate" tests beyond what the fixture change forces.

## Rules you depend on (quoted)

- Owner 2026-11-08 ★S4-1: provided books keep plugin-stamped cards **hidden** as the release carrier; every starter copy is card-less.
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`." Browser-code rules don't apply (server test).
- An int test that opens a DB inside an `it` needs a 60 s timeout (the file already sets it). **Never pipe vitest into `head`.**
- Tests only in a capped scope, logged:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/sockets/sessions.castFromLorebook.int.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-w3-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-w3-tests.log'`
- **Prettier:** `npx prettier --check` the file; only `--write` if every diff is in lines you changed.
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need none.)
- Never `git checkout` / `restore` / `stash`.

## Files owned

`src/lib/server/sockets/sessions.castFromLorebook.int.test.ts` only.

## Done means

That file 7/7 green.

## Report

Final message: what changed, the counts, whether the cause matched, prettier result, **Noticed, not done**.
