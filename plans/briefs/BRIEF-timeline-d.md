# BRIEF — build lane `timeline-d` — the timeless copy of a lorebook

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-timeline-a-2026-11-14.md`, `plans/REPORT-timeline-b-2026-11-14.md`,
`src/lib/server/lorebooks/timeline.ts`, `src/lib/shared/lorebooks/lineReading.ts` (header ~14–28),
`src/lib/server/lorebooks/tableRegistry.ts` (header and `LorebookTableSpec` ~61–127), `NOMENCLATURE.md` §1, §24
and the lorebook group section, `docs/lorebook-time.md`, `docs/lorebooks.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

A lorebook's owner who switches its Timeline off is asked first (lane `timeline-b`, the Timeline card in Book
settings). This lane adds the recommended way out: **Make a timeless copy**, a new lorebook that keeps each
entry and cast member as it reads now on the line being read, undated, with its Timeline off. The source is
never changed. **No migration, no SDK change, no new socket event.**

## Owner rulings this lane builds

- 2026-11-13: "Switch off, allow, but prompt the user with a recommendation to clone as a timeless variant
  instead. Do not provide SDK api for this yet."
- 2026-11-13, the lead's description, confirmed "Sounds good": a copy that keeps each entry as it reads now on
  the line being read, without dates, versions or other lines; scenes kept; history entries left out.
- 2026-11-14, the chosen screen: the prompt's buttons are **Make a timeless copy** (the primary, gold button),
  **Switch off here**, **Cancel**; its text ends *A timeless copy keeps this one as it is.*
- Standing: nothing in the source is deleted or changed; an entry's edit history never travels with a copy.

## What "as it reads now" means here (lead's decision, ★T-D1)

The reading is `readingOf(db, sourceId, { branch: <the line open in the workspace> })` at **that line's
present**: the line's own clock when one is set, else the head of the line (every dated change on the line
applied). For main with no clock but dated history, use what `bookPresentOf` gives
(`src/lib/server/characters/versions.ts` ~1178). State the moment used in the reply so the screen can say it.

## Build

### A. Server — `src/lib/server/lorebooks/timelessCopy.ts` (new), one transaction, only `tx`

`makeTimelessCopy(tx, { sourceId, branchId, userId, name })`:
1. Compute the reading on the **source** and, from the source, what reads on it (before copying, so the answers
   come from the existing readers):
   - entries: which read on the line (`entryOnReadingSql`, `state/entriesOnReading.ts` ~69) and each one's
     folded wire row (`toEntryRow`, `utils/lorebookEntries.ts` ~269 → `entryOverlaysFor` ~99 → `entryAt` ~155);
   - cast: the version in force per member (`castVersionsInForce`, `cast/memberAsRead.ts` ~726);
   - links and stats in force (`rowsOnReading`, `state/reading.ts` ~599; `inForce`, `state/resolve.ts` ~543);
   - scenes on the line.
2. `duplicateLorebookRows` (`utils/lorebookDuplicate.ts` ~71–125) into the copy, keeping its id maps.
3. **Flatten the copy** (never the source), in an order that survives the cascades:
   - **Entries.** For each entry that reads: write its folded fields into its stored columns
     (`splitUpdate`, `lorebookEntries.ts` ~673; a folded `anchorEntryId` / `lorebookBindingId` goes through the
     id maps), `branch_id = NULL`. Delete entries that do not read (other lines, rows past a fork cut). Delete
     every `entry_amendments` row of the copy.
   - **History entries are left out.** Before deleting them: unfile their scenes (`scenes.history_entry_id =
     NULL`; the FK cascades otherwise), and un-anchor any non-history entry anchored under one
     (`anchor_entry_id` cascades, `db/schema.ts` ~9126) so it is kept at the top level.
   - **Scenes** that read on the line are kept: `history_entry_id = NULL`, `branch_id = NULL`, the opened and
     closed story-clock stamps cleared. Scenes of other lines go.
   - **Cast.** The version in force becomes the member's base version (main, undated, no life point, no history
     day, no source session; `isBaseVersion`, `versions.ts` ~2029). Delete every other version **first**
     (unique index `db/schema.ts` ~9774, CHECK ~9833). A member with no version in force on the reading is
     left out with its binding only if nothing kept refers to it; otherwise keep its base. `cast_presences`
     of the copy are deleted. `lorebook_bindings.history_entry_id = NULL`.
   - **Links** (`narrative_relationships`): those in force are kept with `history_entry_id = NULL`,
     `branch_id = NULL`; ended and superseded rows are deleted **before** the dates are cleared (unique
     `entry_pair_uq`, ~5361).
   - **Stats** (`attribute_values`, `attribute_configs`): the row in force per owner and slot is kept, undated,
     on main; the others are deleted first.
   - **Lines.** After every kept row is on main, delete the copy's `lorebook_branches`.
   - **The lorebook row:** `story_clock_*` NULL, `story_calendar` NULL, `timeline_enabled = false`.
   - Any other table with a `branch_id` or a history-day reference (`state_proposals`, and whatever
     `tableRegistry.ts` marks `lineScoped`): rows of the line being read move to main undated; others go. List
     each table handled in the report. If a table's rule is not obvious, stop and report.
