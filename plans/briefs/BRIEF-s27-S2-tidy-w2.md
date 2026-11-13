# BRIEF s27-S2-tidy-w2 — portrayals answer only the ref asked; outcome words name the member

Worker for lane **s27-S2-tidy** (supervisor: Opus). App root `/home/jody/github/serene-pub`. Report back in your final message (changed files with what changed, tests run with pass/fail counts, anything you could not do).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Rules you work under (quoted from CLAUDE.md / the S2 contract)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite."
- "No static `$lib/server/db` import in modules tests mock (pass `db`)."
- "Files dirty at HEAD carry other lanes' uncommitted work: additive hunks, re-read before each edit." **Never reformat a file** (no prettier --write); `host.ts` already fails prettier at HEAD — leave it.
- No new exported name, setting, flag, event or migration. Never write "no book"/"no lorebook"; say "a session whose lorebook is its own book".
- "The existing tests in your files stay green **unchanged** (a test you must edit is a finding — say why)." New tests are added as new `test`/`it` blocks.
- "Behaviour stays the same for today's data — with one intended change": a seat's member is read wherever it lives, so a member's own name (`own_name`) reaches readers that read through the seat.
- Never pipe vitest into `head`/`tail`. Int tests that touch the DB need 60 s timeouts.

## Files owned (only these hunks)
- `src/lib/server/pipelines/runtime/portrayals.ts` — `resolvePortrayals`, the `seatedAsked` handling (~131–150 and the loop after the main `for (const p of parsed)` ~314–318).
- `src/lib/server/pipelines/runtime/host.ts` — the outcome-words block only (~7395–7400, find `outcomeWordsOf(db, p.blocks)`).
- New tests in `src/lib/server/pipelines/runtime/turnSeats.seatMembers.int.test.ts` (append inside / beside its `describe("resolvePortrayals"…)`) and `src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts` (append a new `describe`). Reuse each file's existing fixtures/helpers; read the file's top first.

## Items
1. **Portrayals answer only under the ref asked.** Today `resolvePortrayals` translates each asked `seated-member:<id>` to its seat's card form (`seatedAsked`), answers the card under its canonical key in the main loop, then copies that answer under the asked `seated-member:` key. So the result also carries `character:<cardId>` (or `player-seat:<id>`) though nobody asked for it. Change: after copying under the asked ref, delete the translated card key from `portrayals` **unless that same canonical key was also asked directly** (a ref in `refs` that is not a `seated-member:` ref and canonicalises to the same key via `formatParticipantRef(parseParticipantRef(ref))`). Keep everything else (speaker handling, `NONE` for unseated). Comment it in one line. Add a test in `turnSeats.seatMembers.int.test.ts`: asked only `seated-member:<npcMember>` and `seated-member:<personaMember>` → the result has exactly those keys (plus nothing for the cards); and the existing test (which also asks `character:<npc>`) stays green unchanged.
2. **Outcome words name the member.** `host.ts` ~7398: `outcomeWordsOf(db, p.blocks)` → `outcomeWordsOf(db, p.blocks, sessionId)` (`sessionId` is the scope's, already in scope there — verify it is defined at that point and is a number; if it can be `undefined`, pass it as is: the parameter is optional). Test in `host.seatMembers.int.test.ts`: a carded seat whose member has its own name (`own_name`), a message written through the host's write outlet with an outcome block whose `by` is `character:<card>` → the row's `metadata.diceWords` (key `DICE_WORDS_KEY` from `messages/diceWords.ts`) starts with the member's own name, not the card's. Look at how the file's existing tests drive the host (e.g. the set-stat-config test) and how `messages/seatMemberNames.int.test.ts` (`describe("outcomeWordsOf"`) builds outcome blocks; reuse those shapes. If driving the write outlet needs a harness the file doesn't have, stop and report what is missing instead of building one.

## Tests (Done means — all green, existing ones unedited)
From the app root, one invocation:
`npx vitest run src/lib/server/pipelines/runtime/portrayals.int.test.ts src/lib/server/pipelines/runtime/turnSeats.seatMembers.int.test.ts src/lib/server/pipelines/runtime/runTurn.int.test.ts src/lib/server/utils/envoyRoad.int.test.ts src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts src/lib/server/messages/seatMemberNames.int.test.ts src/lib/server/messages/diceWords.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/s27-S2-tidy-w2-vitest.log 2>&1`
then, separately, `npx vitest run src/lib/server/sockets/sessions.lairWalk.int.test.ts > …/s27-S2-tidy-w2-lair.log 2>&1` (it asserts `diceWords` through the host). Read summaries with `grep`. If a file fails, say whether the failure is from your change (read it; don't guess).
Then `npx tsc --noEmit -p . 2>&1 | grep -E "runtime/portrayals|runtime/host.ts|turnSeats.seatMembers|host.seatMembers"` — report any line and whether it is yours.
Afterwards delete only `/tmp/serene-pub-vitest-*` dirs clearly named after your test files, by exact name.

## Out of scope
`cardFormRef` callers (leave `portrayals.ts`'s `cardFormRef` calls as they are), `messages/**` source, `sockets/sessions.ts`, `NOMENCLATURE.md`. Stop and report (don't decide) if an item can't be done without editing an existing test or changing another behaviour.
