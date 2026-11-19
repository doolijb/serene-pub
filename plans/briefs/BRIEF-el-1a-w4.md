# BRIEF — worker `el-1a-w4` — the entry lock's door, and the control and list mark for entries and scenes

App repo `/home/jody/github/serene-pub`. SDK repo is read-only. Supervisor: lane `el-1a`. Report: your final message
(under ~600 words) — changed files, tests run with results, every label and sentence you put on screen, what a
reader who cannot edit sees, Noticed-not-done.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` at all.)

## Rules you work under (quoted from CLAUDE.md, STYLE-GUIDE.md and the lane brief)

- The repo is staged by the lead: run **no git command that changes the index or the working tree**. Never run
  prettier with `--write` and never pipe its output into a file. No schema change (done: `lorebook_entries.entry_lock`
  → `entryLock`, `scenes.scene_lock` → `sceneLock`, booleans default false).
- "Sockets: one domain context per event family (provided by both shells) is the only listener, and the only place
  that toasts; views register listeners for local state and never call `toaster`. An event in `SCOPED_EVENTS` must
  carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing."
- "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- STYLE-GUIDE: "Help is one sentence. A second sentence is a docs link's words, a field's `title`, or gone." · "The one
  sentence under a field or a settings section is **`FieldHelp`** (`components/FieldHelp.svelte`) … a `<p>` carrying
  the `id` the control's `aria-describedby` names. What went wrong is **`InlineError`**." · A control a person may not
  use is **absent, never disabled** (lane brief) — and the lock is "shown read-only to people who can see the row and
  cannot edit it; absent for a provided lorebook's rows".
- Comments state the rule, never history. Run `src/lib/shared/conformance/commentHistory.test.ts` before you finish.
- Tests only as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/el-1a-w4-<n>.log 2>&1"`
  (always at least one path), one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
  Never pipe vitest into `head`. A failing `assert` on a happy-dom element has OOM-killed VS Code: keep DOM tests small,
  one component per file. `NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .` and
  `npm run check` (once each, at the end; report errors only in your files).
- `shared/sockets/types.ts` is shared with other lanes: re-read right before each edit; change only your lines. Re-read
  every file right before each edit. Not yours: `client/components/sessionForms/StartSessionForm.svelte`,
  `createSession.svelte.ts`, the session settings form components, the pipeline panel, every server file except the
  two named below.

## What the lock is (owner ruling EL1, 2026-11-17)

