# BRIEF — worker `entry-form-layout-w1` — the closed words of the entry zone, and the row that holds the entry's fields

Repo `/home/jody/github/serene-pub`. Supervisor: lane `entry-form-layout`. You type one pure helper and change one
component, each with its tests. A second worker later moves the form's layout in `EntryWorkspace.svelte`; you do
not touch that file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

The lorebook entry form's one-line row (`time/BeginningDecayRow.svelte`, today: Beginning and Decay, collapsed, with
the line words *On main*) becomes the home of the entry's own fields. Closed, it is one line that says them in words:
*On main · Perpetual · Fact · no keywords · top level*, or *On Duel lost · Began at Year 5 · Living · 0.25 · 3
keywords · part of The Hill · pinned*. Open, it shows in this order: Beginning, Decay, then what the form puts in it
(Keywords, Part of, Pinned, Off — passed as `children`), then one **Change from this version…** control, then the
line (*On ‹line›*) with its action (**Move down the tree…**, passed as `lineAction`).

Owner rulings (quote, do not reinterpret):
- 2026-11-14, the zones: "A makes sense" — a field is the entry's until it is made to differ at a date (Keywords,
  Pinned, Off, Part of); **Change from this version…** / **Make it the same everywhere**.
- 2026-11-15: "Name and Content first, beside the rail. Fold the four entry-held fields into the one-line entry row,
  so it reads 'On main · Perpetual · Fact · no keywords · top level' and opens on demand. Show a single 'Change from
  this version…' link inside that row." — owner: "Your recommendation, ok".
- 2026-11-14: "Keep the form quiet. Beginning and Decay sit in one collapsed row that shows its values in words and
  opens on demand; the defaults should make it rare to open."
- It changes where things are drawn, never what is saved.

## Files owned (edit only these)

- NEW `src/lib/client/lorebooks/time/entryZoneWords.ts` and NEW `src/lib/client/lorebooks/time/entryZoneWords.test.ts`
- `src/lib/client/lorebooks/time/BeginningDecayRow.svelte` (keep the file name)
- `src/lib/client/lorebooks/time/beginningDecayRow.dom.test.svelte.ts`

## Files readable

`time/entryVersions.ts` (`ZoneField`, `ZONE_FIELDS`), `time/versionZones.ts` (`CHANGE_FROM_VERSION_LABEL`),
`$lib/shared/entries/keyList.ts` (`keyList`), `$lib/shared/entries/types.ts` (`isFileableEntryType`),
`editor/PartOfField.svelte` (how "fileable" is decided: `typeof draft.typeId !== "string" ||
isFileableEntryType(draft.typeId)`), `sections/historyDates.ts` (`formatDate`), `STYLE-GUIDE.md` §9 and §10.

## Task 1 — `time/entryZoneWords.ts` (pure; no Svelte, no `openBookTime`, no calendar)

Export one function (the name `entryZoneWords` is chosen: "entry row" already names a list row, so code says
*entry zone*, the form's term for the entry's part):

```ts
export interface EntryZoneWordsInput {
	/** The book keeps a timeline: the line and the Beginning are said. */
	timeline: boolean
	/** *On ‹line›*, said first with the Timeline on, when given. */
	lineWords?: string | null
	/** The Beginning already in words (*Year 5*), or null for Perpetual. */
	beganAt: string | null
	decayRate: number
	/** Which of the four the row holds; the others differ by version and are left out. */
	held: readonly ZoneField[]
	keyCount: number
	/** False for a type that is never filed (a place): no parent words. */
	fileable: boolean
	/** The parent's name; null is top level. */
	parentName: string | null
	pinned: boolean
	off: boolean
}
export function entryZoneWords(input: EntryZoneWordsInput): string
```

Parts, joined with `" · "`, in this order:
1. Timeline on and `lineWords` non-empty: `lineWords`.
2. Timeline on: `Began at ${beganAt}` or `Perpetual`. Timeline off: nothing.
3. Decay: `Fact` when the rate is 0 (or not above 0), else `Living · ${rate}` with the rate as
   `String(Number(rate.toFixed(2)))` (0.25, 0.6, 1). With the Timeline off the decay part is prefixed `Decay: `
   (*Decay: Fact*, *Decay: Living · 0.6*), exactly as the row says today.
4. `keys` held: `no keywords` / `1 keyword` / `${n} keywords`.
5. `anchorEntryId` held and `fileable`: `top level` / `part of ${parentName}`.
6. `constant` held and pinned: `pinned`. 7. `enabled` held and off: `off`. (Neither is said when not set.)

Tests (`entryZoneWords.test.ts`): both owner examples verbatim; Timeline off (*Decay: Fact · no keywords · top
level*); empty `held` gives today's words (*On main · Perpetual · Fact*, *Perpetual · Fact*, *Decay: Fact*); each
field left out when not held; 1 keyword vs n; a place (not fileable) has no parent words; pinned and off only when
set; rate formatting.

## Task 2 — `time/BeginningDecayRow.svelte`

