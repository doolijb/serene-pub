# BRIEF — ui-working worker 2 — the turn line says what runs in the background (SDK side)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You do not run `sdk:build` at all in this brief: the supervisor runs the one build. Your component test compiles the turn line from source and does not need it.)

Repo: `/home/jody/github/serene-pub-sdk` (SDK). Use absolute paths. **Never `git checkout` / `restore` / `stash` / `clean` in this repo — most of it is uncommitted.** Never `kill -9`. Never `prettier --write` on a directory.

## Goal

The owner (2026-11-13): *"when tasks/routines are running in the background, there's no indicator, the status still says 'waiting for a message or pick who speaks next'"*. The turn line's left half learns to say so. The rule, as ruled for this build:

> While a routine's run that has lasted longer than a moment, or a scene's summary, is under way for a session, the turn line's left half says so in one short line: *Summarizing ‹scene›*, *‹routine name› is running*, or for more than one *2 things are running in the background* with the list in the line's tooltip. A reply being written, a failed run and *Review N changes* always win the left half; the background line shows only when none of those does. The right half is unchanged and nothing is blocked: the line informs and offers no Stop.

The host (another worker, app side) supplies routine names through a new optional dossier field; it sends a name only once a run has lasted past its delay and clears it when the run ends or parks, so the widget applies no timer of its own.

## What exists (read these)

