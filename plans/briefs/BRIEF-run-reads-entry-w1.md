# BRIEF — worker `run-reads-entry-w1` — the earmark: record, refusals, request (server)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: **no SDK file changes at all** in this task.)

Also: never `git checkout`, `restore`; never `kill -9`; never `prettier --write` a directory.

## Goal

In Serene Pub (`/home/jody/github/serene-pub`), a pipeline run that showed the model some lore entries (the
🚧 `core:query/entries-named@1` step lists them; the run's later lore write may then replace their text) must
**earmark** those entries on its run handle until the run finishes. While any live run earmarks an entry, a
person's save that would change that entry's name, content or typed fields is **refused** with one sentence, and a
new request `entries:earmark` lets a form ask whether an entry is earmarked. The client side is another worker's;
the wire contract is already written (see "Contract, already in place").

Owner rulings (2026-11-13), binding: "Prevent the save, keep as draft, tell the user upfront"; "Notice on open and
on save" — no pushed event; members never see model plumbing (a routine's or pipeline's shown name and a session's
name are fine; never a connection, a model or a run id). P1: an automatic action shows its cause. P2: one writer per
thing.

## Build

1. **The record** — `src/lib/server/pipelines/runtime/runRegistry.ts`:
   - `export type EarmarkKind = "entry"` (🚧; the only kind now — written keyed by kind so another writer can adopt
     it later; build no second adopter).
   - A field on `RunHandle`: 🚧 `earmarks?: Map<EarmarkKind, Set<string>>` (keys stored as strings; a JSDoc saying
     what it is and that it lives and dies with the handle).
   - 🚧 `export function earmark(runId: string, kind: EarmarkKind, keys: Iterable<number | string>): void` — adds
     to the handle's set; **no-op when no run is registered under the id** (a preview, a test, a dry run).
   - 🚧 `export function earmarkedBy(kind: EarmarkKind, key: number | string): EarmarkHolder[]` where 🚧
     `EarmarkHolder = { runId: string; userId: number; sessionId?: number; specId?: string; kind: RunKind; startedAt: number }`,
     oldest first. No import from lorebooks or sockets into the registry.
   - **It clears only when the run finishes** (`finish` deletes the handle, so it falls out). Not on park, not on
     stop: a parked run still writes after the person decides, and a stopped run reaches `finish` in its `finally`.
     **Do not** add an early-clear function (nothing would call it). `_reset` already clears.
   - Tests in the existing `runtime/runRegistry.test.ts`: record + ask; unregistered id records nothing; a stopped
     (cancelled) run still answers until `finish`; `finish` clears; two kinds never mix is not needed (one kind).
2. **Record at the lookup** — the `"core:query/entries-named@1"` binding in
   `src/lib/server/pipelines/runtime/bindings.ts` (~8703). `coreBindings(run)` (~2336) already receives
   `{ runId, user, seed }` from `runSpec` (`runTurn.ts` ~1133 — do not edit `runTurn.ts`); read `run.runId` from the
   closure as the neighbours do (~4930). After `entriesNamedIn` returns, `earmark(run.runId, "entry", ids)` when
   `run.runId` is set and `ids` is non-empty. Import the registry the way the file already imports runtime modules
   (check whether it is a static or `await import`; match). Only the Story sweep and Chat's *Remember things* wire
   this lookup; both are routines, always registered (`routines/run.ts` ~404) under the run id given to `runSpec`.
   A preview/dry run gets a fresh unregistered id (`runTurn.ts` ~603 `request.runId ?? uuidv4()`, and no preview
   call site registers), so "a dry run records nothing" is the unregistered no-op — say so in the test's name.
   If you find a preview that runs under a registered id, stop and report it instead of plumbing a flag.
3. **The sentence** — in `src/lib/server/sockets/entries.ts`, one exported async function, e.g.
   `earmarkNotice(entryId: number, askerId: number): Promise<string | null>`, used by every refusal and by the
   request, so the refusal and the notice are always the same words. From `earmarkedBy("entry", entryId)` take the
   first holder (two runs on one entry is out of scope). Then:
   - **‹routine›** = `routineRunOf(runId)?.shownAs?.name` (`pipelines/routines/runs.ts`) if set, else the
     pipeline's stored name (`schema.pipelineSpecs.name` where `slug = specId`), else `A routine` for a `routine`
     kind and `A pipeline` otherwise. Never an id.
   - **‹session›** = the session's name, only when `checkSessionAccess(sessionId, askerId)`
     (`utils/sessionAccess.ts`) grants access and the name is non-empty; otherwise the session part is left out.
   - **waiting for review** = `pendingReviewsFor(holder.userId)` (`runtime/reviewGate.ts`) has a view whose
     `specId === holder.specId`. (The view carries no session id or run id; that approximation is accepted and the
     supervisor reports it. Do not edit `reviewGate.ts`.)
   - Copy, verbatim (🚧 provisional; the `in ‹session›` part dropped when the session is left out):
     - running: `‹routine› in ‹session› may update this entry when it finishes. Your changes are kept here: save again then.`
     - waiting, asker is the run's user: `‹routine› in ‹session› is waiting for your review and may update this entry. Your changes are kept here: decide there, then save.`
     - waiting, asker is someone else: `‹routine› in ‹session› is waiting for review and may update this entry. Your changes are kept here: save again once it is decided.`
   - **Never use the words "read" or "reading", "claim" or "held"** in any name you add or any copy: *Read by
     ‹session›*, **lorebook reading**, a channel's **claim** and a **held change** already mean other things
     (NOMENCLATURE R1: one word, one meaning).
