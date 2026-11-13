# BRIEF m2e-D3-w1 — four server correctness fixes (starter lists, disable mark, kept-kit delete, share recipients)

Lane `m2e-D3`, worker 1. Supervisor wrote this from the lane brief `plans/briefs/BRIEF-m2e-D3.md` (read it only for context; THIS file is your contract). Work in `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` for this task.)

## Shared tree — read this
A story-playtest programme is editing other server files at the same time. **Re-read each file immediately before every edit** (the line numbers below drift), make **additive, minimal hunks**, **never reformat** a file (no prettier --write). Another worker (w2) edits `src/lib/server/plugins/pluginActions.ts` and its test right now: do not touch those.

## Files owned (the only files you may edit)
- `src/lib/server/sockets/starterKits.ts`
- `src/lib/server/sockets/plugins.ts` — only the `providedBookDisabledHandler` function (~line 684–740) and its import list
- `src/lib/server/plugins/providedBooks.ts` — only `setProvidedBookDisabled` (~line 747)
- Tests: `src/lib/server/lorebooks/starterKits.int.test.ts`, `src/lib/server/plugins/providedBooks.int.test.ts`, `src/lib/server/plugins/providedPrimers.int.test.ts`; you may add ONE new test file `src/lib/server/sockets/plugins.providedBookToggle.int.test.ts` if a test needs its own `vi.mock`s.

## Files readable
Anything. Useful: `src/lib/server/plugins/providedMarks.ts` (`markedBook`, `providedOwnerPresent`), `src/lib/server/sockets/lorebooks.ts` ~1015–1035 (the delete pattern to copy for fix 3), `src/lib/server/utils/shares.ts` (`listSharedWith`), `src/lib/server/sockets/utils/userPush.ts` (`pushToUser` is a no-op until `installUserPush(io)` puts a pusher on `globalThis[Symbol.for("serene-pub.userPush")]` — a test can install a recording pusher there and remove it after), `src/lib/server/sockets/activity.ts:40-43` (asker-only emit pattern).

## The four fixes

