# BRIEF s27-S2-tidy-w1 — stamp fails loudly, "can act" by the seat's card, ordering tidy

Worker for lane **s27-S2-tidy** (supervisor: Opus). App root `/home/jody/github/serene-pub`. Report back in your final message (changed files with what changed, tests run with pass/fail counts, anything you could not do). **No behaviour change for today's data in any item.**

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Rules you work under (quoted from CLAUDE.md / the S2 contract)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite."
- "No static `$lib/server/db` import in modules tests mock (pass `db`)."
- "Files dirty at HEAD carry other lanes' uncommitted work: additive hunks, re-read before each edit." **Never reformat a file** (no prettier --write); edit only the hunks named.
- "`src/lib/server/sockets/sessions.ts` (≈10k lines) … Re-read the hunk immediately before each edit; never reformat; never run prettier on it."
- No new exported name, setting, flag, event or migration. Never write "no book"/"no lorebook" in code, comments or tests; say "a session whose lorebook is its own book".
- "The existing tests in your files stay green **unchanged** (a test you must edit is a finding — say why)."
- Never pipe vitest into `head`/`tail` (SIGPIPE leaks PGlite temp dirs). Int tests that touch the DB need 60 s timeouts.

## Files owned (only these hunks)
- `src/lib/server/messages/store.ts` — the speaker-stamp hunk (~lines 128–210: `speakerMemberOf`, `withSpeakerStamp`, `restampSpeakers`). Do NOT touch `speakerRefOfValues` (another item, held) or `withStoryClockStamp`.
- `src/lib/server/messages/permissions.ts` — `ownsSeatedCard` (~66–94).
- `src/lib/server/sockets/sessions.ts` — the fireTurn `ownsIt` block only (~10064–10106; find it by `let ownsIt = false`).
- `src/lib/server/utils/castMemberCards.ts` — `memberOfCard` (~93–121).
- `src/lib/server/pipelines/prompt/seatCards.ts` — `cardsAsSeatsRead` (~318–361) only.
- `src/lib/server/sessions/seats.ts` — `seatOf`'s doc comment only (~860–874).

## Items
1. **The speaker stamp fails loudly.** In `store.ts`, `withSpeakerStamp` wraps the stamp in `try { … } catch (err) { console.warn("[messages] speaker stamp skipped:", err); return values }`. Drop the try/catch so a failed `seatOf` fails the write like any other query in it. Do the same in `restampSpeakers` (its loop body is in a try/catch that warns "speaker re-stamp skipped" — drop it; a patch's re-stamp is part of that write). Fix the doc comment on `speakerMemberOf` (and any comment saying a failure "never fails the write" about the SPEAKER stamp — leave `withStoryClockStamp`'s own comment as it is): say a failed seat read fails the write, as any other query in it does (inside a transaction a failed select aborts it anyway). Behaviour for a successful read is identical.
2. **"Can act" by the seat's card.** `permissions.ts` `ownsSeatedCard` today reads `memberAsRead(… overCards: new Map([[seat.castMemberId, seat.cardId]]))` only to get `activeCardId`, which `overCards` pins to `seat.cardId`. Replace with: `const seat = await seatOf(…)`; `if (!seat) return ownsCharacter(db, cardId, userId)`; `return ownsCharacter(db, seat.cardId ?? cardId, userId)`. Drop the `memberAsRead` import there. Rewrite the doc: judged by the owner of the card the seat holds (`seat.cardId`); a card no seat holds here any more is judged by the message's own card.
3. **Fire-turn `ownsIt` by the seat's card.** In `sockets/sessions.ts`'s fireTurn handler, the `ownsIt` block reads `memberAsRead` the same way. Replace the `memberAsRead` part so `cardId` is just `seat?.cardId ?? null` (then the existing `if (!seat && seatRefForm === "character") cardId = Number(…)` line and the owner select stay). A card-less seat (`seat.cardId` null) stays not-owned, as built. Update the `🚧 Judged through the seat (S2)` comment: the owner of the card the seat holds. Minimal diff, no reformatting of the surrounding block.
4. **`memberOfCard` is deterministic.** In `castMemberCards.ts`, the first select (`linked`, `.limit(1)` on `lorebookBindings`) gets `.orderBy(asc(schema.lorebookBindings.id))` before `.limit(1)` (`asc` is already imported there — check).
5. **`cardsAsSeatsRead` orders like `seatOf`.** In `seatCards.ts`, `.orderBy(asc(cs.position), asc(cs.id))` becomes `.orderBy(asc(sql\`coalesce(${cs.position}, 0)\`), asc(cs.id))` — matching `seatOf` in `sessions/seats.ts` (~905). Add `sql` to the dynamic `drizzle-orm` import in that function.
6. **`seatOf`'s doc names its mirror.** Add one line to `seatOf`'s doc comment in `sessions/seats.ts`: "`cardFormRefInCast` (`pipelines/prompt/seatCards.ts`) mirrors this order over a `session_cast` read in hand — change both together." Nothing else in that file.

## Tests (Done means — all green, none edited)
Run from the app root, one vitest invocation, e.g.
`npx vitest run src/lib/server/messages src/lib/server/sessions/fireTurn.int.test.ts src/lib/server/sessions/fireTurn.seatedMember.int.test.ts src/lib/server/sockets/sessions.fireTurnOnly.test.ts src/lib/server/sockets/sessions.turnControlPresence.int.test.ts src/lib/server/sockets/sessionMessages.laneEnvoySwipe.int.test.ts src/lib/server/pipelines/prompt/seatCards.test.ts src/lib/server/pipelines/prompt/seatCards.int.test.ts src/lib/server/sessions/seats.int.test.ts src/lib/server/sockets/sessions.seatCast.int.test.ts src/lib/server/sessions/branch.seatMembers.int.test.ts src/lib/server/pipelines/runtime/datedCardLore.int.test.ts src/lib/server/sockets/castMemberLifecycle.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/s27-S2-tidy-w1-vitest.log 2>&1`
then read the log's summary with `grep`. If a file fails, say whether it fails at HEAD's logic too (read the failure; don't guess). Then `npx tsc --noEmit -p . 2>&1 | grep -E "messages/(store|permissions)|sockets/sessions.ts|castMemberCards|seatCards.ts|sessions/seats.ts"` must print nothing new from your hunks (report any line it prints and whether it is yours).
Afterwards list any `/tmp/serene-pub-vitest-*` dirs younger than your run; delete only ones clearly named after your test files, by exact name.

## Out of scope
`speakerRefOfValues` / `speakerRefOf`, any `cardFormRef` caller, `portrayals.ts`, `host.ts`, `NOMENCLATURE.md`. Stop and report (don't decide) if any item can't be done without changing behaviour or editing an existing test.