4. Queue the copy's entries for embedding (`enqueueLorebookGroup`, `embedding/vectorizationQueue.ts` ~673)
   after the transaction commits.
5. Return the new lorebook and the moment used.

### B. Server — the socket

`lorebooks:duplicate` (`sockets/lorebooks.ts` ~5794–5833) takes one optional param
`timeless?: { branchId: number | null }` (`shared/sockets/types.ts` ~8700–8709). With it, the handler calls
`makeTimelessCopy` in place of `duplicateLorebookRows`; permission, cover handling, relist, the emitted event
and the reply are the same, plus the moment used. Default name 🚧 `‹name› (timeless)`. Without the param the
handler is unchanged.

### C. Client — the prompt (`src/lib/client/lorebooks/time/TimelineCard.svelte` ~165–196; mounted in `BookSettings.svelte` ~419, which has `branchId`)

- The prompt's text gains the ruled last sentence: *… and sessions read the lorebook as it stands now. A
  timeless copy keeps this one as it is.* 🚧
- Buttons, in this order: **Cancel** (tonal), **Switch off here** (tonal), **Make a timeless copy** 🚧
  (`preset-filled-primary-500`).
- **Make a timeless copy** sends `lorebooks:duplicate` with `timeless: { branchId }` (the line open in the
  workspace) through `awaitReply`; while it runs the button reads 🚧 *Copying…* and the others are disabled; on
  success the prompt closes, **the source's switch is left on**, and the workspace opens the copy the way
  Duplicate does today (`onDuplicated` → `openBook`, `LorebookActions.svelte` ~383–394,
  `LorebooksWorkspace.svelte` ~3395, ~1687); a refusal shows in the card.
- When the lorebook has more than one line, the prompt names the line the copy is made from, 🚧 *The copy is
  made from the line ‹name›.*
- Check `lorebooks:duplicate:error` is shown once (in the card), not also as a toast, for a request the card
  sent; if that needs `Layout.svelte`'s handled-events list, edit only that list and add its test.
- The button exists only in this prompt. No menu item, no other entry point.

## Files owned

Server: new `lorebooks/timelessCopy.ts` and its tests; `sockets/lorebooks.ts` (the duplicate handler only);
`shared/sockets/types.ts` (the param and reply field); `utils/lorebookDuplicate.ts` only if it must return its
id maps. Client: `lorebooks/time/TimelineCard.svelte`, `lorebooks/BookSettings.svelte` (the card's props),
`lorebooks/LorebooksWorkspace.svelte` (passing the open-book callback only), `components/Layout.svelte` (the
handled-events list only), tests beside each. Docs: `docs/lorebook-time.md`, `docs/lorebooks.md`,
`NOMENCLATURE.md` (row + §25). **Read, never edit:** `tableRegistry.ts`, the readers named in A1,
`lineReading.ts`, `amendments.ts`.

Another lane (`timeline-c`) is building now in `sockets/sessions.ts`, `ownBook.ts`, the session forms, the
session page, the SDK and `NOMENCLATURE.md`: stay out of its files; in `NOMENCLATURE.md` and
`shared/sockets/types.ts` re-read right before a small edit and never reformat.

## Out of scope — written down, never built

Any SDK, pipeline or plugin surface for the copy; a menu item or bulk action; changing Duplicate; changing the
source in any way; switching the source off as part of the copy; a way to re-date the copy later; the session
side; edit history travelling.

## Stop and ask when

CLAUDE.md §Decisions applies; a migration seems needed; a table's flatten rule is not obvious; the existing
readers cannot give a folded row without a change to them; the copy cannot be made in one transaction for a
large lorebook (measure with a few thousand entries; report the time).

## Rules

- Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a row at a fixed id. Migrations are
  generated only; this lane expects none.
- Sockets: one domain context per event family is the only listener and the only place that toasts; views never
  call `toaster`. `socket.off(event)` always with the handler.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. It is a session, never a chat. No other
  product's name in any file. Comments state the rule, not the story (a ratchet test counts phrases such as
  "no longer").
