# BRIEF — build lane `entry-form-layout` — Name and Content first; the entry-held fields fold into the entry row

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-time-t4a-2026-11-14.md` (all of it, including the walk section at the end),
`plans/briefs/BRIEF-time-t4a.md` correction 3 (the zones rule this lane must keep exactly),
`plans/REPORT-time-t2-2026-11-14.md`, `plans/REPORT-time-t8a-2026-11-15.md`, `STYLE-GUIDE.md` (forms, §6.19
version rail, container queries, copy, a11y), `NOMENCLATURE.md` §1, §24 and the rows for **Beginning**,
**Decay**, *entry version*, **move down the tree**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

Opening a lorebook entry shows what it says first. Today the railed entry form opens, top to bottom: the
one-line entry row (*On main · Perpetual · Fact*), then **Keywords**, **Part of**, **Pinned**, **Off** (each with
its own *Change from this version…* link once the entry has a dated version), and only then the versions rail
with **Name** and **Content**, which land below the fold on a 1050 px tall window.

After this lane:

1. **Name and Content come first**, beside the versions rail (or under the strip when narrow), directly under
   the form's header.
2. **The entry row holds the entry-held fields.** Closed, it is one line that says them in words, for example
   *On main · Perpetual · Fact · no keywords · top level* or *On Duel lost · Began at Year 5 · Living · 0.25 ·
   3 keywords · part of The Hill · pinned*. Open (the same toggle that opens Beginning and Decay today), it
   shows, in this order: Beginning, Decay, then the entry-held ones of **Keywords, Part of, Pinned, Off**, then
   the line with **Move down the tree…**.
3. **One *Change from this version…* control inside the open row**, not four links: a single small menu or
   button that lists the entry-held fields that can be made to differ (those not already *differs by version*),
   offered only while a dated version is selected. Choosing one moves that field into the version's fields
   exactly as today.
4. A field that *differs by version* shows with the version's fields (below Name and Content, above the
   advanced fields), marked *differs by version*, with **Make it the same everywhere** as today. Nothing about
   rule A changes: only where things are drawn.

No server change, no storage change, no socket event, no SDK change.

## Owner rulings this lane builds (quote them in worker briefs)

- 2026-11-14, the zones: "A makes sense" — a field is the entry's until it is made to differ at a date
  (Keywords, Pinned, Off, Part of); **Change from this version…** / **Make it the same everywhere**.
- 2026-11-15, shown the built form (Name and Content below the fold) and the lead's recommendation — "Name and
  Content first, beside the rail. Fold the four entry-held fields into the one-line entry row, so it reads 'On
  main · Perpetual · Fact · no keywords · top level' and opens on demand. Show a single 'Change from this
  version…' link inside that row." — the owner: "Your recommendation, ok".
- 2026-11-14: "Keep the form quiet. Beginning and Decay sit in one collapsed row that shows its values in words
  and opens on demand; the defaults should make it rare to open."
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't
  enabled."

## Rules

- **Every form, railed or not, puts Name and Content first.** With the Timeline off (no rail) the entry row
  still exists as the home of Keywords, Part of, Pinned and Off plus Decay (Beginning hidden, as today), closed
  by default. With the Timeline off **Move down the tree…** stays reachable where lane `time-t8a` put it (⋯),
  and may also sit in the open row; say which you chose.
- **The closed row's words** are built by one pure function with tests: the line, Beginning, Decay, keywords
  (*no keywords* / *1 keyword* / *‹n› keywords*), parent (*top level* / *part of ‹name›*), and *pinned* / *off*
  only when set. A field that *differs by version* is left out of the closed words and replaced by nothing (it
  is with the version). Long words truncate with the full text in `title` and in the toggle's accessible name.
- **The row opens by itself** when something in it needs attention: a validation problem on a field inside it,
  or when the person arrives from a loose end that names keywords (the "Needs keywords" chore must still land
  on a visible Keywords control). It otherwise stays as the person left it for that entry (not remembered
  across entries).
- History entries, scenes and the cast keep their own forms: no change there. Editors that are not the common
  one (`DerivedEntryEditor`, `GenericEntryEditor`, `PlaceEditor`, `ItemEditor`, `CharacterLoreEditor`) keep
  their own fields; only the common entry-held four move. Report any editor where Keywords or Part of is drawn
  by the type's own editor and how you handled it.
- Read-only forms (a shared reader, a library piece, an inherited entry on a fork, an entry after a move) show
  the row and open it, with every control inside disabled, as today's fieldset rule does.
- Drag-to-reparent ("or drag this row onto another") and the Part of picker keep working; its hint moves with
  the control.
- The pin and off toggles in the list rows and the ⋯ menu are not this lane's; where lane `time-t4a` removed
  Pinned and Off from ⋯ for railed entries, leave that as it is.
- Keyboard and a11y: the row's toggle is a button with `aria-expanded` and `aria-controls`; focus order is
  header → Name → Content → the version's own fields → the entry row; opening the row does not move focus.
- Copy: reuse existing words; new words only for the closed row's phrases and the one control. 🚧 all. Help is
  one sentence.

## Files owned

- `src/lib/client/lorebooks/EntryWorkspace.svelte` (the form's layout only), `sections/EntryCoreFields.svelte`,
  `sections/EntryAdvancedFields.svelte`, `time/BeginningDecayRow.svelte` (it becomes the entry row; rename the
  component only if every import is updated and the NOMENCLATURE ledger records it), `time/versionZones.ts`,
  a new pure helper for the closed row's words, tests beside each
- `docs/lorebooks.md`, `docs/lorebook-time.md` (where the form is described), `STYLE-GUIDE.md` §6.19 (the entry
  row is part of the pattern), `NOMENCLATURE.md` (a §25 line per new name; amend the rows that describe the
  entry area)

## Out of scope (write down, never build)

Any change to what is saved or sent; the versions rail's own behaviour; the cast member page; the moment bar;
the entries list (`LorebooksWorkspace.svelte`, `EntryPool.svelte`: lane `time-t8b` is editing them now — do not
touch them); `MoveDownTheTreeDialog.svelte`'s behaviour; the Chronicle; any server or SDK file.

## Stop and ask when

CLAUDE.md §Decisions applies; a type's own editor owns Keywords or Part of in a way that cannot move without
changing that editor's behaviour; the "Needs keywords" loose end cannot land on a visible control; anything
would change what a save sends.

## Done means

- Tests (targeted files only, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/entry-form-layout-<name>.log 2>&1"`
  from the repo root, one at a time; check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` first and
  wait if one is running; never pipe vitest into `head`): Name and Content precede the entry row in document
  order, railed and unrailed; the closed words for each combination; the row opens for a problem inside it and
  for the keywords loose end; one *Change from this version…* control lists only fields not yet differing and
  moves the chosen one into the version; *differs by version* fields sit with the version; Timeline off;
  read-only; the saves send exactly what they sent (the existing `entryWorkspace.versions.dom`,
  `sections/entryZones.dom`, `time/versionZones.test`, `time/beginningDecayRow.dom`,
  `time/moveDownTheTreeDialog.dom`, `lenses/readOnlyLenses.dom`, `entryWorkspace.beginning.dom` and
  `entryAdvancedFields.dom` tests pass, updated only where they pin the old placement: list each change).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors. Do not run the full suite or a build.
- Comments state the rule, not the story. Never `prettier --write` beyond the lines changed.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-entry-form-layout-2026-11-15.md`): what
moved where, with file:line; how each non-common editor was handled; changed files; tests with results; every
name, phrase and label added; open ★; **Noticed, not done**. Under about 800 words.
