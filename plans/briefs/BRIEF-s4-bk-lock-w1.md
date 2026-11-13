# BRIEF — `s4-bk-lock` worker 1 (server) — a session keeps the lorebook it started with; cast-name push gaps — 2026-11-08

Supervisor: lane `s4-bk-lock`. Repo `/home/jody/github/serene-pub`. Worker 2 runs in parallel on the client files (EditSessionForm, LorebooksWorkspace, SummarizeLoreModal …) — never touch a `.svelte` file or anything under `src/lib/client/` except `src/lib/client/sockets/typedSocket.ts` (named below).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## Owner rulings this rests on (never reinterpret)

- 2026-11-05 ★27-10: "All sessions have a lorebook, [own book] or overlay. No exceptions so SDK data storage API is predictable. No swapping lorebooks."
- 2026-11-08 ★B-5: the book is **fixed at start** — chosen at create; the edit form shows a read-only line. Supersedes the 2026-10-21 "until play has written" lock (`sessions/bookLock.ts:1-19`).
- Kept (not swaps): create, chat import, branch, next chapter, `shareAsLorebook` (surfacing). Don't touch those paths.
- Memory rule "There is ALWAYS a lorebook": never write copy or comments that frame a session as having no lorebook. A session with `lorebook_id = null` reads **its own book** (its Session notes); one with `lorebook_id` set reads that book through an **overlay** (its own book overlays it).

## Goal

