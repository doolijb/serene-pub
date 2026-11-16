# BRIEF — build lane `time-t5a` — what a dated session writes: a dated version at once, undoable by its turn

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/briefs/BRIEF-full-direct.md` (the Corrections section: this lane builds its **correction 1**, held on
2026-11-13) and `plans/REPORT-full-direct-2026-11-13.md` (the rule as built, every "lead follow-up", ★FD-5 to
★FD-10), `plans/PLAN-entry-time-and-lines-2026-11-14.md` §4 (the write path), §5 rules 1–3, §6 lane T5 and §8
★4, `plans/REPORT-time-t2-2026-11-14.md`, `plans/REPORT-time-t4a-2026-11-14.md` (the one-version-per-date rule in
`sockets/amendments.ts`), `plans/REPORT-edit-history-a-2026-11-14.md` (what records an edit),
`../serene-pub-sdk/INTEGRATING.md` (the step on lore-writing outlets and the host's write ports, read only),
`NOMENCLATURE.md` §1, §24, §23 and the rows for *imprint* / *per-turn record*, *held change*, *dated change* /
*entry version*, **Beginning**, **Decay**, `docs/lorebooks.md` (writes from sessions), `docs/lorebook-time.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**This lane makes no SDK edit and runs no `sdk:build`** (the owner's own server is up on this machine). The SDK
half of plan lane T5 (defaults on entry types, repertoires, a genre override, outlet values) is a later lane,
`time-t5b`.

## Goal

Under **Full**, on the owner's own lorebook, a session that plays at a story date (its lorebook keeps a
timeline and the session reads at a moment):

1. **A change to an existing lorebook entry lands at once as a dated version** of that entry at the session's
   date, on the session's line. It does not overwrite the entry's stored row, and it does not wait in the
   session's notes. The entry's text at earlier dates and on other lines stays as it was.
2. **It is undoable by its turn**: swipe, regenerate, Back and delete take it away; Forward puts it back.
3. **One version per entry, line and date**: a second change that day, by this session or another, updates that
   version (plan §5.1).
4. **A new entry a dated session makes takes its Beginning and Decay from core's defaults per entry type**
   (plan ★4): World lore, Place, Character lore: perpetual, Decay 0. Item: begins at the session's date, Decay
   0. History: its own date (as today); its Decay stays 0 in this lane (the "living (slow)" default waits for
   lane T7, where Decay is first read; say so in the report).
5. ★FD-9: Apply's move path gains the rule-C check its merge loop has.

A session with no date, a lorebook with the Timeline off, **Review changes**, **Off**, a lorebook someone else
owns, and a session whose notes are its whole lorebook all behave exactly as today.

## Owner rulings this lane builds (quote them in worker briefs)

- 2026-11-13, asked what a session that plays at a story date does to an existing entry under Full: "Write a
  dated change straight into the lorebook".
- 2026-11-13: "file it right away. if review is off, write directly to the lorebook".
- 2026-11-14, "Lets go with all your recommendations", which rules: one version per entry, line and date, a
  second write that day updates it; a version cannot be dated before the entry's Beginning; the core defaults
  when a dated session writes a new entry (★4); "the turn's undo is the per-turn record; every write also lands
  in the edit history"; ★FD-9 (Apply's move path and rule C: the day waits with the reason).
- 2026-11-14: "Settle one scene behind" (how settling works now; this lane does not change it).
- 2026-11-12: "a routine-saved summary never settles; Back resets it" (do not disturb).
- 2026-11-15: "Go ahead and proceed with everything in the order you see fit." — the go.
- Standing: P1 (a new automatic behaviour shows its cause and how to undo it: the per-turn record's note on the
  entry, as today's direct writes have); P2 (one writer: `lorebooks/imprints.ts` owns the per-turn record,
  `sockets/amendments.ts` / its helpers own dated changes).

## What exists (re-verify every line before relying on it)

- The route and the direct write: `src/lib/server/pipelines/runtime/host.ts` `changeLoreEntry` (the "book"
  route's direct branch writes in place with `imprintChanges`; a dated change to an existing entry returns
  early into `holdLoreEntryChange`), and the same decision for the update outlet. Line numbers moved since the
  `full-direct` brief: find them.
- The write Apply makes from a dated held change: `src/lib/server/lorebooks/ownBook.ts` (the dated row it
  inserts into `entry_amendments`; `heldChangeVerdict`; `applyOverlayItems`; `applyHeldAutomatically`).
  "Reuse that write, do not spell a second one."
