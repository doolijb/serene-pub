# BRIEF playtest3-T2-w2 — the badge on the narrator's own line, and the label *Narrator's turn*

Lane `playtest3-T2`, worker 2 (SDK + client words + docs). Supervisor reads your report. Report: put your full report in your final message (changed files in both repos, diff summary, tests run with exact command and pass/fail counts, anything you could not do, Noticed-not-done).

Context: worker 1 makes the host stamp `metadata.turnCause = { via: "unprompted", every: n }` (n = 1, 2 or 3) on a narration written on the narrator's unprompted turn. You draw it, and rename the setting's label. Both names are owner-ruled (2026-11-04, Rulings round 2): the metadata key **`turnCause`** and the widget part **`messages.message-badge-cause`**; the label **Narrator's turn**. No other new name.

## 1. SDK type — `/home/jody/github/serene-pub-sdk/sdk/src/widgets.ts`, `interface MessageMetadataV1` (~line 469)
Add, after `tableLine` (additive, optional):
```ts
	/**
	 * 🚧 Why the line was written without anyone asking (★T-1, 2026-11-04):
	 * the narrator's own turn, which the session's *Narrator's turn* setting
	 * gives it every `every` rounds. Stamped by the host at the write, never
	 * by a pipeline; absent on every other line. Drawn as the
	 * `messages.message-badge-cause` badge.
	 */
	turnCause?: { via: 'unprompted'; every: number }
```
(SDK style: single quotes, tabs — match the file.)

