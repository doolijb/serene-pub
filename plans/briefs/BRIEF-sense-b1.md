# BRIEF — lane `sense-b1` — Stage B, the thin slice: a session's change to a lorebook entry is held, applied, taken back

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then, in full,
**`plans/DESIGN-own-book-write-path-2026-11-11.md`**: its **Challenger round** at the end wins wherever it differs
from the text above it, and the rulings below win over both. Then `plans/PLAN-sensible-engine-2026-11-11.md` §1.3
(the four rules), §5.8 (rulings) and §5.9 (the queue, including "Step 3 is cut down" and "The change record is two
tables"); `plans/REPORT-sense-st3-2026-11-11.md` (the undo rule and the change records as built today); CLAUDE.md
Hard rules and "0.6 is in users' hands"; NOMENCLATURE §1, §23, §24, §25. `plans/briefs/BRIEF-sense-clk.md`'s
**Verbatim rules** bind you and your workers word for word.

## Why a slice

Stage B is large. Before it fans out, **one path is built end to end and proven in tests**: a pipeline's change to
one entry of the session's attached lorebook. Nothing else about Stage B is built here: not new entries, links,
members, values, scenes, automatic Apply, the write mode's removal, or the router's removal. Those lanes follow and
will copy this slice's shape, so the shape matters more than the reach.

## Rulings that bind (owner 2026-11-11 unless said)

- "Only Apply settles." "A turn owns what it wrote." A branch: "One cut at the fork message."
- Stage B questions 1–2: "Do what's best, least complex and easiest to manage without cornering us." Lead's
  decision: **(b) fold.** Apply folds a held change into the lorebook's row and files a change record that keeps
  before, after, the session and the message. A branch reads the lorebook live, so it sees what its original
  applies later; it is cut off from its original's *session*.
- The change record stays `lore_imprints` for lorebook rows (`session_imprints` is the session's; do not merge).
- Members never see model plumbing; it is a session, never a chat; every session has a lorebook.

## Build

Begin by re-reading every cited line (they have drifted) and listing, in your first worker brief, every reader of
`entry_amendments` in `src/`. The challenger's C1 list is a floor.

1. **Schema, one generated migration** (re-check the highest index in `drizzle/` and `drizzle/meta/_journal.json`
   immediately before `npm run db:generate`; 0155 today; another session is building; never hand-write):
   - `entry_amendments`: `source_message_id` int nullable, `base` jsonb nullable; `year` becomes nullable with a
     CHECK that an undated row has a `base` (the existing month/day CHECKs stay true).
   - `lore_imprints`: `origin` text NOT NULL default `'run'` with a CHECK (`run`, `routine`, `press`, `person`,
     `apply`, `book-run`, `upgrade`), `batch` text nullable, `cause` jsonb nullable. Only `run` (default) and
     `apply` are written in this lane.
2. **A held amendment** 🚧 (propose the term through NOMENCLATURE §24; the design's word is "held"): an
   `entry_amendments` row whose `lorebook_id` is the session's **own book** and whose `entry_id` is an entry of the
   attached lorebook, with `source_message_id` (the turn's anchor, by `turnAnchorOf`) and `base` (the resolved
   value of each field it changes, as the session read it when it wrote).
3. **Write.** `changeLoreEntry` (`pipelines/runtime/host.ts` ~2003): when the stored entry belongs to the attached
   lorebook (not the own book), it inserts a held amendment in the own book and touches nothing in the attached
   lorebook: no update, no imprint there, no line fork, **whatever the lore write mode is**. A change to an
   own-book entry is unchanged in this lane. `update-lore-entry` stops refusing a change to an attached-book entry
   on those grounds; its published ports and result shape do not change.
4. **Read (challenger C1, in full for entries).** The holder (the session's own book id) travels on `EntryReading`.
   `entryOverlaysFor` includes the holder's held rows whenever the reading is a session's and never for the main
   reading, so no caller opts in. The shared resolver (`src/lib/shared/lorebooks/amendments.ts`, `lineReading.ts`)
   applies held amendments last, oldest anchor first; a dated one only at or before the moment, an undated one
   always. Readers that query by `entry_id` alone or copy a book **exclude** held rows explicitly
   (`utils/lorebookEntries.ts` ~636, `lorebooks/imprints.ts` ~193, `lorebooks/tableRegistry.ts` ~770). One test per
   reader that the session sees its held change and another session of the same lorebook does not: retrieval,
   keyword match, the names vocabulary, places, supply, side characters, graph links, the entries workspace.
   Retrieval ranks by the lorebook entry's vector; that is accepted.
5. **A turn owns it.** Swipe, regenerate, Back and delete remove the held amendments anchored to the turn, through
   `retractStateAnchoredTo`; Forward and a failed re-tell put them back. No splice: held rows are whole rows.
6. **Listed and applied.** The existing "This session only" list (`overlayItemsOf`, `sessions:overlayItems`) also
   lists each held entry change (which entry, which fields, before and after). `applyOverlayItems` applies one:
   re-read the lorebook entry's resolved fields; if any differs from `base`, it is a **conflict** and stays held
   with that reason (F6); otherwise fold it into the lorebook row (dated: move the row to the lorebook and the
   session's line, superseding; undated: update the row), file `lore_imprints` rows with `origin: 'apply'`, one
   `batch` id for the press, `cause` naming who pressed, and the session and message; delete the held row; settle
   as Apply does today. Only the lorebook's owner applies (as built).
7. **Taken back.** One server function takes back a `batch`: it restores each field only while it still holds the
   record's `after`, puts the change back as a held amendment in the own book, and refuses in a sentence when
   something stands on it (F8). Settling must not strip `before` from `origin: 'apply'` records (challenger C2).
   **No new UI or socket for take-back in this lane**: tests only; the UI is a later proposal.
8. **A branch.** `copyOwnBookToBranch` copies held amendments anchored at or before the fork message, message ids
   remapped. Tests: a branch cut before the change does not see it; one cut after does; after the original
   applies, both read the lorebook's value.
9. **Docs and ledgers in the same change:** `docs/lorebooks.md` and `docs/sessions.md` (a short, plain paragraph:
   a pipeline's change to a lorebook entry is kept with the session until it is applied), the schema comments that
   say "An amendment IS a date", `../serene-pub-sdk/guides/storage.md` where it says such a write changes the
   lorebook, NOMENCLATURE rows and §25. Copy is provisional 🚧; list every sentence in the report.

## Files owned

`src/lib/server/db/schema.ts` (the columns above), the one generated migration, `state/entriesOnReading.ts`,
`src/lib/shared/lorebooks/amendments.ts`, `lineReading.ts` (amendment ordering only), `lorebooks/ownBook.ts`
(`overlayItemsOf`, `applyOverlayItems`, `copyOwnBookToBranch`, `sessionEntriesAsRead`), `lorebooks/imprints.ts`
(the three new columns and the by-entry exclusion; the retraction rule must not change), `state/write.ts` (retract
and restore of held amendments), `sessions/settle.ts` (the `apply` exemption), `sessions/branch.ts` (the call),
`pipelines/runtime/host.ts` (`changeLoreEntry`, `update-lore-entry`, the retrieval read; **no other lane touches
this file**), the lines of each C1 reader that load amendments, `sockets/sessions.ts` (the two overlay sockets'
payload, additive), the client card that lists overlay items (one more item kind, existing layout), tests beside
each, the docs above.

## Out of scope

Everything else in the design: links, members, values, scenes, new entries, `applyHeld`'s other kinds, automatic
Apply and the three lorebook settings, removing the lore write mode or any routing function, `ensureSessionLine`,
`recordToTimeline`, `new-world`, registrations, stat owner kinds, the settle triggers, any new setting, any
take-back UI, a data upgrade of existing imprints (none is needed for this slice: say so if you find otherwise).

## Stop and ask when

The migration needs more than the columns above; a published SDK name, port or payload would change other than
additively; a reader cannot get the holder without a signature change that ripples past the owned files (report
the sites; do not thread a global); a held change would be visible to another session or to the lorebook's own
reading; the fold cannot keep "supersede" for a dated change; existing stored data would need a pass.

## Done means

Tests for every numbered item, including: two sessions on one lorebook each hold a different change to the same
field and each reads its own; the first applies cleanly, the second is then a conflict and stays held; take-back
of the first's batch restores the lorebook and the held row; the same after a settle; swipe, regenerate, Back,
delete, Forward; the branch cases; a member's session on someone else's lorebook holds its change and cannot
apply. The existing suites for amendments, `entriesOnReading`, `ownBook`, `imprints`, `settle`, `branch`,
`oneUndoRule`, retrieval and the `update-lore-entry` socket/host tests pass, rewritten where the behaviour moved,
never weakened. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean. Tests run only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 …"`.
If the SDK changed (docs only is expected): `pgrep` checks, one `npm run sdk:build`; report pins, **do not re-pin**.

## Report

**Return the full report as your final message**, after every worker has finished (the lead saves it as
`plans/REPORT-sense-b1-2026-11-11.md`): the readers found and what each does now, the migration's name and index,
the rule as built in three sentences a modder could read, what the next Stage B lanes should copy and what they
should not, changed files in each repo, tests and results, pins that moved, open ★, provisional names and copy,
**Noticed, not done**.