- The per-turn record: `src/lib/server/lorebooks/imprints.ts` (`IMPRINT_SUBJECTS`, `SUBJECTS.entry`, `holds`,
  `retractImprints`, `restoreImprints`, `markImprintsKept`, `settleKeptImprint`). The table `lore_imprints` has
  `lorebook_id` NOT NULL and a CHECK on the subject kind.
- One version per (entry, line, date): `sockets/amendments.ts` `ownChangeAt` and the merge on create (lane
  `time-t4a`); `assertAtOrAfterBeginning`.
- The edit history: `lorebooks/redlines.ts` (`recordRedline` with `amendment_id`; `takeBackRedline` /
  `putBackRedline` for a run's write).
- Move down the tree refuses while a per-turn record stands on an entry (`lorebooks/moveDownTheTree.ts`):
  a dated version's record names what subject? It must still refuse correctly.

## Build

### A. Inventory first (supervisor, read-only, before any worker) — report with file:line

1. Today's path for a dated session's change to an existing entry under Full, end to end: where it is held,
   what row holds it, what the session reads meanwhile (does the session see its own held change at once?),
   when it drains (scene close, Apply, Close out), and what row draining writes.
2. What the per-turn record can and cannot name today: can a subject be an `entry_amendments` row (the CHECK,
   `subject_kind`, `subject_id`, `field`); what "made" and "changed" records look like; what Back, swipe,
   regenerate, delete and Forward do with each; what settling does (`sessions/settle.ts`, read only).
   **If the per-turn record needs a new subject kind, say whether the CHECK is in the schema (a generated
   migration) or only in code.** A migration is allowed in this lane only if it is the one CHECK change; its
   index must exceed the highest applied (0163 today) and it must be generated.
3. Every reader that must see the new dated version at once and already does (it is an ordinary
   `entry_amendments` row): the session's own reading, another session at a later date on the same line, the
   lorebook workspace's rail. Name anything that special-cases "held" and would now miss it.
4. What a *second* change the same day does today for a held change (folded, or a second row), and what the
   t4a merge does for a person's write; say how this lane's write uses the same merge and what the per-turn
   record of the *second* turn must hold so that taking that turn back restores the first turn's text, not the
   base.
5. New entries: where a session's new entry gets its fields (`host.ts`, the create outlet), and whether the
   session's date is at hand there for the Item default. Where core's entry types are declared, to place a
   default table **in the app** for this lane (the SDK declaration comes in `time-t5b`): one small map keyed by
   core entry type id, in `src/lib/server/lorebooks/` beside the Beginning helpers; a ruleset's entry types and
   unknown types take perpetual, Decay 0.
6. ★FD-9: Apply's move path (`ownBook.ts`) and the rule-C check in its merge loop.

### B. The write

- On the "book" route under Full, when the session reads at a date and the lorebook's Timeline is on, a change
  to an existing lorebook entry is written at once as a dated change at the session's date on the session's
  line, through the same function Apply uses, under the book's lock, in the pipeline write's own transaction
  (inside `db.transaction` only `tx`).
- Where a change already waits (this session holds a change on that entry), today's rule stands: the new change
  folds into the held one (`full-direct` correction 4). Where the entry is earmarked, on another line the
  session cannot write, or the write would be refused for a person (before the Beginning; a History entry's
  rules), the change is held as today with its reason. Nothing that is held today is refused, and nothing is
  dropped.
- A change dated before the entry's Beginning cannot be written: it is held with the reason (the existing
  sentence from `assertAtOrAfterBeginning`).
- The same-day rule: the write merges into the line's own version at that date (the t4a merge), whoever made
  it.
- The edit history records it as a `routine` edit of that version, with the run (so Back takes the row back as
  it does for entries today).

### C. The undo

- The per-turn record learns the dated version: one record per turn and version saying what the turn made or
  changed there. Taking the turn back (swipe, regenerate, Back, delete): a version the turn made is deleted; a
  version the turn changed gets each changed field's earlier value back (and a field the turn added is
  removed). Forward puts both back. The checks `holds` makes for an entry (another session standing on the row)
  apply to a version the same way: when another session or a person has changed that version since, the turn's
  part is not ripped out; the record is kept and the entry shows the existing *replaced* note.