4. **Which fields a run can replace.** Read `changeLoreEntry` in `runtime/host.ts` (~2255) and the rewrite at
   ~11690–11735 (`patch: fields`, `content: next`, `name: undefined`). The refused set is: the entry's **name**
   (title), its **content**, and its **declared typed fields** (`declaredFields(typeId)` /
   `splitUpdate(...).fields` in `utils/lorebookEntries.ts` ~673) — confirm against `changeLoreEntry` and narrow or
   widen only to what it can actually write; report what you found. Columns such as `enabled`, `archived`,
   `constant`, `keys`, `matchMode`, `position`, an anchor or a re-parent are **not** refused (a reorder, a mark or a
   switch is never refused). Write this as one small exported helper so `entries.ts` and `amendments.ts` share it.
5. **Refuse the save** — `updateEntryHandler` (`entries.ts` ~1041, wrapped in `refusable`): after the ownership and
   primer checks and after the trim pass and `splitUpdate`, and **before any write**, when the save would change
   one of those fields **compared with the stored row** (name/content after the existing trim pass; a typed field
   whose value differs from `existing.entry.fields[key]` by a stable deep compare) and `earmarkNotice` returns a
   sentence, `throw new Error(sentence)` — the refusal goes through `refusable` as every other does, reaching the
   client as `{ error }` on `entries:update:error`. No change to the refusal's shape. A save that changes nothing
   of that set, or a save of another entry, is never refused.
6. **Refuse dated changes from the same form** — `src/lib/server/sockets/amendments.ts`, `amendmentsCreateHandler`
   (~1559, the `hasEntry` branch) and `amendmentsUpdateHandler` (~1692, the entry branch when `params.fields` is
   given): after `cleanFields`, before the transaction, when the subject entry is earmarked and the cleaned fields
   carry a name, content or typed-field key, throw the sentence. A re-date alone, `amendments:delete`, the
   switch-off window (`offWindowAmendments`, `enabled` amendments) and `entries:setMarks` are **not** refused.
   Touch nothing else in `amendments.ts`.
7. **Other person paths** — list every person path that can replace an entry's name, content or typed fields
   (grep `sockets/` and the client callers of `entries:update`: `EntryWorkspace.svelte`, `entryManager.ts`,
   `CastWorkspace.svelte`, `TimeLens.svelte`, `EntryFireTest.svelte`, `sessionPage/storyMoved.ts`;
   `lorebooks:settleImprint` *Revert* in `entries.ts` ~2285; the held-change **Apply** in `sockets/sessions.ts`;
   `entries:copyFromLibrary`, `entries:iterateNext`, `amendments:place`/`unplace`, imports) and for each say whether
   it can replace text and what it does now. **In `entries.ts` only**: `lorebooks:settleImprint` with
   `choice: "revert"` that would put back a name, content or typed field of an earmarked entry is refused with the
   same sentence (`keep` never). Anything outside `entries.ts`/`amendments.ts` is reported, not changed.
