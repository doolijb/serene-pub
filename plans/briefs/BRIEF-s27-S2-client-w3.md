# BRIEF s27-S2-client-w3: int tests for the session payload's cast fields

Lane **s27-S2-client** (supervisor: Opus), worker **w3** (Sonnet). App `/home/jody/github/serene-pub`. Your report goes to your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## What is under test (written by the supervisor; read it, do not edit it)
`src/lib/server/sessions/rowProjection.ts`:
- `seatCastShownFrom(rows, asReads)` (pure): `castNames` / `castFaces` by seated card id from each seat's member as read; a seat whose member reads exactly as its card adds nothing.
- `seatCastShownForSessions(db, sessions)`: the same for many sessions (the `sessions:list` rows), running the member read only for sessions the internal prefilter `sessionsWithMemberWords` names (a seat's stored member, or the card's member in the session's attached or own book, has `own_name`, `own_nickname` or `face_media_id`).
- `memberSpriteSetsBySeat(db, rows, asReads)`: the member's own sprite sets (`sprite_sets.cast_member_id`) by seated card id, kept only when one set has a sprite with a file.
- `lastVisibleMessages(db, sessionIds)`: the speaker name now comes from `cardsAsSeatsRead` (the seat's member, wherever it lives).
`asReads` come from `seatMembersAsRead(db, sessionId, rows)` in `src/lib/server/pipelines/prompt/seatCards.ts`.

## Item: one new test file `src/lib/server/sessions/rowProjection.seatCast.int.test.ts`
Copy fixture setup from `src/lib/server/pipelines/prompt/seatCards.int.test.ts`, `src/lib/server/cast/memberAsRead.int.test.ts` and `src/lib/server/sessions/rowProjection.castNames.int.test.ts` (test DB, users, cards, lorebooks incl. a session's own book, bindings, seats with `cast_member_id`, files for faces/sprites, dated card amendments). `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`. Its temp dir name starts `serene-pub-vitest-s27client-`; remove it in `afterAll` exactly as the copied files do.
Cases (each a `test`):
1. **Own-book member over card:** a session whose lorebook is its own book; a seat on card C (name "Bianca", no nickname, an avatar file) whose member lives in the own book with `own_name` "Bee" and a face file with `retold: { face: true }` → `seatCastShownForSessions` gives `castNames[C] = { ownName: "Bee", ownNickname: "" }` and `castFaces[C] = <face file id>`.
2. **Unchanged for today's data:** a seat whose member has no own names and no retold face (and a seat with no member at all) → the session is absent from the map, or its maps are `{}`; and `seatCastShownFrom` on such rows gives `{ castNames: {}, castFaces: {} }`.
3. **An own nickname only:** member `own_nickname` "B" → `castNames[C] = { ownName: "Bianca", ownNickname: "B" }`.
4. **Two seats on one member:** two seats in one session, cards C1 and C2, both with `cast_member_id` = M (M has `own_name`) — each keyed by its own card, both with M's name.
5. **A seat reads the card it holds:** if `seatCards.int.test.ts` has a dated card-amendment fixture, reuse it: a seat holding card A while the clock draws card B → `castNames`/`castFaces` keyed by A, and no entry for B. If building that fixture is impractical, say so and skip this case.
6. **Member sprite sets:** M owns a set "casual" with one sprite that has a file → `memberSpriteSetsBySeat` gives `{ [C]: [{ name: "casual", isDefault, sprites: [{ label, position, file: { uuid, rev } }] }] }`; a member set with no sprite file → no entry; a seat whose member has no sets → no entry.
7. **Last line names the own-book member:** `lastVisibleMessages` for a session whose lorebook is its own book, last line spoken by card C whose own-book member has `own_name` "Bee" → `speakerName` "Bee".
Run: `npx vitest run src/lib/server/sessions/rowProjection.seatCast.int.test.ts src/lib/server/sessions/rowProjection.castNames.int.test.ts` (never piped into `head`). All green. `npx prettier --check` on the new file. If a case fails because the code under test is wrong, do NOT change the code: report the failing case with what you expected and what you got.

## Files owned
Only the new test file.

## Rules
- "Inside `db.transaction(async (tx) => …)` use only `tx`."
- "Never seed a row at a hardcoded id." Use returned ids.
- "Every session has a lorebook … Never write "no book", "no lorebook", "bookless", "reads no lorebook" in code, comments, tests or copy." Say "a session whose lorebook is its own book".
- It is a **session**, never a chat.
- Never pipe vitest into `head`. DB int tests: 60 s timeouts.

## Report
Tests and counts, any case skipped and why, any failure that points at the code.
