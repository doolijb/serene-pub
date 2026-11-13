# BRIEF playtest2-S3-w2 — client: Compile for an entry whose day has scenes not yet compiled

Lane `playtest2-S3`, worker 2 of 2. Write your report at `plans/briefs/REPORT-playtest2-S3-w2.md` (if the harness refuses, put the full text in your final message).

## Background
A scene now opens filed under no history entry (*not yet compiled*; `scene.historyEntryId === null`), and **Compile to entry** takes in the unfiled scenes of the entry's day. But every Compile control is gated on scenes ALREADY filed under the entry, so an entry a person adds for a new day can never be compiled. Worker 1 is adding, in parallel, one optional field on each **history** entry row the book's `entries:list` sends: **`unfiledSceneCount?: number`** — how many not-yet-compiled scenes a compile of this entry would take in; **absent when there are none** (and on rows from an older server). The rows reach these components as `PoolSource` (`Record<string, any>`), so read it as `Number(row?.unfiledSceneCount) || 0`. Do not touch types.ts.

## Goal — three gates enable Compile when the count > 0
1. `src/lib/client/lorebooks/sections/HistoryRowMenu.svelte` (:28–31): the button is enabled when `scenes.length > 0 || unfiled > 0`; the `title="Capture scenes first"` shows only when both are 0. Label logic unchanged.
2. `src/lib/client/lorebooks/sections/HistorySceneList.svelte` (:71 and the button at ~:183): when `scenes.length === 0`:
   - `unfiled === 0` → exactly today's paragraph ("No scenes captured for this entry yet. Capture scenes from the session page."), no button;
   - `unfiled > 0` → the paragraph reads **`{n} scene not yet compiled for this day.`** / **`{n} scenes not yet compiled for this day.`** (same element/classes as today's empty paragraph), followed by the same **Compile to Entry** button (`pool.openCompile(entry)`) the non-empty branch shows. Keep the non-empty branch exactly as is. Prefer one button in the markup reached by both branches over a duplicate, if it stays readable.
3. `src/lib/client/lorebooks/time/DatedEntryPanel.svelte` (~:193–215): `source` is the entry row. **Recompile** is enabled when `scenes.length > 0 || unfiled > 0`. Titles: both 0 → today's "Capture a scene from a session first"; `scenes.length > 0` → today's "Compile these scenes into this entry again"; `scenes.length === 0 && unfiled > 0` → **"Compile this day's scenes into this entry"**. The italic paragraph under it when `scenes.length === 0`: `unfiled === 0` → today's sentence; `unfiled > 0` → the same `{n} scene(s) not yet compiled for this day.` sentence as in 2. Nothing else in the panel changes.
These are the only new strings; use them exactly (the canon phrase is *not yet compiled*; never "unfiled" in the UI; never "chat").

Read-only checks (do NOT edit; report what you find with file:line): does `EntryWorkspace.svelte`'s `openCompile`, `TimeLens.svelte`'s `recompile` (the `onRecompile` the panel calls), or `components/modals/CompileHistoryEntryModal.svelte` refuse or hide anything when the entry has no filed scenes? Does an extra field on an `entries:list` row survive to `source` / `entry` in each of the three (it does for `keptImprints`: `EntryInspector.svelte:130`)?

## Files owned (re-read each immediately before every edit; use Edit, never Write, on existing files — lane L edits other files in `src/lib/client/lorebooks/` right now)
The three components above; new DOM tests beside them: `src/lib/client/lorebooks/sections/historyCompileGate.dom.test.svelte.ts` (covering HistoryRowMenu + HistorySceneList) and `src/lib/client/lorebooks/time/datedEntryCompileGate.dom.test.svelte.ts` (DatedEntryPanel). Name them otherwise only if the repo's dom-test glob needs it (check `vitest` config) and say so.

## Files readable
Everything. DOM-test pattern: `src/lib/client/lorebooks/sections/keptImprintNote.dom.test.svelte.ts` (`vi.mock` the socket/interest modules, `mount`/`flushSync`, `afterEach` unmount + `document.body.innerHTML = ""`; ⚠ "No DOM node is ever handed to `expect`" — assert on `textContent`, `.disabled`, `.title`, booleans). The pool context: `sections/poolContext.ts` (`getLorePoolCtx`; `vi.mock("./poolContext", …)` with a fake `{ scenesOf, compileActivityOf, openCompile, … }`). `DatedEntryPanel` reads `bookReadOnly()` and other imports — mock what it needs minimally.

## Tests to add (Done means)
For each of the three: (a) no filed scenes, `unfiledSceneCount` absent → disabled/hidden with today's title/sentence ("Capture scenes first" in the row menu); (b) no filed scenes, `unfiledSceneCount: 2` → enabled, pressing it calls `openCompile(entry)` / `onRecompile`, the sentence reads "2 scenes not yet compiled for this day." (singular for 1 where a sentence shows); (c) filed scenes present → as today. Run (exact, capped; read the log after; never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/lorebooks/sections/historyCompileGate.dom.test.svelte.ts src/lib/client/lorebooks/time/datedEntryCompileGate.dom.test.svelte.ts src/lib/client/components/sessionPage/requests/historyEntries.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S3-w2.log 2>&1; echo exit=$?'`
`npx prettier --check <file>` on each changed file (report, don't reformat untouched lines).

## Rules your work depends on (quoted)
- STYLE-GUIDE copy: sentence case; say what is so and what to do. Use only the strings above.
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." (Use `$derived` for the count.)
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "Sockets: views register listeners for local state and never call `toaster`." "`socket.off(event)` with no handler removes every listener app-wide." (Nothing here should need a socket.)
- "It is a **session**, never a *chat*."
- Do what was asked, at the size asked. Findings go under **Noticed, not done** in your report, never fixed in passing. No new prop, context member, name, setting or event.
- Never a full `npm test`, `npm run check`, project-wide `tsc`, or `sdk:test`.

## Stop and ask when
A gate cannot read the field from the row it has (it needs a new prop or context member); another string seems needed; a read-only check shows the compile path refuses an entry with no filed scenes.

## Report
Changed files (what changed), tests run (exact command, pass/fail counts), the read-only findings with file:line, decisions, Noticed-not-done.

## Verbatim lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No SDK change is expected.)
