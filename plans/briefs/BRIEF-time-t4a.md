# BRIEF — build lane `time-t4a` — the entry form: versions on a timeline

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §1, §2, §5 and §6 (lane T4),
`plans/NOTES-entry-time-and-lines-2026-11-13.md` part H (~206–222), `plans/REPORT-time-t2-2026-11-14.md`,
`plans/REPORT-edit-history-a-2026-11-14.md`, `plans/REPORT-timeline-b-2026-11-14.md`, `NOMENCLATURE.md` §1, §24,
§23 and the lorebook group rows for *amendment* / *dated change*, **Beginning**, **Decay**, **Edit history**,
`STYLE-GUIDE.md` (forms, shell and container-query rules, copy, a11y), `docs/lorebook-time.md`,
`docs/lorebooks.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

In a lorebook that keeps a timeline, the **entry form** shows an entry as what it is: one entry with versions
over story time. The cast member page is lane `time-t4b`, not this one.

- **The entry** (true at every date) sits in one quiet row: the existing Beginning and Decay row, widened to say
  the line too (*On main · Perpetual · Fact*).
- **The versions** sit on a vertical **timeline rail beside the fields**: *From the beginning* (or *Began at
  ‹date›*), then each dated change as a version, in story order. Selecting one shows that version in the fields.
- **Save** saves the version being edited. **Save as a new version…** adds a version at a date. *+ Add a version
  here* between two versions does the same with the date range known. A version's date can be changed in place.
- The entry's **edit history** rows sit under the version they changed, with a toggle to hide them.
- This **replaces** **Save as of ‹date›**, **Change the base** and the *Amendments* list in the entry form.

No storage change: a dated change still stores only the fields that differ; the form shows it as a whole
version. **No migration, no SDK change, no new socket event unless the inventory shows one is unavoidable (then
stop and ask).**

## Owner rulings this lane builds (quote them in worker briefs)

- 2026-11-13: "For living entries and when making edits to existing perpetual entries, we should show the
  option to change the effective date of that version. Save edits that version, but also need a button to save
  as a new dated version. It would be neat to be able to toggle off undated history edits and then navigate the
  dated versions like a vertical timeline, adding new versions before or after."
- 2026-11-14, "Lets go with all your recommendations", which rules the chosen screen: **the timeline rail beside
  the fields, folding to a strip above the fields when narrow**; the form in two zones (the entry; the version);
  the replacement of **Save as of ‹date›**, **Change the base** and the *Amendments* list; one version per
  entry, line and date, and a version cannot be dated before the entry's Beginning (plan §5.1).
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't
  enabled." With the Timeline off the form has no rail, no strip, no version date: one plain form with the edit
  history fold as today.
- 2026-11-14 (today): "continue with the feature completion buildouts" — the go for this lane.

## The chosen screen, in words (from the owner's options page; the example is a place that burns in Year 7 and is rebuilt in Year 9)

```
The Hill Chapel                       Place · Unsaved changes
The entry   On main · Perpetual · Fact                [Change]

Versions                 [Edits ▣]    | This version begins  Year 7
● From the beginning                  | Name      The Hill Chapel
    A stone chapel                    | Content   A roofless ruin since the fire…
  + Add a version here                | Keywords  chapel  ruin  the hill
● Year 7   Burned to a ruin  ◀        |
    You fixed a typo · 2 days ago · Restore
    ‹routine› added a sentence in ‹session› · 5 days ago · Restore
  + Add a version here                |
