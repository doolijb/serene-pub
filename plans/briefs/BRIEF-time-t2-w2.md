# BRIEF — worker `time-t2-w2` — an entry's Beginning and Decay: the row in the entry form

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t2` (brief `plans/briefs/BRIEF-time-t2.md`, readable for
context; this brief rules where they differ). A server worker (`time-t2-w1`) is building the server half at the same
time in other files; never edit a server file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

Every lorebook entry except History gets one quiet, collapsed row in its editor showing two properties in words, and
opening on demand to set them:

- **Beginning** — *Perpetual* (no date) or *Began at ‹date›*. Stored as the entry's own `year`, `month`, `day`
  (numbers; `null` = Perpetual), the same three keys a history entry uses for its date.
- **Decay** — *Fact* (rate 0) or *Living* (rate above 0, at most 1). Stored as `decayRate` (number). Nothing uses it
  for recall yet, and the row must say so.

## The wire (contract with the server worker)

Every entry row the client receives carries `decayRate: number` (0–1). A non-history row also carries
`year`, `month`, `day` (`number | null`). A new draft may lack all four: treat absent `decayRate` as 0 and absent
date parts as Perpetual. The row edits `draft.decayRate`, `draft.year`, `draft.month`, `draft.day` in place; the
entry's own Save sends the changed ones (`changedFields` diff, already wired). The Timeline card's counts reply
gains `beginnings: number` (the server worker adds the type; until then `tsc` may complain in `TimelineCard` — say
so in your report rather than casting it away).

## Owner rulings (quoted; build to them)

- 2026-11-13: "Decay: Fact | Living" and "Beginning: Perpetual | Began at date"; "Yes on labels."
- 2026-11-14: the screen is **the entry's own row in words**, collapsed, opening on demand: "Keep the form quiet.
  Beginning and Decay sit in one collapsed row that shows its values in words and opens on demand; the defaults
  should make it rare to open."
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled."
  With the lorebook's Timeline off, Beginning is not shown or settable; Decay stays.
- Standing: cast members get no Decay and no Beginning; history entries keep their own date editor (this row does
  not replace it and is not drawn on a history entry).
- Lead's correction (P1, never imply a behaviour that is not there): **no word of fading**. No *slowly / steadily /
  quickly*, no "fades". The collapsed row and the slider show the number.

## Files owned (edit only these)

- new `src/lib/client/lorebooks/time/BeginningDecayRow.svelte` and its test
  `src/lib/client/lorebooks/time/beginningDecayRow.dom.test.svelte.ts` (plus a small fixture/probe component beside it
  if a context is needed, named `BeginningDecayRow*.svelte`)
- `src/lib/client/lorebooks/sections/EntryAdvancedFields.svelte` (mount the row) and
  `sections/entryAdvancedFields.dom.test.svelte.ts`
- `src/lib/client/lorebooks/EntryWorkspace.svelte` (only the dimming below) and a test for it
  (`src/lib/client/lorebooks/entryWorkspace.beginning.dom.test.svelte.ts`, reusing `EntryWorkspaceFixture.svelte`
  read-only if it serves)
- `src/lib/client/lorebooks/time/storyTime.test.ts` (one added case; do not edit `storyTime.ts` unless the case
  shows it labels such an entry as history — then stop and report instead)
- `src/lib/client/lorebooks/time/TimelineCard.svelte` and `time/timelineCard.dom.test.svelte.ts` (the count only)

Readable: anything. Do not edit any other file (not `sections/index.ts`, `entryDrafts.ts`, `HistoryEditor.svelte`,
`LorebooksWorkspace.svelte`, `TimeLens.svelte`, any server or shared file). If you need one, stop and report.

## Build

### 1. `time/BeginningDecayRow.svelte`

Props: `draft` (bindable `Record<string, any>`), `idPrefix: string`. Reads the Timeline switch with
`bookTimeline()` (`lorebooks/bookData.svelte.ts`; `.value` is true outside the workspace). Date words with
`formatDate(date)` from `sections/historyDates.ts` (it uses the book's calendar, `openBookTime.calendar`, when one is
declared). Calendar hint like HistoryEditor's (`dateProblem` from `$lib/shared/lorebooks/storyDate`).

Collapsed: one disclosure button (`aria-expanded`, `aria-controls`), sentence-case text, values in words:

- Timeline on: *Perpetual · Fact* · *Perpetual · Living · 0.25* · *Began at ‹date words› · Fact* ·
  *Began at Year 12, Mo. 3, Day 4 · Living · 0.25* (whatever `formatDate` gives).
- Timeline off (Beginning hidden): *Decay: Fact* · *Decay: Living · 0.25*.
- The number: up to two decimals, no trailing zeros (0.5, 0.25, 1).
- Its accessible name may add the words *Beginning and decay* before the values (an `aria-label` only).

Open (below the button, inside the same row; no dialog, no popover):

- **Beginning** (a `fieldset` with legend *Beginning*; not drawn at all with the Timeline off): two radio choices
  *Perpetual* and *Began at*. *Began at* shows Year / Month / Day number inputs like `sections/HistoryEditor.svelte`
  ~60–115 (same classes, labels Year, Month, Day; year required while Began at is chosen) and the calendar hint
  (*Reads as ‹date›* or the problem). Choosing *Perpetual* sets all three to `null`. Choosing *Began at* with no year
  leaves the inputs empty for the person to fill (do not invent a date). Help, one sentence: 🚧 *The entry is not
  read before this date.*
- **Decay** (a `fieldset` with legend *Decay*): radio *Fact* and *Living*. *Fact* sets `decayRate = 0`. *Living* on
  a rate of 0 sets 0.25; *Living* shows a range input 0–1, step 0.01, `aria-label` *Decay rate*, with its number
  shown beside it. Help, one sentence: 🚧 *Stored now; recall does not use it yet.*
- `bind:value` on a number/range input yields a number; keep the draft's values numbers (`null` for empty date
  parts, never `""`).
- **Never write the draft on mount or on open** (the form's unsaved-changes check compares the draft with what was
  saved; a write the person did not make shows a false *unsaved changes*). Only a person's choice writes.
- Read-only: the editor sits inside a `<fieldset disabled>` in `EntryWorkspace` (~2271); every input of the row must
  be disabled there (native inheritance is fine; verify in the test).
- No toast, no socket, no `crypto.randomUUID`, no `navigator.clipboard`, no `$state(new Set())` (use `SvelteSet`).
- Styling: STYLE-GUIDE — sentence case; roles with stops, no hex; help text `text-xs text-surface-700-300`; 44px touch
  target for the toggle; no gold (filled primary) on the toggle or radios; it should look as quiet as the
  *Matching* fold's summary in `EntryAdvancedFields.svelte`.

### 2. Mount it (`sections/EntryAdvancedFields.svelte`)

Draw `<BeginningDecayRow bind:draft {idPrefix} />` above the advanced block (before the `{#if advanced}` …
`AdvancedHiddenLine` branch, so it shows whether or not advanced controls are on), and **not** when
`draft.typeId === HISTORY_TYPE_ID` (`$lib/shared/entries/types`). Check that in every editor that uses
`EntryAdvancedFields` (World lore, Character lore, Place, Item, Derived) the row lands below the type's own fields.
`GenericEntryEditor` has no advanced fields; leave it (report it).

