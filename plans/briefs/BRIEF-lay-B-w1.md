# BRIEF lay-B-w1 — split Messages into Messages · Turn line · Composer (SDK core-catalog)

Worker (Sonnet) for lane lay-B. Supervisor: lay-B. Paths: SDK = /home/jody/github/serene-pub-sdk, APP = /home/jody/github/serene-pub.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (In this lane: **do not run sdk:build / any build at all**.)

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

## Goal
The owner ruled (2026-11-05, R8): "Split the messages, composer and activity status/turn select into three widgets." Today ONE widget `messages` (SDK `core-catalog/components/shared/messages/MessagesWidget.svelte`) draws the log, the channel head/tabs, the selection bar, the turn line (`TurnLine.svelte`) and the composer (`SessionComposer.svelte` + rewind note + read-only banner). Make it three core widgets that coordinate **through the host** (each core component is its own bundle; they share no module state):

1. **`messages`** keeps: the log, the channel head, the channel tabs, the selection bar (now at the widget's own foot — keep its existing wrapper parts `messages.compose` / `messages.compose-area` around the selection bar so the stylesheet still draws it; it no longer replaces anything). It no longer draws TurnLine, SessionComposer, the rewind note or the read-only banner.
   - It **announces the channel it shows** with the new core-only request `show-channel { channel }` (already declared by the supervisor in `SDK/sdk/src/widgets.ts`: `'show-channel': { params: { channel: string }; result: void }`, askers `'core'`). Send it once the conversation has a lane, and again on every change of `conversation.lane.current` (a tab press, or the channels list changing which lane is current). Send the canonical lane string exactly as `conversation.lane.current` returns it. Dedupe: never send the same value twice in a row. Use `conversation.request` style error handling (an unmount decline is silent — `isUnmountDecline`). Read nothing tracked inside the effect body you don't mean to track (wrap the request in `untrack`).
   - Messages STOPS declaring the settings `composer`, `otherTabsComposer`, `composerPosition`, `showMessages`, `showComposer`, `nextUp`, `showActions` (registry). Its reader (`readConversationSettings` / `ConversationSettings` in MessagesWidget.svelte's module script) stops reading them too; remove `data-composer-position`, `data-composer-skin`, `data-show-messages` from `messages.root` (the log always shows). Keep `lineWidth`, `presentation`, `order`, channel/Reading settings on Messages. Do NOT add any "hidden field" flag (the SDK has none; the app converts stored rows before the prune).
2. **`turn-line`** — new widget + component: `TurnLine` with the `nextUp` setting (same enum/labels/default/group as today's `messages.nextUp`, `group: 'Turns'` may go — it is the widget's only setting; keep the ⏳ `showNudge: false` → `hidden` read).
3. **`composer`** — new widget + component: the compose block exactly as MessagesWidget draws it today (the `messages.compose` wrapper, `<TurnLine>` REMOVED from it, `messages.compose-area`, the read-only banner, the rewind note with Forward, `<SessionComposer {composerSkin} showActions>`), shown under the same conditions as today (`conversation && !conversation.noLane`; `showComposer` no longer exists). Settings, moved verbatim from today's `messages` decl: `composer` (skin), `otherTabsComposer`, `showActions`.

## The dossier fields Composer and Turn line read (define them; lay-C's host fills them)
The host gives Composer and Turn line the same `session:full` dossier as their **target** Messages copy (its `composer.channels` narrowed the same way), plus these fields under `dossier.composer` (NOT yet in the SDK type `ConversationComposerV1` in `sdk/src/sessionDossier.ts`, which this lane does not own — read them structurally through ONE small component-local reader, e.g. `composerTargetOf(dossier)` in a new `components/shared/composer/target.ts`, never `any` scattered around):
```ts
target?: {
  instance: string                 // the target Messages instance id ('messages', 'messages#sanctum')
  channel: string                  // the channel that copy shows (its last `show-channel`), canonical
  label: string                    // that channel's label in the viewer's language
  lineWidth?: 'column' | 'full' | 'comfortable'   // the target's Line width
  presentation?: 'rows' | 'folio'  // the target's effective presentation
}
writingTo?: { channel: string; label: string }  // set when the target panel shows a non-Messages tab
```
- `createConversation(ctx, opts?)` in `conversation.svelte.ts` gains an option (e.g. `{ followTarget: true }`) used ONLY by the Composer and Turn line mounts: then `lane.current` returns the target's `channel` (canonicalised as today) when the dossier carries a `target`, else today's behaviour (first writable channel). `lane.set` on such a conversation is inert. Messages mounts pass no option: unchanged.
- Composer: when `writingTo` is set, draw one line above the field: *Writing to ‹label›* (exact copy: `Writing to {label}` through `t()`), part `composer.writing-to` (a `<p role="status">`).
- Composer root carries `data-line-width` from `target.lineWidth` (default `full`, the Messages default) and `data-presentation` from `target.presentation`; the composer skin follows today's Folio rule: when the target's presentation is `folio` (or, with no `presentation`, the target channel's role is `folio` via `conversation.channelRole`) and the copy's `composer` is the declared default `classic`, the skin is `quill`.
- `otherTabsComposer`: applies when the conversation's channels make 2+ tabs (`channelTabsOf(conversation.channels)`) and the current lane is not the first tab — today's rule, moved.

## Parts (STYLE-GUIDE §6.16, quoted)
"A session widget's markup carries **no look** … Its elements carry **widget parts** … **Carrier:** `data-widget-part`, a whitespace-separated token list … **Grammar:** `<part owner>.<part name>`. The **part owner** is whoever draws the element: the widget, by its widget id … One element can carry both, the owner's first … A part name is kebab-case, singular, and says what the element is, never how it looks. State stays in the widget's own `data-*`."
Lead decision D8: "their parts keep `messages.compose*` / `messages.turn-line*` names ⏳ (aliases `composer.*` / `turn-line.*` added) so every existing style pack and user style keeps working."
Rule for this build (supervisor's decision — apply mechanically, no other new part names):
- Every `messages.<x>` token drawn by the Composer component's files (its wrapper, `SessionComposer.svelte`, the rewind note, the read-only banner) ALSO carries `composer.<x>` (same suffix): `data-widget-part="messages.composer-field"` → `data-widget-part="messages.composer-field composer.composer-field"`; generic tokens (`toolbar`, `label`…) stay where they are, after the owned ones.
- Every `messages.<x>` token drawn by TurnLine/NextCharacterBlock/StateProposalList-in-the-turn-line ALSO carries `turn-line.<x>`: `messages.turn-line-run` → `+ turn-line.turn-line-run`, `messages.next-up-head` → `+ turn-line.next-up-head`, `messages.ledger-review-note` → `+ turn-line.ledger-review-note`. If a file is ALSO drawn inside the log (check: `StateProposalList`, ledger parts), only add the alias where it is drawn by the turn line (a prop, or leave that file alone and say so).
- Each new widget's outermost element carries `<id>.root`: `composer.root`, `turn-line.root`. **The Composer root must NOT be `block-size: 100%`/height-filling** (the host measures its content for Fit) — no inline style, just the element.
- Messages keeps every part it draws unchanged.
- Do NOT run `gen:widget-parts` / regenerate `guides/widgets.md` (lay-F owns it). `sdk-tests/widgetParts.test.ts` will fail on the guide until it is regenerated — report that, don't fix it.

## Components to add (follow `components/shared/messages/{messages.ts,Messages.svelte}` exactly)
- `components/shared/composer/composer.ts` (`svelteComponent(Composer)`), `Composer.svelte` (setContext WIDGET_CONTEXT_KEY with `widgetRefFromComponent(untrack(() => ctx), { id: "composer", instanceId: "composer", title: "Composer" })`, `<WidgetBoundary {ctx}>`), `ComposerWidget.svelte` (creates `createConversation(ctx, { followTarget: true })` + `setConversation`, reads its settings with a small reader `readComposerSettings(raw, …)` in a component-local `.ts`), `target.ts`.
- `components/shared/turn-line/turn-line.ts`, `TurnLineMount.svelte` (or similar; id `turn-line`, title `Turn line`), `TurnLineWidget.svelte` (conversation with `followTarget`, renders `<TurnLine nextUp>` wrapped in an element carrying `turn-line.root`).
- Import the shared pieces from `../messages/…` (SessionComposer, TurnLine, conversation.svelte). Keep new helper logic in `components/**` files (they bundle from source in the test harness); do NOT add to `core-catalog/src/shared/ui/**` (components read that through the package's built `dist`, which this lane cannot rebuild).
- Composer and TurnLine read selection state? No: selection belongs to Messages now. `TurnLine`'s rows/dossier/events come from its own conversation — unchanged code.

## Registry (`SDK/core-catalog/src/registry/widgets.ts`) — edit ONLY: the `messages` entry, two new entries placed right after it, the `coreWidgets` handles, `CORE_COMPONENTS`, `CORE_VIEW_ONLY_COMPONENTS`. Another worker edits the `scene-portraits`, `stats` and `authors-note` entries of this same file at the same time: use the Edit tool with exact hunks, re-read the file right before each edit, never rewrite the file, never reformat other entries.
- Rewrite the `messages` entry's doc comment (it says the composer is a setting "rather than a widget"; now: the log, read; the Composer and Turn line are widgets beside it, split by owner ruling R8 2026-11-05).
- New `turn-line` decl: `title: 'Turn line'`, `component: 'turn-line'`, `reads` same as messages (`['layout','messages','actions','settings','viewer','locale']`), `presets: [DEFAULT_PRESET]`, settings `{ nextUp }`. No `icon` (a glyph is a NOMENCLATURE §22 claim — not this lane's). No `role`.
- New `composer` decl: `title: 'Composer'`, `component: 'composer'`, same `reads`, `presets: [DEFAULT_PRESET]`, settings `{ composer, otherTabsComposer, showActions }` (moved verbatim; `showActions` keeps label 'Show the Actions label'; drop `group: 'Turns'` only if it would be a lone group — your call, say which). No icon, no role.
- `WidgetDecl.panel` defaults are a LATER step (another lane's type) — do NOT add `panel`.
- `coreWidgets`: add `composer: coreWidget('composer')` and `turnLine: coreWidget('turn-line')` with one-line 🚧 docs.
- `CORE_COMPONENTS`: add `composer` (label 'Composer', entry `components/shared/composer/composer.ts`) and `turn-line` (label 'Turn line', entry `components/shared/turn-line/turn-line.ts`).
- `CORE_VIEW_ONLY_COMPONENTS`: add `'composer'` and `'turn-line'` beside `'messages'` (they run on core's trust — `send`, `draft`, `fire-turn` are answered only for `owner: 'core'` — which a clone cannot have); update that doc comment in one line.

## Tests (sdk-tests/, run with `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file>`; never pipe into `head`)
Files you own and must leave green: `coreConversationComponent.test.ts`, `coreComposerAttachments.test.ts`, `coreComposerClosed.test.ts`, `coreComposerKinds.test.ts`, `corePaletteNewcomers.test.ts`, `coreConversationScenes.test.ts`, `coreMessageTurnCause.test.ts`, `rewindStrip.test.ts`, `lairSanctumTab.test.ts` (ONLY its "the widget declares the other tabs' composer" test moves to the `composer` decl — leave its layout-shape test alone), `coreCatalog.test.ts` and `coreCatalogCoreWidgets.test.ts` (only where they assert the messages decl's settings / the widget list), `packageConformance.test.ts` only if it breaks.
- A test that mounts `components/shared/messages/messages.ts` and probes the composer, the turn line or the rewind note now mounts `components/shared/composer/composer.ts` (or `turn-line/turn-line.ts`) with the same dossier; keep every behaviour assertion, change only where it is mounted and which settings key it passes.
- New `sdk-tests/coreComposerComponent.test.ts`: (a) with `composer.target { channel: 'sanctum', … }` and `channels: ['main','sanctum']`, a send goes to `sanctum`; (b) `writingTo` draws *Writing to Sanctum*; (c) `otherTabsComposer: 'minimal'` on a non-first tab target → `data-composer-skin="minimal"` on the composer; (d) no target → today's lane (main); (e) the root carries `composer.root` and `messages.compose`.
- New `sdk-tests/coreTurnLineComponent.test.ts`: mounts, `nextUp: 'hidden'` drops the next half, carries `turn-line.root`.
- In `coreConversationComponent.test.ts` add: Messages sends `show-channel { channel: 'main' }` on mount and `{ channel: 'sanctum' }` after the Sanctum tab is chosen, and never draws `messages.composer` / `messages.turn-line` any more.
- Mounted component tests are heavy: run them one file at a time.
- Typecheck: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "core-catalog/src/registry/widgets|sdk-tests/(coreComposer|coreTurnLine|coreConversation|lairSanctum|coreCatalog)"` must print nothing. (Svelte files are checked by svelte-check against the built SDK, which is stale for the new `show-channel` request until the lead rebuilds — don't run it; say so.)

## Rules (CLAUDE.md, quoted)
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "It is a **session**, never a *chat*."
- "Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted."
- Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'." Any new user-visible word beyond: *Composer, Turn line, Writing to ‹label›* → stop and ask in your report.
- Comments: follow the files' existing doc style (why, rulings cited `PLAN-session-layout-simplify D7/D8, owner R8 2026-11-05`), short.

## Files owned
- `SDK/core-catalog/components/shared/messages/**`, new `SDK/core-catalog/components/shared/composer/**`, new `SDK/core-catalog/components/shared/turn-line/**`.
- `SDK/core-catalog/src/registry/widgets.ts` — only the hunks named above.
- The sdk-tests listed above + the two new ones.

## Files readable
Anything. Do NOT edit: `sdk/src/**` (the request is already declared), `core-catalog/src/registry/layouts.ts` / `genres.ts` (a later step), `core-catalog/src/shared/**`, scene-portraits / stats / authors-note components, `guides/**`, anything in APP.

## Out of scope
Shipped layouts, `WidgetDecl.panel`, the app host (target resolution, styles CSS, `show-channel` answerer), regenerating guides/widgets.md, NOMENCLATURE.

## Stop and ask when
The split needs host data the dossier fields above can't carry; a test's behaviour assertion would have to change meaning (not just mount point); a new user-visible word.

## Done means
The owned tests above green, one by one, with counts; the tsc filter above prints nothing.

## Report
Write `/home/jody/github/serene-pub/plans/REPORT-lay-B-w1-2026-11-05.md`: changed/new files; the composer and turn-line DOM shape (root element, its `data-*`); the exact part aliases added (count, rule exceptions); the `createConversation` option's name and behaviour; the attributes removed from `messages.root`; tests run with pass/fail counts; Noticed-not-done; open questions.
