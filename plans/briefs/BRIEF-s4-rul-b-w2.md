# BRIEF — worker `s4-rul-b-w2` (2026-11-10) — the cast member form in tabs, like the card editor

Supervisor: lane `s4-rul-b`. Repo: `/home/jody/github/serene-pub`. Use absolute paths. Report in your final message (the supervisor reads it); do not write a report file.

## Owner's words (quote, never reinterpret)

- Asked where the member form's post-history instructions, creator notes and likeness should go, the owner answered: *"tabs like card, should probably adapt and reuse the same component/forms"*.
- Cascade principle (2026-11-09): *"Cast by default cascades… a card is a seed, not the sole carrier… not having a card doesn't make them 2nd class."*

## Goal

`src/lib/client/lorebooks/cast/CastMemberForm.svelte` (~1786 lines, one long column today) becomes a **tabbed form like the card editor** (`src/lib/client/components/characterForms/CharacterForm.svelte`: `PanelTabStrip`, tabs from `FORM_TABS`, a `TAB_FIELDS` map so a tab marks itself when a field inside it fails, every panel mounted with `hidden={activeFormTab !== …}`), drawing the shared fields from the components worker w1 just extracted. **Every field and control the member form has today stays, with the same copy and the same save payload.** Nothing is dropped.

Read before you start: the whole of `CastMemberForm.svelte`; `CharacterForm.svelte` ~l.1380–1420 (strip) and ~l.1400–2230 (panels); the new shared components (below); `memberDraft.ts`; `retoldRows.ts`; the existing member DOM tests (`memberOwned.dom.test.ts` is the best harness to copy).

## Files owned (the only files you may edit or create)

