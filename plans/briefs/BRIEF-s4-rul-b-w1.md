# BRIEF — worker `s4-rul-b-w1` (2026-11-10) — extract the card editor's shared field components

Supervisor: lane `s4-rul-b`. Repo: `/home/jody/github/serene-pub`. Use absolute paths. Report in your final message (the supervisor reads it); do not write a report file.

## Goal

The card editor (`src/lib/client/components/characterForms/CharacterForm.svelte`) draws some tab bodies as inline markup. A second form (the lorebook cast member form, done by another worker after you) must draw the **same fields from the same components**. Your job: extract those pieces into components, and make `CharacterForm.svelte` use them **with no visible or behavioural change at all**. The card editor must look and behave exactly as before; its existing DOM tests are the guard and must pass **unchanged**.

Owner's words this rests on (quote, never reinterpret): *"tabs like card, should probably adapt and reuse the same component/forms"*.

## Files owned (the only files you may edit or create)

New, all under `src/lib/client/components/characterForms/`:
- `fieldClass.ts` — `export const FIELD_CLASS = "input rounded-base"`, with the JSDoc that sits on the const today (`CharacterForm.svelte` ~l.396–401). CharacterForm imports it and its local const goes.
- `formTabs.ts` — the card's `FormTab` type and `FORM_TABS` array moved out of CharacterForm (~l.334–352) unchanged (same values, labels, icons, order: Profile · Voice · Notes · Likeness · Speech · Stats). Export both. CharacterForm imports them. (The member form will reuse this list minus Stats.)
- `PromptBadge.svelte` — props `{ hint: string }`; renders exactly the `promptBadge` snippet's markup (~l.1271–1284).
- `RemoveRowButton.svelte` — props `{ label: string; onRemove: () => void }`; exactly the `removeRowButton` snippet's markup.
- `AddRowButton.svelte` — props `{ label: string; onAdd: () => void }`; exactly the `addRowButton` snippet's markup.
- `ProseField.svelte` — one labelled prose textarea (see API below).
- `GreetingsList.svelte` — the greeting list editor (see API below).
- `CreatorNotesFields.svelte` — the Notes tab body (see API below).

Edited: `src/lib/client/components/characterForms/CharacterForm.svelte` — **only** to use the above in place of the inline markup they replace, import them, and drop the moved consts. Nothing else in that file changes.