- Tests: only the lane's files and the suites touched, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full paths> > plans/timeline-d-<n>.log 2>&1"`
  from the repo root, one run at a time; before each run check
  `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait if one is up, checking each minute (another
  lane and another session run tests too; never `pgrep -f "vitest run"` in a loop). Never pipe vitest into
  `head`. An int test that opens a DB inside an `it` takes a 60 s timeout. Then
  `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`. Not `npm run check` or `npm test`.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane needs no `sdk:build`; the other lane may run one: if app tests fail on a missing SDK `dist` file, wait and rerun.)
- Never `kill -9`.

## Done means

- One int fixture lorebook holding: a second line forked mid-story and a sibling line; a clock; entries with
  dated changes before and after the present, on main and on the line; an **Off for a while** window open at
  the present and one closed; an entry that exists only on the sibling; history entries with scenes filed
  under them and a non-history entry anchored under one; cast members with several dated versions and
  presences; links that changed over time; stats dated by history days. Then:
  - **the copy reads as the source read**: for every entry, member, link and stat that read on the source's
    reading, the copy's stored rows read at the head (no moment) give the same values, and nothing else reads;
  - the copy holds no dated change, no history entry, no second line, no presence, no clock, no calendar, and
    its switch is off; its scenes are kept, unfiled;
  - **the source is unchanged**: every table's rows for the source compare equal before and after;
  - from main and from the line give the two different expected copies;
  - `holdsSomethingDated` (`lorebooks/timeline.ts`) is false for the copy.
- Socket: the param makes a timeless copy; without it Duplicate is unchanged; a shared reader may make one
  (the copy is theirs); the reply carries the moment.
- DOM: the three buttons in order; the copy button sends the param with the open line and opens the copy; the
  source's switch is not sent; a refusal shows in the card; the line sentence only with more than one line.
- `tsc` clean. Docs and NOMENCLATURE updated.

## Report — `plans/REPORT-timeline-d-2026-11-14.md`

If the harness refuses the file, return the whole report as your final message. Changed files; tests with
results; the flatten rule used for each table; the time measured for a large lorebook; every name, sentence and
label added (🚧); open ★; **Noticed, not done**. Say plainly that nothing was looked at in a running app unless
it was.

## Corrections from the cold review (2026-11-14) — these rule over the text above

1. **"Now" is the head of the open line** (★T-D1 is withdrawn). Read with
   `readingOf(tx, sourceId, { branch })` at **moment null** for entries, cast, links and stats alike: every
   dated change on the line applied, which is what the code and docs call now
   (`shared/lorebooks/amendments.ts` ~36–38; `LorebooksWorkspace.svelte` ~1101; `docs/lorebook-time.md` ~75,
   ~83) and exactly what **Switch off here** would make the source read. Do not use `bookPresentOf` or the
   line's clock. The reply carries no "moment used". An **Off for a while** window therefore reads as the last
   of its two changes says.
2. **Versions, links and stats are replaced, not pruned.** `duplicateLorebookRows` gives id maps for branches,
   bindings, entries and scenes only (`utils/lorebookDuplicate.ts` ~51–58; `IdMaps`, `tableRegistry.ts`
   ~60–75), so the copy's rows of these three kinds cannot be matched to the source's rows in force. For each:
   **delete all of the copy's rows, then insert the source's in-force rows again**, remapped through the four
   maps:
   - each member's version in force goes in through `insertCharacterVersions` as the base version: main,
     undated, `atHour` / `personalPosition` / `sourceSessionId` / `retiredOrder` null, parent and `follows`
     kept;
   - links in force go in undated, on main (ended and superseded rows are simply not inserted);
   - stats and their configs go in one row per owner and slot, undated, on main, with the session clock stamp
     columns (`attribute_values.story_clock_*`, `db/schema.ts` ~10620–10630) cleared.
3. **Order of the flatten**, to survive the `set null` on a deleted history entry meeting the link index
   (`tableRegistry.ts` ~749–751, `entry_pair_uq`):
   1. replace versions, links and stats (correction 2); delete the copy's presences and dated changes;
   2. fold the entries (a folded `anchorEntryId` / `lorebookBindingId` mapped), move kept rows to main;
   3. unfile scenes; un-anchor any non-history entry under a history entry;
   4. for each place entry and each cast member about to go, call `deleteOwnedRows`
      (`tableRegistry.ts` ~1186–1195: `["location"]`, `["cast_member"]`) so no stat, config or owner-sheet row
      is left unreachable; then delete history entries and entries that do not read;
   5. clear the remaining dates (bindings' history day, scenes' stamps, the lorebook's clock and calendar);
   6. delete the lines; set the switch off.
4. **`state_proposals` is not a lorebook table and is not copied** (`tableRegistry.ts` ~31–33): remove it from
   the flatten. Never read or write the source's sessions.
5. **The request is the card's own.** `lorebooks:duplicate` gains an optional `requestId`
   (`shared/sockets/types.ts` ~8707–8711) echoed on the reply and on the refusal (`askerOf`,
   `sockets/refusable.ts` ~62–82). The card matches its reply on `requestId` (a plain Duplicate from another
   tab must not satisfy it) and sets `awaitReply`'s `timeoutMs` from the measured time for a large lorebook
   (default 15 s, `client/utils/awaitReply.ts` ~11). In `Layout.svelte` add `lorebooks:duplicate:error` to
   **`HANDLED_WHEN_ASKED_ERROR_EVENTS`** (~364–375), never to the whole-event list: plain Duplicate sends no
   `requestId` and keeps its toast (`LorebookActions.svelte` ~396–402).
6. Files owned gains `sockets/refusable.ts` **only if** the echo needs it; `tableRegistry.ts` stays read-only
   (`deleteOwnedRows` and `insertCharacterVersions` are called, not changed).
