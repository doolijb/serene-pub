# BRIEF — lane `time-t10`, worker w3 — the server's two person doors: the clock door and Session settings' save

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t10`. Workers w1 (server core) and w2 (client) are done; you run alone.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no GPU, no migration. Leave the owner's `vite preview` (port 4173) alone.

## Goal

When a person moves a session's story clock **back** past dated things that session already wrote into its lorebook, the move follows the session's **On revision** and is confirmed first. Under **Overwrite** a confirmed move is exactly today's write (nothing is removed). Under **Branch** the session branches at its newest message and the BRANCH's clock is set; the parent is not written. You wire the two server doors to the decider w1 built.

Owner rulings (quote, do not reinterpret):
- 2026-11-14 (★12): "The clock moved back uses **On revision** (no separate answer for deleting a turn and for moving the clock)"; "No new setting; 'flashback' is the same line, writing at the earlier date."
- 2026-11-13: "When a session's story clock moves back past things that session already wrote, a choice is required, never made silently."

## What exists (read these first)

- `src/lib/server/sessions/clockMoveBack.ts` (w1): `clockMoveBackNotice(db, sessionId, move: PersonClockMove)` — THE decider, null = proceed as today; `ClockMoveBackRefusal` (a `StoryClockRefusal` carrying `.notice`); `moveClockBackOnBranch(db, { sessionId, userId, to: StoryClock | null, io? })` → `{ ok, sessionId, from } | { ok: false, error }`; `PersonClockMove = { to } | { follow: true } | { by, unit }`.
- Wire (already in `src/lib/shared/sockets/types.ts`; do not edit): `StoryClock.Params.moveTo?: StoryClock | null`; `StoryClock.Response.clockMoveBack?: ClockMoveBackNotice | null` and `branchedTo?: number`; `SetStoryClock.Params.confirmClockMoveBack?: true`; `Update.Params.confirmClockMoveBack?: true`; `Update.Response.branchedTo?: number`.
- The client (w2) already sends these: the session page resends `sessions:setStoryClock` with `confirmClockMoveBack: true` after the person confirms a refusal carrying `clockMoveBack`, and goes to `branchedTo`; Session settings asks `sessions:storyClock { moveTo }` before saving a moved clock and sends `sessions:update` with `confirmClockMoveBack: true` after the person confirms.

## Files owned (edit only these)

1. `src/lib/server/sockets/storyClock.ts`.
2. `src/lib/server/sessions/clockMoveBack.ts` — only to export the destination helper of §A (refactor `clockMoveBackNotice` to use it; its behaviour must not change).
3. `src/lib/server/sockets/sessions.ts` — a SHARED file: ONLY the clock part of `sessionsUpdateHandler` (around the `db.transaction(async (tx) => { const linePatch = await sessionLinePatch(tx, { … clock: clockFromColumns(…) })` block, ~6830–6880) and the one `branchedTo` field on its reply object (`const res: Sockets.Sessions.Update.Response = { session: … }`, ~7610). Nothing else in the file; never reformat it.
4. **New** `src/lib/server/sockets/storyClock.moveBack.int.test.ts` and **new** `src/lib/server/sockets/sessions.clockMoveBack.int.test.ts`.

## Build

### A. The destination (clockMoveBack.ts)

Export `personMoveDestination(db, sessionId, move): Promise<{ from: StoryClock; to: StoryClock | null } | null>` — the `from` / destination computation now inside `clockMoveBackNotice` (follow → the line's present; step → `advanceStoryTime`), so a Branch step sets the branch's clock to the same date the notice named. `clockMoveBackNotice` calls it.

### B. The clock door (storyClock.ts)

1. `sessionsStoryClock` (the read): when `params.moveTo !== undefined` and the asker is the owner, add `clockMoveBack: await clockMoveBackNotice(db, sessionId, moveTo === null ? { follow: true } : { to })` (a `moveTo` that is not a clock → `clockMoveBack: null`; use `clockFrom`). Otherwise the reply is exactly today's.
2. `setSessionStoryClock`: after its existing checks (owner, one way, the clock's shape and calendar, the timeline) and before it steps or writes, build the `PersonClockMove` and ask `clockMoveBackNotice`.
   - null → exactly today's path.
   - a notice and no `params.confirmClockMoveBack === true` → `throw new ClockMoveBackRefusal(notice)`; nothing written.
   - a notice, confirmed, `mode === "overwrite"` → exactly today's path.
   - a notice, confirmed, `mode === "branch"` → `moveClockBackOnBranch(db, { sessionId, userId, to: <the destination; null for follow>, io })`; its `error` → `StoryClockRefusal(error)`. Return `{ moved: false, branchedTo }` (the parent did not move).
   The notice is judged before the write and outside the move's own lock; say so in a one-line comment (the person's door only; a concurrent pipeline step only moves forward).
3. `sessionsSetStoryClock`: on `branchedTo`, re-send the person's session list and push the new row as `relistWithRow` in `sessions.ts` does (find the exported pieces, e.g. `buildSessionsListFor`, `broadcastSessionRow`; do not export anything new from `sessions.ts`), then reply with the PARENT's reading plus `branchedTo`. No `announceMoved` for the branch (it is a new session the person is taken to). In the catch, a `ClockMoveBackRefusal` adds `clockMoveBack: error.notice` to the `:error` reply (its message is the sentence already).

### C. Session settings' save (sessions.ts, the clock part only)

Before the `db.transaction` that writes the line patch: when the update carries a clock (`clockFromColumns(...) !== undefined`), the line is unchanged (`lorebookBranchId === undefined || lorebookBranchId === before.lorebookBranchId`), and the clock differs from `before`'s, ask `clockMoveBackNotice(db, id, clock === null ? { follow: true } : { to: clock })`.
- a notice and no `params.confirmClockMoveBack === true` → `throw new Error(notice.sentence)` (refused, nothing written, as every refusal of this handler is).
- confirmed Overwrite → as today.
- confirmed Branch → pass `clock: undefined` to `sessionLinePatch` (this session keeps its clock; everything else in the form saves), and right after the transaction `moveClockBackOnBranch(db, { sessionId, userId, to: clock, io: socket.io })`; its `error` → `throw new Error(error)`; remember the branch id, put it on the reply as `branchedTo`, and call `relistWithRow(socket, emitToUser, branchId)` after the reply as the delete handler does (~9375).

## Rules your work depends on

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently. `moveClockBackOnBranch` and `clockMoveBackNotice` take the outer `db`: call them outside any transaction.
- Sockets: an event in `SCOPED_EVENTS` must carry its scope key (`sessionId`) in the payload, or `emitToUser` silently sends nothing — every reply here carries `sessionId`. The server never toasts; replies and refusals only.
- Comments state the rule, not the story. Mark new names and sentences 🚧.
- Never `prettier --write` beyond the lines you changed (never on `sessions.ts` or `storyClock.ts` whole).
- An int test that opens a DB inside an `it` needs a 60 s timeout.
- It is a **session**, never a *chat*.
- If anything needs a new event, setting, migration, an edit elsewhere in `sessions.ts`, or a client change, STOP and report.

## Tests (write them; run each as below, one at a time)

Before each run: `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` — if a vitest is running (another session shares the checkout), wait and check again. Then:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t10-w3-<name>.log 2>&1"` and read the log (never pipe vitest into `head`). Fixtures: copy from `src/lib/server/sessions/clockMoveBack.int.test.ts` (w1: a session that wrote a dated version, the `branch` built-in published) and `src/lib/server/sockets/storyClock.int.test.ts` (how the handlers are driven).

`storyClock.moveBack.int.test.ts`: a move back past nothing, a forward move, a session with no clock, the Timeline off → as today; a set back past the session's dated version → `:error` with `clockMoveBack` (mode, count, sentence), the clock unchanged; the same with `confirmClockMoveBack` under Overwrite → moved, the later version still in the lorebook; under Branch → the reply carries `branchedTo`, the branch's clock is the date moved to, the parent's clock unchanged; a step back (`by: -n`) and `follow` are judged too; another session's later write does not count; a read with `moveTo` answers the notice, a guest's read with `moveTo` answers none.
`sessions.clockMoveBack.int.test.ts`: an update moving the clock back past the session's write is refused with the sentence and writes nothing (a name changed in the same update is not saved); confirmed Overwrite saves; confirmed Branch saves the other fields on this session, keeps its clock, sets the branch's clock and answers `branchedTo`; an update that does not touch the clock behaves as before.
Also run `src/lib/server/sockets/storyClock*.int.test.ts src/lib/server/sessions/clockMoveBack.int.test.ts` and the existing `sessions.*` tests that exercise `sessions:update` (`ls src/lib/server/sockets/ | grep -E "sessions\.(update|forms|reading|line)"`; `sessions.forms.int` has one known failure — report it, do not fix it).

Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors.

## Report (your final message)

Changed files (with the line ranges you touched in `sessions.ts`); each test command with pass/fail counts; any deviation and why; Noticed, not done. Under 400 words.
