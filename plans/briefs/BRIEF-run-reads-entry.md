# BRIEF — build lane `run-reads-entry` — an entry a run is reading cannot be saved over

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then
`plans/REPORT-lore-match-2026-11-13.md` (the lane this follows; finding 3 / ★4 is what this closes),
`src/lib/server/pipelines/runtime/runRegistry.ts` in full, `docs/lorebooks.md` where it covers a lore write that
updates an entry, CLAUDE.md Hard rules, Principles, **Standing rulings**, NOMENCLATURE §1, §23, §24, §25,
STYLE-GUIDE.md's copy rules. Line numbers below are from a look on 2026-11-13: re-read before editing.

Words. A **build lane** is this stream of work; a **channel** is a session's message channel. A **run** is one
registered pipeline run (`RunHandle`). An entry is **shown** when the 🚧 `core:query/entries-named@1` step listed it
for the model (`ids`, passed to the write as `shown`): only a shown entry can have its text replaced.

## Rulings that bind (owner, 2026-11-13)

- Asked whether a run in progress can be known to be about to edit an entry: "Mark the entry, or rather mark it in
  the runs metadata, check the runs when going to save an entry, or also show a notice in the form. Can probably do
  something similar to prevent collisions elsewhere".
- Asked what a save does while a run has shown the model that entry: **"Prevent the save, keep as draft, tell the
  user upfront"**.
- Asked how the form learns it: **"Notice on open and on save"** — no new live (pushed) event; the form learns it
  when the entry is opened and again in a refused save's answer.
- Standing: members never see model plumbing (a routine's or pipeline's shown name and a session's name are fine;
  never a connection, a model or a run id). P1: an automatic action shows its cause. P2: one writer per thing.

## What is true today

- `RunHandle` (`runRegistry.ts` ~70–120) is process memory: it exists from `start` to `finish`. A run parked at a
  review gate stays registered until the person decides (`routines/run.ts` ~433 `onParked`; `runTurn.ts`).
- The lookup is the `core:query/entries-named@1` binding (`pipelines/runtime/bindings.ts` ~8703; it calls
  `entriesNamedIn`, `runtime/loreMatch.ts`). Its `ctx` today carries only `countTokens`; elsewhere in `bindings.ts`
  the run is at hand (`run.runId`, ~4930, ~7016). Find how this binding can know its run id **without an SDK
  change**.
- The write is `core:outlet/create-lore-entry` in `runtime/host.ts` (~11600): a shown entry of an own book is
  rewritten in place; a shown lorebook entry gets a held change in the session's own book.
- A person saves an entry through `entries:update` (`src/lib/server/sockets/entries.ts` ~1041, wrapped in
  `refusable`). It has many client callers (`EntryWorkspace.svelte`, `entryManager.ts`, `CastWorkspace.svelte`,
  `TimeLens.svelte`, `EntryFireTest.svelte`, `sessionPage/storyMoved.ts`). There is no single-entry read event; the
  form opens from list rows. Other paths that change what a session reads of an entry (`sockets/amendments.ts`
  create/update, `entrySetMarksHandler`, delete) exist: list them and say for each whether it can replace an
  entry's text.
- Entry ids are unique across entry types (`lorebook_entries.id`, one table): a bare id is the key.
- The binding can read its run id from the closure, as its neighbours do (`coreBindings(run)`, `bindings.ts` ~2336;
  `run.runId` ~4930). Only the Story sweep and Chat's *Remember things* wire the lookup; both are routines and
  always registered (`routines/run.ts` ~404) under the run id handed to `runSpec`.
- A refusal reaches the client only as `{ error }` on `entries:update:error` (`refusable.ts` ~62) and the shell
  toasts it; the forms' catch already keeps the draft (`EntryWorkspace.svelte` ~1307, `CastWorkspace.svelte` ~756)
  but cannot tell this refusal from another.
- The write also applies typed fields (`host.ts` ~11714 `patch: fields`), so "text" below means name, content and
  typed fields.
