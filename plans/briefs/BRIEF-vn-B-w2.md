# BRIEF — vn-B-w2: the shown line, the stage as of it, the own line id, one automatic voice

Lane vn-B (supervisor), plan `plans/PLAN-visual-novel-layout-2026-11-11.md` rev 2 (§1.2, §1.5, §7 S2). App repo `/home/jody/github/serene-pub`. The SDK is already built with the new types: `WidgetRequests['show-line']` `{ params: { messageId: number | null }; result: void }` (core only), `SessionCharactersV1.speakerRef?: string | null`, `SessionDossierV1.ownNewestMessageId?: number | null`, the `dialogue-box` widget. **Do not edit anything in `../serene-pub-sdk`. Do not run `npm run sdk:build`.** Another worker (w1) is editing other files in this repo at the same time (`arrangeOps.ts`, `LayoutLookSection.svelte`, `SessionLayoutRender.svelte`, `RemoteWidget.svelte`, `widgets.css`, `corePresets.ts`); touch only yours.

Read first: `plans/REPORT-vn-C-2026-11-11.md` §"Shapes the app lane (vn-B) implements against" and §"Stopped on" S2; the SDK comments on `show-line` (`../serene-pub-sdk/sdk/src/widgets.ts` ~:2017-2029) and `speakerRef` (~:1154-1160).

## Goal

### A. `show-line` — the shown line (client-only page state)
New `src/lib/client/components/sessionPage/requests/showLine.ts`, modelled on `requests/showChannel.ts` (read it and its test). Exact API (other code depends on these names):
```ts
/** The line a Dialogue box's reader is on (`show-line`), by session id — at most one entry. */
export const shownLines: SvelteMap<number, number>
/** Answer one `show-line` for the page's session. */
export function answerShowLine(params: unknown, sessionId: number | null): void
/** The shown line for this session, or null (none shown, or another session's). */
export function shownLineOf(sessionId: number | null | undefined): number | null
/** Forget the shown line. */
export function clearShownLine(): void
```
- `messageId` must be `null` or a positive integer; anything else throws in words: `show-line needs a message id (a whole number) or null`. No session (`sessionId == null`) throws `show-line needs a session` (other answerers throw on no session too — check how `index.ts` words it and match).
- `null` deletes the session's entry. A number sets it; setting it for one session drops any other session's entry (so a switch never shows a stale line). The same value again writes nothing (as `answerShowChannel`).
- Holds no listener and never toasts (CLAUDE.md: "views register listeners for local state and never call `toaster`").
- Register in `requests/index.ts` with **one** line beside `"show-channel"` (:640): `"show-line": (p, _from, d) => answerShowLine(p, d.sessionId())`. That makes the app's typecheck pass again.
- Tests: new `requests/showLine.test.ts` (set, overwrite, null clears, other session dropped, same value no write, refusals, `shownLineOf` for another session is null); add a case to `requests/index.test.ts` beside the `show-channel` one (`answer("show-line", { messageId: 5 }, core)` resolves undefined over a deps `sessionId: () => 3`). The `WIDGET_REQUEST_ANSWERS` kind-list test already pins the table to the SDK's kinds. Check `requests/askers.test.ts` still passes (core-only askers come from the SDK table).

