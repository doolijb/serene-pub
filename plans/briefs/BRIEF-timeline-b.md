# BRIEF — build lane `timeline-b` — a lorebook's Timeline switch: the lorebook's screens and the server leftovers

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-timeline-a-2026-11-14.md` (whole), `src/lib/server/lorebooks/timeline.ts`,
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §1 ("Timeline off" and "Presets and time") and §8's last block,
`STYLE-GUIDE.md` (component patterns, copy rules), `NOMENCLATURE.md` §1, §24 and the lorebook group section,
`docs/lorebook-time.md`, `docs/lorebooks.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Lane `timeline-a` built the flag `lorebooks.timeline_enabled` (default on) and its server rule; no screen reads
it. This lane makes it usable from the lorebook's own screens and closes the server gaps `timeline-a` queued.
**No migration, no SDK change, no `sdk:build`.** The session side (presets, the start form's offer, real-time
stamps) is lane `timeline-c`; the timeless copy is `timeline-d`. Neither is built here.

## Owner rulings this lane builds (quote them in worker briefs)

- 2026-11-13: "hide all the extra time management noise in entries and the lorebook when timelines aren't
  enabled"; "No history entries for undated lorebooks, maybe scenes only. We can surface a list view purely for
  scenes, and add a history divider and link when enabled"; "Switch off, allow, but prompt the user with a
  recommendation to clone as a timeless variant instead. Do not provide SDK api for this yet."
- 2026-11-14: the Timeline switch is "a card in Book settings, with the prompt in place" (the chosen screen).
  The line chip shows whenever a second line exists; lines are untouched by the flag (`timeline.ts:7-8`).
- 2026-11-14: a new hand-made lorebook's Timeline: "Off with offer at session creation, and ask when created."
  This lane builds "ask when created" only.
- Standing: nothing is deleted by the switch; lorebook-wide actions are the lorebook owner's alone; a shared
  reader never sees the card.

## Build

### A. Server

1. **`lorebooks:create` takes an optional `timelineEnabled`** (`src/lib/server/sockets/lorebooks.ts` ~700–750,
   insert ~733). Absent = on, as today (the start form's own `lorebooks:create`,
   `StartSessionForm.svelte` ~957, sends nothing and must keep behaving as today; `timeline-c` changes that).
2. **Export and import carry the switch.** Export writes one additive optional key only when the switch is
   **off** (`utils/lorebookExportBuilder.ts` ~507–527 beside `serenepub.storyTime`; convention at
   `utils/lorebookExportMapper.ts` ~20–27, ~748–751: no version bump; an unchanged timelined lorebook must export
   byte-identical). `importLorebookDocument` (`sockets/lorebooks.ts` ~5642 → insert ~5182) reads it; absent = on.
   The other arrival paths (one-file import `sockets/import.ts` ~888, attic, primers) stay on by default: do not
   touch them.
3. **Refusals with the switch off**, each with a sentence from `TIMELINE_OFF_SENTENCES` (reuse; add at most one
   new sentence, 🚧, if neither fits):
   - the session history write in `sockets/entries.ts` (Summarize to lorebook's **New** history day;
     `messages/writes.ts` ~334 must not fall back to Year 1);
   - the lorebook's own clock and calendar handlers in `sockets/lorebooks.ts`, and `state/clockMoves.ts`
     `clockMoveProblem`;
   - `changeLoreEntry` (`pipelines/runtime/host.ts`) re-dating a history entry: the date parts are dropped from
     the change, the rest of the change goes through;
   - Apply (`lorebooks/ownBook.ts`): dated held changes and notes' history days **wait** when the target
     lorebook's switch is off, with the sentence as the reason shown where a waiting row's reason is shown
     today (find how ★FD-9's "the day waits with the reason" is surfaced and reuse it). Nothing is applied
     undated, nothing is dropped.
4. **Open sessions learn of a flip.** After `lorebooks:update` changes `timelineEnabled`, tell each open session
   reading that lorebook to re-read its story clock and reading, by emitting the **existing** `story:moved`
   (see `src/lib/client/sessionPage/storyMoved.ts`; scoped events must carry `sessionId`). No new event.
5. **The counts for the prompt.** One read, owner only, returning for a lorebook: dated changes
   (`entry_amendments` with a date + `cast_amendments`), history entries, and whether a clock is set. Reuse what
   `holdsSomethingDated` (`lorebooks/timeline.ts` ~105–160) already queries. Carry it on an existing reply if
   one fits (`lorebooks:get` for the owner); otherwise one new event named per NOMENCLATURE §24 and recorded in
   §25.
6. **The one-time pass, corrected and registered** (`lorebooks/timelinePass.ts`, `startup/index.ts`; pattern:
   the `seat-members` task with `doneMarker`). Rule, replacing the current one for the "else off" case:
   a book with no `overlay_of` stays **on** when it holds anything dated (as built), **or** it is a session's
   whole-world notes and that session's genre keeps story time (`keepsTime: 'story'`,
   `src/lib/server/rulesets/genreOffer.ts` ~25), **or** any session that is not archived reads it and that
   session's genre keeps story time. Otherwise off. Starter kits and primers: leave on (never decided by the
   pass). Notes over a lorebook copy it. A second boot changes nothing (test). Tests: each "stays on" reason; an
   unplayed Living session's notes stay on; a hand-made lorebook with no session and nothing dated goes off.