- A parked run still writes after the person decides (`reviewGate.ts` ~442–491), and an approved held rewrite
  replaces the entry's text (`host.ts` ~11703–11725).

## Corrections from the cold review (2026-11-13) — these override anything below that disagrees

1. **The record clears only when the run finishes** (`finish`). Not on park, not on stop: a parked run writes later,
   and a stopped run reaches `finish` in its `finally`. Test: a parked run still refuses the save and its sentence
   says the run waits for review (🚧 *‹routine› in ‹session› is waiting for your review and may update this entry.
   Your changes are kept here: decide there, then save.*); it clears on finish. Carry as an open ★ that a review
   left waiting keeps those entries unsaveable for as long as it waits.
2. **Dated changes from the same form are refused too**: `amendments:create` and `amendments:update`
   (`sockets/amendments.ts` ~1559, ~1692) when the subject is a recorded entry and the change touches its name,
   content or typed fields; the form's Save-as-amendment control is disabled under the notice
   (`EntryWorkspace.svelte` ~1054, `lorebooks/editor/entrySave.ts`). `amendments:delete`, the switch-off window and
   `entries:setMarks` are not refused. These files are owned for that only.
3. **The cast member's Lore tab** (`CastWorkspace.svelte` ~739–760) saves character lore through `entries:update`:
   it gets the same notice on open and Save disabled. Owned for that only.
4. **Notice on save**: after any refused save of an existing entry the form asks the new request once and, when a
   run is recorded, enters the notice state (no change to the refusal's shape). In the DOM test.
5. **Do not use "read" or "reading" in the copy, the record's name or the request's name**: *Read by ‹session›* and
   **lorebook reading** already mean something else (NOMENCLATURE ~365, ~392; R1). Copy 🚧: *‹routine› in ‹session›
   may update this entry when it finishes. Your changes are kept here: save again then.*
6. The new request needs its entry in `src/lib/client/sockets/typedSocket.ts` (owned for that), and if it answers on
   a scoped event its reply carries the scope key (`lorebookId`) (Standing rulings › Sockets).

## The rule to build, in five sentences

From the moment a run's lookup shows the model entries until that run ends, is stopped, or parks at a review gate,
the run's handle records those entries (🚧 name per §24; **not** "claim", which is a channel's word, and not
"held", which is a held change's). While any live run records an entry, a person's save that would change that
entry's text or name is **refused** with one sentence naming what is reading it, and the form keeps what the person
typed, exactly as typed, so they can save again when the run is done. When a form opens an entry, it asks once
whether a run is reading it and, if so, shows the same sentence as a notice above the fields with Save disabled and
a way to ask again; nothing is pushed. The record lives only in the registry: no table, no column, no migration, no
setting, and it clears with the handle. The record and its check are written once, keyed by a kind (`entry` is the
only kind used now), so another writer can adopt it later; **build no second adopter**.

## Build

1. **The record** (`runRegistry.ts`): a field on `RunHandle` and two functions, one to record `(runId, kind, keys)`
   (no-op when no run is registered under the id: previews, tests, dry runs) and one to ask "which live runs record
   this key" returning what a sentence needs (the run's spec id and session id; the caller turns them into shown
   names). A function to clear a run's record early. No import from lorebooks or sockets into the registry.
2. **Record at the lookup**: the `entries-named` binding records the ids it returns. A dry run records nothing.
3. **Clear** when the run finishes (falls out of `finish`), when it parks (`onParked` on every path that parks a
   run which could have recorded: routines, and a reply or action if they can reach the lookup), and when it is
   stopped. Prove with a test that a parked run does not block a save.
4. **Refuse the save** (`entries:update`): only when the save changes the entry's text or name (find the fields the
   run can replace; a reorder, a mark or a switch is not refused). The refusal goes through `refusable` as every
   other does. Copy 🚧: *‹routine or pipeline shown name› is reading this entry in ‹session name› and may update
   it. Your changes are kept here: save again in a moment.* If the person may not see that session, leave the
   session's name out. Do the same for any other person path found above that replaces an entry's text.