Keep every current behaviour (radios, year/month/day inputs, the calendar line, the decay slider, "⚠ Only a person's
choice writes the draft", the `data-lore-*` attributes, `idPrefix`). Change:

- **New props** (all optional, defaults keep today's use working):
  - `open?: boolean` — `$bindable(false)`; replaces the internal `open` state.
  - `disabled?: boolean` (default false) — every control inside the open region sits in one
    `<fieldset disabled={disabled} class="flex min-w-0 flex-col gap-3">`; the toggle is **outside** it and stays
    live (a reader can fold and unfold; read-only forms open it, see below).
  - `held?: readonly ZoneField[]` (default `[]`) — which of the four the form put in the row, for the words.
  - `parentName?: string | null` (default null).
  - `promotable?: readonly { field: ZoneField; name: string }[]` (default `[]`) and
    `onPromote?: (field: ZoneField) => void` — the one **Change from this version…** control.
- **The words** come from `entryZoneWords` with `timeline: timeline.value`, `lineWords`, `beganAt: hasYear ?
  formatDate(date) : null`, `decayRate: rate`, `held`, `keyCount: keyList(draft.keys).length`, `fileable` as
  PartOfField decides it, `parentName`, `pinned: !!draft.constant`, `off: draft.enabled === false`. Remove the old
  `summary` code.
- **The toggle**: still a `button` with `aria-expanded` and `aria-controls` (the region id), `min-w-0 flex-1`; the
  words span (`data-lore-beginning-decay-words`) gets `truncate`; the button gets `title={words}` and
  `aria-label="The entry: {words}"` (🚧 new accessible name, replacing *Beginning and decay: ‹values›*, because the
  row now says more than those two). Keep the toggle as the first `button` inside the first `div` child of the
  `[data-lore-beginning-decay]` root: a focus-return selector elsewhere is
  `[data-lore-beginning-decay] > div > button:not(:disabled)`.
- **The open region** (`id={regionId}`, `hidden={!open}`, contents only `{#if open}`), in this order:
  1. the fieldset above, holding Beginning (Timeline on only, as today), Decay, then `{@render children?.()}`
     (children move **inside** the fold; today they draw between the toggle and the fold);
  2. when `promotable.length > 0`, outside the fieldset: one quiet button `CHANGE_FROM_VERSION_LABEL`
     (`text-surface-700-300 min-h-11 self-start text-left text-xs underline`, `aria-expanded`, `aria-controls`) that
     unfolds in place a `role="group"` with `aria-label="Change from this version"` holding one
     `btn btn-sm preset-tonal-surface min-h-11` button per entry, text = `name`, `aria-label="Change {name} from this
     version"`, `data-lore-change-from-version={field}`; pressing one closes the group, calls `onPromote(field)`, and
     then (after `tick()`) puts focus back on the **Change from this version…** button if it is still drawn, else on
     the row's toggle. No new sentence: no help line.
  3. outside the fieldset, the line: `{#if (timeline.value && lineWords) || lineAction}` a
     `<div class="flex flex-wrap items-center gap-x-3" data-lore-entry-line>` with
     `<span class="text-surface-700-300">{lineWords}</span>` (only with the Timeline on and lineWords given) then
     `{@render lineAction?.()}`. `lineAction` no longer draws beside the toggle.
- **Opens by itself on a problem inside it**: when the calendar line has a problem (`calendarHint?.problem`), an
  `$effect` sets `open = true`. It never closes the row by itself.
- Update the doc comment: the row is the entry zone's row (line, Beginning, Decay, and the entry's own fields the
  form passes in); comments state the rule, not the story.

## Task 3 — `time/beginningDecayRow.dom.test.svelte.ts`

Update only what pins the old placement, and list each change in your report: the `aria-label` assertions now expect
`The entry` (and the words); "children draw outside the closed fold" becomes "children draw inside the fold, after
Decay"; the `lineAction` test (if any asserts it beside the toggle) now opens the row first. Add tests: closed words
with `held` and `parentName` (both owner examples); `open` as a prop (drawn open; toggling updates it);
`disabled` disables every input and button in the region while the toggle stays enabled; the change control: absent
with empty `promotable`, lists exactly the given fields, pressing one calls `onPromote` with that field and closes the
group; the line shows *On main* and the action inside the open region. Keep the file's rule: no DOM node is ever
handed to `expect`.

## Rules (verbatim, apply to everything you write)

- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`.
- Views never call `toaster`; `socket.off(event)` always with the handler. No `crypto.randomUUID`, no
  `navigator.clipboard` (browser code runs on plain-http LAN addresses).
- STYLE-GUIDE §9: every interactive element is a real `button` or input with an accessible name; never an interactive
  inside an interactive; `aria-expanded` on anything that opens; nothing hover-only; targets 44px (`min-h-11`).
- STYLE-GUIDE §10: sentence case; reuse existing words; help is one sentence.
- Comments state the rule, not the story. Never `prettier --write` beyond the lines you changed
  (`npx prettier --check <file>` to look).
- No new names beyond `entryZoneWords`, `EntryZoneWordsInput`, the props listed, and the labels quoted here.

## Done means

From the repo root, one at a time, first checking `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and
waiting (poll every 30 s) while one runs; never pipe vitest into `head`:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/time/entryZoneWords.test.ts src/lib/client/lorebooks/time/beginningDecayRow.dom.test.svelte.ts > plans/entry-form-layout-w1.log 2>&1"`

Both pass. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` shows no error in your files
(report errors elsewhere as not yours). Do not run the full suite, `npm run check` or a build.

## Report

Return your report as your final message (do not write a report file): changed files, tests run with results (counts,
log path), each test changed and why, assumptions, **Noticed, not done**. Under 400 words.
