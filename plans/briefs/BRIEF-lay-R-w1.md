# BRIEF lay-R-w1 — the Runs widget, SDK half (sonnet worker)

Supervisor: lay-R (Opus). Repo: `/home/jody/github/serene-pub-sdk` (the SDK; sibling app at `/home/jody/github/serene-pub`). Another programme (`cv-*`) edits SDK files concurrently: **re-read every file right before you edit it, make minimal hunks, never rewrite whole files.** Lines below drift; re-find them by grep.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."

**Do NOT run `sdk:build`** at all — the supervisor builds. You run only the targeted SDK tests listed under Done (they run from source via tsx).

## Goal
Owner 2026-11-06: "Create a widget for pipeline history etc and debugging. Only renders for admins." A new core widget **Runs** (id `session-runs`): an administrator's list of this session's pipeline runs, newest first — what started each, which pipeline, how it ended, how long it took, where it stopped — with the doors to its steps (inline), the run inspector and the prompt. It owns no data.

## Rules you must follow (quoted from the project's canon)
- **Admin only (R10 + lead):** the widget draws NOTHING — no root element, no text, no request asked — unless `widget.current.viewer.v1.isAdmin === true`. (Owner R10: "don't have most widgets show placeholder text when there's nothing to show" — so an admin's empty list also draws no sentence; only the toolbar with Refresh.)
- **Vocabulary:** never the word "trigger" in UI text (retired 2026-09-28: "what starts a run is an **event** or a fired **action**, never a trigger"). Say **Started by …**. The data field names `triggerFamily` / `triggerSource` are allowed (canon term "trigger family"; `triggerSource` mirrors the published Receipt field) — but never shown as words. Never "chat" — it is a **session**. Outcomes in words: `ok` → **Finished**, `halt` → **Stopped**, `err` → **Failed**, `cancelled` → **Cancelled**; the raw word rides on `data-outcome`. A preview run is marked **Preview**. Node keys may be shown in the steps list (admin exception).
- **No settings** (P3). 25 runs first; **Show more** asks for 100 (one step, then the button goes). Refresh on mount, on the widget event `run:ended`, on `story:moved` (debounce both ~500 ms like routine-log), and on a **Refresh** button.
- Markup carries no look: every element names what it is in `data-widget-part` (STYLE-GUIDE §6.16); the app's stylesheet draws them. Buttons need an accessible name (`aria-label` when icon-only). Every sentence goes through the widget's `t()`.
- Published SDK names are never removed or renamed. New exported names are listed in your report.
- A failed read or a refused press is the widget's own `session-runs.alert` line, never a toast.
- Tests: **never hand a DOM node to an assertion** (compare `x === null` to `true`/`false`) — a failing assert on a happy-dom node has OOM-killed VS Code.

## Contract (exact — the app worker codes against the same text)

### 1. Requests — `sdk/src/widgets.ts`
In `interface WidgetRequests` (next to `'routine-log'`, grep it), add with 🚧 doc comments:
```ts
'session-runs': { params: { limit?: number }; result: SessionRunsV1 }
'session-run-steps': { params: { runId: string }; result: SessionRunStepsV1 }
```
Doc: administrators' only — the host refuses anyone else (the request is not a grant); `limit` is a wish the host clamps (1–100, 25 by default); newest first.
Askers table (grep `'routine-log': 'core',`): both `'core'`. Group table (grep `'routine-log': 'session',`): both `'session'`.
Types (next to `RoutineLogV1`), all `@experimental`, 🚧:
```ts
/** 🚧 One run of a pipeline in this session, as the Runs widget lists it (owner 2026-11-06). */
export interface SessionRunV1 {
	runId: string
	/** The pipeline's slug. */
	pipeline: string
	outcome: 'ok' | 'halt' | 'err' | 'cancelled'
	/** Which family of registration started it — `event` · `action` · `routine`; null when none did. */
	triggerFamily: string | null
	/** That registration's derived key (`message-respond→story-respond`); null when none. */
	registrationKey: string | null
	/** The receipt's trigger source: `input` · `event` · `hook` · `ui` · `schedule`. */
	triggerSource: string
	/** Whose run it is (an administrator sees every user's runs). */
	userId: number | null
	username: string | null
	/** Epoch ms. */
	startedAt: number
	endedAt: number
	elapsedMs: number
	tokens: number
	/** Where it stopped, when it did not finish. */
	haltNodeKey: string | null
	haltReason: string | null
	isPreview: boolean
	/** The run that started this one, and how deep below the first it stands (0 = a run nothing else started). */
	parentRunId: string | null
	depth: number
	/** The line whose prompt the Prompt door opens — set only when the host can show it (context debugging on, the line loaded, its prompt recorded); else null and no Prompt button. */
	promptMessageId: number | null
}
/** 🚧 What `session-runs` answers: the session's runs, newest first. */
export interface SessionRunsV1 { runs: SessionRunV1[] }
/** 🚧 One step of a run, as `session-run-steps` answers it. */
export interface SessionRunStepV1 {
	seq: number
	/** The step's node key (`generate`, or `lore [2]` for a loop's iteration). */
	key: string
	kind: string
	/** The receipt's word for how the step ended (`ok`, `halt`, `skip`, `error`…). */
	result: string
	reason: string | null
	elapsedMs: number
	tokens: number | null
}
/** 🚧 What `session-run-steps` answers. */
export interface SessionRunStepsV1 { steps: SessionRunStepV1[] }
```
Re-export the four types from `sdk/src/component.ts` beside `RoutineLogEntryV1, RoutineLogV1` (grep) and wherever `RoutineLogV1` is re-exported from `sdk/src/index.ts` (check; follow the existing pattern exactly).

### 2. Component kit — the plain half shared with the app
Follow the **attendance** pattern (`core-catalog/src/shared/ui/attendance/index.ts`, imported by the component as `@serene-pub/core-catalog/attendance` and by the app directly):
- New `core-catalog/src/shared/ui/session-runs/index.ts` — pure TS, no Svelte, header comment like attendance's (what it answers; ⚠ not While you were away (routines, for everyone), not the progress card (a run in flight), not the Pipelines view's Runs tab (every session, by pipeline); 🚧). Exports (exact names):
  - `SESSION_RUNS_FIRST = 25`, `SESSION_RUNS_MOST = 100`
  - `runOutcomeWords(outcome: string): string` — Finished / Stopped / Failed / Cancelled; unknown → the raw word.
  - `runDurationWords(ms: number): string` — `< 1000` → `"820 ms"`; `< 60 000` → one decimal `"4.2 s"` (drop `.0`: `"4 s"`); else `"1 min 5 s"` (`"2 min"` when 0 s).
  - `runStartedByWords(run: Pick<SessionRunV1,'triggerFamily'|'triggerSource'|'userId'|'username'>, viewerId: number | null): string` — family first: `routine` → "Started by a routine", `action` → "Started by an action", `event` → "Started by an event"; then source: `schedule` → "Started by a schedule", `event` → "Started by an event", `ui` → "Started by you" when `run.userId === viewerId` (and not null), else `"Started by ${username}"` when a username, else "Started by a person"; `input` → "Started by hand"; `hook` → "Started by a hook"; anything else → `"Started by ${source}"`. (These are English source strings; the component passes them through `t()` — for the username case the component calls `t("Started by {name}")` and replaces; so ALSO export the template choice: return a `{ source: string; name?: string }` pair instead of a final string if that keeps i18n clean — your call, but the test must pin the English results.)
  - `runStoppedAtWords(run: Pick<SessionRunV1,'outcome'|'haltNodeKey'|'haltReason'>): string | null` — null when `outcome === 'ok'`; else `"at {node}: {reason}"`, `"at {node}"`, or `"{reason}"`, null when neither.
  - `runTokensWords(n: number | null): string | null` — null for 0/null; `"1 token"`, `"1234 tokens"` (no locale grouping, deterministic).
  - `runAgoWords(at: number, now: number): string` — same scale as routine-log's `agoWords` (just now / N minutes ago / N hours ago (< 48) / N days ago); write it here (routine-log has no kit subpath; don't import across).
  - `interface SessionRunRow { runId; pipeline; outcome; outcomeWords; startedBy; when; duration; tokens: string|null; stoppedAt: string|null; preview: boolean; depth: number; promptMessageId: number|null }` and `sessionRunRows(runs: readonly SessionRunV1[], viewerId: number | null, now: number): SessionRunRow[]` (keeps order — the host's is newest first).
  - `interface SessionRunStepRow { seq; key; kind; result; reason: string|null; duration: string; tokens: string|null }` and `sessionRunStepRows(steps: readonly SessionRunStepV1[]): SessionRunStepRow[]` (sorted by `seq`).
  - `canShowMoreRuns(shown: number, limit: number): boolean` — `shown >= limit && limit < SESSION_RUNS_MOST`.
- `core-catalog/package.json` `exports`: add `"./session-runs": { "types": "./dist/shared/ui/session-runs/index.d.ts", "import": "./dist/shared/ui/session-runs/index.js" }` right after `"./attendance"` (re-read first; one hunk). Check whether `sideEffects` needs it (it doesn't if the module has no side effects — attendance isn't listed).
- `sdk/src/componentImports.ts` `COMPONENT_IMPORTS`: APPEND `'@serene-pub/core-catalog/session-runs'` at the end with a comment in the existing style (`// 🚧 2026-11-06 (lay-R): the Runs widget's plain half — appended.`). The list only grows. Update the two tests that pin the list: `sdk-tests/coreComponentSources.test.ts` (the `kit` array ~:146) and `sdk-tests/hostElements.test.ts` (~:187).

### 3. Registry — `core-catalog/src/registry/widgets.ts`
- A `CORE_WIDGETS` entry right after `routine-log`'s (grep `id: 'routine-log'`), with a 🚧 doc comment carrying the charter: *Runs: an administrator's list of this session's pipeline runs, newest first — what started each, which pipeline, how it ended, how long it took, where it stopped — with the doors to its steps, the run inspector and the prompt; it owns no data (runs belong to `pipeline_runs`, receipts to the inspector); it is not While you were away (routines, for everyone), the progress card (a run in flight) or the Pipelines view's Runs tab (every session, by pipeline). Draws nothing for anyone but an administrator; the app keeps it out of a non-admin's tray.*
  ```ts
  { id: 'session-runs', title: 'Runs', icon: 'Receipt', component: 'session-runs',
    layout: { span: { ideal: 1 }, minInline: 260 }, reads: ['viewer', 'session'],
    maxInstances: 1, presets: [DEFAULT_PRESET] }
  ```
  No `settings`, no new declaration field (no audience field — the app filters the tray).
- `coreWidgets` map: `sessionRuns: coreWidget('session-runs'),` after `routineLog` with a one-line 🚧 doc.
- `CORE_COMPONENTS`: `component({ slug: 'session-runs', label: 'Runs', entry: 'components/shared/session-runs/session-runs.ts', framework: 'svelte' })` after routine-log's.

### 4. The component — new `core-catalog/components/shared/session-runs/`
Copy routine-log's shape (`components/shared/routine-log/`: `routine-log.ts` entry, `RoutineLog.svelte` wrapper, `RoutineLogWidget.svelte`) — but import the plain half from `@serene-pub/core-catalog/session-runs` (like AttendanceWidget imports `@serene-pub/core-catalog/attendance`). Files: `session-runs.ts`, `SessionRuns.svelte` (wrapper: context + `WidgetBoundary`; `widgetRefFromComponent(ctx, { id: 'session-runs', instanceId: 'session-runs', title: 'Runs' })`; no settings wait — it reads no settings, so `ready` is always true), `SessionRunsWidget.svelte`.
Widget behaviour:
- `isAdmin = widget.current.viewer.v1.isAdmin === true`; `viewerId = viewer.v1.userId ?? null`. **Not admin → render nothing and ask nothing** (guard the `ask()` effect and the event subscriptions on isAdmin).
- `limit` state starts `SESSION_RUNS_FIRST`; `ask()` = `ctx.request('session-runs', { limit })` with the routine-log ticket pattern (latest ask wins; `untrack` where routine-log does).
- `now` clock refreshed each minute for the "ago" words (no re-ask on the tick — only mount / events / Refresh / Show more).
- Each row: pipeline, outcome words (`data-outcome` raw), Preview chip, started-by, when, duration, tokens, stopped-at line; buttons: **Steps** (toggle, `aria-expanded`, `aria-controls` to the steps list id), **Inspect** (`ctx.request('inspect-run', { runId })`), **Prompt** only when `promptMessageId != null` (`ctx.request('prompt-details', { messageId })`). Icon + text buttons are fine; icon-only ones need `aria-label`. Use `<sp-icon name="…" size="12">` like routine-log (list-tree / search / file-text or similar lucide kebab names).
- Steps expand inline: first open asks `session-run-steps { runId }`, caches the answer per runId (`SvelteMap` from `svelte/reactivity` — `$state(new Map())` is NOT reactive on mutation), a failure is the alert line. Rows from `sessionRunStepRows`.
- **Show more** button when `canShowMoreRuns(runs.length, limit)` → `limit = SESSION_RUNS_MOST; ask()`.
- `data-depth` on a row when `depth > 0` (no lineage tree — out of scope).
Parts (exact names — the app's stylesheet and STYLE-GUIDE use them):
`session-runs.root` · `session-runs.toolbar toolbar` · `session-runs.refresh` · `session-runs.alert` (role=alert) · `session-runs.list list` (ul) · `session-runs.entry row` (li; `data-outcome`, `data-preview` when preview, `data-open` when steps shown, `data-depth`) · `session-runs.pipeline label` · `session-runs.outcome` · `session-runs.preview chip` · `session-runs.started-by` · `session-runs.when` · `session-runs.duration` · `session-runs.tokens` · `session-runs.stopped-at` · `session-runs.actions` (the row's buttons) · `session-runs.steps-toggle` · `session-runs.inspect` · `session-runs.prompt` · `session-runs.steps list` (ol) · `session-runs.step row` (li; `data-result`) · `session-runs.step-key` · `session-runs.step-kind` · `session-runs.step-result` · `session-runs.step-reason` · `session-runs.step-duration` · `session-runs.step-tokens` · `session-runs.more` (*Show more*).

### 5. Tests — new `sdk-tests/coreSessionRuns.test.ts` (copy `sdk-tests/coreRoutineLog.test.ts`'s shape)
- Declaration: id/title/icon/maxInstances/reads `['viewer','session']`/no settings/`coreWidgets.sessionRuns === decl`/`CORE_COMPONENTS` entry.
- Requests: both kinds in `WIDGET_REQUEST_KINDS`, askers `'core'`.
- Plain half: outcome words (all four + unknown), duration (ms / s / min boundaries), started-by (each family, each source, ui you vs name vs nobody), stopped-at (ok → null, node+reason, node only, reason only), tokens, ago, rows keep order, step rows sorted, `canShowMoreRuns`.
- Mount (use `mountComponent` like coreRoutineLog's `mountEmpty`, `timeout: 120_000` on the test, `timeoutMs: 60_000`):
  (a) a **non-admin** viewer: `view.root.textContent.trim() === ''`, `query('[data-widget-part~="session-runs.root"]') === null` is `true`, and the requests stub was never called;
  (b) an **admin** with two runs answered: two `session-runs.entry` rows, the first row's outcome text, a Prompt button only on the run with a `promptMessageId`; clicking Steps asks `session-run-steps` with that runId and draws its step rows (check how other sdk-tests click — grep `click(` in `sdk-tests/coreConversationComponent.test.ts` or the attendance test for the harness's API).
- Add `'session-runs'` to the `CLONEABLE` lists in `sdk-tests/coreComponentSources.test.ts` (:39 and :215) after `'routine-log'`.
- Regenerate the parts guide: `npm run gen:widget-parts` (in the SDK root — this is a script, allowed) and confirm `guides/widgets.md` gained the session-runs parts.
- The catalogue digest pin (`sdk-tests/coreCatalog.test.ts` ~:1056, `assert.equal(digest.slice(0, 16), '…')`): run that test; **if it moved, report the new digest and the old one — do NOT re-pin it yourself** (the cv programme moves it too; the supervisor re-pins with a "Moved" comment after checking).

## Files owned (only these)
`sdk/src/widgets.ts` (the hunks above only), `sdk/src/component.ts` / `sdk/src/index.ts` (re-export lines only), `sdk/src/componentImports.ts` (append only), `core-catalog/package.json` (one exports entry), `core-catalog/src/registry/widgets.ts` (the three hunks), new `core-catalog/src/shared/ui/session-runs/index.ts`, new `core-catalog/components/shared/session-runs/*`, new `sdk-tests/coreSessionRuns.test.ts`, `sdk-tests/coreComponentSources.test.ts` + `sdk-tests/hostElements.test.ts` (list lines only), `guides/widgets.md` (only via `npm run gen:widget-parts`).

## Out of scope
Filters, cancel, live progress, wire/replay, lineage trees, cross-session lists, Statistics, settings, any app file, NOMENCLATURE/STYLE-GUIDE/docs (the supervisor writes those), the digest re-pin.

## Stop and ask (in your report) when
A new name beyond the ones listed here seems needed; a published name would have to change; a test outside this list breaks because of your change.

## How to run tests — ALWAYS inside the memory cap, one group at a time, logging to a file, never bare, never piped into `head`
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub-sdk && timeout 900 npx tsx --test sdk-tests/coreSessionRuns.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-R-w1-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-R-w1-t.log'
```
then `grep -E "^# (pass|fail)|not ok|test-exit" <log>`. Groups: (1) `coreSessionRuns.test.ts`; (2) `coreComponentSources.test.ts hostElements.test.ts coreRoutineLog.test.ts widgetSections.test.ts`; (3) `coreCatalog.test.ts`. Typecheck the packages you touched in the same cap with MemoryMax=12G and `--max-old-space-size=8192`: `cd /home/jody/github/serene-pub-sdk/sdk && npx tsc --noEmit -p .` and the same in `core-catalog` (check each package.json for its tsc project; report errors in YOUR files only — the cv programme may have its own in flight).

## Done means
Groups 1–2 green (group 3: report the digest result), tsc clean in your files, `guides/widgets.md` regenerated. Report: exported names + signatures, changed files, test results (counts), the digest old/new if moved, anything noticed but not done.