### 1. The lock becomes unconditional — `src/lib/server/sessions/bookLock.ts`
- `bookChangeRefusal` becomes pure and synchronous: `bookChangeRefusal(session: { lorebookId: number | null }, nextLorebookId: number | null): string | null`. Same value (null === null too) → `null`; anything different → `BOOK_LOCK_REFUSAL`. No `playHasWritten` call, no db.
- **Keep `playHasWritten`** (still read by `sessions/closeOut.ts:79` and `sockets/sessions.ts:5480` for `lorebookFixed`/`catchUp`). Update its JSDoc so it no longer calls itself the lock: it is "play has written" (closeOut and the catch-up read it).
- Rewrite the header comment (lines 1–19): the 2026-11-08 ★B-5 rule — a session keeps the lorebook it started with; the book is chosen at create; why (an own book is written against the book it overlays; ★27-10 keeps the SDK's storage predictable); the one refusal sentence; Share as a lorebook is the way to build on its notes elsewhere. No sentence may promise a switch before play.
- `rulesFromBook`: after your changes check `grep -rn rulesFromBook src` (non-test). If nothing calls it, delete it and its now-unused imports, and say so. (`createSession.svelte.ts`'s `rulesFromBook` is an unrelated client field — leave it.)
- Remove the re-export of `NOTES_KEEP_THE_WORLD` / `bookFixedSentence`; re-export `BOOK_LOCK_REFUSAL` instead if a caller wants it from here.

### 2. The words — `src/lib/shared/lorebooks/sessionNotes.ts` (one copy of each sentence; the client imports them — worker 2 imports exactly these names)
Replace `NOTES_KEEP_THE_WORLD` and `bookFixedSentence` with (mark both 🚧, one JSDoc sentence each, cite ★B-5 2026-11-08 / plan §34.3):
```ts
/** 🚧 The book lock's one refusal (★B-5, 2026-11-08): server, old clients and the Guide alike. */
export const BOOK_LOCK_REFUSAL = "A session keeps the lorebook it started with."

/** 🚧 The edit form's read-only Lorebook line, one per book kind (plan §34.3). `book` is the read book's plain name. */
export const BOOK_LOCK_LINES = Object.freeze({
	ownBook:
		"This session's lorebook is its own notes, and a session keeps the lorebook it started with. Share them as a lorebook to build on them in other sessions.",
	overlay: (book: string): string => `This session reads ${book} and keeps it. Share its notes to ${book}.`
})
```
Those three sentences are owner-ruled: copy them character for character. Also reword `SHARE_REFUSALS.noBook` (it frames a session as reading no lorebook; it's still thrown by `cloneWithChanges`, which stays until wave 6) to exactly:
`"This session's lorebook is its own notes, so there is nothing to clone. Share them as a lorebook instead."`
Fix the stale comment block above the old constants. Leave the rest of the file alone.

### 3. `sessions:update` — `src/lib/server/sockets/sessions.ts` (ONLY the update handler's book checks, ~6264–6360, the write ~6543, the resync ~6556–6560, and stale book-lock comments in that handler)
- When `params.session.lorebookId !== undefined`: read the stored `lorebookId`; `bookChangeRefusal({ lorebookId: stored }, next)`; refused → `throw new Error(refusal)` **before** any other check or write. Same value → accepted and nothing about the book changes (old clients post every field).
- The kit/ownership check at ~6276 (`kitReadRefusal`, `checkLorebookOwnership`) is for a *new* book; with the lock first it only ever sees the stored value. Keep the order so the lock refuses first, and keep or drop the then-redundant check as you judge — say which.
- Drop the dead "book read in before play" branch: `bookRules`, `strictRulesRefusal` there, `rulesFromBook` there, `...(bookRules ?? {})` in the write, and the `ownBookFor` resync after the transaction (the book can no longer move). Keep `lorebookId` in the `.set(...)` only if needed for the same-value write — simplest is to stop writing `lorebookId` at all from this handler; decide and say which.
- Touch nothing else in this 11k-line file (no reformatting).

### 4. `sessions:setLorebook` removed
- `src/lib/server/sockets/summarize.ts`: delete `sessionsSetLorebookHandler` and its `register(...)` line, plus imports only it used (`isNewAttachOfDisabledBook`, `assertOwnedBook`/`LOREBOOK_NOT_FOUND`, `strictRulesRefusal`, `announceSessionLineMoved` … — check each with grep inside the file and elsewhere; an export another file imports stays).
- `src/lib/shared/sockets/types.ts`: delete the `namespace SetLorebook` (~7442) and nothing else.
- `src/lib/client/sockets/typedSocket.ts`: delete the `"sessions:setLorebook"` entry (~1735) only.
- `src/lib/shared/sockets/interest.ts`: delete `"sessions:setLorebook"` from the list (~734) only.
- A client emit of `sessions:setLorebook` must now meet no handler.

### 5. Library `attach-lorebook` op — `src/lib/server/library/writes.ts` (the attach op's refusal only; do NOT remove the op, its undo/redo or anything in `host.ts`/`bindings.ts`/`flows.ts`/`receipts.ts`/`announce.ts`/`ledgerLines.ts` — lane f-sdk removes them in wave 1)
- In `applyLibraryChange` `case "attach-lorebook"` (~473): after the read/write permission checks and the stored-book read, `bookChangeRefusal({ lorebookId: session?.lorebookId ?? null }, lorebookId)`; refused → `throw new LibraryWriteRefusal(refusal)`. Same book → today's path (a no-op move).
- Undo (~579) and redo (~637) call `setSessionBook` too; an old ledger row could still move a book on Back/Forward. Route both through `bookChangeRefusal` and, when refused, **skip the move silently** (the session keeps its book; Back/Forward of the rest of the turn must not fail). One comment line saying why.

### 6. Cast-name push gaps — `src/lib/server/sockets/amendments.ts` (push lines only)
- `amendments:place` (~2326): after the transaction, `await tellMemberSessions(socket.io, db, params.lorebookId, member.id)` (already imported at the top; see its use at ~1913).
- `amendments:unplace` (~2397): the delete gets `.returning({ castId: schema.castPresences.lorebookBindingId })`; for the deleted row, `tellMemberSessions(socket.io, db, params.lorebookId, castId)`.
- `amendments:deleteBranch` (~2048; `announceSessionsMoved` ~2281): every moved session also gets `pushSessionToParticipants(io, sessionId, ownerId)` (from `$lib/server/sockets/sessions`, lazy import as `memberSessions.ts` does) so its `castNames` arrive; read each session's owner (`sessions.userId`). Best-effort: log a failure, never refuse the delete that landed. Fix the comment at ~2277 that cites `sessions:setLorebook`.
- Fork needs nothing.

## Files owned (edit only these)
`src/lib/server/sessions/bookLock.ts` · `src/lib/shared/lorebooks/sessionNotes.ts` · `src/lib/server/sockets/sessions.ts` (§3 hunks only) · `src/lib/server/sockets/summarize.ts` · `src/lib/server/library/writes.ts` (§5 hunks only) · `src/lib/server/sockets/amendments.ts` (§6 hunks only) · `src/lib/shared/sockets/types.ts` (the SetLorebook namespace only) · `src/lib/client/sockets/typedSocket.ts` (one entry) · `src/lib/shared/sockets/interest.ts` (one entry) · **test files**: any `*.test.ts` / `*.int.test.ts` under `src/lib/server/` or `src/lib/shared/` that references the removed event/helpers or that breaks because a test moves a session's book after create (see Tests).

## Files readable
Everything. Useful: `src/lib/server/sessions/memberSessions.ts`, `src/lib/server/lorebooks/ownBook.ts`, `src/lib/server/sockets/lorebooks.memberSessionPush.int.test.ts`, `src/lib/server/library/writes.int.test.ts`, `plans/PLAN-sdk-creation-seams-2026-10-30.md` §34.3 (line ~1468).

## Out of scope (never build here)
- Removing the library op, the SDK outlet `core:outlet/attach-lorebook@1`, or its mentions in `host.ts`/`bindings.ts`/`flows.ts`/`receipts.ts`/`announce.ts`/`ledgerLines.ts` (lane f-sdk, wave 1).
- `cloneWithChanges` and its UI (wave 6). Next chapter's surfaced-book reading (wave 6).
- `seats.ts`, `state/**`, comments in `rulesets/bookRules.ts` / `shared/rulesets/rulesOffer.ts` that cite `sessions:setLorebook` (list them under Noticed).
- Any client `.svelte` file (worker 2).

## Stop and ask when (write it in your report and stop that item; finish the rest)
- A test or code path shows a **live** flow (Guide/applet start, chat import, branch, next chapter, a starter start) depends on changing a session's book after create. A test that merely *sets up* a book with `sessions:update` is not a live flow: change its setup (create the session with the book, or write the column directly in the fixture) and say so per file.
- Any new name beyond `BOOK_LOCK_REFUSAL` / `BOOK_LOCK_LINES`, any migration, any new event.

## Hard rules (each has cost data or hours)
- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- An event in `SCOPED_EVENTS` must carry its scope key in the payload.
- It is a **session**, never a chat. Never frame a session as having no lorebook.
- Never `kill -9` anything. Never `git checkout` / `restore` / `stash` in either repo.
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (This task needs no `sdk:build`; a dev server runs on :5199.)
- **Prettier:** run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file you didn't otherwise edit. If a file fails only on lines you didn't touch, leave it and say so.

## Tests
Run only targeted files, in a capped scope, logged (never pipe vitest into `head`; scratch logs in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, names starting `s4-bk-lock-w1`):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > <log> 2>&1; echo test-exit=$? >> <log>'
```
An int test that opens a DB inside an `it` needs a 60 s timeout.

1. **Baseline first** (before editing), on the candidate files, so you know what already fails: `src/lib/server/sessions/bookLock.int.test.ts`, `src/lib/server/sockets/summarize.setLorebookAnnounce.int.test.ts`, `src/lib/server/sockets/summarize.sessionAccess.int.test.ts`, `src/lib/server/sockets/sessions.rulesIncompatible.int.test.ts`, `src/lib/server/sockets/calendarInvariants.int.test.ts`, `src/lib/server/lorebooks/starterKits.int.test.ts`, `src/lib/server/plugins/providedBooksPubWide.int.test.ts`, `src/lib/server/library/writes.int.test.ts`, `src/lib/server/sockets/lorebooks.memberSessionPush.int.test.ts`, plus every test file that calls `sessions:update`/`sessionsUpdateHandler` with a `lorebookId` (find with `grep -rln "sessionsUpdateHandler\|\"sessions:update\"" src --include=*.test.ts | xargs grep -ln lorebookId` — ~23 files). Run in batches of ≤6 files.
2. **Write / update:**
   - `bookLock.int.test.ts`: `sessions:update` refuses a different `lorebookId` **before play** and **after play** with `BOOK_LOCK_REFUSAL`, for an own-book session (null → a book) and an overlay session (book → another book, book → null); accepts the same id (and null → null) and still saves the other fields. Delete its `sessions:setLorebook` describe (reason: event removed). Keep the `playHasWritten` tests.
   - The library op: a different book is refused in words (`BOOK_LOCK_REFUSAL`, as a `LibraryWriteRefusal`); the same book is accepted; undo/redo of an old row whose move is now refused leaves the book and does not throw. In `writes.int.test.ts` or a new neighbour.
   - `sessions:setLorebook` is gone: a test that the summarize handler registry no longer registers it (or that a client emit gets no handler/ack) — the cheapest honest proof.
   - Push: `amendments:place`, `amendments:unplace` and `deleteBranch` push the session (`castNames` reach the reading session) — extend `lorebooks.memberSessionPush.int.test.ts` following its existing cases.
   - Delete `summarize.setLorebookAnnounce.int.test.ts` and the setLorebook cases in `summarize.sessionAccess.int.test.ts`, `sessions.rulesIncompatible.int.test.ts` (~294), `calendarInvariants.int.test.ts` (~370), `starterKits.int.test.ts` (~589, keep its create/update kit refusals where they still hold) — each with a one-line reason in your report. `providedBooksPubWide.int.test.ts` ~279–300: the update and library-attach steps now expect the refusal; keep the create step.
   - Every other test that moved a book after create: fix the setup, list each file.
3. Re-run all of the above; report before/after per file. Don't run `npm test`, `tsc` or `check` — the supervisor does.

## Report
Write your report as your final message (the supervisor reads it): changed files (with the hunks' line ranges), each decision you made, tests before/after per file, anything under Stop-and-ask, and **Noticed, not done**.
