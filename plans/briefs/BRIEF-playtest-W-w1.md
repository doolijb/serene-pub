# BRIEF playtest-W-w1 — SDK: a widget that throws says so (item 15, steps 1 and 3)

Supervisor: lane `playtest-W`. Report back in your final message (no report file). Work in
`/home/jody/github/serene-pub-sdk`. Use absolute paths.

## Goal

Today a core widget whose Svelte render throws after mount goes blank with nothing on screen: the UI
worker only catches a throw at mount (`k: 'failed'`) and in an event handler (`k: 'error'`)
(`component-client/src/workerRuntime.ts:593-631`). Make the throw visible.

1. **One boundary component, used by every core widget host.** Add
   `core-catalog/components/shared/WidgetBoundary.svelte`: props `ctx: ComponentContext` and
   `children: Snippet`. It renders `{@render children()}` inside `<svelte:boundary>` (Svelte 5.56 is
   installed). Its `onerror(error)` calls `ctx.error(<message>, true)` — the existing fatal report
   over the widget port (`sdk/src/componentWire.ts:340`, `{ t: 'error', message, fatal }`), which the
   page answers with its own *This widget stopped* overlay. Build `<message>` the way the mount
   failure does at `workerRuntime.ts:603-611`: the error's message plus up to six stack frames
   (`'\n' + e.stack.split('\n').slice(1, 7).join('\n')`). Guard `ctx.error` with try/catch (a
   closed port must not throw out of the boundary). Its `failed` snippet draws one plain element
   with `role="alert"` and exactly the existing sentence **This widget stopped and can't show
   anything.** — no new copy, no icon, no new `data-widget-part` name. Doc comment: what it is,
   why (item 15: a render throw went blank and silent), and that a handler's throw is the worker's
   to report, not this.
2. **Wrap every host.** The 14 hosts below each end in one line `<XWidget … />`. Change each to
   `<WidgetBoundary {ctx}><XWidget … /></WidgetBoundary>` and import it. The host's `setContext`
   stays where it is (above the boundary — children still see it). Same wrapper everywhere, no
   per-widget variants, nothing else in the hosts changes:
   `core-catalog/components/shared/{stats/Stats, backdrop/Backdrop, attendance/Attendance,
   messages/Messages, places/Places, chronicle/Chronicle, routine-log/RoutineLog, album/Album,
   annex/Annex, turn-order/TurnOrder, actions/Actions, scene-portraits/ScenePortraits,
   lore-entries/LoreEntries}.svelte` and `core-catalog/components/genres/story/authors-note/AuthorsNote.svelte`.
   Check each host takes `ctx` as a prop; if one doesn't, stop and say so.
3. **Worker-level errors.** In `startComponentWorker` (`workerRuntime.ts:556`), also listen for the
   worker global's `error` and `unhandledrejection` events (guard: only when
   `typeof globalThis.addEventListener === 'function'`; check first what the Remote DOM polyfill
   does to the global's `addEventListener` and say so in your report). An error nobody caught
   cannot be placed on one mount, so send `{ k: 'error', mountId, message }` (the existing
   non-fatal kind: "said, and the mount lives on") to **every live mount** in `mounts`, message from
   the existing `messageOf`. Don't `preventDefault()` — the browser console keeps its own report.
   No change to the wire types (`sdk/src/componentWire.ts` is not yours).