- A person's edit of that version on the rail (lane `time-t4a`) marks the record kept, as a person's edit of an
  entry does (`markImprintsKept`).
- Settling: whatever settles an entry's record settles a version's, at the same moments. Do not change
  `sessions/settle.ts`'s rule; if it needs to learn the new subject, that one addition is in scope.
- Move down the tree (`lorebooks/moveDownTheTree.ts`): a standing record on one of the entry's versions refuses
  the move like a standing record on the entry. Add the test there.

### D. New entries

A dated session's new entry under Full takes Beginning and Decay from the default map (Goal 4). A person's
hand-made entry is untouched (perpetual, 0). The map is 🚧 and app-side for now; its row in NOMENCLATURE says
the SDK declaration will replace it (`time-t5b`).

### E. ★FD-9

Apply's move path checks rule C as its merge loop does; a day that fails waits with the reason, as ruled.

### F. Screens, docs, names

No new screen. The entry's existing per-turn note (what a session's turn wrote, with **Revert** / **Keep**)
shows for a dated version where it shows for an entry today; if it cannot without a UI change, report it.
`docs/lorebooks.md` (writes from sessions: what Full does at a story date, with one example),
`docs/lorebook-time.md`, `NOMENCLATURE.md` (§25 for every new name; amend the *held change* and *imprint*
rows). No other product's name in any file. ⚠ The SDK's `contracts/src/outlets.ts` JSDoc still states the old
routing: queue the corrected sentence in your report for `time-t5b`; do not edit the SDK.

## Files owned

- `src/lib/server/pipelines/runtime/host.ts` (the lore-entry write and update routes only),
  `src/lib/server/lorebooks/ownBook.ts`, `src/lib/server/lorebooks/imprints.ts`,
  `src/lib/server/lorebooks/redlines.ts` (only if a version's routine edit needs it),
  `src/lib/server/lorebooks/moveDownTheTree.ts` (the one check), a new small module for the default map
- `src/lib/server/sockets/amendments.ts` only to export or factor the merge so the pipeline write and the
  person's write share it
- `src/lib/server/sessions/settle.ts` only for the one addition named in C
- `src/lib/server/db/schema.ts` + one generated migration, only for the CHECK if the inventory shows it is in
  the schema
- tests beside each; `docs/lorebooks.md`, `docs/lorebook-time.md`, `NOMENCLATURE.md`

## Out of scope (write down, never build)

Any SDK file or `sdk:build`; defaults declared in the SDK, a genre override, outlet values (`time-t5b`); cast
versions written by sessions (they already land as versions); Review changes and Off; settling's rules;
★FD-5, ★FD-8, ★FD-10; the clock moved back (T10); recall by Decay (T7); the client, except a test that the
existing note shows.

## Stop and ask when

CLAUDE.md §Decisions applies; a write held today would be refused or dropped; the per-turn record cannot name a
version without more than the one CHECK change; taking a turn back could delete or rewrite text another session
or a person wrote; a second migration, a setting, an event or a published name seems needed; a test of the old
rule cannot be rewritten without losing coverage of the held path (move such tests to **Review changes**, as
`full-direct` did).

## Done means

- Tests (targeted files only, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t5a-<name>.log 2>&1"`
  from the repo root, one at a time; check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` first;
  never pipe vitest into `head`; 60 s for an int test that opens a DB inside an `it`): the dated version is
  written at once and read at once by the session and by another session at a later date; text at an earlier
  date and on another line is unchanged; the entry's stored row is unchanged; a second change the same day
  updates the version; each undo path (swipe, regenerate, Back, delete) and Forward, for a version the turn
  made and for one it changed; another session's or a person's later change survives a take-back; a person's
  edit keeps the record; settle; before the Beginning → held with the reason; no date / Timeline off / Review
  changes / Off / someone else's lorebook / notes-only → exactly as before (the existing tests pass unchanged);
  the default map for a new entry; ★FD-9; move down the tree refuses.
- **The wider regression the last lane missed** (owner-facing bugs came from here): run, in the same capped way,
  `src/lib/server/sockets/scenes.*`, `src/lib/server/sockets/sessions.*`, `src/lib/server/pipelines/routines`,
  `src/lib/server/state`, `src/lib/server/lorebooks`, `src/lib/server/pipelines/runtime/host.*` and report the
  totals. Known not-this-lane failures to discount: `sockets/sessions.forms.int` (one test),
  `sockets/presetFallback.int`, `sockets/sessionAdmin.presetActions.int`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors. Do not run the full suite or a build.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t5a-2026-11-15.md`): the inventory
with file:line; the rule as built, as a table like `full-direct`'s; changed files; tests with results including
the wider regression; every name and sentence added; open ★; **Noticed, not done**. Under about 1,100 words.

## Corrections after the cold review (2026-11-15) — these rule over the text above

On the substance, no objection: "nobody shares a row until Apply" was reversed for Full by the owner's
2026-11-13 rulings (`BRIEF-full-direct.md` ~22–24, correction 1); settling is subject-agnostic
(`sessions/settle.ts` ~268–276 clears `before` on every standing non-apply record), so a dated session's direct
writes settle one scene behind like every other direct write, and `settle.ts` needs no change; `host.ts` is free.
The lead's earlier advice to the owner that this lane waits on the session-storage plan is withdrawn (the plan's
relevant part is ruled and built); the owner's 2026-11-15 "proceed with everything in the order you see fit" is
the go.