- `core-catalog/components/shared/messages/TurnLine.svelte` (261 lines, read it whole): `status` (~98–107: live → *X is thinking* or the row's status; failed → *Last run failed · …*), the review links (`waiting`, `toDecide`, `reviewLabel`, `hasLinks` ~109–137), the left half markup (~146–209: the pill is an `sp-popover` trigger when `hasLinks`, else a plain `span`), the right half (~210–260, **do not change it**).
- `sdk/src/sessionDossier.ts`: `SessionDossierV1` (~214); `ConversationSceneV1.summaryStatus` (~131, `'running'` while a summary runs) and `name` (~104, null for an unnamed scene); `isOwner`; `liveRunIds` (~296–303) as the pattern for a run-derived optional field.
- `core-catalog/components/shared/messages/SceneDivider.svelte` ~47: a scene's shown name is `scene.name?.trim() ? scene.name : "Scene"`.
- `sdk-tests/coreConversationComponent.test.ts`: the harness for mounting the turn line — `dossier` fixture (~35–70), `row` (~19), `mountWidget('turn-line/turn-line.ts', settings, dossier)` (~1052–1074), `view.query/queryAll/click/push('scoped', { session_full })/settle/unmount`, `view.requested`. Copy what you need into your own new test file; do not edit that file.

## Build

1. **The dossier field** (`sdk/src/sessionDossier.ts`, beside `liveRunIds`): one optional, additive field
   ```ts
   /**
    * 🚧 The names of this session's routines running now, one per run, as Routines names them —
    * a run shows only once it has lasted past the host's short delay, and never while it is
    * parked at a review gate. The turn line's left half says them when nothing else holds it.
    * Names only, never a run id. Absent reads as none.
    * @experimental
    */
   runningRoutineNames?: string[]
   ```
   (Adjust wording if you must; keep it present tense and keep the facts.)
2. **TurnLine.svelte** — left half only:
   - `backgroundItems` (derived): first each scene in `dossier.scenes` with `summaryStatus === 'running'`, **only when `dossier.isOwner`** (a member's scene list is not kept current for summaries), as `Summarizing ‹name›` with the scene's trimmed name, or `Summarizing a scene` when it has none; then each of `dossier.runningRoutineNames ?? []` as `‹name› is running`.
   - `backgroundLine` (derived string): `""` when there are no items, or when `status` is non-empty, or when `hasLinks` (a live reply, a failed run and Review always win); the one item's text when there is one; else `` `${n} things are running in the background` ``.
   - Render the left-half wrapper (`turn-line.run`) when `status || hasLinks || backgroundLine`. Existing branches stay exactly as they are. When neither `status` nor `hasLinks` and `backgroundLine` is set:
     - **one item:** a `span` exactly like the existing plain pill (`messages.turn-line-status turn-line.status` with `messages.turn-line-status-text turn-line.status-text` inside), `title` = the line, and **no** `data-turn-state`.
     - **several:** the same `sp-popover` pattern as the Review pill (`placement="top-start"`, `label="Running in the background"`, the shared `panelOpen`), its trigger button with the same parts and chevron, `title` = the items joined with `"\n"`; its panel (`messages.turn-line-panel turn-line.panel`) holds a `<ul data-widget-part="turn-line.background-list">` with one `<li>` per item (plain text). No other new part name, no new `data-*` value.
   - No Stop, no link, no progress for background work. No `aria-live` / `role="status"`: the turn line has no live region, and a text that has not changed is not re-rendered (a derived string, so an equal string leaves the DOM alone).
   - Update the head comment's left-half bullet with one sentence for the background line and its precedence. Copy: sentence case, no ellipsis-only text.
3. Nothing else in the SDK repo. (The supervisor writes `INTEGRATING.md` and the app docs.)

## Rules you must follow (quoted)

- STYLE-GUIDE §10: *"Sentence case everywhere"*; *"No filler: a screen with nothing to say says nothing"*; *"Counts live in the copy where they help"*.
- STYLE-GUIDE §6.16 / the turn line's own head: *"The turn line's parts (`messages.turn-line*`, STYLE-GUIDE §6.16): no look here; the default widget stylesheet draws them."* — no inline styles, no classes.
- SDK CLAUDE.md: *"Core components (`core-catalog/components/**`, `shared/ui/**`) never import rulesets, compendium JSON or registries"*; *"A linked package that imports `svelte` pulls a second Svelte's types into the app's check … never add a `svelte` import to a package that has none"*.
- Members never see a connection, a model or a run id.
- Comments state the rule, not the story: never "no longer", "used to", "previously", "deliberately not", or a story of how it came to be.
- It is a **session**, never a *chat*.
- Spoken-line runs are out of scope: *Mira is speaking…* comes through the session banners; do not touch it.
- NOMENCLATURE R3: qualify, never a bare noun. Use only the names given here (`runningRoutineNames`, `backgroundItems`, `backgroundLine`, part `turn-line.background-list`). Need another public name: stop and ask in your report.

## Files owned (edit only these)

- `/home/jody/github/serene-pub-sdk/core-catalog/components/shared/messages/TurnLine.svelte`
- `/home/jody/github/serene-pub-sdk/sdk/src/sessionDossier.ts` (the one field)
- New: `/home/jody/github/serene-pub-sdk/sdk-tests/turnLineBackground.test.ts`

## Out of scope

The right half, *Waiting for a message — or pick who speaks next*, `NextCharacterBlock`, the Turn order widget; a Stop; progress; styles in the app's `widgets.css`; spoken-line runs; who may see scene summaries beyond the `isOwner` gate above.

## Stop and ask when

A published SDK name or widget field would have to change (the optional field above is additive); you need a new name not listed; the right half would have to change.

## Done means

`sdk-tests/turnLineBackground.test.ts`, mounting `turn-line/turn-line.ts` with dossier variants, proves:
- **none:** no background items → no `turn-line.run` at all (as today);
- **one routine:** `runningRoutineNames: ['Note what changed']` → the status text reads `Note what changed is running`, its `title` the same, no popover trigger;
- **one summary, owner:** a scene `{ name: 'The vault', summaryStatus: 'running' }` → `Summarizing The vault`; an unnamed one → `Summarizing a scene`;
- **member:** the same running scene with `isOwner: false` → nothing on the left;
- **several:** one running scene and one routine → `2 things are running in the background`, `title` lists both lines, and clicking the pill opens the panel whose `turn-line.background-list` holds both;
- **precedence:** with routine names present, a live reply row (`isGenerating: true`) shows its thinking status instead; a failed reply (`error: { message: 'boom' }`) shows `Last run failed · boom`; a waiting review (`state.waiting` with one proposal — copy a proposal shape from the existing tests or `StateProposalList`) shows `Review 1 change`;
- **right half unchanged:** the `turn-line.next` part renders the same with and without background items (compare its text);
- **no re-render:** re-pushing the dossier with equal names leaves the status text unchanged, and if the harness exposes node identity (the same element object from `view.query` before and after), assert it; say in your report which you could assert.

Run it **only** inside a capped scope (a failing assert on a happy-dom element has OOM-killed VS Code):
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test turnLineBackground.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/ui-working-w2-sdk.log 2>&1"` — never two runs at once, never piped into `head`; then read the log. Also `npx prettier --check` each changed file (from `/home/jody/github/serene-pub-sdk`). Do not run `sdk:build`, `sdk:test`, the app's `tsc` or `check`.

## Report

Return as your final message: changed files; each decision you made; tests run with results (counts); anything you could not do; **Noticed, not done**.