### B. Client — one source of truth

`BookData` (`src/lib/client/lorebooks/bookData.svelte.ts` ~40–100) gains one derived boolean for the open
book's switch, read from the row `LorebooksWorkspace.svelte` already holds (`book`, ~316; the row already
carries `timelineEnabled`). Every hide below reads that one value; no component reads the row itself. Notes
over a lorebook show their lorebook's value (the server already answers so; check the list payload does, and
fix it on the server if not).

### C. Client — the Timeline card (`BookSettings.svelte`, ~373–420; owner only, never on a primer page)

- A card **Timeline** 🚧 above the clock, in the existing card markup (`section.card preset-filled-surface-100-900
  space-y-3 p-3`), with a switch (pattern: `admin/pub/SettingSwitch.svelte`) and one sentence 🚧: *Dates,
  versions over time, history and a story clock. Turn it off for a world where nothing needs a date.*
- Switching **on** saves at once. Switching **off** opens the prompt **in place** (inline confirm pattern:
  `BookRulesCard.svelte` ~124–160; save with `awaitReply` on `lorebooks:update` + `requestId`, ~60–97):
  *This lorebook has ‹n› dated versions and ‹m› history entries. With the timeline off they are hidden, not
  deleted, and sessions read the lorebook as it stands now.* 🚧 Buttons **Switch off here** and **Cancel**.
  With nothing dated and no clock set, it switches off without the prompt. **No "Make a timeless copy" button**
  (lane `timeline-d` adds it; leave no placeholder, no disabled button, no comment about it).
- With the switch off, `StoryClockEditor` (~409) and `StoryCalendarEditor` (~413–419) are not rendered.
- Notes over a lorebook: the card shows the state in words and no switch (the server refuses the setter there).
- Errors: the event already used is `lorebooks:update`; check `Layout.svelte` `HANDLED_ERROR_EVENTS` covers it
  so a refusal shows once, where the card shows it.

### D. Client — the New lorebook dialog (`components/lorebookForms/NewLorebookDialog.svelte`; emitted from `lorebooks/LorebookActions.svelte` ~176)

A switch **Keep a timeline** 🚧, **off** by default, with one sentence 🚧: *Dates, history and a story clock.
You can turn it on later in Book settings.* The dialog always sends `timelineEnabled` explicitly.

### E. Client — hidden while the switch is off (render nothing; no disabled controls, no explanations in their place)

- The moment bar (`LorebooksWorkspace.svelte` ~2871–2892, mounted ~3289 and ~3303; `time/MomentBar.svelte`).
  **The line chip stays** when the lorebook has a second line: render `BranchChip` alone where the bar was.
  The compare-lines view stays.
- The Time lens and the Lives lens (`lenses/registry.ts` ~96–126; `LensTrack`). A route pointing at a hidden
  lens falls back to the default lens.
- History: the History scope (`shared/lorebooks/loreRoute.ts` ~28–36, `scopes.ts` ~187), the History door in
  the new-entry picker (`EntryWorkspace.svelte` ~628–635, `sections/index.ts` ~199–230), **Add the next date**
  (`sections/HistoryListActions.svelte` ~91), every compile control (`sections/HistoryUnfiledGroup.svelte`
  ~75–101, `sections/HistorySceneList.svelte` ~191–197, `EntryInspector.svelte` ~199 Scenes tab,
  `time/DatedEntryPanel.svelte` ~205). Existing history entries are hidden from lists and search results in
  the lorebook screens, not deleted; a direct link to one opens the lorebook's default view.
- Dated changes: **Save as of** / **Change the base** (`EntryWorkspace.svelte` ~2003–2085, `canAmend` ~998),
  the cast form's equivalent (`cast/CastMemberForm.svelte` ~1902–1943), `time/AmendmentList.svelte` at both
  mounts (`EntryWorkspace.svelte` ~2220, `CastWorkspace.svelte` ~1926), **Off for a while…**
  (`EntryWorkspace.svelte` ~1976–1982, form ~1815).
