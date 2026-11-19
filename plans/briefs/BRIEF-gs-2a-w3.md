# BRIEF — worker `gs-2a-w3` (tests only): pin the last closed `debugMeta` paths

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-2a`. You add tests to **one file**: `src/lib/server/sockets/sessions.debugMeta.int.test.ts` (read all of it first; it was written by worker w1 and extended by the supervisor). You edit no other file. If a test shows the server code wrong, stop and report it: do not fix server code.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: don't run one.)

Also: never `git checkout / restore`; never `prettier --write`; no migration; inside `db.transaction(async (tx) => …)` use only `tx`.

**Tests only like this**, one run at a time, each preceded by the wait:
```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/sessions.debugMeta.int.test.ts > plans/gs-2a-w3-<n>.log 2>&1"
```
Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout under load (the file sets it).

## The rule being pinned (owner rulings 2026-11-16, lead's reading D64)

G5: "The session's owner and administrators only." G6: "In another person's session an administrator is a guest." Read together: a reply's compiled prompt (`debugMeta` on a message row) reaches only the session's **owner**; a guest, and an administrator who is a guest, get the row with `debugMeta: null` and nothing else changed. Every closed path is asserted on the serialised payload (`noLeak` in the file: `JSON.stringify(reply)` holds neither sentinel) and by row equality with the owner's row with `debugMeta: null`. The owner's own reply is shown unchanged (carries the `debugMeta`).

## Add (keep the file's existing six-row fixture intact for the tests that count it: any extra row or seat you add, remove it again in a `finally`, as the `sessionMessages:update` block does)

1. **The caller-only `sessions:refresh` resend** (`resendSession` in `sockets/sessions.shared.ts` ~1338 → `buildSessionRefresh(…, laneFilter=true)`, which strips at ~1315 for a caller who is not the owner). Reach it through a real handler, capturing the emit: the handlers pass `emitToUser(event, data)` where `data` may be a **thunk** (call it if it is a function and await the result). Candidates: `sessions:setCastSeatEnabled` (`sockets/sessions.participants.ts` ~528–700: a guest benching or bringing back **their own** seat calls `resendSession`), or `sessionMessages:delete` (`sockets/sessions.messages.ts` ~752–940). Pick the one with the smaller honest setup. Assert: for a guest (and, if the same setup allows, an administrator who is a guest) the captured `sessions:refresh` payload passes `noLeak` and its `session.sessionMessages` row for the reply equals the owner's with `debugMeta: null`; for the owner driving the same handler on their own seat or line, the payload carries the `debugMeta`.
2. **The swipe-right reply** (`sessionMessages:swipeRight`, `sockets/sessions.messages.ts` ~1600–1680, the navigation branch: the row is **not** on its last swipe, so no generation runs; the reply goes through `rowShownTo`). The asker needs rerun permission on the line (`canActOnMessage(…, "rerun")`, `messages/permissions.ts` ~172–260): for a guest, a line spoken by a card they own and that is seated in the session (`ownsSeatedCard`), or the owner for any character line. Build a reply row with a `debugMeta` and `metadata.swipes` holding at least two alternatives with `currentIdx` 0 (read how swipes are stored in `messages/` and the swipe built-in to make it real). Assert the guest's captured reply passes `noLeak` and its `debugMeta` is `null`, and the owner's reply carries it. If permission or swipe setup turns out to need more than the file can honestly build, stop that item and report exactly what blocks it.
3. `sessionMessages:regenerate` and `sessionMessages:extend` (~1125, ~1300) send their reply (through `rowShownTo`) **before** starting the run. Only if item 2's setup makes it cheap: capture the reply for a guest and assert `noLeak`; the run that follows may fail without a model — that is fine, assert only the captured reply. Otherwise skip and say so.
4. Retitle the test "a streamed chunk carrying no prompt is sent as it is, by reference, with no owner query" to drop "with no owner query" (nothing counts reads), or add a spy that proves it; your choice, say which.

Done means: the file green (log path), every new test's name and what it asserts in your report, `npx prettier --check` result on the file (it already fails on wrap width from w1: report, don't `--write`).

## Report

To the supervisor, as your final message: the tests added (name → asserts), runs with pass counts and log paths, anything you could not pin and why, Noticed-not-done.