## 2. The badge — `/home/jody/github/serene-pub-sdk/core-catalog/components/shared/messages/SessionMessage.svelte`
Inside `<span data-widget-part="messages.message-badges">` (~line 619), after the `msg.isHidden` badge and before the vectors block, draw — only when `msg.metadata?.turnCause?.via === "unprompted"` with a positive integer `every`:
```svelte
<button
	type="button"
	data-widget-part="messages.message-badge messages.message-badge-cause"
	onclick={() => void conv.request("pick-turn", {})}
>
	<sp-icon name="book-open-text" size="14"></sp-icon>
	<span data-widget-part="messages.message-badge-text">{causeText}</span>
</button>
```
with a short comment above it (the narrator's own turn, P1: the line says why it was written; the press opens the turn picker, which holds the setting — a member sees the badge and the picker draws no control for them). `causeText` is a `$derived`: `Narrator's turn (every round)` for 1, `Narrator's turn (every 2nd round)` for 2, `Narrator's turn (every 3rd round)` for 3, and the English ordinal for any other positive integer (`every 4th round`, `every 21st round`, `every 11th round`). Keep the helper local to the component (no new export). This component's file uses double quotes; match it. The markup carries NO look (STYLE-GUIDE §6.16: "A session widget's markup carries **no look**: no spacing, type, colour, radius or `preset-*` classes. Its elements carry **widget parts**") — no classes, no style attributes. Use exactly `conv.request("pick-turn", {})` — the same request `TurnLine.svelte:250` sends for *Someone else*; never a new request kind. Accessibility (STYLE-GUIDE §9): "Every interactive element is a real `button` … with an accessible name" — the visible text is its name; no `aria-label` needed. Do not touch any scene code in this file (lane S5 owns `SceneDivider.svelte` and scenes; the `messages.message-badge-scene` part, if you see it, is not yours).

## 3. The SDK test — new file `/home/jody/github/serene-pub-sdk/sdk-tests/coreMessageTurnCause.test.ts`
Mount core's conversation the way `sdk-tests/coreConversationScenes.test.ts:1-130` does (copy its `row` / `line` / `dossier` / `mount` helpers, trimmed: `scenes: []`, `scened: []`; use `mountComponent` from `./harnessGuard.js`, `timeoutMs: 60_000`). Cases (`node:test` + `node:assert/strict`):
- a narration row (`role: 'assistant'`, `characterId: null`, `isNarratorResponse: true`, `metadata: { turnCause: { via: 'unprompted', every: 2 } }`) draws `[data-widget-part~="messages.message-badge-cause"]` whose text is `Narrator's turn (every 2nd round)`; `every: 1` reads `Narrator's turn (every round)`.
- pressing it sends one `pick-turn` request with `{}` params (`view.requested.filter((r) => r.kind === 'pick-turn')`).
- a row without `turnCause`, and a row with `turnCause: { via: 'something-else', every: 2 }`, draw no such badge.
- with `isOwner: false` in the dossier the badge is still drawn (members see it).
Unmount/close each view as the scenes test does. Keep it to these few mounts (DOM tests are heavy).

## 4. The label — `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/genres.ts` `NARRATOR_INTERJECTIONS_FIELD` (~line 244-270)
`label: { en: "Narrator asides" }` → `label: { en: "Narrator's turn" }`; the doc comment's heading `🚧 **Narrator asides**` → `🚧 **Narrator's turn**` (add "(the label was *Narrator asides* until 2026-11-04, ★T-2; the key `narratorInterjections` stays)"). Description unchanged. The stored key `narratorInterjections` and every enum key stay exactly as they are (R1: the stored key is not the label).
`/home/jody/github/serene-pub-sdk/sdk-tests/coreNarratorTurns.test.ts`: in the first test add `assert.equal(f.label.en, "Narrator's turn")` and put the label in the test title.

## 5. Client words — `src/lib/client/components/sessionPage/turnPickerCadence.dom.test.svelte.ts`
The fixture `label: "Narrator asides"` → `"Narrator's turn"`, every `"Narrator asides"` in its expectations and the `aria-label="Show Narrator asides options"` selectors → `Show Narrator's turn options` (careful with the apostrophe inside the single-quoted CSS selector string — use a template or double-quoted JS string so the selector is `button[aria-label="Show Narrator's turn options"]`), and the header comment. `src/lib/client/components/sessionPage/TurnPicker.svelte`: words only — it currently contains no *Narrator asides* text; change nothing there unless a comment says it (report what you found).

## 6. Docs (re-read each file immediately before editing; lane S5 edits `docs/sessions.md` § Scenes at the same time — touch only line ~136)
- `docs/genre-story.md` ~line 65: every **Narrator asides** → **Narrator's turn** (keep the sentence otherwise), and add ONE sentence at that paragraph's end: `A line the narrator writes on its own turn says so in its header, *Narrator's turn (every 2nd round)*; pressing that opens **Someone else**, where the session's owner changes how often.` Also ~line 79: **Narrator asides** → **Narrator's turn**.
- `docs/group-sessions.md` ~line 110: **Narrator asides** → **Narrator's turn**.
- `docs/sessions.md` ~line 136: **Narrator asides** → **Narrator's turn**.

## Tests (run each in a capped scope; read the log after; never pipe into `head`)
SDK (targeted files only, from `sdk-tests`, NOT `npm test`):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test coreNarratorTurns.test.ts coreMessageTurnCause.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-T2-w2-sdk-1.log 2>&1; echo exit=$?'
```
App:
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/sessionPage/turnPickerCadence.dom.test.svelte.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-T2-w2-app-1.log 2>&1; echo exit=$?'
```
(increment suffixes per run). Then `npx prettier --check` on each changed file (from the repo it lives in); report results, and say which failures were there before you.
Known and NOT yours: `sdk-tests/widgetParts.test.ts` will fail until `guides/widgets.md` is regenerated (`npm run gen:widget-parts`) — do NOT run the generator or edit the guide (another lane adds parts too; the lead regenerates once). `sdk-tests/coreCatalog.test.ts`'s golden digest moves with the label — do NOT re-pin it. Don't run either file.

## Files owned (edit only these)
`../serene-pub-sdk/sdk/src/widgets.ts` (the one field) · `../serene-pub-sdk/core-catalog/components/shared/messages/SessionMessage.svelte` (the badge only) · `../serene-pub-sdk/sdk-tests/coreMessageTurnCause.test.ts` (new) · `../serene-pub-sdk/core-catalog/src/registry/genres.ts` (the label + its comment) · `../serene-pub-sdk/sdk-tests/coreNarratorTurns.test.ts` · `src/lib/client/components/sessionPage/TurnPicker.svelte` (words only) · `src/lib/client/components/sessionPage/turnPickerCadence.dom.test.svelte.ts` · `docs/genre-story.md` · `docs/group-sessions.md` · `docs/sessions.md` (line ~136 only).

## Files readable
Everything. Never edit: `NOMENCLATURE.md`, `STYLE-GUIDE.md`, `guides/widgets.md`, any CSS (`messageLayouts.css`, `widgets.css`), `narratorCadence.ts` (client or shared), `narratorCadence.test.ts`, `speakerRotation.ts`, `SceneDivider.svelte`, `sdk/src/sessionDossier.ts`, any scenes file, `host.ts`, `runTurn.ts`.

## Out of scope — never build
A new request kind; a *Spoke up* badge for *Let others speak up* lines; a setting; renaming the stored key; a migration; any CSS; a `title`/tooltip sentence beyond the badge text (copy is the owner's).

## Stop and report (do not decide) when
You would need a name beyond `turnCause` / `messages.message-badge-cause` / the local helper; the harness cannot mount the conversation; a test outside these files must change.

## Rules you work under
- NOMENCLATURE R1 "One word, one meaning" — the label changes, the key `narratorInterjections` does not. R3 qualify, never the bare noun.
- "It is a **session**, never a *chat*" in any copy.
- STYLE-GUIDE §10: "Sentence case everywhere"; "Help is one sentence."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- Do what was asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
- Never `git checkout` / `restore` / `stash` / `clean` in `../serene-pub-sdk` — most of it is uncommitted.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need `sdk:build`.)
