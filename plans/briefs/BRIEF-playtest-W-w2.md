# BRIEF playtest-W-w2 — App: Reload widget, remount on a layout copy, hold settings writes during a copy (item 15, steps 2 and 4)

Supervisor: lane `playtest-W`. Report back in your final message (no report file). Work in
`/home/jody/github/serene-pub`. Use absolute paths.

## Goal

### A. *Reload widget* on the stopped overlay
`src/lib/client/components/host/ComponentMount.svelte` draws *This widget stopped…* when `fatal` is
set (overlay at ~:374-388; `fatal` is set by a refused mutation ~:327, a `failed` mount ~:337, the
wire's `onFatal` ~:224, a false core claim ~:236).
- Add an optional prop `onReload?: () => void` (doc comment: asks the parent to mount the widget
  again; absent, no button). When `fatal` and `onReload` are both set, the overlay shows one button
  under the sentence: label **Reload widget**, `type="button"`, `class="btn btn-sm preset-tonal"`
  (STYLE-GUIDE §6.1: *"Secondary actions are tonal"*; reloading removes nothing, so no signal
  colour), no icon. Its click calls `onReload`. Leave the overlay's sentence exactly as it is.
- `src/lib/client/components/host/RemoteWidget.svelte`: a local `let reloads = $state(0)`; pass
  `onReload={() => reloads++}` to `ComponentMount`; add an optional prop `remountKey?: number`
  (doc comment: a value whose change mounts the component again — the page passes the layout's
  seed count, so a layout copy landing remounts the widget). Fold both into the existing `{#key}`
  at ~:218 (today `pageIds ? \`${src} page-ids\` : src`), keeping its two current meanings and its
  comment, extended to say why the other two remount. The saved view state survives (filed under
  the widget id, as the comment above the file says for live reload).
- `src/lib/client/sessionLayout/SessionLayoutRender.svelte`: on the conversation's `<RemoteWidget>`
  (~:319-342) pass `remountKey={Math.max(manager.seedCount, 1)}` with a one-line comment: a copy
  landing re-seeds the manager (`seedCount`, `surfaces/panelManager.svelte.ts:248-254`) and
  remounts the conversation; floored at 1 so the first seed of a page load does not mount it twice.
  Change nothing else in that file.

### B. A settings write never puts the old arrangement back over a pending copy
`src/lib/client/components/sessionPage/sessionLayoutData.svelte.ts:94-106`: every widget-settings
write emits `sessions:panelLayout:set` with `layout: surfaceManager.toBlob()` — the arrangement as
this tab holds it. While a copy this tab asked for is pending (`layoutCopyAsks.pending > 0`; asked in
`startLayoutFrom` ~:156, settled in `settleLayoutCopy` ~:173 from `handleLayoutStartFrom` and
`handleLayoutStartFromError`), that arrangement is the OLD one, and a write landing after the copy
puts it back. Fix on the client only:
- **Hold.** While `layoutCopyAsks.pending > 0`, the writer still sets `widgetSettings = next` (the
  screen shows the change at once) but emits nothing; it keeps `{ base, next }` — `base` the
  settings as held when the first held write came in (`$state.snapshot`), `next` the newest.
- **Refused** (both paths that settle `false`), once `pending` is 0: send the held write as it
  would have gone — `{ sessionId, layout: surfaceManager.toBlob(), widgetSettings: next }`.
- **Landed**, once `pending` is 0, after `adoptPanelLayout(res)` and `settleLayoutCopy(true)`:
  replay only what changed during the hold over the copy's answer. Per widget id, per key: a key
  whose value in `next` differs from `base` (compare with `JSON.stringify`) is set to `next`'s value,
  a key present in `base` and absent in `next` is removed, a widget id left with no keys is dropped.
  Apply that over `res.widgetSettings`; if it changed anything, set `widgetSettings` and send one
  write with `surfaceManager.toBlob()` (now the copy's arrangement). If nothing changed, send nothing.
  Put the diff/replay in one exported pure function in the same file
  (e.g. `replayHeldWidgetSettings(base, next, landed)`), so the test can hit it directly.
- `reset()` drops anything held. A held write is never sent for another session.
- Leave `persistLayoutSettings` and `persistPanelLayout` as they are (not this step).
- Update the writer's doc comment to say the rule in two or three lines.

## Files owned (edit only these)
- `src/lib/client/components/host/ComponentMount.svelte`, `src/lib/client/components/host/RemoteWidget.svelte` and their tests in that folder (extend `componentMount.dom.test.ts`, `remoteWidget.dom.test.ts` or `liveReload.dom.test.svelte.ts` — your pick, say which)
- `src/lib/client/sessionLayout/SessionLayoutRender.svelte` (the one prop)
- `src/lib/client/components/sessionPage/sessionLayoutData.svelte.ts` and a new test beside it (match an existing naming pattern the vitest config picks up, e.g. `sessionLayoutData.dom.test.svelte.ts`; check `vitest.config.ts`)

## Tests to add
- ComponentMount: no button without `onReload`; with it and a fatal (`worker.say({ k: 'failed', … })`
  as `liveReload.dom.test.svelte.ts` does with its `FakeWorker`), the overlay shows **Reload widget**
  and a click calls it once.
- RemoteWidget: a click on **Reload widget** after a fatal posts a NEW `mount` to the worker (an
  `unmount` for the old id first) and the overlay is gone; changing `remountKey` remounts
  (new `mount` posted); the same `remountKey` re-passed does not.
- sessionLayoutData (fake socket recording `emit`s, fake inbox storing `on` handlers, fake surface
  manager with `init`/`toBlob`/`cancelPendingSave`/`persistNow`/`destroy`/`instances`/
  `announceRecordedEvent`, inside `$effect.root` + `flushSync`; trigger the writer through the real
  store, e.g. `putWidgetSettings` from `$lib/client/stores/widgetSettings.svelte`):
  1. no copy pending: a write emits `:set` at once with the current blob;
  2. copy pending: a write emits no `:set`; the copy lands (deliver a `sessions:panelLayout:startFrom`
     answer with a new `layout` and `widgetSettings`) → exactly one `:set` whose `layout` is the
     NEW blob and whose `widgetSettings` is the copy's with the held change on top;
  3. copy pending, write, copy refused (`ok: false`, and separately the `:error` handler) → one
     `:set` with the held values;
  4. copy pending, a write that changes nothing relative to base after the landing → no `:set`;
  5. the pure replay function: set, remove-a-key, drop-a-widget, untouched keys keep the copy's value.

## Rules you work under (quoted by the supervisor)
- CLAUDE.md §Decisions: *"Decide implementation inside the asked scope … name the choice in your
  report. Propose and wait … on anything a user sees … a new name / setting / flag / abstraction /
  event."* The only new label is **Reload widget**; the only new props are `onReload` and
  `remountKey`. Nothing else new. Findings go under **Noticed, not done**, never fixed in passing.
- Sockets: *"One domain context per event family … is the only listener, and the only place that
  toasts; views register listeners for local state and never call `toaster`."* Add no toast and no
  new socket listener; `socket.off(event)` always with its handler. No new socket event.
- *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."*
- *"Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."*
- STYLE-GUIDE §10: *"Sentence case everywhere … A button says what happens."* It is a session, never a chat.
- Never hand a DOM node to an assertion (`x === null` compared to `true`, not
  `assert.equal(node, null)` / `expect(node).toBe(null)` on a node): a failing assert on a happy-dom
  element has OOM-killed VS Code. Compare booleans and strings.
- The server is not yours: `src/lib/server/**` stays untouched.

## Done means
Green, run in a capped scope (one command, your files only):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <your test files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-W-w2-<n>.log 2>&1; echo exit=$?'
```
(if `systemd-run` is refused, `timeout 900` with the same NODE_OPTIONS). Include every existing test
file in `src/lib/client/components/host/` that mounts `ComponentMount` or `RemoteWidget`
(`componentMount*.dom.test.ts`, `remoteWidget*.dom.test*.ts`, `liveReload.dom.test.svelte.ts`) plus
your new sessionLayoutData test. Never pipe vitest into `head`; read the log with `tail`/`grep`.
Then `npx prettier --check` on each file you changed.

## Report (final message)
Changed files · tests run with the exact command and pass/fail counts · choices you made · Noticed,
not done. Under 600 words.

## Verbatim lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`: don't run one.)
- Also never `git checkout`, `git restore` or `git clean` in either repo.
