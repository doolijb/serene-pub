# BRIEF — `s4-review-fix-w3` (2026-11-09) — make the refused-create tests reach the refusal catch

Supervisor: lane `s4-review-fix`. You are a lane-worker. Project: `/home/jody/github/serene-pub`. Use absolute paths.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
(You need no `sdk:build`.) **Tests only — change no source file.**

## The problem

`sessions:create` (`src/lib/server/sockets/sessions.ts`) has a refusal catch (~1691–1730) that, when the seat writer refuses inside the seats transaction, deletes the just-written session row and takes back what the create committed: the own book (`purgeOwnBookOf`; a kit copy carries `session_id` too) and, in `mode: "new-world"`, the world copy (`newSession.lorebookId`). A previous worker added three tests in `src/lib/server/sockets/sessions.castMemberIds.int.test.ts` (~213–290: `strandedBooks`, `booksOf`, and tests "a refused create leaves no own book whose session is gone", "a refused create from a starter kit leaves no kit copy", "a refused new-world create leaves neither the world copy nor an own book"). **None reaches the catch:** the pre-check at `sessions.ts` ~1299–1328 refuses every listed `castMemberIds` member that is not in the attached book (and, in new-world, every listed member) and returns *before* anything is written. So those tests pass vacuously.

Facts (verified by the supervisor):
- The writer refusal is reachable only from two loops inside the seats transaction (~1620–1690): the listed `castMemberIds` loop (members that passed the pre-check, i.e. members of the attached book) and the book's seated-cast loop (`seatedCast`, only when the genre declares `castFromLorebook` and the session has an attached book; in new-world each is seated **by card** `seatCast(tdb, { cardId, ... })`).
- A **starter-kit** start never has an attached book (`sessions.ts:1018` refuses kit + book), so its listed members are always refused by the pre-check and no seated cast is computed: the catch is unreachable for a kit start today.

## Goal

1. In `sessions.castMemberIds.int.test.ts`: add a partial mock of `$lib/server/sessions/seats` with a `vi.hoisted` switch, off by default, so other tests keep the real writer: when on, `seatCast` records `input.sessionId` and returns `{ ok: false, refusal: "<a test sentence>" }` **only** for calls that carry `castMemberId`; otherwise it calls the real one. (`sessions.ts` imports `seatCast` from that module — confirm how, so the mock takes effect; `src/lib/server/sessions/seatMembers.int.test.ts:31–46` shows a partial mock of the same module.) Keep `SEAT_REFUSALS` import working.
2. Rewrite test (a): an attached book with a card-less member of **that** book (`cardless(book.id, ...)`), listed in `castMemberIds`, switch on → `res.error` is the test sentence; the recorded session id has **no `sessions` row** and **no `lorebooks` row with that `session_id`**; `strandedBooks` is 0.
3. Delete test (b) (the kit case is unreachable — say so in a one-line comment where it was, citing `sessions.ts:1018` and the pre-check), and delete test (c) from this file.
4. New-world: add the test to `src/lib/server/sockets/sessions.castFromLorebook.int.test.ts` (it already publishes a genre declaring `castFromLorebook` — `publishGenre` ~62, the create helper ~257 with `genreId`, `DECLARED`). Add the same kind of hoisted partial mock of `$lib/server/sessions/seats` there, but refusing calls that carry `cardId` **and** whose `sessionId` is a session made in `new-world` — simplest: the switch holds a flag, and the test turns it on just for its one create. Create with `mode: "new-world"`, the declared genre, an attached book that has a seated carded member (follow the file's existing setup for a seated cast). Assert: the refusal sentence comes back; the user's lorebook count is unchanged (no `"<name> (copy)"` left — check by name too: no lorebook named `${book.name} (copy)` for that user); no `lorebooks` row with the recorded `session_id`; no `sessions` row with it. If new-world with this genre does not reach the seated-cast loop (e.g. the copy has no seated cast), stop and report what you found instead of forcing it.
5. Each test must **prove the catch ran**: the mock recorded a session id (assert it is a number) — that id existed and is now gone.

Run (capped, logged; never pipe vitest into `head`):
```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/sockets/sessions.castMemberIds.int.test.ts src/lib/server/sockets/sessions.castFromLorebook.int.test.ts --maxWorkers=2 > \$S/s4-review-fix-w3-tests.log 2>&1; echo test-exit=\$? >> \$S/s4-review-fix-w3-tests.log"
```
DB-opening tests need a 60 s timeout (`vi.setConfig({ testTimeout: 60_000 })` or per-test). Then, to show the tests are not vacuous, temporarily comment out the `purgeOwnBookOf` call in the create catch? **No — do not touch source.** Instead, state in the report which assertion would fail if the catch did not purge (reason it from the code).

## Rules (CLAUDE.md, quoted)

- "Inside `db.transaction(async (tx) => …)` use only `tx`."
- "It is a **session**, never a *chat*." Memory rule: there is always a lorebook — never write "no lorebook" framing in comments.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**."
- **Prettier:** run `npx prettier --check` on the two test files; **only `--write` the lines you changed** — never reformat a whole file. If a file fails only on lines you didn't touch, leave it and say so.

## Files owned

`src/lib/server/sockets/sessions.castMemberIds.int.test.ts`, `src/lib/server/sockets/sessions.castFromLorebook.int.test.ts`. Readable: anything. Never edit image-generation files (`dispatchImage.ts`, `imageGen/**`, `matting.ts`, `KoboldCppManagedAdapter.ts`, `sprites/fillAction.ts`, `characters/portrait.ts`).

## Report (your final message)

Changed files with line ranges, tests run with pass/fail counts and log path, why each new test cannot pass unless the catch ran, deviations, **Noticed, not done**.