- `src/lib/client/lorebooks/cast/CastMemberForm.svelte`
- New, optional: `src/lib/client/lorebooks/cast/UseFromCardSwitch.svelte` — one *Use from card* switch (the member form repeats the same Skeleton `Switch` markup six times: Name, Nickname, Post-history instructions, Creator notes, Likeness, Voice). Props: `name: string` (the switch's `name`), `label: string` (the sr-only prefix, e.g. "Post-history instructions"), `checked: boolean`, `onCheckedChange: (checked: boolean) => void`. Same markup and classes as today (`switchClass`, `<span class="sr-only">{label}:</span> Use from card`). Use it only if it keeps the DOM identical.
- New test: `src/lib/client/lorebooks/cast/memberTabs.dom.test.ts`
- The existing member DOM tests listed under **Tests**, **only** where a structural move forces a selector change — each such edit listed in your report with its reason. Never weaken an assertion or change an expected payload.

Not yours (read only): the shared components in `src/lib/client/components/characterForms/` (w1's — use them as they are; if one truly can't do something, report it, don't edit it), `CharacterForm.svelte`, `CastWorkspace.svelte`, `memberDraft.ts`, `retoldRows.ts`, anything server-side, `StartSessionForm.svelte`, `state/**`, `media/**`, image-generation files, the SDK, any doc.

## The shared components (w1's, in `src/lib/client/components/characterForms/`)

- `formTabs.ts` — `FORM_TABS` (Profile · Voice · Notes · Likeness · Speech · Stats, with icons) and `type FormTab`.
- `fieldClass.ts` — `FIELD_CLASS = "input rounded-base"`.
- `ProseField.svelte` — `{ id, label, hint?, required?, value? ($bindable), rows?, placeholder?, title?, disabled? (adds opacity-60), class?, invalid?, describedBy?, oninput?(value), follow?: Snippet }`. Renders label (card's label class; a `PromptBadge` when `hint`), then `follow`, then the textarea — no wrapper; wrap it in `<div class="flex flex-col">` as the card does.
- `GreetingsList.svelte` — `{ greetings: CharacterGreeting[], onText(i, text), onGroupOnly(i, on), onRemove(i), onAdd(), id? }`. Textareas `aria-label="Greeting N"`, checkboxes `class="checkbox"` under "Group sessions only", remove buttons `aria-label="Remove greeting N"`, an **Add a greeting** button.
- `CreatorNotesFields.svelte` — `{ textId, langId, text? ($bindable), lang? ($bindable), variants?: NoteLanguageRow[] ($bindable, edited in place), languages?, error?, placeholder?, disabled?, follow?: Snippet, onchange?() }`.

## The layout (build exactly this; the supervisor proposes each placement to the owner as ★)

**Above the tabs (the hero, as on the card where name, nickname and avatar sit above the strip):** the header row (face, name, tag, badges, Delete) and the identity block (a card-less member's **Name**; a carded member's Name and Nickname with *Use from card*, **Change face**, and _Shown in this book only; the card keeps its own._) — unchanged.

**The strip:** `<PanelTabStrip bind:value={activeFormTab} tabs={formTabs} ariaLabel="Character fields" panelIdPrefix="cast-member-form" />`, `formTabs` = `FORM_TABS` **without Stats** (the member form has no stats fields), each with `hasError` from `TAB_FIELDS`. Default tab `"profile"`. Do **not** reset the tab when the member changes (the page's own tabs stay picked from one member to the next). Each panel: `id="cast-member-form-<tab>" role="tabpanel" aria-labelledby="cast-member-form-<tab>-tab" hidden={activeFormTab !== "<tab>"} class="space-y-3"`.

**Sections:** the member page already sits inside a `.panel-card`, so each section is a `.panel-inset` (STYLE-GUIDE: *"`.panel-inset` is a section inside a card"*), not a `.panel-card`. Section titles use the card's heading look on an `h5` (the page's member name is an `h4`): `<h5 class="text-sm font-medium">…</h5>`, inside `<section class="panel-inset flex flex-col gap-3">`. Use the card's section names where the card has the section.

1. **Profile**
   - (carded only) the **From the card** intro — the existing title + paragraph, copy unchanged — in a `panel-inset` carrying `data-cast-retold`.
   - Section **About**: **Summary** (the member's own block: label, 200 limit, its hint line, its counter — copy unchanged), then **Description** (carded only: the retold row, see below), then **Also known as** (the member's chip editor, hint lines and absorbed-names line, unchanged). This is the card's About order (Summary, Description, Aliases). Give Summary's label and the alias input the card's classes (label `text-surface-600-400 mb-1.5 text-xs`, field `FIELD_CLASS`); keep their copy and behaviour.
   - Section **Status in world** — the existing block (State, Visibility, its help line).
   - The **Character card** block — the existing `data-cast-card` block (Edit the card, Change, Unlink card / Link character, the menu, `CardUpdateOffer`, the dated line), as a `panel-inset` section.
2. **Voice**
   - (carded only) the same **From the card** intro, also with `data-cast-retold`.
   - (carded only) Section **Voice**: the **Personality** and **Scenario** retold rows.
   - (carded only) Section **Greetings**: the Greetings retold row.
   - (carded only) Section **Examples**: the Example dialogues retold row.
   - Section **Instructions**, carrying `data-cast-post-history`: **Post-history instructions** through `ProseField` — `hint="This field will be visible in prompts"`, rows 4. Carded: the *Use from card* switch as `follow`; on → `disabled`, value = the card's (`cardExtras?.postHistoryInstructions ?? ""`), placeholder "The card has none."; off → `bind:value={draft.postHistoryInstructions}` with today's placeholder and `title`. Card-less: just the field.
3. **Notes** — Section **Creator notes**, carrying `data-cast-creator-notes`, through `CreatorNotesFields`:
   - Carded with *Use from card* on: `follow` = the switch, `disabled`, `text` = the card's creator notes, `placeholder="The card has none."`, `languages={false}`.
   - Own (card-less, or switch off): `languages` **true** (the member always shows all its fields; the card hides these behind its Show all fields setting), `bind:text`/`bind:lang`/`bind:variants` on local state, `error={validationErrors.creatorNotesLanguages}`, `onchange={writeNotes}` (below). The member's draft has always carried `lang` and `variants`; until now the form only kept them untouched. This makes them editable as on the card — the supervisor raises it as ★.
4. **Likeness** — the existing likeness block (`data-cast-likeness`: title, *Use from card*, _Uses the card's likeness._ or `LikenessTab` with `owner={{ castMemberId: member.id }}` and `active` as today), then the existing **Sprite set** block under its current condition.
5. **Speech** — the existing voice block (`data-cast-voice`: title "Voice", *Use from card*, _Uses the card's voice._, `VoiceTab`), unchanged.

**Below the panels, always visible:** the existing later-versions line and the save row (Save / Save as of … with its menu) — unchanged.

### Retold rows through the shared components

Today one `{#each retold as r}` draws all five rows. Split them by field (a small lookup such as `rowOf(field)` over `retold`), keeping per row: the wrapper `<div class="flex flex-col" data-retold-field={r.field}>`, the **From the card / Retold here** switch and the **Take from card** button (copy, `name`, `title`, `disabled` rules unchanged) as the `follow` snippet (in a `mb-1.5 flex flex-wrap items-center justify-between gap-2` row), and the _Their own … is kept, hidden._ line after the field, inside the wrapper.
- Text rows (`description`, `personality`, `scenario`, `exampleDialogues`): `ProseField` with `id={fieldId}` (`castRetold-<field>-<memberId>`), `label={r.label}`, `value={r.retold ? draft[field] : r.cardValue}`, `disabled={!r.retold}`, `placeholder={r.retold ? <card's placeholder> : "The card has none."}`, `oninput={(v) => setText(field, v)}`, rows 8. Hints as on the card: description, personality, example dialogues → "This field will be visible in prompts"; scenario → "This field will be visible in prompts (excluded from group sessions)". Card placeholders: "Description...", "Personality...", "Scenario...", "Example dialogue...". Example dialogues stays **one** text (the member's shape) with `class="font-mono"`.
- Greetings: a label (card's label class) `for={fieldId}`, the `follow` row, then retold → `<GreetingsList id={fieldId} greetings={greetingList} onText={setGreeting} onGroupOnly={markGreeting} onRemove={removeGreeting} onAdd={addGreeting} />`; not retold → the existing read-only list / _The card has none._ unchanged. Keep `blankAdded` and the existing greeting functions.
- DOM order of `[data-retold-field]` must stay `description, personality, scenario, greetings, exampleDialogues` (Profile panel precedes Voice). A background member has no `[data-cast-retold]` and no retold rows.

### Creator notes: local state, write-back, validation

- Local state `noteText`, `noteLang`, `noteRows: NoteLanguageRow[]` (type from `characterForms/cardDraft`), seeded from `draft.creatorNotes` (`text`, `lang ?? ""`, `Object.entries(variants).map(([lang, text]) => ({ lang, text }))`) by one function called from `seed()` and right after `useFromCard("creatorNotes", …)`.
- `writeNotes()`: if `noteText !== notesText(draft)` → `draft = withNotesText(draft, noteText)` (exactly today's text path, so a text-only edit sends the same payload as before). Otherwise rebuild lang and variants: `draft.creatorNotes = { text: noteText, ...(code(noteLang) ? { lang: code(noteLang) } : {}), variants: <rows with a non-empty code(lang), in row order, keyed by code(lang)> }` where `code = (s) => s.trim().toLowerCase()` (the card's rule in `cardDraft.ts`). An added empty row changes nothing in the draft, so it is not an unsaved change (STYLE-GUIDE §6.14: *"Unsaved means different from what is saved, not 'touched'."*). Clear `validationErrors.creatorNotesLanguages` on any notes edit.
- `validationErrors = $state<Record<string, string>>({})`; `TAB_FIELDS: Record<"profile"|"voice"|"notes"|"likeness"|"speech", string[]>` = notes: `["creatorNotesLanguages"]`, the others `[]`, with a JSDoc as on the card (name is in the hero and shows its own state there).
- In `save()` and `amend()`, before `submit`: when the member's own creator notes are shown (card-less, or `draft.retold.creatorNotes === true`), `noteLanguageProblem({ creatorNotes: noteText, creatorNotesLang: noteLang, creatorNotesVariants: noteRows })` (from `cardDraft`); a sentence → set `validationErrors.creatorNotesLanguages` and send nothing. The Notes tab then shows the strip's error dot. Don't switch tabs (the card doesn't for these).

## Rules you work under (quoted)

- Lane brief: *"Same tabs, same labels, same order wherever the member has the same fields."* *"Each card-followable field keeps its **Use from card** switch; a card-less member gets just the fields."* *"Nothing is dropped."* *"saving still sends the same payload as before"*.
- CLAUDE.md: *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."* No new user-facing copy beyond what this brief names; no copy edits. If you think a string must change, report it instead.
- CLAUDE.md: *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."* *"`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."* Browser code: *"no `crypto.randomUUID`, no `navigator.clipboard`."* It is a **session**, never a chat.
- Memory rule: never write copy that frames a session as having no lorebook.
- STYLE-GUIDE §6.5: *"One strip, `PanelTabStrip`: labelled tabs, icon 16px plus text at 13px, equal widths, … an optional error dot at the label's top-right. It is for tabs inside a detail or an editor"*. §3.2: the type scale is closed — never a bracketed size like `text-[11px]`.
- Keep every existing `data-*` hook, id scheme (`castOwned-…`, `castRetold-…`, `castOwnName-…`, …) and `name` on switches, so tests and the page keep finding them.
- Edits: change only what the restructure needs; don't reformat untouched code. **Prettier: only the lines you changed** — never `--write` the whole `CastMemberForm.svelte`; you may `--write` your new files. Report `npx prettier --check` results.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`; the owner's `vite dev` is up on :5173.)
- Never `git checkout` / `restore` / `stash`. Never pipe vitest into `head`.

## Tests (done means)

New `memberTabs.dom.test.ts` (model it on `memberOwned.dom.test.ts`), covering:
1. A carded member's form shows the tabs **Profile, Voice, Notes, Likeness, Speech** in that order and no Stats; Post-history instructions (`[data-cast-post-history]`) is inside the Voice panel, Creator notes (`[data-cast-creator-notes]`) inside Notes, Likeness (`[data-cast-likeness]`) inside Likeness, the voice (`[data-cast-voice]`) inside Speech, description inside Profile and the other retold rows inside Voice — each cp-10 field with its *Use from card* switch.
2. A card-less member: the same five tabs; the three cp-10 fields are plain (no *Use from card* switch), no retold rows.
3. A duplicate language in the member's own creator notes: Save sends nothing, the Notes tab says "(has an error)" and the sentence `Language "en" is named twice.` shows; fixing it and saving sends.
4. Payloads: a text-only creator-notes edit sends the same `creatorNotes` as `withNotesText` would (variants and lang kept as they came); editing a language sends `{ text, lang?, variants }` with lower-cased codes; a post-history edit sends what `memberPatch` sends (compare with `memberDraft.test.ts`); toggling a tab never changes the payload.

Run, from the repo root, in the capped scope, logged to `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-b-w2-tests.log`:
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/client/lorebooks/cast/memberTabs.dom.test.ts src/lib/client/lorebooks/cast/castMemberForm.dom.test.ts src/lib/client/lorebooks/cast/castMemberFormLater.dom.test.ts src/lib/client/lorebooks/cast/memberOwned.dom.test.ts src/lib/client/lorebooks/cast/retoldBlock.dom.test.ts src/lib/client/lorebooks/cast/memberVoice.dom.test.ts src/lib/client/lorebooks/cast/memberDraft.test.ts src/lib/client/lorebooks/cast/memberPage.dom.test.ts src/lib/client/lorebooks/cast/memberPageCard.dom.test.ts src/lib/client/lorebooks/cast/memberPageVersions.dom.test.ts src/lib/client/lorebooks/cast/memberCopy.dom.test.ts src/lib/client/lorebooks/cast/memberGallery.dom.test.ts src/lib/client/lorebooks/cast/memberSprites.dom.test.ts src/lib/client/lorebooks/lineConformance.screens.dom.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-b-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-b-w2-tests.log'
```
All pass. Then svelte-check for your files only, under `MemoryMax=12G` / `NODE_OPTIONS=--max-old-space-size=8192`: `npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "lorebooks/cast/(CastMemberForm|UseFromCardSwitch|memberTabs)"` — report what it prints (expect nothing). Don't run the whole `npm test`.

## Report (final message)

Changed / created files; where each block of the old form now sits (one line each); every existing test edit with its reason (or "none"); tests run with exact pass counts; svelte-check lines; prettier per file; any copy you had to touch (expect none); anything you could not do as specified; **Noticed, not done**.
