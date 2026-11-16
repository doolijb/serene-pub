# BRIEF — `timeline-b` worker 2 — the Timeline switch on the lorebook's screens: BookData, the Book settings card, the New lorebook dialog

Supervisor: lane `timeline-b`. Repo: `/home/jody/github/serene-pub` (SvelteKit 5, Svelte 5 runes, TypeScript, Tailwind 4,
Skeleton 5, Vitest 4 + happy-dom). Use absolute paths. Read large files by line range (`LorebooksWorkspace.svelte` is
3.4k lines): search by name, read ranges, re-read the region right before each edit, never reformat.
Client paths below are under `src/lib/client/`.

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`; do not run one.)
- Never `kill -9`. Nothing under `../serene-pub-sdk`. A peer session edits widget files (`PluginFrame`,
  `widgetWire`, `sessionPageProjections`, SDK surfaces), and worker 1 of this lane edits server files and
  `src/lib/shared/sockets/types.ts` at the same time: touch nothing outside **Files owned**.

## Background

A lorebook has a stored 🚧 **Timeline** switch, `lorebooks.timeline_enabled` (wire `timelineEnabled`, boolean,
default on). On, the book keeps time (`docs/lorebook-time.md`); off, it is read as it stands now, written undated,
keeps no history and its story time does not move; nothing dated is deleted. The owner sets it on `lorebooks:update`
(`timelineEnabled`, owner only; notes that overlay a lorebook refuse it and follow their lorebook). The list rows
(`lorebooks:list`, held as `knownBooks` / `book` in `lorebooks/LorebooksWorkspace.svelte` ~316) already carry the whole
row, `timelineEnabled` and `overlayOf` included. No screen reads it yet.

Worker 1 (in parallel) adds, in `src/lib/shared/sockets/types.ts`:
- `Sockets.Lorebooks.Create.Params.timelineEnabled?: boolean` (absent = on; not read with `starterKit`).
- on the **owner's** `lorebooks:get` reply, `lorebook.timelineCounts?: { datedChanges: number; historyEntries: number; clockSet: boolean }`
  (`datedChanges` = dated entry changes + cast changes; `historyEntries` = history entries, dated or not; `clockSet` =
  the book's or any line's clock is set). A shared reader gets none.
Code against exactly these shapes. If `tsc` reports them missing because worker 1 has not landed yet, that is
expected: say so in your report, do not add them yourself.

Owner rulings this builds (quote them in your report where they decide something):
- 2026-11-13: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled";
  "Switch off, allow, but prompt the user with a recommendation to clone as a timeless variant instead. Do not
  provide SDK api for this yet."
- 2026-11-14: the Timeline switch is "a card in Book settings, with the prompt in place". The line chip shows whenever
  a second line exists; lines are untouched by the switch.
- 2026-11-14: a new hand-made lorebook's Timeline: "Off with offer at session creation, and ask when created." This
  worker builds "ask when created" only.
- Standing: nothing is deleted by the switch; lorebook-wide actions are the lorebook owner's alone; a shared reader
  never sees the card.

## Rules (quoted from CLAUDE.md, STYLE-GUIDE.md and the lane brief)

- "Sockets: one domain context per event family is the only listener and the only place that toasts; views never
  call `toaster`." "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler."
  Use `declareInterest` / `awaitReply` (`utils/awaitReply.ts`) as `lorebooks/BookRulesCard.svelte` does.
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." "Browser code runs
  on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." (Request ids: `uuid`'s
  `v4`, as `BookRulesCard.svelte` imports it.) It is a session, never a chat. No other product's name in any file.
  Comments state the rule, not the story.
- Skeleton: before using a Skeleton component, read its section only:
  `grep -n "^# Switch" AI-TEMP/skeleton-llms-svelte.txt` (line ~13438), then `sed -n` that section.
- STYLE-GUIDE §10 Writing: "Sentence case everywhere." "A button says what happens." "Labels are nouns, hints are
  sentences." "No toast for a change the control shows." "A card's title is its control's label: say the setting's
  name once" (so the switch's own label is `sr-only`, `labelHidden`). STYLE-GUIDE §2: "A Skeleton **Switch** keeps its
  filled primary track when on." §6.4 setting cards: the title, one sentence of help, then the control; "a switch at its
  own width at every width".
- Every new label or sentence is exactly the text given here, marked 🚧 in a comment beside it. No other new copy.
  If you need a word this brief does not give, stop and say so in your report.
- **No "Make a timeless copy" button** (lane `timeline-d` adds it): leave no placeholder, no disabled button, no
  comment about it.
- Tests: only your files, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/timeline-b-w2-<n>.log 2>&1"`
  from the repo root, one run at a time. Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`;
  if a run is up (worker 1 or another session shares this checkout), wait and check again each minute (never
  `pgrep -f "vitest run"` in a loop). Never pipe vitest into `head`. Then
  `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/timeline-b-w2-tsc.log 2>&1`; report only errors
  in your files. Do not run `npm run check` or `npm test`. A failing `assert` on a happy-dom element has OOM-killed
  VS Code: assert on booleans / strings (`!!el`, `el?.textContent`), never pass an element to `expect(...).toBe…`.

## Files owned (only these)

`lorebooks/bookData.svelte.ts` · `lorebooks/BookSettings.svelte` · new `lorebooks/time/TimelineCard.svelte` ·
`components/lorebookForms/NewLorebookDialog.svelte` · `lorebooks/LorebookActions.svelte` (the create emit only) ·
`lorebooks/LorebooksWorkspace.svelte` (the `setBookData` provider ~819 and the props it passes to `BookSettings`
~2968 only) · `components/Layout.svelte` (one error-event set only) · new DOM test files beside these, and existing
tests of these components you extend. Not yours: `StartSessionForm.svelte` (and the session page, presets, genres),
any server file, `src/lib/shared/sockets/types.ts`, `NOMENCLATURE.md`, `docs/*`.

## Build

### B. One source of truth: `BookData.timelineEnabled`

`lorebooks/bookData.svelte.ts` (~40–100): add `readonly timelineEnabled: boolean` to `BookData` (doc: "🚧 The open
book's **Timeline** switch (notes over a lorebook answer with their lorebook's, as the list carries it); true when not
known. Every time control reads this, never the row."). Provide it in `LorebooksWorkspace.svelte`'s `setBookData`
(~819) as `book?.timelineEnabled ?? true`. Add it to `staticBookData` (`timelineEnabled?: boolean`, default true). Add
an exported `bookTimeline(): { readonly value: boolean }` beside `bookReadOnly()` (~126), same shape: true outside the
workspace (a component mounted alone, or in a session page). Worker 3 will make every hide read these; you add no
hide except the two in BookSettings below. Check that the list payload's `timelineEnabled` for notes over a lorebook
equals their lorebook's (the server copies it: `src/lib/server/sockets/lorebooks.ts` `lorebooks:update` ~1083–1088,
`lorebooks/ownBook.ts` ~236); report what you find, do not edit the server.

### C. The Timeline card — new `lorebooks/time/TimelineCard.svelte`, mounted in `BookSettings.svelte`

Mount it in `BookSettings.svelte` inside the editable branch (`{:else}` of `{#if readOnly}`, ~388–420), **above**
`StoryClockEditor` (~409). `readOnly` already covers a shared book and a primer page (no card there). Pass it the
book id, `timelineEnabled` (from `getBookData()` in BookSettings, or a prop from the workspace — one value, the
BookData one), and whether the book is notes over a lorebook (`book.overlayOf != null`, passed down from the
workspace as a boolean prop; name it `overlaysLorebook`). Update BookSettings' header comment (~3–15, "There are no
feature switches here…") so it stays true.

The card, in the existing card markup (`section.card preset-filled-surface-100-900 space-y-3 p-3`, heading row as in
`BookRulesCard.svelte` ~103–113 with `Icons.History` — the timeline's glyph, NOMENCLATURE §22):
- Title 🚧 **Timeline**. One sentence 🚧: *Dates, versions over time, history and a story clock. Turn it off for a
  world where nothing needs a date.*
- A switch, pattern `components/admin/pub/SettingSwitch.svelte` (import it, `labelHidden`, label "Timeline").
- **Switching on** saves at once: `awaitReply` on `lorebooks:update` with `{ lorebook: { id }, timelineEnabled: true,
  requestId }`, `errorEvent: "lorebooks:update:error"`, `match`/`matchError` on `requestId` (as `BookRulesCard.svelte`
  ~60–97). No toast (the switch shows it).
- **Switching off**: first read the counts fresh: `awaitReply` on `lorebooks:get` (`params: { id }`, `replyKey:
  interestKey("lorebooks:get", id)`, `match: (d) => d?.lorebookId === id`, `errorEvent: "lorebooks:get:error"`), read
  `lorebook.timelineCounts`. With `datedChanges === 0 && historyEntries === 0 && !clockSet` (or no counts), save off at
  once. Otherwise open the prompt **in place** (inline confirm pattern, `BookRulesCard.svelte` ~124–160: a
  `bg-surface-50-950 rounded-base` group, `role="group"`, an `aria-label`), the switch still showing on:
  🚧 *This lorebook has ‹n› dated versions and ‹m› history entries. With the timeline off they are hidden, not deleted,
  and sessions read the lorebook as it stands now.* (singular when 1: *1 dated version*, *1 history entry*.) Buttons
  🚧 **Cancel** (`preset-tonal-surface`) and 🚧 **Switch off here** (`preset-filled-primary-500`, the region's one
  filled primary). Cancel closes the prompt and changes nothing; Switch off here saves off as above.
- While saving, the switch and buttons are disabled. A refusal shows in the card (`<p class="text-error-600-400
  text-sm" role="alert">`), and the switch returns to the stored value.
- **Notes over a lorebook** (`overlaysLorebook`): no switch, no prompt; the state in words 🚧: *On: these notes follow
  their lorebook's timeline.* or *Off: these notes follow their lorebook's timeline.*
- With the switch **off**, `BookSettings.svelte` does not render `StoryClockEditor` (~409) or `StoryCalendarEditor`
  (~413–419, and its `hidden={!advanced}` wrapper). With it on, both exactly as today.
- Errors: `lorebooks:update:error` is not in `components/Layout.svelte`'s `HANDLED_ERROR_EVENTS` (~118) nor
  `HANDLED_WHEN_ASKED_ERROR_EVENTS` (~372), so Layout toasts it beside the card's own line. Check every client
  sender of `lorebooks:update` (`grep -rln '"lorebooks:update"' src/lib/client`: `BookRulesCard.svelte`,
  `BookWritesCard.svelte`, `EditLorebookForm.svelte`): if every one that sends a `requestId` shows its refusal in
  place, add `"lorebooks:update:error"` to `HANDLED_WHEN_ASKED_ERROR_EVENTS` (refusals naming an asker said in place,
  the rest still toasted). If any sender with a `requestId` relies on the toast, add nothing and report it.

### D. The New lorebook dialog (`components/lorebookForms/NewLorebookDialog.svelte`; emitted from `lorebooks/LorebookActions.svelte` ~158–176)

- The switch is on the dialog's **Blank** way only (~19–23, ~65–66). **Start from a starter lorebook** and **Make a
  lorebook from this kit** (`makeBookFromKit` ~185) send nothing and stay as today.
- The dialog is also mounted by the start form (`components/sessionForms/StartSessionForm.svelte` ~3400), which you
  must not edit and whose create must keep sending nothing (lane `timeline-c` owns that screen). So the switch is
  drawn only when the parent asks: an optional boolean prop `asksTimeline` (default false; doc "Draw the Blank way's
  Keep a timeline switch and send its value."). `LorebookActions.svelte` passes it; the start form does not, so it
  sees no change.
- The switch: label 🚧 **Keep a timeline** (visible label here: the dialog is a form, not a setting card), **off** by
  default each time the dialog opens, with one muted sentence 🚧: *Dates, history and a story clock. You can turn it
  on later in Book settings.*
- `onConfirm`'s details gain `timelineEnabled?: boolean`, set (true or false) whenever `asksTimeline` is on and the way
  is Blank. `LorebookActions.svelte`'s `handleCreateConfirm` puts it on the `lorebooks:create` params when present
  (so the dialog's create always sends it explicitly); `makeBookFromKit` sends none.

## Done means

DOM tests, all passing (new files beside the components, modelled on `lorebooks/bookRulesFit.dom.test.svelte.ts`,
`lorebooks/bookSettingsAdvanced.dom.test.svelte.ts`, `components/lorebookForms/newLorebookKits.dom.test.svelte.ts`):
- the card: on saves at once (one `lorebooks:update` with `timelineEnabled: true`); off with counts prompts with the
  counts and saves nothing until **Switch off here**; off with nothing dated saves at once; Cancel changes nothing;
  notes over a lorebook show the words and no switch; a primer page (and a shared book) shows no card; with the switch
  off, BookSettings renders no clock or calendar editor, and with it on both are there.
- the dialog: with `asksTimeline`, Blank shows the switch, off by default, and confirm sends `timelineEnabled: false`
  (and `true` when turned on); the kit way shows no switch and sends none; without `asksTimeline` no switch and no
  field (the start form's case).
- `BookData.timelineEnabled` / `bookTimeline()`: true by default, false when the row says false.
Also re-run the existing suites of the files you touched (`bookSettingsAdvanced`, `bookRulesFit`, `newLorebookKits`,
`refusalsSaidOnce`, and any `grep -l BookSettings\|NewLorebookDialog\|LorebookActions` test). `tsc` clean in your
files (missing worker-1 types excepted, named).

## Report — `plans/briefs/REPORT-timeline-b-w2.md`

Changed files; tests run with results and log paths; every label and sentence added (🚧) and where; each assumption;
what B's list-payload check found; the error-event decision and why; **Noticed, not done**.