### B. Clear the shown line when no Dialogue box is drawn — and the one automatic voice (in `src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts`)
1. Add a derived **`holdsDialogueBox`** (exposed as a getter on the returned model): true when any tab of the drawn zones (`zones.left`, `zones.middle`, `zones.right`, the same `zones` the model already derives) is an instance of `dialogue-box` (`isInstanceOf(id, "dialogue-box")` from `@serene-pub/sdk`, as `conversationTarget.ts:7` imports it).
2. Inside `createSessionLayoutModel` (it is constructed during component init — `SessionLayout.svelte:148` — and inside `$effect.root` in tests), add an `$effect` that calls `clearShownLine()` (untracked) whenever `holdsDialogueBox` is false, and a teardown-only effect (`$effect(() => () => untrack(clearShownLine))`) so leaving the page drops it. Reason, in a comment: the Dialogue box sends nothing when it unmounts (SDK `show-line` comment), so without this the stage stays held on an old line after a switch to another layout. Do not read `shownLines` tracked in that effect in a way that loops (CLAUDE.md: "Never read state a method writes inside an effect-called store method without `untrack`").
3. **One automatic voice (plan §7 S2, ★10).** Every tab stays mounted (`PanelTabs.svelte`), so a hidden Messages **Log** tab autoplays the newest line and takes the voice from the Dialogue box. The per-instance dossier a conversation mount gets is `dossierFor(id)` (:615) → `narrowedDossier(id)` (:557). Make it so that **while `holdsDialogueBox`**, the dossier handed to each **Messages** copy (`conversationKindOf(id) === "messages"`; `conversationKindOf` from `./conversationTarget`) has `spokenPlayback: "click"` when the page's value is `"auto"` or absent (`"never"` stays `"never"`; `"click"` stays). SDK meaning (`sessionDossier.ts:279-286`): "`auto` plays the newest line as it arrives under `play`, `click` shows a player that waits, `never` shows no spoken line" — so a line still plays in the Log when its play button is pressed. Return the page's own object (the same reference) when nothing changes, as `narrowedDossier` does today. Composer / Turn line dossiers are untouched; the Dialogue box is not a conversation mount (it gets the page's dossier through `Panel`'s `session:full` context), so its data is untouched. **No edit to any Messages file in either repo.** With no Dialogue box in the layout, nothing changes.
4. Test (new file `src/lib/client/sessionLayout/dialogueBoxPage.test.svelte.ts`; build a model as `arrangeCanvas.dom.test.svelte.ts:527-552` does — a `SurfaceManager` `init`ed with `coreDefaultWidgets(true)` and a v2 layout — inside `$effect.root`, with a `conversationDossier` stub carrying `composer.channels` and `spokenPlayback`): with a layout holding `dialogue-box` + `messages` (e.g. one middle panel with tabs `["dialogue-box", "messages"]`, then `turn-line`, `composer`): `holdsDialogueBox` true; `dossierFor("messages").spokenPlayback === "click"` from `"auto"`, `"never"` stays; the page dossier object is not mutated; with a layout without it: `holdsDialogueBox` false and `dossierFor("messages")` is the page's own object (`toBe`). The clear: set a shown line (`answerShowLine({ messageId: 9 }, 1)`), build/flush a model whose layout holds no `dialogue-box` → `shownLineOf(1)` is null; with a `dialogue-box` it stays 9; switching the working layout (`working` input, or the manager's arrangement) to one without it clears it. If `dialogue-box` is not in `coreDefaultWidgets(true)` (so the manager drops it), stop and report.