4. **Find the actual throw (tests).** In `sdk-tests/coreConversationComponent.test.ts`, add tests
   (reuse the file's `row`, `dossier`, `mountComponent` helpers and the existing `push('settings', …)`
   pattern at ~:1871):
   - **live switches**: mount the conversation (as the first test does, `settings: {}`), then push
     settings in turn: `{ presentation: 'folio' }`, `{ presentation: 'rows' }`, `{ composer: 'quill' }`,
     `{ composer: 'classic' }`, `{ showMessages: false }`, `{ showMessages: true }`,
     `{ showComposer: false }`, `{ showComposer: true }`, and combinations (folio + quill together;
     folio then showMessages off then on). After each push assert `view.errors` has no entry, the
     log's bodies are drawn when showMessages is on (`sp-message-body`), and the composer is there
     when showComposer is on (find the composer's existing `data-widget-part` selector in the file;
     don't invent one). If a real throw shows up, find its cause in `core-catalog/components/**`,
     fix it there, and name file:line and the cause in your report. Don't fix anything outside
     `core-catalog/components/**` — report it instead.
   - **the boundary draws its message**: push a value that makes the conversation's render throw
     (e.g. a `scoped` `session_full` dossier with a broken required part such as `composer: null`;
     find one that actually throws in render — no test-only hook in production code), then assert
     `view.errors` holds one entry with `fatal: true`, the `role="alert"` element with the sentence
     is drawn, and `view.refused` is empty.
   - **worker-level errors**: if the harness can drive it, a test that a worker-global `error` event
     reaches every live mount as `k: 'error'`. A new file `sdk-tests/componentWorkerErrors.test.ts`
     is allowed: call `startComponentWorker` directly with a fake host (`post` records,
     `importModule` returns `{ default: () => {} }`), mount two ids over `MessageChannel` ports,
     dispatch an `error` event on the global (install a plain `EventTarget` shim on `globalThis`
     before importing if Node's global has no `addEventListener`), assert both mounts got
     `k: 'error'`, then an `unhandledrejection`. Check how other sdk-tests import from
     `component-client/src` first.

## Files owned (edit only these)
- `core-catalog/components/shared/WidgetBoundary.svelte` (new)
- the 14 host files listed in 2.
- any file under `core-catalog/components/**` only to fix a real throw found in 4 (name it)
- `component-client/src/workerRuntime.ts`
- `sdk-tests/coreConversationComponent.test.ts`, `sdk-tests/componentWorkerErrors.test.ts` (new)

## Files readable
Anything. `cli/src/testing.ts` (the harness: `errors`, `refused`, `push`, `settle`),
`cli/src/testingWorker.ts`, `component-client/src/svelte.ts` (the reactive `ctx` mirror has `error`),
`sdk/src/componentClient.ts:125`.

## Out of scope
The app (`/home/jody/github/serene-pub`), the wire types, `cli/**`, `component-client/src/svelte.ts`,
any new widget setting, any new part name, label or copy. A widget's own `failed`-state look beyond
one plain element.

## Rules you work under (quoted by the supervisor)
- CLAUDE.md §Decisions: *"Decide implementation inside the asked scope … name the choice in your
  report. Propose and wait … on anything a user sees … a new name / setting / flag / abstraction /
  event."* Findings along the way go under **Noticed, not done**, never fixed in passing.
- NOMENCLATURE R2/R3: no new user-facing name. The one new identifier allowed is the component
  `WidgetBoundary` (internal; not a scene boundary, not R5's vocabulary boundary).
- STYLE-GUIDE §10: sentence case, plain words; the sentence above is reused verbatim.
- Browser code runs on plain-http LAN and phones: no `crypto.randomUUID`, no `navigator.clipboard`.
- *"Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted."*
- Never hand a DOM node to an assertion (`x === null` compared to `true`, not
  `assert.equal(node, null)`): a failing assert on a happy-dom element has OOM-killed VS Code.

## Done means
Green, each run alone in a capped scope from `/home/jody/github/serene-pub-sdk/sdk-tests`
(the runner in its `package.json` is `tsx --test`):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test coreConversationComponent.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-W-w1-conv.log 2>&1; echo exit=$?'
```
(if `systemd-run` is refused, `timeout 900` with the same NODE_OPTIONS), and the same for
`componentWorkerErrors.test.ts` if you add it (log `playtest-W-w1-worker.log`). Also
`cd /home/jody/github/serene-pub-sdk/core-catalog && npx svelte-check --workspace components --tsconfig ./tsconfig.json --threshold error`
in the same capped scope (log `playtest-W-w1-check.log`); report errors in your files only.
Read logs with `tail`/`grep`, never pipe a test run into `head`.

## Report (final message)
Changed files · tests run with exact command and pass/fail counts · the real throw found (or
"none found", with what you switched) · what the polyfill does to the global `addEventListener` ·
Noticed, not done. Under 600 words.

## Verbatim lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`: don't run one.)
