# BRIEF — worker `sc-1-w4`: a scene's Edit history on its page (client), and two small test fixes

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `sc-1`. Owner ruling SC1 (2026-11-17): "Go: add a
scene as a subject of change history" (as described to him: every change to a scene's cast is kept; a person opens
the history and brings a version back). B2: "hand edits aren't treated differently. Just keep a change history so a
user can overwrite."

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build in this task.)

The repo is staged by the lead: run **no git command that changes the index or the working tree**. Never run
prettier with `--write` or pipe its output into a file.

## What exists (server side, done; read it, do not change it)

- `scenes:redlines` `{ sceneId }` → `{ sceneId, lorebookId, canRestore, redlines: Sockets.RedlineView[] }` (newest
  first; refused to anyone who may not edit the scene's lorebook). Each row's `changes` have labels "Present" /
  "Mentioned" and `before` / `after` as **arrays of names** (a gone member reads "a cast member no longer in this
  lorebook"). Cause `scene-compiler` (label "Listed who spoke" in `REDLINE_CAUSE_LABELS`), `save`, `restore`.
- `scenes:restoreRedline` `{ redlineId }` → `{ redlineId, sceneId, lorebookId }`; the server then emits
  `scenes:update` `{ scene }` and a fresh `scenes:redlines`. Both events are scoped on **`lorebookId`**
  (`src/lib/shared/sockets/interest.ts`), declared in `src/lib/shared/sockets/types.ts` (`Sockets.Scenes.Redlines`,
  `Sockets.Scenes.RestoreRedline`) and `src/lib/client/sockets/typedSocket.ts`. There is **no per-scene clear** (the
  book's clear in Book settings covers scene rows).
- `src/lib/client/lorebooks/editHistory/EditHistory.svelte`: one component for an entry and a version, told apart by a
  `subject` descriptor (events, scope, ask params, normalise, clear question). `editHistoryCopy.ts` holds all its words.

## Goal

1. **`EditHistory.svelte` takes a third subject**: prop `sceneId?: number` (with `lorebookId`). Descriptor kind
   `"scene"`: asks `scenes:redlines` with `{ sceneId }`, restores `scenes:restoreRedline`, scope `lorebookId`,
   normalise on `res.sceneId === id` (`canClear: false`). A scene has no clear: for kind `"scene"` neither the version
   clear button nor `ClearEditHistoryDialog` is drawn, and `clearOpen` does nothing. Everything else (rows, Show/Hide,
   Restore, inline refusal, `restoreBlocked`, `updatedAt` re-ask) is shared as is. Update the header comment (three
   subjects; a scene has no clear of its own). No new component.
2. **The scene's page** (`src/lib/client/lorebooks/sections/SceneEditor.svelte`): under `<SceneForm …/>`, for a saved
   scene (`source` present, not `isNew`), mount `<EditHistory {lorebookId} sceneId={source.id}
   updatedAt={source.updatedAt ?? null} restoreBlocked={…} />` (the default fold label "Edit history · n edits").
   `restoreBlocked` is `RESTORE_BLOCKED_UNSAVED` ("Save or discard your changes first.", already in
   `editHistoryCopy.ts`) while the draft differs from the saved scene. Decide how to tell "differs" from what the
   page has: prefer the scene door's own `toDraft(source)` compared with `$state.snapshot(draft)` as
   `EntryWorkspace.svelte` does (~780–792); read `sections/` for where the scene door's `toDraft` lives. If that is not
   reachable from `SceneEditor`, compare the four fields the scene form edits (name, summary, the two lists, the lists
   compared as sorted ids) and say which you chose. Read how `EntryWorkspace.svelte` follows a moved source while
   the draft is clean (~2195–2207) and `LorebooksWorkspace.svelte` `handleSceneUpdated` (~2217) and say in your report
   whether, after a Restore, the open page's draft shows the restored cast (do not change those files).
3. **Copy** (`src/lib/client/lorebooks/editHistory/editHistoryCopy.ts`; 🚧 provisional copy): `clearBookSentence`
   becomes `Removes ${editsCount(n)} across its entries, cast and scenes. Every entry, cast member and scene stays as it
   is now; what they said before can no longer be restored.`; `CLEAR_BOOK_HINT` becomes
   `"What this lorebook's entries, cast and scenes said before each edit."`; the header comment names the scene. Leave
   the admin strings as they are.
4. **Two small fixes the server workers left**:
   - `src/lib/shared/sockets/scopedReplies.test.ts` fails "Add the event to SCOPE_PATHS so tsc checks its Response
     carries the key": add `"scenes:redlines": ["lorebookId"]` and `"scenes:restoreRedline": ["lorebookId"]` beside the
     `characterVersions:*` entries (~75).
   - `src/lib/server/sockets/scenes.redlines.int.test.ts:237` has a `tsc` error TS7053 (indexing `changes` typed as a
     record of unknown): type the access so `tsc` is clean, changing no assertion.

## Files owned

`src/lib/client/lorebooks/editHistory/EditHistory.svelte`, `src/lib/client/lorebooks/editHistory/editHistoryCopy.ts`,
`src/lib/client/lorebooks/sections/SceneEditor.svelte`, `src/lib/shared/sockets/scopedReplies.test.ts` (the two
lines), `src/lib/server/sockets/scenes.redlines.int.test.ts` (the one type fix), any existing client test whose
assertion of the two changed copy strings must follow (say which), and new tests
`src/lib/client/lorebooks/editHistory/editHistoryScene.dom.test.svelte.ts` and (if the SceneEditor needs its own)
a case in `src/lib/client/lorebooks/sections/sceneEditor.routineSummary.dom.test.svelte.ts` or a new
`sceneEditor.editHistory.dom.test.svelte.ts` beside it.

Never touch `EntryWorkspace.svelte`, `LorebooksWorkspace.svelte`, `SceneForm.svelte`, server code beyond the one test
fix, or any file of live lane `gs-3a3b-2` (`sessions/seats.ts`, `sessions/seatKeys.ts`, `sessions/guestSeats.ts`,
`sockets/sessions.update.ts`, `state/write.ts`, `lorebooks/entryKnowledge.ts`, `pipelines/runtime/bindings.outlets.ts`,
the seat form components).

## Rules you work under (quoted)

- CLAUDE.md Sockets: "views register listeners for local state and never call `toaster`." A refusal is said inline
  (the component already does this); no toast, no `notify`.
- CLAUDE.md: "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." (use
  the component's existing `declareInterest` releases.) "`$state(new Set())` / `new Map()` is not reactive on mutation
  — use `SvelteSet` / `SvelteMap`."
- CLAUDE.md: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no
  `navigator.clipboard`."
- STYLE-GUIDE: reuse the component's existing classes and patterns; add no new colour or size. Copy rules: plain
  words; the new strings above are the only new copy.
- Comments state the rule, never history (no "was", "used to", "now", "previously", dates, lane names).
  `src/lib/shared/conformance/commentHistory.test.ts` enforces it.
- Svelte 5 runes only.

## Tests (Done means)

- `editHistoryScene.dom.test.svelte.ts` (model it on `editHistoryVersion.dom.test.svelte.ts`): mounting with
  `lorebookId` + `sceneId` emits `scenes:redlines` `{ sceneId }`; a reply draws the fold; opened, a row shows its
  `who`, "Listed who spoke", and "Present: (empty) → Bram, Mira"-style text from the name arrays; Restore emits
  `scenes:restoreRedline` `{ redlineId }` and a refusal shows inline; `restoreBlocked` disables Restore with that title;
  no clear button and no dialog for a scene; a reply for another scene is ignored.
- A SceneEditor case: a saved scene mounts the history (emits `scenes:redlines` with its id); a new scene does not;
  Restore is blocked while the draft differs.
- Also run: `src/lib/client/lorebooks/editHistory/editHistory.dom.test.svelte.ts`,
  `src/lib/client/lorebooks/editHistory/editHistoryVersion.dom.test.svelte.ts`,
  `src/lib/client/lorebooks/editHistory/clearEditHistory.dom.test.svelte.ts`,
  `src/lib/client/lorebooks/editHistory/editHistoryAdminRow.dom.test.svelte.ts`,
  `src/lib/client/lorebooks/sections/sceneEditor.routineSummary.dom.test.svelte.ts`,
  `src/lib/shared/sockets/scopedReplies.test.ts`, `src/lib/server/sockets/scenes.redlines.int.test.ts`,
  `src/lib/shared/conformance/commentHistory.test.ts`, `src/lib/shared/conformance/socketEgress.test.ts`.

How to run tests: first `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then exactly
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/sc-1-w4-<n>.log 2>&1"`
(always at least one path; one run at a time; never pipe vitest into `head`). A failing `assert` on a happy-dom
element has OOM-killed VS Code: assert on strings and attributes, not on elements. Type check:
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "editHistory|SceneEditor|scopedReplies|scenes.redlines"`
and `NODE_OPTIONS=--max-old-space-size=10240 npm run check 2>&1 | grep -E "EditHistory|SceneEditor|editHistory" | head -40`.

## Stop and ask when

a label or sentence beyond the ones above seems needed; the scene page cannot reach a way to tell an unsaved draft;
`EditHistory` cannot take the scene subject without a rewrite; a test outside your files fails because of your change.

## Report

Your final message: changed files; how the scene subject is added; where the history sits and how "unsaved" is
decided; whether the open page shows the restored cast after a Restore (and why); tests run with pass/fail counts;
Noticed, not done.
