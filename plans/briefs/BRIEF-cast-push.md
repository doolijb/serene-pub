# BRIEF cast-push-w1 — a cast member edit reaches open sessions without a refresh (lead-supervised worker; owner 2026-11-06)

You are a lane-worker. Read `plans/briefs/BRIEF-lay-common.md` (rules apply: EVERY test/tsc run inside the memory-capped `systemd-run` scope, one file per run; int tests with DB-in-`it` need 60 s timeouts; inside `db.transaction(async (tx) => …)` only `tx`; CLAUDE.md Sockets rule: an event in SCOPED_EVENTS must carry its scope key). App = /home/jody/github/serene-pub.

Owner: "Editing and saving cast member in the lorebook doesn't update the character in the session without a refresh, i.e. changing the name."

## Root cause (read-only diagnosis, verify lines)
A seated name on the session page = the card overlaid with `session.castNames[cardId]` (`sessionPageProjections.ts:107` → `projections/characters.ts:268`). `castNames` / `castFaces` / `castSpriteSets` are built server-side in `withSessionExtras` (`src/lib/server/sockets/sessions.ts` ≈5375, ≈5419–5425) and reach the client only on `sessions:get` / `sessions:refresh` (`sessionStore.merge`, `sessionStore.svelte.ts:132`; listened in `sessionPageData.svelte.ts` ≈1133–1161). The cast save (`lorebooks:updateBinding` → `updateLorebookBindingHandler`, `sockets/lorebooks.ts` ≈2283–2675; emits `lorebooks:bindingList`, `amendments:list`, `lorebooks:updateBinding` to the editor only) never pushes `sessions:refresh` to the sessions reading that member.

## Build (P2: the writer pushes; no client change)
1. NEW `src/lib/server/sessions/memberSessions.ts`: `sessionsReadingMember(db, { lorebookId, memberId }) → Promise<Array<{ sessionId: number; ownerId: number }>>` = union of (a) sessions with `sessions.lorebookId = lorebookId`, (b) the session whose own book this is (`lorebooks.sessionId`), (c) sessions with a live (not removed) seat whose `castMemberId = memberId` in `sessionCharacters` / `sessionPersonas` (check the real column names in schema.ts). Precedent: `sessionsSeating` in `src/lib/server/state/cardState.ts` ≈334. And `tellMemberSessions(io, db, lorebookId, memberId)`: for each, `pushSessionToParticipants(io, sessionId, ownerId)` (exported from `sockets/sessions.ts` ≈5911; dynamic import like `ownBooks.ts` ≈41) — pass the session's OWNER (getSessionFromDB access-checks that user; the editor may not own a shared-book reader's session). try/catch + log; a failed push never turns a landed write into a refusal (as cardState.ts `tellOthers`).
2. Call it from: `updateLorebookBindingHandler` right after `relistBindings` (lorebooks.ts ≈2654); `updateMemberToCardVersionHandler` (≈2768); the cast-naming `amendments:create` / update / delete handlers in `sockets/amendments.ts` (create ≈1543) when the amendment names a `castId`. `lorebooks.ts` and `amendments.ts` are shared with another programme (cv / seat-cast): re-read each right before editing, one-line call hunks only, never a whole-file write. Do NOT touch `sessions/seats.ts` or `sockets/sessions.ts`.

## Tests
- NEW `src/lib/server/sockets/lorebooks.memberSessionPush.int.test.ts` (copy the pattern of `sessions.refreshPush.int.test.ts` / `castMemberLifecycle.int.test.ts`): a carded member seated in a session reading the book, a socket with interest in `interestKey("sessions:refresh", sessionId)`; `lorebooks:updateBinding { id, ownName: "Renamed" }` → exactly one `sessions:refresh` with `session.id === sessionId` and `castNames[cardId]` showing "Renamed"; a guest's socket gets it too; a session on another book gets nothing; a cast `amendments:create` at a date the session has reached also pushes.
- Client guard (`sessionStore.svelte.test.ts` or the nearest existing store test): `load` with `castNames {}`, `merge` a refresh with `castNames { [cardId]: { ownName: "Renamed" } }` → `seatCardAsShown(session, card).name === "Renamed"`.

## Files owned
the new memberSessions.ts, the call hunks in sockets/lorebooks.ts and sockets/amendments.ts, the two tests. Nothing else.

## Done means
Tests green in capped runs; capped `npx tsc --noEmit -p .` no errors in your files. Final message = report: changed files, tests + results, Noticed.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."