Readable: anything. Do not edit any other file — in particular not `src/lib/client/lorebooks/cast/**` (the next worker's), not any test file, not anything server-side, not the SDK.

## The components (exact APIs — the next worker codes against these; don't rename props)

Svelte 5 runes (`$props()`, `$bindable()`), TypeScript, `import * as Icons from "@lucide/svelte"` where icons are needed, `import type { Snippet } from "svelte"`.

### `ProseField.svelte`
Renders, with **no wrapper element**: a `<label for={id}>` then (optional) the `follow` snippet, then a `<textarea>`. The caller provides any wrapper div (the card keeps its own `<div class="flex flex-col">` where it has one).
```ts
interface Props {
  id: string
  label: string
  /** Prompt-visibility hint: when given, a PromptBadge follows the label text. */
  hint?: string
  /** Appends "*" to the label text and sets aria-required="true" on the textarea. */
  required?: boolean
  value?: string            // $bindable(""); the textarea uses bind:value
  rows?: number
  placeholder?: string
  title?: string
  disabled?: boolean        // when true the textarea is disabled and gets `opacity-60`
  /** Extra classes on the textarea, after FIELD_CLASS. */
  class?: string
  /** undefined = no aria-invalid attribute at all; boolean = "true"/"false". */
  invalid?: boolean
  describedBy?: string      // aria-describedby
  oninput?: (value: string) => void   // called after the bound value updates
  /** Drawn between the label and the textarea (the member form's "Use from card" switch). */
  follow?: Snippet
}
```
Label class must equal the card's today: with `hint` → `"text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"`; without → `"text-surface-600-400 mb-1.5 text-xs"`. Textarea class: `FIELD_CLASS` plus `class`, plus `opacity-60` when disabled.

Card call sites to replace (keep every id, rows, placeholder, title and hint text exactly):
- Description, inside StrokeField's `textarea` snippet (~l.1502–1543): `id="charDescription"`, label `Description`, `required`, hint "This field will be visible in prompts", rows 8, placeholder "Description...", `class` = the error border classes when `validationErrors.description`, `invalid={!!validationErrors.description}`, `describedBy` = `"description-error"` when there is an error, `oninput` clears the description error as today. The error `<p id="description-error">` stays in the card, right after the component, inside the snippet.
- Personality, inside StrokeField's `textarea` snippet (~l.1902–1919): `charPersonality`, rows 8, placeholder "Personality...".
- Scenario (~l.1930–1947): `charScenario`, hint "This field will be visible in prompts (excluded from group sessions)". The card keeps its wrapper div.
- Post-history instructions (~l.2100–2120): `charPostHistory`, rows 4, placeholder and `title` as today.
- Leave the StrokeField `labelExtra` snippets as they are (they render the badge beside StrokeField's own label) — just make them render `<PromptBadge>` via the existing snippet.

### `GreetingsList.svelte`
Exactly the card's list branch (~l.1960–2021: the `<div class="flex flex-col gap-3">` holding each greeting row — textarea with `rows={idx === 0 ? 8 : 3}`, `class="{FIELD_CLASS} resize-y"`, placeholder "Greeting...", `aria-label="Greeting N"`, the **Group sessions only** checkbox label, the RemoveRowButton labelled `Remove greeting N` — then the **Add a greeting** button with `Icons.Plus`). The explanatory `<p>` above it ("A new session opens with…") stays in CharacterForm, outside the component.
```ts
interface Props {
  greetings: { text: string; groupOnly?: boolean }[]   // use CharacterGreeting from $lib/shared/characters/profile
  onText: (index: number, text: string) => void
  onGroupOnly: (index: number, groupOnly: boolean) => void
  onRemove: (index: number) => void
  onAdd: () => void
  /** id on the outer div (a label elsewhere may point at it). */
  id?: string
}
```
The textarea becomes `value={greeting.text}` + `oninput` → `onText`. The card passes callbacks that do exactly what its inline code does today: `onText` sets `editCharacterData.greetings[i].text`; `onGroupOnly` writes `{ text, groupOnly: true }` or `{ text }` (absent, not false — keep that comment); `onRemove` splices; `onAdd` pushes `{ text: "" }`. The non-show-all "First greeting" branch stays inline in the card.

### `CreatorNotesFields.svelte`
The Notes tab body (~l.2134–2225): the `<div class="flex flex-col gap-4">` holding the notes text (a `<div class="flex flex-col">` around a `ProseField` with no hint), then — only when `languages` — the **Language** input and **Other languages** rows (each: language input `aria-label="Language N"`, textarea `aria-label="Notes in language N"`, RemoveRowButton `Remove language N`), the error line (`role="alert"`) and AddRowButton "Add a language".
```ts
interface Props {
  textId: string            // card: "charCreatorNotes"
  langId: string            // card: "charCreatorNotesLang"
  text?: string             // $bindable("")
  lang?: string             // $bindable("")
  variants?: NoteLanguageRow[]   // $bindable([]); type from ./cardDraft. Rows are edited in place, added with push, removed with splice — as the card does today.
  /** Show Language and Other languages (the card passes its Show all fields setting). */
  languages?: boolean
  /** The languages' error sentence (the card's validationErrors.creatorNotesLanguages). */
  error?: string | null
  placeholder?: string      // default "Notes from the character creator..."
  disabled?: boolean        // passed to the text's ProseField
  follow?: Snippet          // passed to the text's ProseField
  /** Called after any edit inside the component: text, language, a row's language or text, add, remove. */
  onchange?: () => void
}
```
The card: `<section class="panel-card"><h2 …>Creator notes</h2><CreatorNotesFields textId="charCreatorNotes" langId="charCreatorNotesLang" bind:text={editCharacterData.creatorNotes} bind:lang={editCharacterData.creatorNotesLang} bind:variants={editCharacterData.creatorNotesVariants} languages={userSettingsCtx.settings?.showAllCharacterFields} error={validationErrors.creatorNotesLanguages} /></section>`. Keep the `aria-label="Language of these notes"` on the language input, its `w-24`, the `placeholder="en"` / `"fr"` / `"Notes in this language..."` exactly.

### Snippets in CharacterForm
Keep the `promptBadge`, `removeRowButton` and `addRowButton` snippet **names and call sites**; replace only each snippet's body with the new component (`<PromptBadge {hint} />`, etc.), so the card's other uses (aliases, example dialogues, tags…) are untouched.

## Rules you work under (quoted)

- From the lane brief: *"`CharacterForm.svelte`: **only** to replace inline tab bodies with the extracted shared components; no behaviour change."* and *"The card editor must look and behave **exactly** as before: its existing DOM tests are the guard."*
- CLAUDE.md: *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."* — add no props beyond the APIs above.
- CLAUDE.md: *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."* Browser code: *"no `crypto.randomUUID`, no `navigator.clipboard`."*
- STYLE-GUIDE §3.2: the type scale is closed — never write a bracketed size like `text-[11px]`; reuse the classes already on the markup you move.
- Each new component gets a short header comment saying what it draws and that both the card editor and the cast member form use it.
- **Prettier: only the lines you changed.** Run `npx prettier --check <file>` on each new file (they should pass — you may `--write` a **new** file); never `--write` `CharacterForm.svelte` as a whole. If it fails only on lines you didn't touch, leave it and say so.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`. The owner's `vite dev` is up on :5173.)
- Never `git checkout` / `restore` / `stash`. Never pipe vitest into `head`.

## Tests (done means)

Run in the capped scope, logged to a file in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/` (name it `s4-rul-b-w1-tests.log`), from the repo root:
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/client/components/characterForms/cardVersions.dom.test.svelte.ts src/lib/client/components/characterForms/castEditNote.dom.test.svelte.ts src/lib/client/components/characterForms/likenessDescribe.dom.test.svelte.ts src/lib/client/components/characterForms/VoiceTab.dom.test.svelte.ts src/lib/client/components/characterForms/StrokeField.dom.test.svelte.ts src/lib/client/components/sidebars/charactersSidebar.dom.test.svelte.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-b-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-b-w1-tests.log'
```
All must pass **with no test file edited**. Then a typecheck of your files only: `npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "characterForms/(CharacterForm|ProseField|GreetingsList|CreatorNotesFields|PromptBadge|RemoveRowButton|AddRowButton|fieldClass|formTabs)"` under the same scope with `MemoryMax=12G` and `NODE_OPTIONS=--max-old-space-size=8192` — report any line it prints (expect none). Do not run the whole `npm test`.

## Report (final message)

Changed / created files; for each card call site you replaced, one line confirming id, classes, text unchanged; tests run with the exact pass counts; svelte-check lines; prettier results per file; anything you could not do exactly as specified (and why); **Noticed, not done**.
