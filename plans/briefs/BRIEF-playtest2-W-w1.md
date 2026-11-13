# BRIEF playtest2-W-w1 — Line width default Full, the stopped-widget sentence, the Channel / Channel lane default choice

Lane `playtest2-W` (supervisor) · worker `w1` · report: `plans/briefs/REPORT-playtest2-W-w1.md`

## Goal — three owner rulings (2026-11-04), build exactly these

### 1. §0-G — the Messages widget's **Line width** defaults to **Full** (the container's width)
Ruling: *"Message width: default **matches the container width** (Full); Column and Comfortable stay on offer."*
- SDK `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/widgets.ts` (~144–165, the `lineWidth` declaration ONLY): `default: 'full'`. Keep `of` and `members` order as is (Column, Full, Comfortable). Update the doc comment above it (Full is the default since the owner ruling 2026-11-04 §0-G; Column was ★R1's default 2026-10-24).
- SDK `/home/jody/github/serene-pub-sdk/core-catalog/components/shared/messages/MessagesWidget.svelte`: `CONVERSATION_DEFAULTS.lineWidth` (~:92) → `"full"`; the comment at ~:422 that says "Column (the default)" → Full is the default. `pickEnum(..., d.lineWidth)` then reads an unknown value as Full.
- SDK `core-catalog/components/shared/messages/SessionContainer.svelte` ~:433 comment "Column (the default)" → fix the words only.
- App `src/lib/client/styles/widgets.css` ~133–150: comments only ("Column, the default (★R1…)" → Column is no longer the default; Full is, owner 2026-11-04). No rule changes: Full has no measure already.
- Stored data: settings are stored as deviations only. A session with a stored `lineWidth` keeps it; one with none now reads Full. No migration, no boot pass.
- Tests: SDK `sdk-tests/coreConversationComponent.test.ts` — the two Line width tests (~1184–1213): the default is `'full'`; `lineWidthOf({})` → `'full'`; `{ lineWidth: 'column' }` → `'column'` (a stored Column stays); `'comfortable'` stays; unknown `'narrow'` → `'full'`; rename the tests' titles to say Full is the default. App: add a case beside the existing widget-settings tests (e.g. `src/lib/shared/widgets/settings.test.ts` if it exists, or a new small test next to `src/lib/shared/widgets/settings.ts`) that `effectiveWidgetSettings` on the messages declaration gives `lineWidth: "full"` with nothing stored and `"column"` with `{ lineWidth: "column" }` stored. If the app reads the declaration from the SDK dist, run `sdk:build` first (rules below). `src/lib/client/styles/widgets.fill.test.ts` must stay green (run it).

### 2. ★W1 — the stopped-widget overlay sentence
Ruling: *"★W1 overlay copy: Reload it to try again — the extension's own message is in the browser console."*
- `src/lib/client/components/host/ComponentMount.svelte` ~:407–411: the paragraph becomes, when `onReload` is given (the **Reload widget** button is drawn): *This widget stopped and can't show anything. Reload it to try again — the extension's own message is in the browser console.* When `onReload` is absent (the component editor's `PreviewPane` passes none, so no button exists) keep today's sentence (*…Reload the page to try it again — …*), because "Reload it" points at a button that isn't there. One `{#if onReload}` around the two sentences; no new prop.
- Test: the existing host DOM tests (`src/lib/client/components/host/liveReload.dom.test.svelte.ts`, `componentMount.dom.test.ts`) — add an assertion of the new sentence when the button is shown and the old one without `onReload`. Run both files.
- `docs/session-layout.md` ~:68 tip already names the overlay; leave it unless it quotes the old second sentence.

### 3. Item 18 — **Channel** and **Channel lane** show their default as a named choice
Ruling: *"18 Lane default: a **named choice** *Default (main)*; a stored blank still means default."* The lane brief adds: Channel shows *Default (main)*, Channel lane shows *Default (1)*; no stored change, no migration; spell out what a blank does in the field's help line.
What blank means today (`core-catalog/src/registry/widgets.ts` ~232–258): **Channel** blank = the primary log, every channel no other Messages widget shows, as tabs when there are two or more; **Channel lane** blank = the whole channel. Typing `main` or `1` would change what the widget shows, so the stored value stays blank.
Build (host side; the SDK field shape does NOT change — a declaration-driven version is a ★ the supervisor raises):
- In `src/lib/client/sessionLayout/WidgetSettingsPanel.svelte`, for the `messages` widget (`widgetOfInstance(widgetId) === "messages"`, from `@serene-pub/sdk`) the `channel` and `channelLane` fields draw as one small control each instead of SchemaForm's text box: the existing `Select` (`$lib/client/components/inputs/Select.svelte`) with two choices, then a text box under it only when the second is chosen:
  - Channel: **Default (main)** (stores blank) · **Another channel** (shows a text box, placeholder *A channel's slug, such as sanctum*).
  - Channel lane: **Default (1)** (stores blank) · **Another lane** (text box, placeholder *mine, or a lane number*).
  - A stored non-blank value shows the second choice with the value in the box. Picking the default writes blank (`""`) through the same commit path the panel uses (`patchWidgetSettings`), so the store prunes it to "nothing stored". Picking the second choice alone writes nothing until a value is committed in the box (`change`).
  - Put the control in a new component `src/lib/client/sessionLayout/ChannelDefaultField.svelte` (props: `key`, `label`, `description`, `value`, `defaultLabel`, `otherLabel`, `placeholder`, `oncommit(value: string)`), with a visible `<label>` / accessible names for both the Select and the text box (STYLE-GUIDE §9). Keep the field's `description` (help line) under it, as SchemaForm does.
  - The other `Channel`-group fields (`interleave`, `interleaveAs`, …) still draw through SchemaForm, in their declared order after these two.
- Help lines — SDK `core-catalog/src/registry/widgets.ts`, the `channel` and `channelLane` `description` strings only (no type or default change):
  - Channel: `'Default (main) leaves it blank: this copy shows every channel no other Messages widget shows, as tabs when there are two or more. Another channel shows that one alone, by its slug (the Lair\'s is sanctum).'`
  - Channel lane: `'Default (1) leaves it blank: this copy shows the whole channel. Another lane shows one: mine, the viewer\'s own lane on a channel of personal lanes, or a lane\'s number on a shared channel.'`
- Tests: `src/lib/client/sessionLayout/widgetSettingsPanel.dom.test.ts` — new cases: the messages widget's Channel shows *Default (main)* with nothing stored; Channel lane shows *Default (1)*; picking the default stores blank (no `channel` key after prune); a stored `sanctum` shows *Another channel* with `sanctum` in the box; committing a slug writes it. Use whatever fixture the file already uses for declarations.
- Docs `docs/session-layout.md`, "What the Messages widget offers" (~:111): the bullet says **Channel lane from** — the field is **Channel lane**; name both defaults: *Default (main)* (every channel no other Messages widget shows) and *Default (1)* (the whole channel). Also "A second Messages widget for one channel" (~:157–159): one clause saying a new copy's Channel starts at *Default (main)* — set **Another channel** and its slug. Re-read the doc first; edit only those lines.
- Docs, Line width bullet (~:107): *Full* (the default) runs them across the whole widget; *Column* keeps a reading column of about 76 characters…; *Comfortable* …. And ~:349 ("keeps to a reading column inside it by default; to run it the whole width, set … Full") → the text runs the whole width by default; set **Line width** to *Column* or *Comfortable* for a reading column. ~:351 stays.

## Files owned (only these)
SDK: `core-catalog/src/registry/widgets.ts` (the `lineWidth`, `channel`, `channelLane` declarations only), `core-catalog/components/shared/messages/MessagesWidget.svelte` (the default + the comment), `core-catalog/components/shared/messages/SessionContainer.svelte` (the comment), `sdk-tests/coreConversationComponent.test.ts` (the two Line width tests).
App: `src/lib/client/styles/widgets.css` (comments at 133–150), `src/lib/client/components/host/ComponentMount.svelte` (the overlay paragraph), `src/lib/client/sessionLayout/WidgetSettingsPanel.svelte`, new `src/lib/client/sessionLayout/ChannelDefaultField.svelte`, `docs/session-layout.md` (the lines named above), and the tests named above (plus a new settings default test if needed).
**w3 edits `WidgetSettingsPanel.svelte` and `docs/session-layout.md` after you** — keep your changes in those files tight.

## Out of scope
Listing the session's channels in the picker; the Album's Channel and **Show another channel inline**; widening Column; any new setting; the Reset/Style reset (w3's); any other copy.

## Stop and ask (put it in your report, don't decide) when
A migration or stored-data change seems needed; a name beyond those above; the SDK field shape would have to change; a test pins a hash that moves.

## Done means
Green: `sdk-tests/coreConversationComponent.test.ts` (whole file, capped scope), `src/lib/client/sessionLayout/widgetSettingsPanel.dom.test.ts`, `src/lib/client/sessionLayout/widgetSettingsModal.dom.test.ts`, `src/lib/client/components/host/liveReload.dom.test.svelte.ts`, `src/lib/client/components/host/componentMount.dom.test.ts`, `src/lib/client/styles/widgets.fill.test.ts`, the settings default test. Run `npm run sdk:build` (rules below) once your SDK edits are done if any app test reads the SDK dist, and say whether you ran it.

## Rules every worker of lane playtest2-W follows (quoted by the supervisor)

Verbatim (from `.claude/guides/multi-agent.md`):
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*

Also:
- Never `git checkout`, `git restore` or `git clean` in either repo (`../serene-pub-sdk` is mostly uncommitted).
- **Another programme's lanes edit `src/lib/client/**`, `src/routes/**` and `docs/**` right now.** Re-read every file immediately before each edit (line numbers here may have moved). Use Edit, never Write, on an existing file. Edit only the lines your brief names.
- **Stay out entirely:** `src/lib/shared/sockets/types.ts`, `src/lib/client/**/navigation.ts`, the `CONTENT_ORDER` and `rightNavOrder` arrays in `Layout.svelte`, `NOMENCLATURE.md`, `STYLE-GUIDE.md`, `src/lib/client/components/host/RemoteWidget.svelte`, the remount block (`remountKey` / `copiesLanded`) in `SessionLayoutRender.svelte`, `server/plugins/**`, `src/lib/shared/plugins/**`, `sessions/settingsForm.ts`, `db/defaults.ts`, `core-catalog/src/loadouts.ts`, `src/lib/generated/**` (generated). If you need a change there, put the exact edit in your report instead.
- **Names (NOMENCLATURE R1–R6):** one word, one meaning; qualify, never the bare noun; it is a **session**, never a *chat*. Do not invent a name the brief doesn't give you; if you must (a helper, a test id), list it in your report under *New names*.
- **STYLE-GUIDE §10 Writing:** sentence case everywhere; a button says what happens; help is one sentence; labels are nouns, hints are sentences. **§9:** every interactive element has an accessible name; icon-only buttons carry `aria-label`; nothing is hover-only.
- **0.6 is in users' hands:** no stored data changes; a stored blank keeps meaning what it means. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- **Svelte 5:** `$state(new Set())`/`new Map()` aren't reactive on mutation (use `SvelteSet`/`SvelteMap`). `socket.off(event)` always with its handler. Views never call `toaster`.
- **DB:** inside `db.transaction(async (tx) => …)` use only `tx`.
- **Tests:** only the files your brief names (plus ones you add). Never a full `npm test`, `npm run check`, project-wide `tsc`, or whole `sdk:test`. Run vitest exactly as:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-W-<worker>-<n>.log 2>&1; echo exit=$?'`
  then read the log (grep for `Test Files`, `Tests`, `FAIL`). Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
  SDK tests run from `/home/jody/github/serene-pub-sdk/sdk-tests` as one file at a time in the same capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file> > <scratchpad>/playtest2-W-<worker>-sdk-<n>.log 2>&1; echo exit=$?'`.
  If an app test needs the rebuilt SDK dist: `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from `/home/jody/github/serene-pub`.
- **Prettier:** `npx prettier --check <file>` on files you changed; if a file was already prettier-dirty before you, leave the rest of it alone.
- **Report:** write it to the path in your brief: Changed files (both repos, with what changed) · Tests run (exact command, pass/fail counts) · New names · Anything you could not do and why · Noticed, not done. Never fix things outside the brief in passing.