### 3. Dimming at a moment (`EntryWorkspace.svelte` `dimmedKeys`, ~540)

Today only `HISTORY_TYPE_ID` rows are asked whether they are later than the moment being read. Ask every ENTRY row
(not scenes, not cast) whose source row has a numeric `year`; History's behaviour stays exactly as it is. Rewrite the
doc comment above it so it states the rule (any dated entry: a history entry's date or another entry's Beginning).

### 4. `time/storyTime.test.ts`

Add a case: a world lore entry with `year: 12` (and a name) is drawn by `storyItems` at its date. Report the `kind`
and label it gets. If it is labelled as history, stop and report (do not edit `storyTime.ts`).

### 5. `time/TimelineCard.svelte`

The switch-off prompt lists what the lorebook holds; add `counts.beginnings` with the others, in the same `plural`
style: 🚧 *‹n› entry with a beginning* / *‹n› entries with a beginning*. A count of 0 says nothing. Add a test case.

## Tests (Done means)

`beginningDecayRow.dom.test.svelte.ts`: the collapsed words for each combination above (Timeline on and off);
opening shows both editors with the Timeline on and only Decay with it off; Perpetual → nulls; Began at with typed
numbers; Fact → 0; Living from 0 → 0.25; a stored 0.37 shows 0.37 on the slider's number; nothing written on mount
or open; read-only disables every input. `entryAdvancedFields.dom.test.svelte.ts`: the row is drawn for world lore and
not for history. The EntryWorkspace test: at a moment before a world lore entry's Beginning its row is dimmed, at or
after it is not (if the fixture makes this too costly, extract nothing; report what you tested instead).
`storyTime.test.ts`, `timelineCard.dom.test.svelte.ts`: the new cases.

Look at existing DOM tests for setup (`time/timelineCard.dom.test.svelte.ts`, `entryWorkspace.timeline.dom.test.svelte.ts`,
`bookTimeline.dom*`) — how a book context with `timelineEnabled` is provided. Heavy DOM tests: keep them small; a
failing assert on a happy-dom element has OOM-killed VS Code before.

Run each file like this, one run at a time, from the repo root:

```
ps -eo pid,args | grep -E "node.*vitest" | grep -v grep   # wait while anything is listed
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t2-w2-<n>.log 2>&1"
```

Never pipe vitest into `head`. Also run the existing `entryWorkspace.timeline.dom.test.svelte.ts` and
`lorebooksWorkspace.timelineOff.dom.test.svelte.ts` as regressions. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/time-t2-w2-tsc.log 2>&1` and report the error
count and any error in your files. Do not run the full suite.

## Hard rules

- Comments state the rule, not the story: no "no longer", "used to", "now", "previously" narration (a ratchet test
  counts them).
- No `prettier --write` on a directory (per file you own is fine).
- No new user-visible word beyond: *Beginning*, *Perpetual*, *Began at*, *Decay*, *Fact*, *Living*, *Decay rate*
  (aria), *Beginning and decay* (aria), the two help sentences and the Timeline card count above, and the existing
  *Year*, *Month*, *Day*, *Reads as*. If you need another, stop and report.
- `socket.off(event)` always with its handler (you should need no socket at all).

## Report

Your final message: changed files, every label and sentence you added (verbatim), tests run with pass/fail counts and
log paths, tsc error count, what `storyTime` calls a dated world lore entry, and **Noticed, not done**. Under 600 words.
