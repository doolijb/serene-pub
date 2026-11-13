# BRIEF — vn-C-w3: the Dialogue box component, its three switches in Messages' files, its component test

Supervisor: lane `vn-C`. Repo: **`/home/jody/github/serene-pub-sdk`** (the SDK). Plan: `/home/jody/github/serene-pub/plans/PLAN-visual-novel-layout-2026-11-11.md` — read §0 (owner R1–R6), §1.2, §1.3, §5, §6 before you start: they are the behaviour.

Already built by the lane (read, don't change): the declaration `id: 'dialogue-box'` in `core-catalog/src/registry/widgets.ts` (settings `autoRead` boolean default false; `readingSpeed` integer 80–600 default 220; `scopes: ['session:full']`; `maxInstances: 1`; `reads: ['layout','messages','actions','settings','viewer','locale']`; component entry `components/shared/dialogue-box/dialogue-box.ts`); the pure modules `core-catalog/src/shared/ui/conversation/readingPlace.ts` (exported through `@serene-pub/core-catalog/conversation`: `settlePlace`, `nextLinePlace`, `queuedSummary`, `queuedText`, `isReadLine`) and `core-catalog/components/shared/messages/readingPace.ts` (`lineSpeechPhase`, `heardAfter`, `readOnState`, `readingTimeMs`, `HeardPlayback`). Read both modules first; the component is a thin shell over them.

## THE HARD RULE

**The Messages widget's behaviour, settings, markup and tests do not change** (owner R5, 2026-11-11: "The visual novel should be a different widget … Not overload the normal widget"). You may *import and render* `SessionMessage.svelte` and `createConversation`. Inside `core-catalog/components/shared/messages/` you make **exactly** the three additive edits in §2 below — optional switches that Messages never passes — and nothing else. You do not edit any existing test. If a goal below cannot be met without another change in `messages/`, stop and report.

## Goal

### 1. The component — `core-catalog/components/shared/dialogue-box/` (new), laid out as `turn-line/` is

Read `core-catalog/components/shared/turn-line/` (all four files) and copy its shape:

- **`dialogue-box.ts`** — `export default svelteComponent(DialogueBoxMount)` with a doc comment like `turn-line.ts`'s.
- **`DialogueBoxMount.svelte`** — as `TurnLineMount.svelte`: `setContext(WIDGET_CONTEXT_KEY, widgetRefFromComponent(untrack(() => ctx), { id: "dialogue-box", instanceId: "dialogue-box", title: "Dialogue box" }))`, `<WidgetBoundary {ctx}><DialogueBoxWidget /></WidgetBoundary>`.
- **`settings.ts`** — `DialogueBoxSettings { autoRead: boolean; readingSpeed: number }`, `DIALOGUE_BOX_DEFAULTS = { autoRead: false, readingSpeed: 220 }` (doc: "The declared defaults (`CORE_WIDGETS`, the `dialogue-box` entry)"), `readDialogueBoxSettings(raw)`: `autoRead` is `raw.autoRead === true`; `readingSpeed` a finite number rounded and clamped to 80–600, else 220.
- **`DialogueBoxWidget.svelte`** — the widget. Specification:

**Conversation and rows.**
```ts
const ctx = useWidgetContext()
const conversation = ctx ? setConversation(createConversation(ctx, { noSelection: true })) : null
const settings = $derived(readDialogueBoxSettings(ctx?.current.settings.v1 as Record<string, unknown> | undefined))
// The main channel's rows only (plan §1.2): `laneOf` from ../messages/sceneMarks
const rows = $derived(conversation ? conversation.rows.filter((m) => laneOf(m.channel) === "main") : [])
const ownId = $derived(conversation?.dossier?.ownNewestMessageId ?? null)
```

**The reading place** — client-only, per mount, never stored.
```ts
let place = $state<number | null>(null)
$effect(() => {
	const r = rows
	const own = ownId
	const was = untrack(() => place)
	const next = settlePlace(r, was, own)
	if (next !== was) place = next
})
function nextLine() { place = nextLinePlace(rows, place, ownId) }
```
Never read `place` inside an effect without `untrack` when that effect writes it (project rule: "Never read state a method writes inside an effect-called store method without `untrack`").

**The shown row.** `shown = rows.find((r) => r.id === place) ?? null`; `shownIndex = rows.indexOf(shown)`; `isNewest = shown !== null && shownIndex === rows.length - 1`.

**Nothing to draw.** Draw **nothing at all** (no root, no placeholder text) when: no `conversation`, `conversation.noLane`, `conversation.dossier === null` (the scope is not granted or has not arrived — never draw a bare row), or `shown === null` (no lines). Owner R10 (2026-11-05): "don't have most widgets show placeholder text when there's nothing to show. Messages being an obvious exception".

**show-line.** The host request `'show-line'` `{ messageId: number | null }` (core-only, already declared in `sdk/src/widgets.ts`): the place when it is behind the newest row, else `null`.
```ts
const shownLine = $derived(place !== null && rows.length > 0 && place !== rows[rows.length - 1]!.id ? place : null)
let sent: number | null | undefined = undefined   // plain, not $state
$effect(() => {
	const v = shownLine
	if (v === sent) return
	sent = v
	void conversation?.request("show-line", { messageId: v })
})
```
So the first value is sent at mount (even `null`), then only on change — never per streamed chunk, never the same value twice in a row.

**The queue.** `summary = queuedSummary(rows, place, nameOf)` with `nameOf = (r) => conversation.line(r.id).speaker.name || (r as MessageV1).speakerLabel || null`; `queued = summary.lines > 0 || summary.writing !== null`; `queuedLabel = queuedText(summary)`.

**Per-line facts** — one `$state` record, reset whenever the place moves to another line:
```ts
let track = $state({ id: null as number | null, shownAt: 0, timerFrom: 0, settledAt: null as number | null, audioSeenAt: null as number | null, heard: "none" as HeardPlayback, seenLive: null as string | null })
```
One `$effect` reads `place`, `shown`, `hasAudio`, `pendingRaw`, `conversation?.dossier?.liveRunIds`, and inside `untrack`: if `track.id !== place` replace `track` with a fresh record (`shownAt = timerFrom = Date.now()`); then set `settledAt = Date.now()` the first time `shown && !shown.isGenerating`; `audioSeenAt = Date.now()` the first time `hasAudio`; `seenLive = pendingRaw.runId` when `liveRunIds` includes it.

**Speech facts** (reuse `../messages/spokenLine` and `../messages/mediaStrip`; do not re-derive):
```ts
const dossier = $derived(conversation?.dossier ?? null)
const spoken = $derived(shown ? spokenOf(shown.metadata) : null)
const hasAudio = $derived(!!shown && !!spoken && !!spokenAudioItem(mediaStripItems(shown.parts, shown.activeRevisions ?? { "0": 0 })))
const pendingRaw = $derived(shown ? spokenPendingOf(shown.metadata) : null)
const pending = $derived(isSpeaking(pendingRaw, dossier?.liveRunIds, track.seenLive) ? pendingRaw : null)
```

**Hearing the line's player.** The `<audio>` inside the row is a host element whose `play`, `pause` and `ended` arrive in the worker as **bubbling** `CustomEvent`s (`component-client/src/workerRuntime.ts:133`). So put `onplay`, `onpause`, `onended` on the line's wrapper element and set `track.heard = heardAfter(track.heard, e.type)`. Do **not** add a callback to `SpokenLine` for this.

**Read on by itself.**
```ts
let held = $state(false)          // the bar's Pause; per mount, not stored
let now = $state(Date.now())
$effect(() => {                   // tick only while something can move
	if (!settings.autoRead || !queued || held) return
	now = Date.now()
	const t = setInterval(() => (now = Date.now()), 200)
	return () => clearInterval(t)
})
const phase = $derived(lineSpeechPhase({ readAloud: readAloudOf(dossier), playback: spokenPlaybackOf(dossier), canSpeak: dossier?.speech?.canSpeak !== false, pendingAt: pending?.at ?? null, hasAudio, audioSeenAt: track.audioSeenAt, heard: track.heard, settledAt: track.settledAt, now }))
const readOn = $derived(settings.autoRead ? readOnState({ phase, queued, held, timerFrom: track.timerFrom, settledAt: track.settledAt, readingMs: readingTimeMs(shown?.content ?? "", settings.readingSpeed), now }) : { due: false, timer: null })
$effect(() => { if (readOn.due) untrack(() => nextLine()) })
function togglePause() { if (held) track.timerFrom = Date.now(); held = !held }
```
(Releasing Pause restarts the reading timer, so a long pause does not jump straight to the next line.) Timers are fine in the UI worker; there is no `requestAnimationFrame`, and a widget cannot call `play()`.

**Markup** (parts are the plan's, exactly: `dialogue-box.root`, `.line`, `.bar`, `.queued`, `.next`, `.progress`, `.pause`; no classes, no inline styles, no look — lane vn-B writes the CSS):
```svelte
{#if conversation && !conversation.noLane && conversation.dossier && shown}
	<div data-widget-part="dialogue-box.root">
		{#key shown.id}
			<div data-widget-part="dialogue-box.line" data-arrive={arrive ? "" : undefined} onplay={hear} onpause={hear} onended={hear}>
				<SessionMessage msg={shown} index={shownIndex} isLastMessage={isNewest} place={{ n: shownIndex + 1, of: rows.length }} atReadingPlace />
			</div>
		{/key}
		{#if queued}
			<!-- the whole bar is Next line's target (★5); the button is the accessible control -->
			<div data-widget-part="dialogue-box.bar" onclick={barClick}>
				{#if queuedLabel}<span data-widget-part="dialogue-box.queued" role="status">{queuedLabel}</span>{/if}
				{#if readOn.timer}<sp-progress data-widget-part="dialogue-box.progress" value={readOn.timer.elapsed} max={readOn.timer.total} label="Time until the next line"></sp-progress>{/if}
				{#if settings.autoRead}<button type="button" data-widget-part="dialogue-box.pause" aria-pressed={held} onclick={togglePause}>Pause</button>{/if}
				<button type="button" data-widget-part="dialogue-box.next" onclick={nextLine}>Next line</button>
			</div>
		{/if}
	</div>
{/if}
```
- `arrive` (the **slide-in hook** for the app's CSS): true for every line shown after the first line this mount drew; the first line (the one on screen at mount) carries no `data-arrive`. Keep the first id in a plain variable.
- `barClick`: a click whose target is inside a `<button>` (Pause or Next line) is left to that button; any other click on the bar is `nextLine()`. Walk `parentNode` up to the bar yourself (the worker DOM may lack `closest`). Silence the two Svelte a11y warnings for the bar with a `<!-- svelte-ignore ... -->` comment naming exactly those codes; keyboard users press the real button.
- Nothing queued → no bar at all (the timer only runs when something is queued). Use `conversation.t("Next line")` / `conversation.t("Pause")` / `conversation.t("Time until the next line")` if neighbouring widgets translate fixed strings that way (check `TurnLine.svelte`); otherwise plain text.
- A doc comment at the top of the script, in the house style (see `TurnLineWidget.svelte`), stating the charter: owns the reading place and the pace of reading; not the log (Messages), writing (the Composer), who speaks next, or speech.

### 2. The three additive switches in `components/shared/messages/` (Messages passes none of them)

a) **`conversation.svelte.ts`** — in `ConversationOptions` add:
```ts
	/**
	 * 🚧 Dialogue box only (PLAN-visual-novel-layout §6 answer 1): no selection
	 * for a summary — `select.start` does nothing and a row's menu leaves out
	 * *Select for summary* — since the selection bar, the only way out of a
	 * selection, is MessagesWidget's (2026-11-05 D7).
	 */
	noSelection?: boolean
```
In `createConversation` read it once (`const noSelection = !!options.noSelection`, beside `followTarget`). In `select`: add `get offered() { return !noSelection }` (doc: "Whether this copy offers selecting lines for a summary; false only for a Dialogue box.") and make `start` return at once when `noSelection`. Nothing else in the file.

b) **`MessageControls.svelte`** — the *Select for summary* button's condition (around line 316, `{#if conv.dossier?.writes.lore && !msg.isGenerating}`) gains `&& conv.select.offered`. Nothing else.

c) **`SpokenLine.svelte`** and its pass-through in **`SessionMessage.svelte`** — autoplay eligibility for the shown line (plan §1.3: "A line is eligible to play aloud when it becomes the line being read, under the existing playback and Read aloud switches").
- `SpokenLine.svelte` `Props`: add
```ts
		/**
		 * 🚧 Dialogue box only (PLAN-visual-novel-layout §1.3): this line has just
		 * become the box's reading place, so its audio may play on its own as the
		 * newest line's does — under Make and play and playback `auto`, once,
		 * spoken since this page opened — newest or not, fresh or not.
		 */
		atReadingPlace?: boolean
```
  destructured `atReadingPlace = false`. In `decide`, replace the single expression so that with `atReadingPlace` false it is **exactly** the old one:
```ts
		const yes =
			spokenPlayback === 'auto' &&
			readAloud === 'play' &&
			(isLastMessage || atReadingPlace) &&
			!played.has(id) &&
			!!spoken &&
			(isFresh(spoken) || atReadingPlace) &&
			spokenSinceLoad(spoken)
```
  Add one sentence to the file-head comment's **Autoplay** bullet: "A Dialogue box's shown line may too (`atReadingPlace`)." Nothing else.
- `SessionMessage.svelte`: add to `Props` `atReadingPlace?: boolean` with a one-line doc ("🚧 Dialogue box only: passed to the spoken line (`SpokenLine`'s `atReadingPlace`). Messages never sets it."), destructure it `= false`, and pass `{atReadingPlace}` on the `<SpokenLine …>` element. Nothing else.

### 3. The parts list in the widgets guide

After the component exists: `cd /home/jody/github/serene-pub-sdk && npx tsx scripts/gen-widget-parts.ts`, then run `sdk-tests/widgetParts.test.ts`. Report the `git diff --stat guides/widgets.md` line (the diff will also carry other lanes' uncommitted parts — that is expected; do not edit the guide by hand).

### 4. The component test — `sdk-tests/coreDialogueBoxComponent.test.ts` (new)

Model: `sdk-tests/coreTurnLineComponent.test.ts` (dossier and rows fixtures, `mountComponent` from `./harnessGuard.js`) and the spoken-line tests in `sdk-tests/coreConversationComponent.test.ts` (around line 2096: `mountSpoken`, and `view.dispatch(selector, 'play' | 'pause' | 'ended', { currentTime, duration, paused })`). Mount from source:
```ts
mountComponent({
	root: CORE_CATALOG,
	entry: 'components/shared/dialogue-box/dialogue-box.ts',
	// The built dist has not the reading place yet: the plain half from source, as coreScenePortraitsSpeaker aliases its own.
	alias: { '@serene-pub/core-catalog/conversation': resolve(CORE_CATALOG, 'src', 'shared', 'ui', 'conversation', 'index.ts') },
	owner: 'core',
	grants: ['session:full'],        // NOT coreConversation: it is a panel widget, granted by its declared scope
	reads: [...decl.reads],          // the declaration's
	timeoutMs: 60_000,
	requests: () => undefined,
	context: { session: { id: 1, name: 'Proof' }, messages: rows, settings, viewer: { userId: 1, isAdmin: false, isGuest: false }, scoped: { session_full: dossier } },
} as never)
```
Declaration and settings read from `'../core-catalog/src/index.js'` and `'../core-catalog/components/shared/dialogue-box/settings.js'`. Tests (each mount `try … finally { await view.unmount() }`, `{ timeout: 120_000 }`):

1. **Declaration**: title, component, `maxInstances: 1`, `scopes: ['session:full']`, reads, settings keys `['autoRead', 'readingSpeed']`, `autoRead.default === false`, `readingSpeed` `{ min: 80, max: 600, default: 220, showIf: { field: 'autoRead', equals: true } }`, listed in `CORE_COMPONENTS` and `CORE_VIEW_ONLY_COMPONENTS`; `readDialogueBoxSettings` table (junk, clamp, round, defaults).
2. **One line drawn**: three rows (persona line, two character lines) → exactly one `messages.message` inside `dialogue-box.line`, and it is the newest; `view.refused` empty; ids prefixed (`view.idPrefix` not `''`).
3. **Nothing drawn with no lines**, and **nothing drawn without the grant** (`grants: []`): no `dialogue-box.root`, and the box's text is empty.
4. **Hold, queue, Next line**: mount with rows [1 user, 2 Osk]; push rows adding 3 (Bren) → the line still shows 2; the bar reads `Bren has replied`; push 4 (Osk again) → `2 more lines`; click `dialogue-box.next` → line 3; click the bar's queued text → line 4 (the whole bar is the target); bar gone.
5. **Retry only on the true newest row**: the shown message carries `data-msg-newest` only when it is the newest row (behind → absent; after Next line onto the newest → present).
6. **No Select for summary**: with `writes.lore: true`, open the shown row's ⋮ menu (find how the Messages tests open it) and assert no option reads *Select for summary*; then mount **Messages** (`entry: 'components/shared/messages/messages.ts'`, `coreConversation: true`, same alias) with the same fixtures and assert its menu still offers it (Messages unchanged).
7. **Sending catches you up**: place held on 2 with 3 queued; push rows with 5 (user) and 6 (Osk) and a dossier with `ownNewestMessageId: 5` → the line shows 6. And an own id that is not one of the box's rows (a row on `channel: 'sanctum'`) moves nothing.
8. **show-line sent on change only**: at mount one `show-line` `{ messageId: null }`; a queued row → `{ messageId: 2 }`; pushing a streamed update of the queued row (same ids, changed `content`, `isGenerating: true`) sends nothing new; Next line to the newest → `{ messageId: null }`.
9. **Read on by itself, no voice — the timed bar**: settings `{ autoRead: true, readingSpeed: 600 }`, a short settled line held with one queued → `dialogue-box.progress` present with `max` > 0 and `dialogue-box.pause` present; within ~4 s (poll with a small sleep + `view.settle()`) the line moves on by itself.
10. **Pause**: same setup, press `dialogue-box.pause` at once → `aria-pressed="true"`, no progress; wait past the reading time → still on the line; press again → it moves on after the reading time.
11. **Waits while speaking, advances on ended and not on pause**: dossier `readAloud: 'play'`, `autoRead: true`, `readingSpeed: 600`. (a) shown line with a live pending marker (`metadata: { spoken: { pending: { runId: 'run-1', at: <now ISO> } } }`, `liveRunIds: ['run-1']`) → after > 3 s still on it. (b) shown line with spoken audio (copy the parts and `metadata.spoken` fixture shape from the Messages spoken tests): dispatch `play` → wait → still there; dispatch `pause` → wait past the reading time → still there; dispatch `ended` → it moves on.
12. **The shown line is eligible to autoplay**: `readAloud: 'play'`; rows [1, 2 held, 3 queued with fresh audio — `spoken.at` = an ISO time taken after mount]; click Next line → the `messages.spoken-audio` element of line 3 carries `autoplay`. (Messages' own autoplay tests stay as they are.)

Keep test time down: reuse mounts within a test where the steps are sequential; poll instead of fixed long sleeps.

## Files owned

- `core-catalog/components/shared/dialogue-box/` (new: the four files)
- `core-catalog/components/shared/messages/conversation.svelte.ts`, `MessageControls.svelte`, `SpokenLine.svelte`, `SessionMessage.svelte` — **the §2 edits only**
- `guides/widgets.md` — only through the generator (§3)
- `sdk-tests/coreDialogueBoxComponent.test.ts` (new)

## Files readable

Anything in both repos.

## Out of scope

Any other edit in `messages/` (not `MessagesWidget.svelte`, `SessionContainer.svelte`, `TurnLine.svelte`, `readingPace.ts`, `spokenLine.ts`); editing any existing test; the registry, layouts, genres (done); the app repo; CSS; `npm run sdk:build`. No new setting, no stored state, no keyboard shortcut beyond the buttons' own, no Hide control, no second line of history, no channel setting.

## Stop and ask when

The Messages behaviour would change; a §2 edit is not enough; the harness cannot deliver `session_full` with `grants: ['session:full']`; the bubbling `play`/`pause`/`ended` do not reach the wrapper; a plan rule cannot be met. Report the evidence instead of working around it.

## Done means

From `/home/jody/github/serene-pub-sdk/sdk-tests`, in a capped scope (heavy DOM tests):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test --test-concurrency=2 coreDialogueBoxComponent.test.ts widgetParts.test.ts readingPlace.test.ts readingPace.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/476d8c15-b0f2-4ccb-8d34-6c7e4d1cbdb8/scratchpad/vn-C-w3-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/476d8c15-b0f2-4ccb-8d34-6c7e4d1cbdb8/scratchpad/vn-C-w3-tests.log'
```
then, **unedited**, the Messages proof:
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test --test-concurrency=2 coreConversationComponent.test.ts coreTurnLineComponent.test.ts spokenLine.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/476d8c15-b0f2-4ccb-8d34-6c7e4d1cbdb8/scratchpad/vn-C-w3-messages.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/476d8c15-b0f2-4ccb-8d34-6c7e4d1cbdb8/scratchpad/vn-C-w3-messages.log'
```
(baseline before your work: 77 pass, 0 fail). Read the logs with `grep -E "^ℹ (tests|pass|fail)|test-exit|^✖|not ok"` — never pipe a run into `head`. Then `npx tsc --noEmit -p .` (report errors in your files; report others without fixing). `npx prettier --check` each file you wrote or edited (say if a neighbour was already unclean). Never `prettier --write` on a directory; never `--write` an existing `messages/` file (it would reformat Messages' markup).

## Report

Final message: files changed; for each `messages/` file the exact lines added/changed (a unified diff of just your hunks); each test file's pass/fail counts; the Messages proof counts; anything you stopped on; **Noticed, not done**.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You never run `sdk:build` in this task.)
- Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write` on a directory.
- Never pipe a test run into `head`. Heavy SDK DOM tests run in a capped scope (the commands above).
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`. `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. Never read state a method writes inside an effect-called store method without `untrack`. Widget components run in a UI worker: timers are fine (`setTimeout` / `setInterval`), there is no `requestAnimationFrame`, and a widget cannot call `play()`.
- `socket.off(event)` with no handler removes every listener — not relevant here, but never call it.
- It is a **session**, never a *chat*.
- Scratch files start with `vn-C-`.