- Other dated controls: the relationship **When** picker (`graphs/RelationshipFields.svelte` ~198–205), dated
  place links (`places/PlaceLinks.svelte` ~329, ~484), `cast/PresencesPanel.svelte` (mount
  `CastWorkspace.svelte` ~1915), the member **Timeline** tab (`CastWorkspace.svelte` ~840, ~2036–2046), the
  roster's "as of" (`LorebooksWorkspace.svelte` ~2764–2775).
- **Loose ends:** the three time chores (`undated-history`, `doubled-history-date`, `history-before-fork`,
  `looseEnds.ts` ~42–90, ~202–240) are not listed or counted.
- With the switch **on**, every screen is exactly as today (assert this in the DOM tests: on = unchanged).

### F. Client — Scenes

The Scenes scope exists (`loreRoute.ts` ~33, door `sections/index.ts` ~367–387, `scenes:listByLorebook`).
- Switch **off**: Scenes is a scope of its own in the rail (not filed under History, `scopes.ts` ~117–118),
  listing scenes in the order they were played, with no compile control and no dates.
- Switch **on**: as today, plus, inside the Scenes list, a **History** divider after the scenes with a link to
  the History scope and the count of history entries. If today's list already shows this in another form, keep
  today's and report; do not build a second one.

## Files owned