1. **One writer for dated versions; never Apply's.** "The same function Apply uses" does not exist: Apply's
   dated write is inline in `applyOverlayItems` (`ownBook.ts` ~2407–2412), moves the held row with a plain
   update, never merges, settles through the newest applied anchor (~2445–2461), ends Forward
   (`discardForwardStack` ~2028) and files `origin: "apply"` records Back never takes (`imprints.ts` ~603).
   **Never call `applyOverlayItems` from the pipeline write.** Build one exported writer in the amendments
   helpers: it takes the book's lock, runs `assertAtOrAfterBeginning`, finds the line's own version at that date
   (`ownChangeAt`), inserts or merges, and returns *made* or *merged* plus each changed field's earlier value.
   The pipeline write and the person's create (`sockets/amendments.ts` ~1665, ~1767, ~2044) both call it.
   Also in scope: `heldChangeVerdict` (`ownBook.ts` ~1475–1525) gains two conflicts, so a waiting change waits
   with its reason instead of Apply writing past the rule: **before the entry's Beginning**, and **the line
   already has a different version at this date**. Changing `takeBackApply` to merge is a stop-and-ask.
2. **The exact conditions under which the change is held as today** (replace "earmarked" and "refused for a
   person", which would have held nearly every update: a lore-update run earmarks the entry it updates, and the
   pipeline write path has no earmark check, `host.ts` ~2559): the session writes on another line or a fork is
   pending (`host.ts` ~2430–2435); this session already holds a change on that entry (`full-direct` correction
   4); the change is dated before the Beginning; the Timeline is off. Nothing else is held.
3. **What C needs, now owned:** `sockets/amendments.ts` is owned for the person's create-merge, update, re-date
   and delete of a version, so each marks the version's per-turn record kept (`markImprintsKept`; today called
   only from `sockets/entries.ts` ~543, `sockets/lorebooks.ts` ~2931, `sockets/narrativeGraph.ts` ~4002);
   `keptImprintsByEntry` (`imprints.ts` ~767–800, entry-only today) maps a version's kept record to its entry so
   the *replaced* note with **Revert** / **Keep** shows (server only; test that the note's data arrives);
   `takeBackRedline` finds a version's edit-history row by `amendment_id`. A new `SUBJECTS.version` in
   `imprints.ts` (row, read, write, remove, insert). **Revert of a field the turn added deletes the key; it never
   writes null.**
4. **The schema:** the subject-kind CHECK is in the schema (`db/schema.ts` ~10955; precedent
   `drizzle/0130_m0_sdk_gaps.sql`): one generated migration, index **0164**, widening the CHECK only. No stored
   data changes, so no second-boot data test is needed beyond the migration applying twice cleanly.
5. **Goal 4 and Build D (defaults for new entries) are out of this lane.** They move to `time-t5b` with the SDK
   declaration, where History's "living (slow)" can take its number (a stopgap 0 here could not later be told
   from a person's choice of Fact). This lane is: the write, the undo, ★FD-9 and correction 1's Apply checks.
6. **Move down the tree needs no new refusal:** taking back a version changes only its own line before and
   after a move (`moveDownTheTree.ts` ~12–13, ~119–121). Drop that bullet; do not edit that file.
7. In the report, say plainly: a dated session no longer gets Apply's settle "through the newest applied anchor"
   for these writes (★FD-10's case shrinks); the Item / Beginning example for the docs belongs to `time-t5b`.