8. **The request** — a new `refusable` handler in `entries.ts`, registered in `registerEntryHandlers` beside the
   others: event `entries:earmark`, params `{ entryId }`. Access exactly as `entries:update`: the entry exists and
   its book is the asker's (`findOwnedEntry` + `lorebookUserId === userId` — look at how update finds the type;
   the request has no `typeId`, so find the row by id first; entry ids are unique across entry types, one table
   `lorebook_entries`). Refusal `Entry not found or access denied.` with the `entryId` echoed (refusable's `echo`).
   Reply to the asker with `emitToUser("entries:earmark", { entryId, lorebookId, notice })` and return it. The reply
   is SCOPED on `lorebookId` (already registered in `interest.ts`), so `lorebookId` must be top-level on every
   reply (Standing ruling: an event in `SCOPED_EVENTS` must carry its scope key or `emitToUser` silently sends
   nothing). Never names a session the asker may not see (step 3).

## Contract, already in place (do not change the shape; fix only if it fails to compile)

- `src/lib/shared/sockets/types.ts` `Sockets.Entries.Earmark` — `Params { entryId: number }`,
  `Response { entryId: number; lorebookId: number; notice: string | null }`,
  `ErrorResponse { entryId?: number; error: string }`.
- `src/lib/client/sockets/typedSocket.ts` — `"entries:earmark"` and `"entries:earmark:error"`.
- `src/lib/shared/sockets/interest.ts` — `entries:earmark` in `SCOPED_EVENTS` (`payload?.lorebookId`) and in
  `GATED_EVENTS`.

## Rules your work depends on (quoted)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite
  silently". "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- CLAUDE.md Standing rulings › Sockets: "views register listeners for local state and never call `toaster`. An
  event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser`
  silently sends nothing."
- "Comments state the rule, not the story" (`src/lib/shared/conformance/commentHistory.test.ts` enforces it): no
  dates, lane names or "was/used to" narratives in new comments. 🚧 marks a provisional name in its JSDoc.
- No table, column, migration, setting or pushed event. The record lives only in the registry.
- Decisions: implementation inside this scope is yours (name the choices in your report). A new user-visible
  behaviour, name, setting or file outside the list below: stop and report.

## Files owned (edit only these)

- `src/lib/server/pipelines/runtime/runRegistry.ts`, `src/lib/server/pipelines/runtime/runRegistry.test.ts`
- `src/lib/server/pipelines/runtime/bindings.ts` — the `entries-named` binding and the import it needs, nothing else
- `src/lib/server/sockets/entries.ts` — the update check, the settleImprint revert check, the new handler and its
  registration, the shared helpers
- `src/lib/server/sockets/amendments.ts` — the two refusals only
- New test files: `src/lib/server/sockets/entries.earmark.int.test.ts` (the socket behaviour) and
  `src/lib/server/pipelines/runtime/bindings.entriesNamedEarmark.int.test.ts` (the binding records); you may put
  the binding test in the existing `runtime/loreMatch.entriesNamed.int.test.ts` instead if its harness makes that
  simpler — say which.
- The contract files above only to fix a compile error.

Readable: anything. Look at `sockets/entries.singleSave.int.test.ts`, `sockets/amendments.int.test.ts` and
`runtime/loreMatch.entriesNamed.int.test.ts` for the harness (how a handler is invoked, a user, a book, a session).

## Out of scope

The outlet's write rule in `host.ts` and any compare of text at the write; deleting an entry a run earmarks; two
runs on one entry; review wording; a second adopter (cast members, stats, scenes); a pushed event; any migration,
setting, table or column; the Activity sidebar; any client file; `runTurn.ts`, `reviewGate.ts`, `routines/*`,
`sockets/sessions.ts`; docs and NOMENCLATURE (the supervisor does those).

## Stop and ask (in your report) when

The binding cannot know its run id without an SDK change; a published SDK name or event shape would have to change;
a save path cannot be refused without changing its event's shape; a preview runs under a registered id.

## Done means

Tests (int tests that open a DB inside an `it` need a 60 s timeout under load):
- the lookup earmarks exactly the ids it returns; an unregistered (dry/preview) run earmarks nothing;
- the earmark survives a stop and a park and clears on `finish`;
- `entries:update` changing the name, the content or a typed field of an earmarked entry is refused with the
  sentence on `entries:update:error`, and the row is byte-identical afterwards (compare the whole selected row);
- the same save after `finish` succeeds; a save of another entry, and a save that changes only a switch/mark/key,
  are not refused;
- a parked run (park one through `createReviewer({ userId, sessionId, specId, signal })` from `reviewGate.ts` with a
  minimal request, then abort its signal to clean up — or the simplest honest route you find) refuses the save with
  the *waiting for your review* sentence, and still clears on `finish`;
- `amendments:create` / `amendments:update` with a content change on an earmarked entry are refused; an amendment
  that only switches `enabled`, and `amendments:delete`, are not;
- `lorebooks:settleImprint` revert on an earmarked entry is refused; keep is not (if building a kept imprint in a
  test is heavy, say so and cover it at the helper level);
- `entries:earmark` answers `notice: null` for an unearmarked entry and the sentence for an earmarked one, with
  `lorebookId` top-level; refuses an entry of another person's book; leaves out the session's name for an asker
  who cannot open the session.

Run, one at a time, **only** inside:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > <log> 2>&1"`
with the log under `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/`
named `run-reads-entry-w1-<n>.log`. Another worker may also run tests: **before every run** check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one is up, wait in a bounded loop (sleep 30, at most
10 tries, using that `ps` line — never `pgrep -f "vitest run"`, which matches itself). Never pipe vitest into `head`.
Files: your new tests, `runtime/runRegistry.test.ts`, `runtime/loreMatch.entriesNamed.int.test.ts`,
`runtime/host.loreMatchShown.int.test.ts`, `sockets/sessions.sweepShown.int.test.ts`,
`sockets/sessions.chatMemoryShown.int.test.ts`, `sockets/entries.singleSave.int.test.ts`,
`sockets/scopedReplies.lorebooks.int.test.ts`, `sockets/amendments.int.test.ts`,
`src/lib/shared/sockets/gatedEvents.test.ts`. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "runRegistry|bindings.ts|sockets/entries|sockets/amendments|sockets/types|typedSocket|interest.ts|earmark"`
(report only errors in your files; the tree may have others) and `npx prettier --check <each file you touched>`.

## Report

Write it as your final message (not a file): changed files; every new name and every copy string verbatim; how the
binding knows its run; the refused field set and the evidence from `changeLoreEntry`; the person-path list (step 7)
with what each does now; tests run with exact commands and results; anything you stopped on; Noticed, not done.
