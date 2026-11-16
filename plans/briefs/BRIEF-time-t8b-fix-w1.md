# BRIEF — worker `time-t8b-fix-w1` — a refusal of `entries:update` / `entries:delete` reaches only the request that asked

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t8b-fix`. Return your report as your final message
(the harness refuses report files): changed files, tests run with results, anything you could not do, Noticed-not-done.
Under 400 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**Never run `sdk:build` at all in this lane** (another lane owns it). Use no GPU, no local model, start no dev instance.

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)

- Sockets: "one domain context per event family (provided by both shells) is the only listener, and the only place
  that toasts; views register listeners for local state and never call `toaster`." The entry form already says its
  own save's outcome through `notify` (existing precedent; Layout's comment: "the editors … as their own toast under
  the action's name") — keep to that, never import `toaster`.
- "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."
- "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser`
  silently sends nothing." Do not remove or rename any field of a reply.
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
  Build ids with the helper the duplicate flow uses: `import { v4 as uuid } from "uuid"` (see
  `src/lib/client/lorebooks/time/TimelineCard.svelte`).
- "Inside `db.transaction(async (tx) => …)` use only `tx`."
- Comments state the rule, not the story. Never `prettier --write` beyond the lines changed.
- Another Claude session edits `src/lib/client/components/Layout.svelte` at the same time: change it **by the Edit
  tool only**, exactly the two lines below, nothing else in that file.
- The lead recently changed `EntryWorkspace.svelte` (an effect near `setEntryRowOpen` that opens the entry row for a
  runaway keyword; `editsToken`; the moment guard's "save in flight" case; the reader's unmounted
  `VersionDateDialog`). Keep all of them; touch only `writeEntryFields`.

## Files owned (edit only these)

- `src/lib/server/sockets/entries.ts` — the echo only.
- `src/lib/shared/sockets/types.ts` — the optional `requestId` only.
- `src/lib/client/sockets/typedSocket.ts`
- `src/lib/client/components/Layout.svelte` — two lines.
- `src/lib/client/components/layoutHandledErrors.test.ts`
- `src/lib/client/lorebooks/EntryWorkspace.svelte` — `writeEntryFields` only.
- Tests: `src/lib/client/lorebooks/entryEarmark.dom.test.ts` (it already has the harness that drives the form's
  save and dispatches `entries:update:error`), one existing `src/lib/server/sockets/entries.*.int.test.ts` of your
  choice for the echo (or a new `entries.requestEcho.int.test.ts` beside them).

Readable: anything. Not yours: `BulkEditBar.svelte`, `bulkEdit.ts` (worker w2 changes them after you), `EntryPool.svelte`,
`CouldExistHereGroup.svelte`, `couldExistHere.ts`, `BulkTimeDialog.svelte` (another worker is in them now).

## Work

1. **Server echo, the way `lorebooks:duplicate` does it** (`src/lib/server/sockets/lorebooks.ts` ~5850–5912:
   `...askerOf(params)` on the reply it emits and returns, and `askerOf` as `refusable`'s 5th argument;
   `askerOf` / `refusable` are in `sockets/refusable.ts`).
   - `updateEntryHandler` (~1489): pass `undefined, askerOf` after the fallback. In `saveEntry` (~1259–1487) add
     `...askerOf(params)` to the `entries:update` payload it emits (~1476) and to the object it returns. `saveEntry`
     is also called by Restore (`sockets/redlines.ts`): check what params Restore passes; absent `requestId` nothing
     changes there.
   - `deleteEntryHandler` (~1886): `...askerOf(params)` on `res`, and `undefined, askerOf` on `refusable`.
   - Additive only: with no `requestId` in the params, the reply and the refusal are exactly as today.
2. **Types**: `Sockets.Entries.Update.Params` / `.Response` and `Sockets.Entries.Delete.Params` / `.Response`
   (`types.ts` ~378, ~401) each get `requestId?: string` with a one-line doc ("The asker's id, echoed on the reply
   and the refusal so the one surface that asked claims them." or close). In `typedSocket.ts`: give
   `"entries:update:error"`'s response `requestId?: string`, and add `"entries:delete:error"` (response
   `{ error?: string; requestId?: string }`, `params: never`, same comment style) next to `"entries:delete"`.
3. **Layout** (`components/Layout.svelte` ~377): add `"entries:update:error",` and `"entries:delete:error",` to
   `HANDLED_WHEN_ASKED_ERROR_EVENTS` (keep a valid array: mind the comma after `"lorebooks:duplicate:error"`; if that
   needs a third changed line, that is the only allowed one). Effect: a refusal carrying a `requestId` is said by its
   asker; one without (CastWorkspace, TimeLens, CompileHistoryEntryModal, entryManager, RetrievalExplanation send
   none) is still toasted as today.
4. **`layoutHandledErrors.test.ts`**: a test that both events are in the handled-when-asked set and NOT in
   `HANDLED_ERROR_EVENTS` (follow the existing `lorebooks:duplicate:error` test).
5. **The entry form's save** (`EntryWorkspace.svelte` `writeEntryFields` ~1817–1847): `const requestId = uuid()`,
   send it in the params, `match: (data) => data?.requestId === requestId`, `matchError: (data) => (data as
   { requestId?: string } | undefined)?.requestId === requestId`. Because the refusal now carries a `requestId`,
   Layout no longer toasts it, so the form must say it: in the catch, when the error is not a timeout
   (`isReplyTimeout`), `notify.error({ title: \`${door.label} was not saved\`, description: <the error's message,
   else "The entry could not be saved."> })` — the title is the one `reportUnanswered` already uses; keep
   `reportUnanswered` and `askAfterRefusal` as they are. Say it regardless of the `toast` argument (that argument
   governs the success toast only; before this change Layout said every refusal).
6. **Every other asker** of `entries:update` / `entries:delete` in `src/lib/client` (grep both): confirm by reading
   that each still works unchanged (none sends `requestId`; their refusals stay toasted). Report the list.

## Tests (each run one at a time)

Before every run: `ps -eo pid,args | grep -E "node.*vitest|sdk:build|tsup|tsc -b" | grep -v grep`; if anything is
listed, wait (`timeout 900 bash -c 'while ps -eo pid,args | grep -E "node.*vitest|sdk:build|tsup|tsc -b" | grep -v grep >/dev/null; do sleep 20; done'`).
Run as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t8b-fix-<name>.log 2>&1"`
from the repo root, then read the log's tail. Never pipe vitest into `head`.

- Int test: a refused `entries:update` (e.g. an entry id the user does not own) with `requestId: "r1"` emits
  `entries:update:error` carrying `requestId: "r1"`; without one, the refusal has no `requestId` key; a successful
  update's reply carries the `requestId`; the same three for `entries:delete`. Copy the harness of a neighbouring
  `entries.*.int.test.ts`; an `it` that opens a DB needs a 60 s timeout.
- `entryEarmark.dom.test.ts`: (a) while the form's save waits, an `entries:update:error` with a different
  `requestId` (a bulk run's) does not settle it, and its own reply then does; (b) the form's own refusal (its
  `requestId`) is said by the form (the mocked `toaster.error` / `notify` gets the sentence) — and update the
  existing dispatch at ~236 to carry the save's `requestId` (read it from the sent params).
- `layoutHandledErrors.test.ts`.
- Then all `src/lib/server/sockets/entries*.int.test.ts` in one capped run (log `plans/time-t8b-fix-entries-int.log`).

Done means those pass, `npx prettier --check` clean on each file you changed (if a file was already unclean before you,
say so rather than reformat it), and your report lists the asker check from step 6.