"A manual lock to all entry types so pipelines can't make edits to individual locked entries." A person switches it
on; while it is on, sessions and their routines (pipelines, the automatic Apply, Back taking a reply's change back)
leave the entry — or the scene — as it is; the person can still edit it by hand. Locking and unlocking is not a
content change: no history row, not dated, not part of the draft, written at once (like **Not common knowledge**).
Who may lock: whoever may edit the row by hand (the lorebook's owner; a session's notes: the session's owner); a
provided lorebook's rows are read-only anyway (`primerRowEditProblem` already refuses there).

## Build

1. **Entry door — `entries:setMarks`** (`src/lib/server/sockets/entries.ts` ~1564, the one door for an entry's marks;
   prefer it over a new event). Params gain `locked?: boolean` (writes `entryLock`); the response gains `locked`
   (the stored row's value: the lock is never dated, so no overlay and no `heldBy` for it). Same access and provided
   check as today. The "say which mark" refusal names the lock too. The reply's `entries:update` row already goes to
   the person's tabs: make sure the entry row the client lists and opens carries `entryLock` (find `toEntryRow` /
   `toListRow` and the wire entry / list row types; add the field where they list fields). Wire type:
   `Sockets.Entries.SetMarks` in `src/lib/shared/sockets/types.ts` ~10012 (and `client/sockets/typedSocket.ts` only if
   it restates the shape).
2. **Scene door** — already built (`scenes:update` with `{ scene: { id, sceneLock } }`; a lock-only update is not a lore
   write; the list rows carry `sceneLock`). Do not edit `sockets/scenes.ts`.
3. **Apply review line** — `Sockets.Sessions.OverlayItems.Item` (`types.ts` ~7950) gains
   `entryLocked?: boolean` (the server already sets `entryLocked: true` on an `entry` or `entry-change` item whose entry
   is locked; `sockets/sessions.overlay.ts` passes items through unchanged — check). In the review
   (`src/lib/client/components/sessionForms/SessionViewPanel.svelte` ~670–700, where `item.conflict` is drawn), an
   item with `entryLocked` shows `RUN_LOCK_SENTENCES.held(<the item's title>)` (`src/lib/shared/lorebooks/runLocks.ts`)
   as a muted line; Apply and Take back stay offered (a person's Apply on a locked entry is allowed).
4. **The control** on the entry page (`src/lib/client/lorebooks/EntryWorkspace.svelte`), modelled on the
   `notCommonToggle` snippet (~2607; rendered in the menu ~2694 and the zone ~2919, so it exists at 400 px width too):
   a toggle button, `aria-pressed`, a lock icon from the existing `Icons` set, label **Locked**, and one sentence of
   help in `FieldHelp`-style markup (`aria-describedby`):
   - entry: *Sessions and their routines leave this entry as it is; you can still edit it.*
   - scene (`activeDoor.store === "scenes"`): *Sessions and their routines leave this scene's summary, notes and cast as they are; you can still edit it.*
   Written at once (entries: `entries:setMarks { entryId, locked }` the way `editor/teachMarks.ts` asks it, with its
   request token; scenes: `scenes:update { scene: { id, sceneLock } }`), busy while the ask is out, an `InlineError` on
   refusal. Only on a stored row (not while creating). **Read-only** for a reader who can see the row and cannot edit
   it (the page's existing read-only state): no button; when the row is locked, one muted line *Locked: sessions and
   their routines leave it as it is.* **Absent** on a provided lorebook's rows and when nothing is locked for a
   read-only reader.
5. **The list mark** (`src/lib/client/lorebooks/EntryPool.svelte`, and the scene rows wherever the Scenes kind lists
   them): a small lock icon on a locked row, `aria-label="Locked"` and `title="Locked"`, beside the row's existing
   marks (find how a row draws **replaced** / pinned / off and sit with them).

Every label and sentence above is provisional (🚧): mark each with `🚧 Provisional copy: the owner has not seen this
sentence.` where the codebase does so.

## Tests

- Socket: new `src/lib/server/sockets/entries.lock.int.test.ts` — the owner locks and unlocks (`locked` in the reply,
  `entry_lock` stored, no Edit history row written); a session-notes entry by the session's owner; another person and a
  provided lorebook's row are refused in words; the listed / opened entry row carries `entryLock`.
- DOM (one file per component; patterns `lorebooks/entryWorkspace.knowledge.dom.test.svelte.ts`,
  `lorebooks/entryEarmark.dom.test.ts`): `src/lib/client/lorebooks/entryWorkspace.lock.dom.test.svelte.ts` — the toggle
  emits `entries:setMarks { locked: true }` for an entry and `scenes:update { scene: { id, sceneLock: true } }` for a
  scene, `aria-pressed` follows the row; read-only reader sees the line and no button; provided row: nothing.
  `src/lib/client/lorebooks/entryPool.lock.dom.test.svelte.ts` — the mark on a locked row only. One small test for the
  review line if `SessionViewPanel` has a DOM test harness (find it); else say so.
- Then the existing tests of what you touched: `lorebooks/entryWorkspace.knowledge.dom.test.svelte.ts`,
  `entryWorkspace.versions.dom.test.svelte.ts`, `entryEarmark.dom.test.ts`, the `entries:setMarks` socket tests (grep
  `setMarks` in `src/lib/server/sockets/*.test.ts`), `sessions.applyLists.int.test.ts`, and
  `src/lib/shared/conformance/commentHistory.test.ts`.

## Files owned

`src/lib/server/sockets/entries.ts` (`entrySetMarksHandler` and the row mapping only), the entry row mapper file if the
field must be added there (name it), `src/lib/shared/sockets/types.ts` (the `SetMarks`, entry row and `OverlayItems.Item`
lines only), `src/lib/client/sockets/typedSocket.ts` (only if needed), `src/lib/client/lorebooks/EntryWorkspace.svelte`,
`src/lib/client/lorebooks/EntryPool.svelte` (and the scene-row component if separate: name it),
`src/lib/client/components/sessionForms/SessionViewPanel.svelte` (the review line only), the new test files.

## Out of scope

Server checks (built), `sockets/scenes.ts`, cast members, docs, NOMENCLATURE, any new event, a lock on the lorebook
or on a cast member.

## Stop and ask (in your report) when

The existing door cannot carry the field without changing what it does for marks; the read-only state is not known to
the page; a place for the control would need a new layout region.

## Done means

The new files and the existing files named above green; `tsc` 0 and `npm run check` 0 errors in your files.