### C. The stage as of the shown line (`projections/characters.ts`, `projections/charactersSection.svelte.ts`)
- **One ordering for the cut: message id.** "At or before the shown line" = rows with `id <= shownMessageId` (the reading place is a message id and moves by id, plan §1.2). Say so in a comment.
- **A shown line that is not among the loaded rows is ignored** (behaviour is exactly today's): the cut needs the line in the window.
- Pure helpers in `characters.ts` (names are yours; keep them local/exported for tests):
  - `messagesAsOf(messages, shownMessageId)` → the cut list (the same array when no cut applies).
  - the speaker: when a shown line is set and loaded, its writer (`characterId ?? personaId`, hidden or not — it is the line on screen); else the writer of the **newest visible** (not `isHidden`) loaded line by id; `null` when there is none or it names no card.
- `CharactersSource` gains optional `shownMessageId?: number | null` (used when the caller did not precompute sprites / last spoke / speaker) and optional precomputed `speakerId?: number | null` (like `currentSprites` / `lastSpoke`). `projectCharacters` emits **`speakerRef`**: the `ref` of the member whose card id is the speaker's (`refOfSeat`), or `null` when that is nobody in `members` (narration, a person with no persona, a card not seated). With no shown line, `currentSpritesOf` / `lastSpokeOf` read the full log exactly as today.
- `charactersSection.svelte.ts`: `CharactersSectionInputs` gains optional `shownLine?(): number | null`, defaulting to `() => shownLineOf(input.sessionId())` (the page's `envelopeSections.svelte.ts` is **not** edited; the default wires it). Cut the loaded messages with `messagesAsOf` **before** `currentSpritesOf` and `lastSpokeOf`; derive the speaker id as its own primitive `$derived` (number | null) and pass it as `speakerId`; `current` depends on it the way it depends on `spritesKey` / `lastSpokeKey`. **The section must not recompute per streamed chunk because of this change**: a chunk that moves no sprite, no last-spoke time and no speaker leaves `current` the same object.
- Tests:
  - `characters.test.ts`: as of a line — sprites and last spoke follow the cut; hidden lines skipped (a hidden later line by the shown speaker changes nothing; the shown line's writer is the speaker even when hidden — decide and assert); a shown line outside the window is ignored; `speakerRef` with a shown line, with none (newest visible), for narration / a person with no persona (null), for a persona line (the persona member's ref); unchanged output (apart from the new `speakerRef` key) with no shown line.
  - `charactersSection.dom.test.svelte.ts`: setting / moving the shown line (through the `shownLine` input) rebuilds the section with the earlier sprite and the new `speakerRef`; clearing it returns to today's; a streamed chunk with a shown line set leaves `current` the same object.
- Existing tests whose `toEqual` on `projectCharacters` output now lacks `speakerRef`, or that build a `ScenePortrait` literal without the now-required `speaking` (search `src/` tests, e.g. `remoteScenePortraits.dom.test.ts`, `panel.dom.test.svelte.ts`): fix minimally and **list each with why** in your report.

### D. `ownNewestMessageId` on the dossier (`src/lib/client/components/sessionPage/sessionPageProjections.ts`)
In `projectConversationDossier` (the returned object, near `spokenPlayback` ~:928), add `ownNewestMessageId`: the greatest `id` among `session.sessionMessages` rows the viewing user wrote — **`role === "user"` and `userId === userCtx.user?.id`** (a greeting or reply row can carry the owner's `userId`; the file's own rule at :323 is `msg.role === "user" && msg.userId != null` → the author's), on any channel; `null` when there is none or no viewer. Touch nothing else in the file. Test: a new `sessionPageProjections.ownLine.test.ts` modelled on `sessionPageProjections.cardless.test.ts` (how it builds `DossierSources`): own user rows → newest id; another person's row, an assistant row carrying the viewer's `userId`, no viewer → not counted / null.

## Files owned (edit only these)
- `src/lib/client/components/sessionPage/requests/showLine.ts` (new), `requests/showLine.test.ts` (new), `requests/index.ts` (the one line), `requests/index.test.ts`
- `src/lib/client/components/sessionPage/projections/characters.ts`, `characters.test.ts`, `charactersSection.svelte.ts`, `charactersSection.dom.test.svelte.ts`
- `src/lib/client/components/sessionPage/sessionPageProjections.ts` (the field only), `sessionPageProjections.ownLine.test.ts` (new)
- `src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts` (B only), `src/lib/client/sessionLayout/dialogueBoxPage.test.svelte.ts` (new)
- Existing test files that break on `speakerRef` / `ScenePortrait.speaking` (literal fixes only; list them)

## Files readable
Anything. `envelopeSections.svelte.ts` (how the section and dossier are built), `conversationTarget.ts`, `arrangeCanvas.dom.test.svelte.ts`, `SessionLayoutRender.svelte` (how `dossierFor` reaches a mount, :190-226), `seatIdentity.ts`, the SDK's `core-catalog/src/shared/ui/scene-portraits/portraits.ts:467` (`speaking` = `speakerRef === m.ref`).

## Rules you work under (quoted)
- CLAUDE.md Standing rulings: "views register listeners for local state and never call `toaster`." "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." This work adds **no** socket listener and **no** toast; if it seems to need one, stop.
- CLAUDE.md Hard rules: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." Memory: never read state a method writes inside an effect-called method without `untrack`.
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`.
- P1: same inputs, same result. No shown line = exactly today's projection.
- Plan §1.2: "`ownNewestMessageId?: number | null` … the id of the newest loaded row the viewing user wrote."
- It is a **session**, never a *chat*. No new names beyond `show-line`, `speakerRef`, `ownNewestMessageId`, `holdsDialogueBox` and private helpers; a new user-facing word → stop.
- Never `git commit`, `git stash`, `git checkout`, `git restore`, `git clean`.

## Out of scope (write down, never build)
Any Messages, Composer, Turn line or `conversationTarget.ts` change; `envelopeSections.svelte.ts`; `SessionLayout.svelte`; `SessionLayoutRender.svelte` (w1); anything in the SDK; storing the reading place; the sprite-set header face (keeps reading the full log); docs and canon (a later worker).

## Stop and ask when
A rule above can't be met; the playback override can't be done per Messages instance through host data alone (then stop B.3 only, report the evidence and the smallest alternative, finish the rest); a file outside the list must change.

## Done means
These pass in the capped scope: `src/lib/client/components/sessionPage/requests/showLine.test.ts`, `requests/index.test.ts`, `requests/askers.test.ts`, `requests/showChannel.test.ts`, `projections/characters.test.ts`, `projections/charactersSection.dom.test.svelte.ts`, `sessionPageProjections.ownLine.test.ts`, `sessionPageProjections.cardless.test.ts`, `sessionPageProjections.castNames.test.ts`, `sessionPageProjections.seatMember.test.ts`, `src/lib/client/sessionLayout/dialogueBoxPage.test.svelte.ts`, `src/lib/client/sessionLayout/conversationTarget.test.ts`, `src/lib/client/sessionLayout/conversationStyles.test.ts`, `src/lib/client/components/sessionPage/remoteScenePortraits.dom.test.ts`, `src/lib/client/components/surfaces/panel.dom.test.svelte.ts`, plus every test file you edited.
Also `npx prettier --check` on each file you changed (fix only your own lines). Do not run `tsc` or `npm run check` (the supervisor does).

Capped scope (exact): `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'` from `/home/jody/github/serene-pub`. Never pipe vitest into `head`.

## Report
Your final message is your report: changed files; tests run with results; every existing test you changed and why; decisions you made (the hidden-shown-line case, anything else); anything you stopped on, with evidence; Noticed, not done.

## Verbatim lane rules
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You never run `sdk:build` in this lane.)
- Never run `prettier --write` on a directory. Scratch files start with `vn-B-w2-`.