### Fix 1 — a list computed WITH `includeDisabled` goes only to the asking socket
Bug: `starterKitsListHandler` (`sockets/starterKits.ts` ~84) emits via `emitToUser` (every tab of the user), and `providedBookDisabledHandler` (`sockets/plugins.ts` ~715) re-sends `starterKits:list` with `includeDisabled: true` the same way. So the admin Starter lorebooks page and the session/new-lorebook pickers overwrite each other's list: a picker receives disabled rows; the admin page loses its disabled rows after a plain re-send.
Fix (one decider, server only, no new event): when the list is computed WITH `includeDisabled` (i.e. `params.includeDisabled === true && socket.user.isAdmin` on the request; always on the toggle's re-send) send it with `socket.emit("starterKits:list", res)` — the asking socket only. The plain list keeps `emitToUser`. Keep `relistKits` as it is (plain, `emitToUser`). In the toggle handler compute the kits first, then `socket.emit` the value (not a thunk). Keep the handler's return value as today.
Tests (both deliveries): request with `includeDisabled` as admin → `socket.emit` receives `starterKits:list` with the disabled row and `emitToUser` receives no `starterKits:list`; plain request → `emitToUser` receives it and `socket.emit` does not; a member passing `includeDisabled: true` → plain path (emitToUser, no disabled rows); the toggle re-send for a starter row → `socket.emit`, not `emitToUser`. The test sockets need an `emit` spy. **Update the existing test in `providedBooks.int.test.ts` "switching a plugin's book: … starterKits:list …" (~line 307)** which today expects `starterKits:list` among the `emitToUser` events: it must now find it on `socket.emit`.

### Fix 2 — `setProvidedBookDisabled` writes under the sync's `serial(pluginId)`
Bug: `setProvidedBookDisabled` (`plugins/providedBooks.ts` ~747) writes the mark outside `serial(pluginId, …)` (defined in the same file ~236). A concurrent `syncProvidedBooks` (runs under `serial(pluginId)`) or `syncProvidedPrimers` (runs under `serial("core")`) upgrade reads the mark, then saves it later and wipes the admin's switch.
Fix: wrap the whole body of `setProvidedBookDisabled` in `return serial(pluginId, async () => { … })`. A core primer's `pluginId` is `"core"`, so it shares `serial("core")` with `syncProvidedPrimers`. Its only caller is the socket handler (not inside a serial), so there is no re-entrancy; check that stays true. Signature and return value unchanged.
Test (in `providedBooks.int.test.ts`): a direct ordering test that FAILS without the fix: enqueue a stand-in upgrade with `serial(pluginId, async () => { read the book's mark; await a gate promise; save the stale mark back (e.g. via a direct `extraJson` update) })`, then call `setProvidedBookDisabled(…, true, …)` without awaiting, release the gate, await both, and assert the book's mark is `disabled: true`. (Export of `serial` already exists.)

### Fix 3 — `starterKits:delete` treats a mark as live only while its owner is present
Bug: `starterKitsDeleteHandler` (`sockets/starterKits.ts` ~212) throws `STARTER_KIT_SENTENCES.shippedKeep` whenever `markedBook(...)` is non-null; `lorebooks:delete` (`sockets/lorebooks.ts` ~1025) and the client refuse only while the owner is present (`providedOwnerPresent`). So a kept kit (its plugin uninstalled with `providedBooks: 'keep'`) can never be deleted.
Fix: copy the lorebooks.ts pattern inside the existing transaction: `const mark = markedBook(row.extraJson, row.uuid); if (mark && (await providedOwnerPresent(tx as unknown as Db, mark.plugin))) throw new Error(STARTER_KIT_SENTENCES.shippedKeep)`. Use only `tx` inside the transaction (Hard rule below). Import `providedOwnerPresent` from `$lib/server/plugins/providedMarks`.
Test (in `providedPrimers.int.test.ts` near the existing delete test ~529, or `starterKits.int.test.ts`): a plugin's starter row (a `kind: "starter_kit"` book with a genuine mark naming a plugin) is refused while the plugin row exists, and deletes once the plugin row is gone; a core primer row stays refused.

### Fix 4 — after disable/enable, share recipients get `lorebooks:list` too
Bug: `providedBookDisabledHandler` (`sockets/plugins.ts` ~722) pushes `lorebooks:list` only to the book's owner; people the book is shared with keep a stale list.
Fix: when `lorebookId != null`, also push the same event to every recipient: `for (const p of await listSharedWith(db as unknown as Db, "lorebook", lorebookId)) pushToUser(p.id, "lorebooks:list", () => buildLorebooksList(p.id))` (skip the owner if listed). `listSharedWith` is in `$lib/server/utils/shares`. Same event, no new one. `lorebooks:list` is not a scoped event, so no scope key is needed.
Test: share the provided book with one member (insert a `lorebook_shares` row), install a recording pusher on `globalThis[Symbol.for("serene-pub.userPush")]` (remove it in `finally`), toggle, and assert `lorebooks:list` was pushed to both the owner and the member.

## Rules (quoted from CLAUDE.md, NOMENCLATURE, the lane brief)
- "Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report." "Propose and wait … on anything a user sees or that outlives the change: behaviour, layout, copy, a new name / setting / flag / abstraction / event / table / migration … files outside the asked area." "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- Lane brief: "no new event (fix 1 reuses `starterKits:list`), no setting, no migration". **Add no new exported name.** If you believe one is needed, stop and say so in your report (NOMENCLATURE R1 one word one meaning · R2 distinctive words for new concepts · R3 qualify, never the bare noun · R4 casual words are not type names · R5 reconcile vocabularies at boundaries · R6 mark ⏳/🚧).
- Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Sockets: "one domain context per event family … is the only listener, and the only place that toasts" (server change only here). "An event in `SCOPED_EVENTS` must carry its scope key … in the payload, or `emitToUser` silently sends nothing." (`starterKits:list` and `lorebooks:list` are not scoped.)
- "`socket.off(event)` with no handler removes every listener" — n/a server side, don't add any.
- Tests: targeted files only. **Never pipe vitest into `head`** (the SIGPIPE leaks PGlite temp dirs). "An int test that opens a DB inside an `it` needs a 60 s timeout under load." Run as: `cd /home/jody/github/serene-pub && npx vitest run <files> 2>&1 | tail -60`.
- `npx tsc --noEmit -p .` is slow and shared; instead run `npx tsc --noEmit -p . 2>&1 | grep -E "sockets/starterKits|sockets/plugins|plugins/providedBooks|providedPrimers|lorebooks/starterKits"` once at the end and report the result.

## Done means
Green: `src/lib/server/lorebooks/starterKits.int.test.ts`, `src/lib/server/plugins/providedBooks.int.test.ts`, `src/lib/server/plugins/providedPrimers.int.test.ts`, `src/lib/server/sockets/plugins.int.test.ts` (plus your new test file if any). Each new test fails without its fix (say how you checked, e.g. by reasoning or a temporary revert you then restored).

## Report
Write `plans/briefs/REPORT-m2e-D3-w1.md`: per fix the hunk location and choice made; tests run with pass/fail counts; anything you changed outside "Files owned" (should be none); Noticed, not done. Then end.
