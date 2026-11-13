# BRIEF playtest-C — Models view: the finder becomes a pane, not a dialog (item 20, steps 1–3 and 8)

Lane id `playtest-C` · wave 3 · report `plans/REPORT-playtest-C-2026-11-04.md`

## Goal
Plan lines 698–745. Client only.
1. The Models view (`src/lib/client/components/sidebars/ModelsSidebar.svelte`, `PanelSplit` with `detail={detailPane}`, `:332-344`) gets a small pane union for its right-hand side: `{ kind: 'model', … } | { kind: 'finder', scope } | { kind: 'add-by-name' }`. `openFinder(scope)` (`:286-300`) sets the finder pane instead of opening the dialog, so every door (Loadouts' **Get a model…**, a runtime's / the ONNX endpoint's **Get more…**, the toolbar) moves at once.
2. Wide view: list on the left, finder on the right. Narrow view or Dock: the finder takes the view, with **Back** to the list, the same as a model's details. Pressing Get keeps the finder open; the downloads tray shows progress as today.
3. `ModelFinderView.svelte` fills its pane: drop the dialog's fixed `h-[min(90vh,760px)]`, one scroller; its **Open connection** hand-off stops closing a dialog and opens the connection.
8. Delete the `<Dialog>` block (`:415-455`) and `finderOpen`.
**Add by name** keeps its own dialog for now but opens over the pane (the `'add-by-name'` pane kind may stay unused if it adds nothing today — don't build for later: include it only if step 1's union needs it to compile the existing flow). The quant picker stays a Dialog. **Set up chat** (`SetupChatFlow.svelte`) keeps embedding the finder as it does today; it must still work.
Docs: `docs/connections.md` "The model finder" (a pane of the Models view, not a dialog); STYLE-GUIDE: the list/detail pane pattern for the Models view, in the existing §6 `PanelSplit` material (one short paragraph, same section — no new section).

## Files owned
`src/lib/client/components/sidebars/ModelsSidebar.svelte` (+ its tests), `src/lib/client/components/connections/ModelFinderView.svelte`, `finder.ts`, `finder.dom.test.svelte.ts`, `finderViews.ssr.test.ts`, `SetupChatFlow.svelte` only if the embed needs a prop change to keep working; `docs/connections.md`; `STYLE-GUIDE.md` (that one paragraph only).

## Files readable
Anything. Especially NOMENCLATURE §10 Connections (line 628; **Get a model** at ~:694, quant picker ~:699), §26 Shell (3167) for Dock/Half/Focus and pane words; STYLE-GUIDE §5 Layout (428) and the `PanelSplit` pattern in §6; `docs/connections.md`, `docs/getting-around.md`; `plans/PLAN-model-library-2026-10-29.md` §1 D1–D2.

## Out of scope
Item 20 steps 4–7 (★20a/b: quant picker inline, Add by name as a pane, Set up chat moved, `?get=` view state); items 16 and 17 (no built-in ONNX rows, no finder empty-card button); any server change; any new setting. `NOMENCLATURE.md` :694's "dialog" wording: report it under Canon rows needed.

## Done means
Green: `finder.dom.test.svelte.ts` (renders in a pane; Back returns to the list; Get keeps the pane; each door opens the pane with the right scope), `finderViews.ssr.test.ts` updated, the ModelsSidebar tests, and an axe check in the DOM test (no dialog role on the pane; focus moves to its heading on open). Then the report.

## Standing rules for every playtest lane (verbatim from the lead)

- **Plan:** `plans/PLAN-story-playtest-fixes-2026-11-03.md`. Read the §Summary, §0, your item sections (line ranges below), and §"Build plan". Read `.claude/guides/multi-agent.md` first, then the NOMENCLATURE, STYLE-GUIDE and `docs/<area>.md` sections your files trigger (CLAUDE.md §Authoritative documents), and quote the lines that matter into every worker brief.
- **Scope is the ready-now set only.** The owner's go (2026-11-04) covers only the steps named under **Goal** below. Every §0 reversal and every ★ in the plan is UNRULED and stays unbuilt, even where the plan recommends an answer; the only exception is ★1a's default, which the owner's go named. If a step turns out to need an unruled ★, a new user-facing setting, a new flag, a migration, or a file outside **Files owned**, stop that step, finish the rest, and put it in the report under **Stopped, needs owner**.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 (line 29) and §24 (line 1579), then the group section for your area. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** (term · meaning · section · ⚠ what it is not); the lead writes the §25 ledger row. §23 retired words are never reintroduced. Copy follows STYLE-GUIDE §10 (line 2170): sentence case, plain words, it is a *session*, never a *chat*.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration and stops the step.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts; views never call `toaster`. An event in `SCOPED_EVENTS` must carry its scope key in the payload or `emitToUser` sends nothing. `socket.off(event)` always with the handler. `$state(new Set())`/`Map` is not reactive: `SvelteSet`/`SvelteMap`. `crypto.randomUUID` and `navigator.clipboard` are banned in browser code.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-<lane-id>-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Run only the targeted test files named under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole; the lead runs one grouped verification at the end. Run vitest inside a capped scope and log to a file named with your lane id in the scratchpad dir `/tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/`:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > <scratchpad>/<lane-id>-<n>.log 2>&1; echo exit=$?'` (if `systemd-run` is refused, use `timeout 900` with the same NODE_OPTIONS). Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Never hand a DOM node to an assertion (`x === null` compared to `true`, not `assert.equal(node, null)`).
  SDK tests: run the single file through the runner in `../serene-pub-sdk/sdk-tests/package.json` (check it first), never the SDK root `npm test`/`npm run build`.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk` (the app resolves `@serene-pub/*` by `file:` link). If an app test needs the rebuilt dist: `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-dist.lock npm run sdk:build` from the app root, only after the dev-server check below. Never `git checkout`/`restore`/`stash` in the SDK repo: most of it is uncommitted.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path below: Changed files (both repos) · Tests run, with the exact command and pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (edits to files you don't own, with file:line and the exact text) · Noticed, not done. Under 1,200 words.