● Year 9   Rebuilt in timber          | [Save]  [Save as a new version…]
```

Narrow (a phone, the half-width pane): the rail becomes a horizontal strip of version chips above the fields
(*From the beginning · + · Year 7 · + · Year 9 · +*), the fields stay full width, and the edits of the shown
version sit in a fold under the fields (*Edits to this version · 2 · Show*). Use a container query on the form's
own width (STYLE-GUIDE), never the viewport.

## Build

### A. First, an inventory (supervisor, read-only, before any worker starts) — report it with file:line

1. What the entry form does today at a moment: how the draft is built (base plus amendments in force), what
   **Save**, **Save as of ‹date›** and **Change the base** each send (`EntryWorkspace.svelte` ~2090–2160 and the
   save functions they call), what `time/AmendmentList.svelte` lists and which actions it has (edit, re-date,
   delete, place / unplace on a line), and how the moment bar's date chooses what the form shows.
2. Which fields a dated change may carry and which it may not (`cleanFields`, `sockets/amendments.ts`;
   `NEVER_AMENDED`, `shared/lorebooks/amendments.ts`): those it may not are "the entry" zone or stay where they
   are (keywords? pinned, off, archive, parent: say which, from the code).
3. What the server already offers for: listing an entry's dated changes with their dates and lines
   (`amendments:list`), creating one at a date (`amendments:create`), editing one (`amendments:update`),
   re-dating one, deleting one; the one-version-per-entry-line-date rule (is it enforced on create and on
   re-date today, or does a second write that day make a second row?); the Beginning rule
   (`assertAtOrAfterBeginning`).
4. How edit-history rows relate to a version: `lore_redlines.amendment_id` null = the entry itself (the first
   version), set = that dated change. What `entries:redlines` returns and whether it can be grouped per version
   on the client without a new request.
5. Every other mount of `AmendmentList` and of the save-as-of controls (the cast member page uses
   `AmendmentList` too: it must keep working unchanged in this lane).
6. Entry types whose editor is not the common one (`HistoryEditor`, `SceneEditor`, `DerivedEntryEditor`,
   `GenericEntryEditor`, character lore): which get the rail. History entries and scenes do **not** (a history
   entry is a date; it has no versions): confirm from the code that they carry no dated changes today, or
   report.

### B. The form

- A new component for the rail / strip under `src/lib/client/lorebooks/time/` (one component, two layouts by
  container width), fed by the entry's dated changes on the line being read and its edit-history rows.
- Selecting a version sets what the fields show and edit: *From the beginning* edits the entry's own stored
  fields; a dated version edits that dated change (the fields show the whole version: the base with every change
  up to and including it folded, exactly as the reader folds them; saving writes only the fields that differ, as
  the existing save-as-of path does). Use the existing fold and diff helpers; do not write a second fold.
- The version shown when the form opens: the one in force at the moment the workspace reads (the moment bar's
  date, else the line's present, else the latest). Moving the moment bar selects the version in force then;
  selecting a version on the rail does **not** move the moment bar (state the choice in the report).
- **Save**: saves the selected version (the entry's own save for the first; `amendments:update` for a dated
  one). **Save as a new version…**: asks for the date (prefilled from the moment, bounded by the Beginning and,
  from *+ Add a version here*, by its neighbours), then `amendments:create`; a date that already has a version
  on this line is refused in the dialog with a sentence and offers to open that version. **Change its date**:
  on a dated version, in place, same bounds. **Delete this version**: on a dated version, with a confirmation;
  the first version has no delete (deleting the entry is the entry's own action).
- Unsaved changes: switching version with unsaved edits asks (keep editing / discard), as the form does today
  when switching entry.
- The edit history: rows whose `amendment_id` is null under *From the beginning*, the others under their
  version; the **Edits** toggle hides them all (remember per browser, `localStorage` in try/catch). **Restore**
  works as today. The separate Edit history fold under the form goes when the rail shows; it stays with the
  Timeline off and in the narrow layout (scoped to the shown version there).
- The entry's row: `BeginningDecayRow` gains the line as its first words (*On main* / *On ‹line›*), read-only
  here (moving an entry between lines is lane T8).
- With the Timeline off: none of this is drawn; the form is as today without the save-as-of pair and the
  *Amendments* list (already hidden by lane `timeline-b`).
- Read-only forms (a shared lorebook's reader, a starter the person may not edit): the rail shows and selects;
  no save, add, re-date or delete.
- Keyboard and a11y: the rail is a list of buttons with the selected one marked `aria-current`; the add buttons
  have names that say where (*Add a version between Year 7 and Year 9*); focus stays in place after a save.
- No `crypto.randomUUID`, no `navigator.clipboard`; `SvelteSet` / `SvelteMap` for reactive sets and maps;
  sockets: views register listeners for local state only, always `socket.off(event, handler)`, never toast.

### C. What goes

**Save as of ‹date›**, **Change the base** and the `AmendmentList` mount in `EntryWorkspace.svelte`, with their
now-unused code and tests, once the rail does their jobs: re-check each job from inventory item 1 is covered
(edit a change, re-date, delete, place / unplace on a line) before removing; a job the rail does not cover is
reported, not dropped. `AmendmentList.svelte` itself stays (the cast member page mounts it).

### D. Docs and names

`docs/lorebook-time.md` and `docs/lorebooks.md`: the entry form's versions, in plain words with the one
example; remove the descriptions of the replaced controls. `NOMENCLATURE.md`: a row for **version** of an entry
(R3: always *entry version* / *a version of an entry*, since *card version* and *cast version* exist; say that a
dated version is stored as a dated change, 🚧 the internal word stays *amendment*), and a §25 line for every new
name; the retired labels (**Save as of**, **Change the base**, *Amendments* as the entry form's heading) go to
§23 with their replacement, noting the cast page still shows *Amendments* until `time-t4b`. No other product's
name in any file.

## Files owned

- `src/lib/client/lorebooks/EntryWorkspace.svelte`, `src/lib/client/lorebooks/sections/EntryCoreFields.svelte`,
  `EntryAdvancedFields.svelte`, `src/lib/client/lorebooks/time/BeginningDecayRow.svelte`, one new rail
  component and one new date dialog under `src/lib/client/lorebooks/time/`, pure helpers beside them
- `src/lib/client/lorebooks/editHistory/EditHistory.svelte` only to let rows be drawn per version (lane
  `edit-history-b` will have given it a subject; keep that)
- tests beside each; `docs/lorebook-time.md`, `docs/lorebooks.md`, `NOMENCLATURE.md`, `STYLE-GUIDE.md` only if
  a rule moves
- Server files: none expected. If inventory item 3 shows the one-version-per-date rule is not enforced on
  re-date, the smallest refusal in `src/lib/server/sockets/amendments.ts` is in scope, with a test.

## Out of scope (write down, never build)

The cast member page and `CastWorkspace.svelte` (`time-t4b`); moving an entry between lines, *could exist here*,
bulk edit (T8); what sessions write (T5); recall by Decay (T7); knowledge marks (T6); the moment bar's own
behaviour; history entries' and scenes' editors; `LorebooksWorkspace.svelte`; any SDK or
`src/lib/server/pipelines/**` file.

## Stop and ask when

CLAUDE.md §Decisions applies; a job of the replaced controls has no place on the rail; a new socket event, a
server change beyond the one named, or a stored value seems needed; the fold shown in the form would differ from
what a session reads.

## Done means

- Tests (targeted files only, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t4a-<name>.log 2>&1"`
  from the repo root, one at a time; check for a running vitest first; never pipe vitest into `head`): the
  rail's order and selection; the version in force at the moment is selected on open; Save on the first version
  and on a dated one sends the right request with only changed fields; Save as a new version (bounds, the taken
  date refusal); change a date; delete; edits grouped under their version and the toggle; the narrow layout;
  Timeline off draws none of it; read-only; the existing entry-form tests that still apply pass, and the ones
  for removed controls are removed with them (list them).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` has 0 errors. Do not run the full suite.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t4a-2026-11-14.md`): the inventory
with file:line; what each replaced control's job became; changed files; tests with results; every name, sentence
and label added; open ★; **Noticed, not done**. Under about 1,000 words.

## Corrections after the cold review (2026-11-14) — these rule over the text above

**Ready to build: every correction below is ruled or the lead's decision.**

1. **Other lines' changes and history entries keep their list.**
   - `AmendmentList` is "the only place another line's amendment can be re-dated or deleted"
     (`time/AmendmentList.svelte` ~28–32, ~365–367) and it lists them under *Not read on ‹line›*. History
     entries do carry dated changes (a compile on a fork writes one: `editor/compileSave.ts` ~8–16, ~43–60).
   - So: the `AmendmentList` mount **stays for entry types that get no rail** (History), and the rail gains an
     **Elsewhere** group at its end for changes on lines the reading does not read (re-date, delete, *open on
     ‹line›*), with their edit-history rows.
   - A version the line inherits (main's, an ancestor's) shows on the rail **read-only** with *from ‹line›* and
     a way to open it on its own line. Only the line's own versions and, on the line that owns the entry, *From
     the beginning* are editable in place.
   - `amendmentsOnLine` (`shared/lorebooks/lineReading.ts` ~447–481) applies main, then each ancestor, then the
     line's own: a nearer line wins whatever the date. The rail's order and "whole version" fold must come from
     that function's result, never from sorting by date alone.
   - Saving *From the beginning* where other lines read the entry carries today's whole warning ("everywhere,
     on every line and at every moment", `EntryWorkspace.svelte` ~2137–2140).
2. **One version per entry, line and date** (plan §5.1, ruled: "a second write that day updates it").
   - Today nothing enforces it: `amendments:create` inserts with no check (`sockets/amendments.ts` ~1676–1693),
     re-date has none (~1909–1937), there is no unique index.
   - In scope, server, in `sockets/amendments.ts` under the book's lock: **create at a date that already has
     the line's own change for that entry merges into that row** (the new fields win), recorded in the edit
     history as an edit of it; **re-date onto a taken date is refused** with a sentence. Tests for both. No
     index, no migration, no reshaping of stored rows.
   - Existing data may hold two changes at one date on one line: the rail draws them as **one version**, folded
     in id order; editing it edits the later row (say so in the report).
   - **Save as a new version…** at a taken date: the dialog says the date already has a version and that Save
     will change it, then does so (no refusal).
3. **The zones (owner, 2026-11-14: "A makes sense").** One rule: **a field is the entry's until it is made to
   differ at a date.** Storage is unchanged; this is only how the form shows it.
   - Always the entry's, shown in the entry row, never per version: line, Beginning, Decay, archive.
   - **Keywords, Pinned, Off and Part of** (and only these four): when no dated change on the line being read
     carries the field, it shows once in "the entry" area and editing it writes the entry's own stored value
     (it changes everywhere; where other lines read the entry the existing whole warning applies).
   - Each of the four has a small action **Change from this version…**, offered while a dated version is
     selected: it moves the field into that version's fields, marked *differs by version*, and from then on the
     field is edited per version (the dated change carries it), on every version of the entry on this line.
   - **Make it the same everywhere** on such a field removes it from every dated change of this line's own
     (after a confirmation naming how many versions change) and it returns to the entry area with the value of
     the version shown. Inherited versions of other lines are not touched; if one of them carries the field it
     stays *differs by version* and the action says why it is not offered.
   - A field already dated today (an existing **Off for a while…**) simply shows as *differs by version*.
     **Off for a while…** itself stays as it is.
   - Name, Content and the type's own fields are always the version's.
   - A field that is the entry's **saves to the entry even while a dated version is selected**: Save splits into
     the entry's update for those keys and `amendments:update` for the rest (`cleanFields` refuses date parts
     and `decayRate`, ~952–960).
   - The toast that says "use Change the base in the save menu" (`editor/entrySave.ts` ~245–254) is rewritten;
     `editor/entrySave.ts` is added to Files owned.
   - Copy 🚧: **Change from this version…**, **Make it the same everywhere**, *differs by version*.
4. **Selecting a version moves the moment bar** (owner, 2026-11-14: "Yes, move the moment bar"). Clicking a
   version on the rail sets the workspace's moment to that version's date (*From the beginning* on a perpetual
   entry: the earliest moment; the lead's reading, ★). The moment bar and the rail are then one selection: the
   rail's selected version is always the one in force at the moment. With unsaved edits, a change of moment that
   would change the version asks first (keep editing / discard), once, as switching entry does; the existing
   rule that a dirty draft keeps its moment (`EntryWorkspace.svelte` ~1047–1059) is replaced by that question.
   The route's moment param changes as the moment bar's does today. `LorebooksWorkspace.svelte` stays out of
   scope: use the moment setter the workspace already hands the entry form; if none exists, stop and report.
5. **Copy that goes stale.** `MOMENT_SAVE_SENTENCE` (`time/moment.ts` ~209–218, drawn at `MomentBar.svelte`
   ~126) is false for the entry form after this lane: `time/moment.ts` is added to Files owned, the entry form
   gets its own sentence, the cast page keeps today's until `time-t4b`. STYLE-GUIDE §6.1's split-button example
   (`amendSave`) moves to the cast form.
6. **Job list corrected.** `AmendmentList` has re-date and delete only (~181–212), plus the cross-line group and
   the *not yet* count (~91–94, ~350–356): the rail covers all four; "place / unplace on a line" is not its
   job. A version has no caption field: caption each with the existing "changes ‹fields›" wording (`saysWhat`,
   `AmendmentList.svelte` ~145–150), never an invented summary. Deleting a version removes its edit history
   (cascade, `schema.ts` ~10995–10997): the confirmation says so.
7. **Two parts.** `time-t4a-1`: the rail, selection, Save, Save as a new version, re-date, delete, Elsewhere,
   the removals, the server rule, docs. `time-t4a-2` (after `edit-history-b`): edit-history rows under each
   version, the **Edits** toggle, the narrow layout's fold. The supervisor builds part 1 first and part 2 only
   when part 1's tests pass.
