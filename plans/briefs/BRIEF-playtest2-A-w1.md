# BRIEF playtest2-A-w1 — any member stops a waiting reply (★A2) + the model's clock move dropped after a manual Time passes (13a)

Supervisor: lane `playtest2-A`. Report: `/home/jody/github/serene-pub/plans/REPORT-playtest2-A-w1-2026-11-04.md` (if the write is refused, put the full report in your final message).

## Context you must not lose
Another programme (M2e) edits the same trees **right now**. `auth/actingPerson.ts` is being edited in parallel by another worker (they add a frame-origin cause beside `via`). `pipelines/runtime/host.ts` and `runTurn.ts` also carry their uncommitted edits. So: **re-read each file immediately before each edit; use Edit, never Write, on an existing file; never rewrite a file whole; touch only the lines your task needs.**

## Goal

### Task 1 — ★A2 (owner ruling 2026-11-04): "a waiting **reply** may be stopped by **any session member**; Actions (Rest, Image) and speech lines: **presser or owner** (★1a as built)."
1. `src/lib/server/auth/actingPerson.ts`: `PersonThing` gains ONE kind, additive only: `{ kind: "reply-run"; sessionId: number; runId: string }`. In `personMay(db, person, op, thing)` (that argument order) answer it by **session access**: `checkSessionAccess(thing.sessionId, uid, db)`; no access → `no(NOT_FOUND.session)`. Also check the thing is what it says, from the run registry (`runSessionOf(runId) === sessionId`, `runKindOf(runId) === "reply"`, `!runLineBoundOf(runId)`), else `no("Not your run.")` (that sentence already exists in the handler — reuse it, no new string). Op rule: mirror `session-annex` — `read`/`write` OK on access, `delete` owner-only with the existing sentence. **Op `"write"` means stop. No fourth op. The string `stop` appears nowhere as an op or kind (R1).** Update the file's doc comment for the new kind in one or two lines.
2. `src/lib/server/pipelines/runtime/runRegistry.ts`: **retire** the `opts: { ownedSessionId }` parameter of `cancel` — back to `cancel(runId, userId)`, allowed only for the run's starter (as at HEAD: `git -C /home/jody/github/serene-pub show HEAD:src/lib/server/pipelines/runtime/runRegistry.ts`). Keep `runSessionOf`. Fix the header comment (lines ~10-14) so it no longer claims the registry checks the owner: the access rule is the handler's, through `personMay`.
3. `src/lib/server/sockets/pipelines.ts` — **the `pipelinesCancelRun` handler only** (around line 5855–5885). New rule, in this order:
   - not authenticated → unchanged;
   - `cancel(runId, userId)`: `found:false` → `{ ok: true, found: false }`; allowed (the starter) → `{ ok: true, found: true }`;
   - otherwise resolve the person: `actingPersonFor(db, { via: "press", userId })` (db = the module's `db` import, as the file already uses);
   - **a reply run** — `runKindOf(runId) === "reply"` (never a negation such as `!== "action"`) and the run has a session: `personMay(db, person, "write", { kind: "reply-run", sessionId, runId })`; ok → stop it through `cancelAs(runId, \`user:${userId}\`, "the run was cancelled")` (the same actor/reason `cancel` stamps, so the receipt reads the same);
   - **any other run with a session that is not line-bound** (`!runLineBoundOf(runId)`) — action, routine, maintenance: the owner right as built, asked as `personMay(db, person, "write", { kind: "session", id: sessionId })` (that answer is owner-only today, read `personMay`); ok → `cancelAs(...)` as above;
   - else `{ ok: false, found: true, error: "Not your run." }`.
   Drop the now-unused `checkSessionAccess` call in that handler only if nothing else in the file uses the import (it is used elsewhere — leave the import).
   ⚠ Routine/maintenance: the brief says "a member cannot stop a routine or maintenance run" — under the rule above a *member* (guest) gets "Not your run." for them; the owner keeps the right as built. That is the intended result.
4. Client: `turnFlow.svelte.ts` / `messageControls.svelte.ts` already send `pipelines:cancelRun { runId }` from a waiting row — **no client change**. Confirm by reading and say so.

Tests (extend `src/lib/server/sockets/pipelines.cancelRunAction.int.test.ts`, keep every existing case green; the third-user case must still be refused):
- a guest (session member) stops the owner's waiting **reply** run (register with `runRegistry.start({ kind: "reply", userId: owner, sessionId })`) → `{ ok: true, found: true }`, aborted, `cancellation(handle).by === \`user:${guest.id}\``;
- a guest cannot stop another person's **routine** run nor a **maintenance** run in the same session → "Not your run.", not aborted;
- a guest cannot stop the owner's **action** run → refused; the **owner still stops a guest's action** (existing case — keep);
- a guest cannot stop a **line-bound** reply-kind run (`lineBound: true`) → refused.
- `src/lib/server/auth/actingPerson.int.test.ts`: cases for `reply-run` — a guest `write` OK; a stranger refused with "Session not found."; a thing whose `sessionId` doesn't match the registered run's, or whose run is an `action`, refused with "Not your run.".
- `src/lib/server/pipelines/runtime/runRegistry.test.ts`: the `ownedSessionId` cases (~line 410-440) are replaced by: `cancel` lets only the starter stop (owner of the session is refused at this layer).
- `src/lib/server/sockets/sessions.fireCancelled.int.test.ts` calls `cancel(runId, user.id)` with two args — it must still pass unchanged (run it).

### Task 2 — 13a (owner ruling 2026-11-04): "after a manual Time passes the model's own move is **dropped**"; the brief: "ledger says nothing for the dropped one; the receipt records it". ★13d is ruled NO: **no `source` field on the clock row.**
Where the model's move lands: `src/lib/server/pipelines/runtime/host.ts`, the `case "core:outlet/advance-story-clock":` arm (~line 8922–9060). Story's reckoning (*Note what changed*, `core-catalog/src/shared/reckoning.ts` ~860) calls it with `cause: 'keeper'`, `onRefusal: 'skip'`; a *Time passes…* press calls it with `cause: 'action'`; a reply's tick with `cause: 'tick'`.
1. `src/lib/server/state/clockMoves.ts`: one exported helper (name it plainly, e.g. `handMovedThisTurn`), taking `db`, `sessionId`: "this turn" = **the anchor a keeper move would file under** — compute it exactly as `recordClockMove` does for a move with no `messageId` (read `recordClockMove` and `anchorFor`; reuse, don't copy logic) — and answer whether an **applied** clock row with `payload.cause === "action"` stands at that same anchor (null anchor = the ledger head: match rows with no anchor). Read only; deterministic; no timestamps.
2. `host.ts`, the advance-story-clock arm, **a few lines only**: when `cause === "keeper"` and the helper says yes, return early — before the transaction — with no ledger row, no clock write, no `noteTimeAction`, no broadcast: `{ id: sessionId, sessionId, clock: null, label: "", skipped: <sentence>, moved: 0 }` (the same shape the refused-`to` branch returns, ~line 9036, which "moves nothing and leaves no ledger row"). The node's output is what the receipt records. Sentence (copy, STYLE-GUIDE §10: say what happened, plainly): `Dropped: the clock was already moved by hand this turn, so the model's ${span} was not added.` where `span` is the step in words — use the existing `clockSpanWords` (imported in clockMoves.ts from `$lib/shared/lorebooks/storyDate`; read its signature). Export the sentence builder from clockMoves.ts so the test reads the same words.
3. Tests — `src/lib/server/state/clockMoves.int.test.ts` (read it first; follow its fixtures): (a) an `action` move then a `keeper` move with the same anchor → the keeper move moves nothing, writes no ledger row, its result carries the sentence; (b) a `keeper` move with no action move at its anchor still moves (regression); (c) an `action` move filed under an EARLIER anchor (a new message written after it) does not drop the keeper's move. If the outlet arm can only be exercised through the host, test the helper plus one host-level case if the file's existing fixtures make it cheap; say which you did.
4. Docs `docs/lorebook-time.md` ~line 103-107: one sentence — when you move the clock with **Time passes…**, the routine's own guess for that turn is dropped (it shows on the run's receipt, not in the conversation).

## Files owned
`src/lib/server/auth/actingPerson.ts`, `src/lib/server/auth/actingPerson.int.test.ts`, `src/lib/server/pipelines/runtime/runRegistry.ts`, `src/lib/server/pipelines/runtime/runRegistry.test.ts`, `src/lib/server/sockets/pipelines.ts` (**the `pipelinesCancelRun` handler only**), `src/lib/server/sockets/pipelines.cancelRunAction.int.test.ts`, `src/lib/server/state/clockMoves.ts`, `src/lib/server/state/clockMoves.int.test.ts`, `src/lib/server/pipelines/runtime/host.ts` (**the advance-story-clock arm only, a few lines**), `docs/lorebook-time.md` (the one sentence).

## Files readable
Everything. `NOMENCLATURE.md` rows: grep `clock move`, `turn unit` (read only the matching rows, `sed -n <line>p`).

## Out of scope — never built
Any new setting, op, event or field; a `source` on the clock row (★13d ruled no); a `stop` op; any change to `sessionMessages:cancel`; client changes; 13c (dayless clock crossing midnight — the supervisor is proposing that separately: do NOT touch `../serene-pub-sdk/sdk/src/storyTime.ts` or `state/storyTime.ts`); NOMENCLATURE.md (list terms in your report instead).

## Rules quoted (CLAUDE.md / plan)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Every function takes `db` — the module-level handle bypasses `vi.mock`, and inside a transaction only `tx` may be used." (actingPerson.ts header)
- "★A2 is a `personMay` thing kind `{ kind: \"reply-run\", sessionId, runId }` with op `\"write\"`; no fourth op, no `stop` string." · "\"reply run\" is `runKindOf === \"reply\"`, never a negation; `personMay(db, person, op, thing)` argument order fixed; a member-cannot-stop-a-routine test added." (plan § Build plan 2)
- P1: "every automatic action shows its cause and how to undo or switch it off."
- Names: before any new identifier or string, grep it across `src` and `../serene-pub-sdk` (NOMENCLATURE §24: pick a distinctive word, grep first, never a second meaning). List every new exported name and sentence in your report under **Canon rows needed**.
- Do what was asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing. Nothing "for later".
- Never `git commit`. Never `git checkout` / `restore` / `stash` / `clean` in either repo.

## Done means (run only these; one vitest call)
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/pipelines.cancelRunAction.int.test.ts src/lib/server/auth/actingPerson.int.test.ts src/lib/server/pipelines/runtime/runRegistry.test.ts src/lib/server/sockets/sessions.fireCancelled.int.test.ts src/lib/server/state/clockMoves.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-A-w1.log 2>&1; echo exit=$?'
```
then read the log (tail/grep it — never pipe vitest itself into `head`). An int test that opens a DB inside an `it` gets a 60 s timeout. Then `npx prettier --check <each file you changed>`.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should need no `sdk:build`.)

## Report
Changed files with a one-line why each · the exact test command and pass/fail counts · assumptions · **Canon rows needed** (term + row text) · **Noticed, not done**.
