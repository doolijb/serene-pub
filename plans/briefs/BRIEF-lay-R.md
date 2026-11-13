# BRIEF lay-R — the Runs widget (owner 2026-11-06: "Create a widget for pipeline history etc and debugging. Only renders for admins")

Lane-supervisor (fresh, Opus). Read `plans/briefs/BRIEF-lay-common.md` (rules absolute: every test/tsc/check inside the memory-capped `systemd-run` scope; never hand a DOM node to an assertion; new names → NOMENCLATURE §1/§24 and recorded by YOU in §9/§22/§25 this time — re-read NOMENCLATURE right before each edit, minimal hunks, another programme appends rows), then `plans/briefs/RECON-runs-widget.md` (file:line map). CLAUDE.md Principles P1–P6.

## Lead decisions
- Widget id `session-runs`, title **Runs**, icon `Receipt`. Charter (P6, for its §9 row): "Runs: an administrator's list of this session's pipeline runs, newest first — what started each, which pipeline, how it ended, how long it took, where it stopped — with the doors to its steps, the run inspector and the prompt; it owns no data (runs belong to `pipeline_runs`, receipts to the inspector); it is not While you were away (routines, for everyone), the progress card (a run in flight) or the Pipelines view's Runs tab (every session, by pipeline)."
- UI words: never "trigger" (retired) — "Started by …" (event / action / routine / schedule / you); outcomes in words (Finished · Stopped · Failed · Cancelled) with `data-outcome`; previews marked "Preview". Node ids allowed in the steps list (admin exception, :3531).
- Data: add `triggerFamily`, `registrationKey`, `triggerSource`, `endedAt`, `parentRunId`, `depth` to the `pipelines:runs` select + its type (plain columns; NEVER the receipt); echo `sessionId`. `sockets/pipelines.ts` + `shared/sockets/types.ts` are shared files — re-read right before each edit, minimal hunks.
- Requests (SDK `sdk/src/widgets.ts`, askers `'core'`, group `'session'`): `session-runs { limit? }` → `SessionRunsV1 { runs: SessionRunV1[] }`; `session-run-steps { runId }` → `{ steps: { seq, key, kind, result, reason, elapsedMs, tokens }[] }` (app answerer maps the existing `pipelines:run` receipt through receiptView `nodeRows`; no new server code). App answerers REFUSE non-admins before any socket emit (no `:error` toast). Reuse `inspect-run` and `prompt-details` for the row buttons (Prompt only when the run wrote a message, context debugging is on, and the line is loaded — otherwise no button).
- Gating: server R55 already; the widget draws NOTHING unless `viewer.v1.isAdmin` (R10); the tray: an APP-side admin-only id list (e.g. in `coreWidgets.ts` / `coreDefaultWidgets(isAdmin)`), so non-admins never see it in the tray or the phone editor's Add — NO new SDK declaration field.
- No settings (P3). 25 runs, **Show more** to 100. Refresh on mount, `run:ended`, `story:moved`, and a Refresh button. Steps expand inline per run.
- Out of scope: filters, cancel, live progress, wire/replay, lineage trees, cross-session lists, Statistics.

## Build
SDK: request map + types + askers + group (`sdk/src/widgets.ts`), re-exports (`sdk/src/component.ts` if that's the pattern), registry entry + `coreWidgets.sessionRuns` + `CORE_COMPONENTS` (`core-catalog/src/registry/widgets.ts`, reads incl. 'viewer'), new `core-catalog/components/shared/session-runs/` (entry, wrapper, widget, pure logic — copy routine-log's shape), sdk-tests `coreSessionRuns.test.ts` (declaration, askers, pure logic: outcome words, duration, started-by; a mount test incl. non-admin draws nothing) + `coreComponentSources` lists; regenerate parts (`npm run gen:widget-parts`) and re-pin the coreCatalog digest with a "Moved" comment if it moves.
App: `requests/sessionRuns.ts` (+test: non-admin refused before emit; clamp; mapping), `requests/index.ts` table + dep type, `pageAsks.ts` readers, `routes/sessions/[id]/+page.svelte` wiring, `server/components/core.ts` loader, `coreWidgets.ts` + `sessionLayoutData.svelte.ts` tray filter (+test), `coreWidgets.test.ts` slug list, `server/sockets/pipelines.ts` + types (+ an int test for the new columns), `styles/widgets.css` (parts; quiet admin look per STYLE-GUIDE §6.16, 44px touch targets).
Docs: `docs/session-layout.md` widget table row, `docs/pipelines.md` mention; STYLE-GUIDE §6.16 parts row; NOMENCLATURE §9 row (charter), §22 icon row, §25 ledger rows.
SDK build: only when `pgrep -af "vite dev"` shows no serene-pub server (the owner's :5173 may be up) — else report "blocked on your dev server"; inside a capped scope.
Browser check: an isolated dev instance (memory reference_isolated_dev_instance_recipe; never :5173; SIGTERM only) — the widget placed as an admin shows runs and steps; a non-admin guest sees nothing and no tray entry. If another programme's mid-edit breaks boot, say so and skip.

## Files owned
Exactly the files named above, their tests, and the new folder. Nothing else.

## Done means
Targeted tests green in capped runs; app tsc + check no new errors in your files; SDK tsc clean. END with the full report as your final message (changed files, names for §25 you recorded, tests, open ★, Noticed).

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."