5. **The draft**: check each form that saves entry text (`EntryWorkspace.svelte` and what it uses). On this
   refusal the form must stay open with every field as typed and no "discard" prompt. Fix only what does not
   already do so.
6. **Notice on open**: one request/response (🚧 name per §24; a request, not a push; additive in
   `shared/sockets/types.ts`), asked when the entry form opens an existing entry and when the person presses the
   notice's *Check again*. While it says a run is reading: the notice line (STYLE-GUIDE notice pattern, not a
   toast: the toast rule is "only the domain context toasts"), Save disabled. No polling, no timer.
7. **Docs and ledgers in the same change:** `docs/lorebooks.md` (one short paragraph where a lore write that
   updates an entry is described), NOMENCLATURE row(s) and §25 for the record's name, the request and the copy.

## Files owned

`src/lib/server/pipelines/runtime/runRegistry.ts`; the `entries-named` binding in `runtime/bindings.ts` and the
smallest plumbing that gives it its run id; the `onParked` sites; `src/lib/server/sockets/entries.ts` (the update
handler's check, the new request) and its registration; `src/lib/shared/sockets/types.ts` (the request);
`src/lib/client/lorebooks/EntryWorkspace.svelte` and the form pieces it uses (the notice, the draft, Save);
their tests; `docs/lorebooks.md`; `NOMENCLATURE.md`. **No SDK file.**

## Out of scope

The outlet's write rule (`host.ts` create-lore-entry) and any compare of text at the write; deleting an entry a
run is reading; two runs reading the same entry; the reviewer's wording under Review (★5); a second adopter of the
record (cast members, stats, scenes); a pushed event; any migration, setting, table or column; the Activity
sidebar.

## Stop and ask when

The binding cannot know its run id without an SDK change; a published SDK name or event shape would have to
change; a save path cannot be refused without changing its event's shape; the form cannot keep the draft without
restructuring it.

## Done means

Tests: the lookup records exactly the ids it returns and a dry or unregistered run records nothing; the record
clears on finish, on stop and on park; `entries:update` changing text or name of a recorded entry is refused with
the sentence and the row is byte-identical afterwards; the same save after the run ends succeeds; a save of
another entry, and a save that changes no text or name, are not refused; the request answers for a recorded and an
unrecorded entry and never names a session the asker may not see; a DOM test that the form keeps the typed text
after the refusal and shows the notice with Save disabled on open. The existing suites pass:
`runtime/loreMatch.entriesNamed.int`, `runtime/host.loreMatchShown.int`, `sockets/sessions.sweepShown.int`,
`sockets/sessions.chatMemoryShown.int`, `sockets/entries.singleSave.int`, `sockets/scopedReplies.lorebooks.int`.
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean;
`NODE_OPTIONS=--max-old-space-size=12288 npm run check` no new errors. Tests run only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 …"`,
never two runs at once. **To see whether a test run or dev server is up use**
`ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` — never `pgrep -f "vitest run"` inside a wait
loop: the loop's own command line matches and it never ends. **No `npm run sdk:build`** (no SDK file changes). Do
not re-pin hashes: list any that moved (none are expected). Never `git commit`, `stash`, `checkout` or `restore`;
never `prettier --write` a directory; never glob-delete under `/tmp`. Comments state the rule, not the story
(`shared/conformance/commentHistory.test.ts`). At most two workers at once.

## Report

**Return the full report as your final message** (the lead saves it as
`plans/REPORT-run-reads-entry-2026-11-13.md`): the rule as built; the record's name and shape; how the binding
knows its run; every clear point; every person path that can replace an entry's text and what each does now;
whether entry ids are unique across entry types; the request's name and shape; provisional copy verbatim; changed
files; tests and results; open ★; **Noticed, not done**. Say plainly that nothing was looked at in a running app.