Server: `sockets/lorebooks.ts` (create, update's emit, clock + calendar handlers, import read, the counts),
`sockets/entries.ts` (the session history write only), `messages/writes.ts` (~334 only),
`state/clockMoves.ts`, `pipelines/runtime/host.ts` (`changeLoreEntry` date parts only),
`lorebooks/ownBook.ts` (Apply's waiting rule only), `lorebooks/timeline.ts`, `lorebooks/timelinePass.ts`,
`startup/index.ts` (one task), `utils/lorebookExportBuilder.ts`, `utils/lorebookExportMapper.ts`,
`shared/sockets/types.ts` (the payload fields), new test files beside each.
Client: `lorebooks/bookData.svelte.ts`, `lorebooks/BookSettings.svelte`, a new
`lorebooks/time/TimelineCard.svelte`, `components/lorebookForms/NewLorebookDialog.svelte`,
`lorebooks/LorebookActions.svelte`, `lorebooks/LorebooksWorkspace.svelte`, `lorebooks/time/MomentBar.svelte`,
`lorebooks/lenses/registry.ts`, `lorebooks/scopes.ts`, `lorebooks/looseEnds.ts`, `lorebooks/EntryWorkspace.svelte`,
`lorebooks/EntryInspector.svelte`, `lorebooks/sections/*` named above, `lorebooks/cast/CastWorkspace.svelte`,
`cast/CastMemberForm.svelte`, `cast/PresencesPanel.svelte`, `graphs/RelationshipFields.svelte`,
`places/PlaceLinks.svelte`, `components/Layout.svelte` (`HANDLED_ERROR_EVENTS` only), tests beside each.
Docs: `docs/lorebook-time.md`, `docs/lorebooks.md`, `NOMENCLATURE.md` (rows + §25), `STYLE-GUIDE.md` only if a
rule moves. Paths above are as the sweep reported them; verify each before editing.

`host.ts`, `ownBook.ts` and `NOMENCLATURE.md` are shared: one worker at a time in each, small edits, re-read the
region right before editing, never reformat. A peer session is editing widget files (`PluginFrame`,
`widgetWire`, `sessionPageProjections`, SDK surfaces): do not touch those.

## Out of scope — written down, never built

Presets, genres, `keepsTime`, fit sentences, the start form, the session page, message stamps, the Chronicle
widget, anything under `../serene-pub-sdk`; the timeless copy and its button; Beginning and Decay; the versions
timeline; changing any creation default other than the dialog's; deleting or converting dated data; lines.

## Stop and ask when

CLAUDE.md §Decisions applies; a migration seems needed; a hide would also remove something that is not a time
control; the Apply waiting rule has no existing place to show a reason; the pass's corrected rule cannot tell a
session's genre inside its transaction; any name beyond those marked 🚧 above is needed.

## Rules

- Sockets: one domain context per event family is the only listener and the only place that toasts; views never
  call `toaster`. `socket.off(event)` always with the handler. A scoped event carries its scope key.
- `$state(new Set())`/`new Map()` is not reactive: `SvelteSet`/`SvelteMap`. Browser code: no
  `crypto.randomUUID`, no `navigator.clipboard`. It is a session, never a chat. No other product's name in any
  file. Comments state the rule, not the story.
- Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a row at a fixed id.
- Skeleton components: grep the one section of `AI-TEMP/skeleton-llms-svelte.txt` before using one.
- Tests: only the lane's files and the suites touched, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/timeline-b-<n>.log 2>&1"`
  from the repo root, one run at a time. Before each run check
  `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if a run is up, wait and check again each minute
  (never `pgrep -f "vitest run"` in a loop). Never pipe vitest into `head`. An int test that opens a DB inside
  an `it` takes a 60 s timeout. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`. Do not run
  `npm run check` or `npm test`; the lead does.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane needs no `sdk:build`.)
- Never `kill -9`. Never edit server files while a dev instance is booting.

## Done means

- Server tests: create with and without the field; export byte-identical when on, key present when off, import
  round trip; each refusal in A3 (and the on-path unchanged); Apply's waiting rows; the `story:moved` emit on a
  flip (and none when another field changes); the counts (owner only); the pass (cases in A6, second boot).
- DOM tests: the card (on saves at once; off prompts with the counts; Cancel changes nothing; notes over a
  lorebook show no switch; a primer page shows no card); the dialog sends the switch, off by default; with the
  switch off each item of E is absent and with it on present; the line chip alone when a second line exists;
  Scenes per F; Loose ends counts.
- `tsc` clean. Docs updated: `docs/lorebook-time.md` loses its 🚧 "not reachable from a screen" note and
  describes the card, the dialog and what is hidden; NOMENCLATURE rows and §25.

## Report — `plans/REPORT-timeline-b-2026-11-14.md`

Changed files; tests run with results; every sentence and label added (🚧, for the owner to rule); each place a
hide was not possible and why; open ★; **Noticed, not done**. State plainly that nothing was looked at in a
running app unless it was.

## Corrections from the cold review (2026-11-14) — these rule over the text above

1. **A4: `story:moved` is not a socket event** (the session page sends it to its own widgets,
   `src/lib/client/surfaces/panelManager.svelte.ts` ~612; `src/lib/client/components/sessionPage/storyMoved.ts`).
   Emit the existing scoped **`state:changed`** instead, with the pattern `tellSessions` has in
   `src/lib/server/sockets/lorebookState.ts` ~215–228 (the page already turns it into `story:moved`). Reach both
   sessions attached to the lorebook and a session whose whole world is the notes being switched. Check on the
   client that the session re-reads its story clock on it (`sessions:storyClock`); if it does not, report it
   under Noticed and leave the session page alone (it is `timeline-c`'s).
2. **A6: `keepsTime` lives only in the live genre registry** (`getGenre`, as `rulesets/genreFit.ts` ~110 reads
   it; `genreOffer.ts` ~25 is only a type). So: register the task **after** the `plugins` task
   (`startup/index.ts` ~467–472), read `sessions.genre_id` through `tx`, and **when a session's genre does not
   resolve (retired, plugin disabled or missing), the book stays on**. Test both.
3. **A6: what keeps a book on.** Any history entry, dated or not, counts (not only one with a year,
   `timeline.ts` ~139). A session reading the book counts **whether archived or not**. So "off" is only: no
   `overlay_of`, not a kit or primer, nothing dated, no history entry, no clock, default calendar, one line, and
   no session of a story-time or unresolvable genre reading it or owning it.
4. **E: the member Timeline tab is not hidden** (`lorebooks/CastWorkspace.svelte` ~840, ~2036–2046;
   `lorebooks/cast/MemberTimeline.svelte` lists the scenes a member is in). With the switch off it keeps its
   label and its scenes and drops dates and anything about "later". Correct paths:
   `src/lib/client/lorebooks/CastWorkspace.svelte`, `src/lib/client/lorebooks/cast/PresencesPanel.svelte`.
5. **D: the switch is on the dialog's Blank way only** (`NewLorebookDialog.svelte` ~19–23, ~65–66). **Start
   from a starter lorebook** and **Make a lorebook from this kit** send nothing and stay as today.
6. **A3 Apply: where the reason shows.** ★FD-9 is not built; do not look for it. A dated held change gets its
   reason through the conflict reason Apply already computes (`heldChangeVerdict`, `lorebooks/ownBook.ts`
   ~1447–1510; listed ~1794; shown at `SessionViewPanel.svelte` ~694–699, which also hides that row's Apply
   button). A notes' history day that waits gives its reason in the Apply reply, as waiting days do today
   (`SessionViewPanel.svelte` ~174–177). Do not edit `SessionViewPanel.svelte`; if the reason cannot reach it
   without an edit, stop and report.
