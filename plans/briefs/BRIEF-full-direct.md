# BRIEF — build lane `full-direct` — under Full, a session writes straight into the player's own lorebook

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then the "rule as built" parts of
`plans/REPORT-sense-b1-2026-11-11.md`, `plans/REPORT-sense-b2-2026-11-12.md`, `plans/REPORT-sense-b4-2026-11-12.md`
(and `REPORT-sense-b3*` if present), `docs/lorebooks.md` ~225–262, the header of
`src/lib/server/lorebooks/imprints.ts` (1–60), CLAUDE.md Hard rules, Principles, Standing rulings, NOMENCLATURE §1,
§23, §24, §25, STYLE-GUIDE.md copy rules. Line numbers are from a read-only inventory on 2026-11-13: re-read
before editing.

Words. A **build lane** is this stream of work. A session's **notes** (code: *own book*) is the `lorebooks` row
with `session_id` set; the **lorebook** is `sessions.lorebook_id`. **Full / Review changes / Off** is the lorebook
write setting in force (the stricter of the person's and the book's). A change **waits** when it is kept in the
notes until it is applied to the lorebook. An **imprint** (`lore_imprints`) is the per-field before/after record a
turn's write leaves, by which a swipe, regenerate, Back or delete takes it back.

## Rulings that bind (owner, 2026-11-13)

- "We should pull back on how frequently we use own notes. Use the lorebook if it's a surfaced one."
- "file it right away. if review is off, write directly to the lorebook". Lead's reading, put to the owner with
  its costs and agreed ("I agree"): **with Full in force and the session on its owner's own lorebook, everything
  the session's pipelines write goes into the lorebook at once, changes to existing entries included; the notes
  are used under Review changes and Off, for a session whose notes are its whole lorebook, and for a book the
  session's owner does not own.** This reverses, for Full only, `sense-b1`'s "a change to an existing lorebook
  entry always waits" and `sense-b4`'s "a session whose scenes end by themselves keeps new entries, places,
  history days and links in the notes under Full".
- Agreed with it (lead's recommendations, 2026-11-13):
  1. **Inside the open scene a direct write does not stop Back** (refined by correction 2: the story settles
     when the scene closes). Back, swipe, regenerate and delete take it back by its imprint, and a field a
     person changed since gets the *replaced* note (Revert / Keep).
  2. **A branch session** keeps a change to an entry on another line (or while its fork is pending) waiting in
     its notes, as now. It is never refused for that reason.
  3. **Automatic Apply at scene close stays**, so what already waits in notes drains by itself.
  4. Accepted: direct writes do not wait for a scene summary's review.
- Standing: "Let the model rewrite it" (lore-match, 2026-11-13); the earmark refusal (`run-reads-entry`) stays.
- A change history for entries was agreed as a **later, separate build**. Do not start it.

## Corrections from the cold review and the owner's answers (2026-11-13) — these override anything below that disagrees

1. **A dated session writes a dated change straight into the lorebook** (owner, asked what a session that plays
   at a story date does to an existing entry under Full: "Write a dated change straight into the lorebook").
   On the "book" route, when the session reads at a date, a change to an existing lorebook entry is **not** an
   in-place overwrite: it is written at once as a dated change (`entry_amendments`, not held) on the lorebook at
   the session's date, on the session's line: the same row Apply makes today from a dated held change
   (`ownBook.ts` ~2378–2385; reuse that write, do not spell a second one). The entry's own row and its text at
   earlier dates stay as they were. It is imprinted so swipe, regenerate, Back and delete remove it and Forward
   puts it back: `lorebooks/imprints.ts` gains a subject for it (`IMPRINT_SUBJECTS` ~56; **owned for this**). A
   second change by the same session to the same entry at the same date follows what a held change does today
   (say which: folded or a second row). A session with no date writes in place, as Build 2 says. Tests: text at
   an earlier date and on another line is unchanged; another session at a later date reads the change at once;
   each undo path; Forward.
2. **Settling** (owner: "Settle when a scene closes"). Build 3 below is **replaced** by this. Leave the settle on
   a `sources` write exactly as it is today for every session (the skip stays keyed on
   `scenesEndByThemselves`), so a session whose scenes don't end by themselves behaves as today. New: when a
   scene closes for a session on the "book" route under Full, the story settles through the end of that scene
   **whether or not anything was applied**, at exactly the moments automatic Apply runs today (it waits for a
   summary being written or awaiting review; Close out; nothing while Back could still go Forward). Put it where
   automatic Apply decides (`ownBook.ts` ~2820–2950; Apply's own settle is ~2390). `sessions/settle.ts` is
   called, not changed. Report as an open ★ that a Full session with no scenes at all still settles on each
   routine write, as today. Note, do not fix: automatic Apply and `appliesItself` read the book's setting only
   (`ownBook.ts` ~2849, ~2994) while the route uses the stricter of the person's and the book's (~401); use the
   route's rule for the new settle.
3. **Back and swipe never delete a row another session stands on.** `retractImprints` calls a made row untouched
   through `holds` (`imprints.ts` ~221–245), which ignores another session's held change, a link in another
   session's notes and values another session keeps on it; `entry_amendments.entry_id` cascades, so the delete
   would wipe them. Widen `holds` to the checks **Take back** already makes (`ownBook.ts` ~1360–1375,
   ~2571–2616): then the row stays and gets the *replaced* note. **Owned for this.** Tests: session B holds a
   change on, links to, or keeps place values on an entry session A made directly; A swipes; the entry and B's
   rows remain and the entry is marked *replaced*.
4. **A change that already waits keeps collecting.** When this session already holds a change on that entry, the
   new change folds into it as today (it drains at scene close); it is never written beside it. In Build 4's test.
5. **Forward after the slot was taken.** A made row is re-inserted with its stored `position`
   (`imprints.ts` ~213); `lorebook_entries_position_uq` refuses it when something took the slot. Give it the next
   free position then (`utils/lorebookEntries.ts` `nextPosition` ~727). Test: rewind, another session adds an
   entry of that type, Forward succeeds. A history day whose date gained another day meanwhile: **stop and
   report**, do not build a merge.
6. **Facts corrected.** `lineOnFirstWrite` is set for branches (`sessions/branch.ts` ~184) **and** for "branch
   off at a point" starts (`sockets/sessions.ts` ~1277–1290); on a pending fork a match without links does not
   fork (`host.ts` ~11655), so the line check (~2283) must turn into a hold, never a refusal. A later **run's**
   write to the same field is spliced silently; the *replaced* note appears only when a person overwrote it or
   the chain broke (`imprints.ts` ~24–36). `update-lore-entry` on the lorebook route sends a notes entry through
   `sessionLoreWriteTo(…, {notes:true})` (`host.ts` ~11976).
7. **Say in the docs:** the Lair's **File as a room** on your own lorebook is a press with no turn, so Back no
   longer takes it (it did while it sat in the notes); **Applied to the lorebook** lists only what waited; a
   dated session's change lands as a dated change at once.

## What is true today (inventory; verify)

`host.ts` = `src/lib/server/pipelines/runtime/host.ts`; `ownBook.ts` = `src/lib/server/lorebooks/ownBook.ts`.

- `loreWriteRoute` (`ownBook.ts` ~346–355) returns "book" only when there is an attached book the session's
  owner owns and the mode is Full; `loreWriteTargetFor` (~381–423) reads the facts.
- `sessionLoreWriteTo` (`host.ts` ~1634–1713) forces the notes when `opts.notes || endsByThemselves` (~1658–1665);
  `scenesEndByThemselves` is `ownBook.ts` ~438–459. The settle skip for such sessions is at `host.ts` ~11849,
  ~12053, ~12202; the own-book-first resolve at ~11953–11960.
- `changeLoreEntry` holds any entry not in the notes, with no mode check (`host.ts` ~2274–2279); outlet-level
  copies of that decision at ~11694–11695 and ~11973–11979; the match path's fork decision (~11655–11658)
  assumes a match is held. Its direct branch (~2290–2329) writes in place with `imprintChanges` (~2313–2321) and
  refuses an entry on another line or under a pending fork (~2283–2289).
- A write carrying `sources` moves the settle line (`host.ts` ~11849–11853, ~12053–12059, ~12202–12208);
  retraction at or below the line is refused (`imprints.ts` ~509–511).
- On the "book" route the match looks in the lorebook only (`host.ts` ~1669–1676); the notes route also reads the
  lorebook (`alsoReads`, ~1693–1708). `entries-named` shows rows of both books, notes first (`loreMatch.ts` ~307).
- Automatic Apply (`ownBook.ts` ~2820; Full on the owner's own book only, ~2848–2850; branch guard ~2893–2946;
  summary wait ~2873–2880). `appliesItself` (~2969–2995) feeds the **This session only** card
  (`SessionViewPanel.svelte` ~647–664).
- Cast members, world values/stats, ties, timeline capture and the lorebook annex already land in the lorebook
  under Full (`characters/versions.ts` ~1863, `state/write.ts` ~2791, `rulesets/ties.ts` ~251, `state/durable.ts`
  ~198). **Not in this lane.**

## Build

1. **New entries, places, history days, links.** `sessionLoreWriteTo` no longer forces the notes because scenes
   end by themselves. `opts.notes` (a filing tool's `toNotes`) still does. The code that only served the forced
   route may stay if other routes use it; remove a branch only when nothing can reach it, and say which.
2. **A change to an existing lorebook entry** (`changeLoreEntry` and its three outlet-level copies, the match
   path's fork decision): on the "book" route it is written in place and imprinted, as a notes entry is today.
   It waits in the notes only when the route is not "book", **or** when the direct write would be refused for the
   line (another line, a pending fork): that case keeps today's held change. No write is refused that is held
   today.
3. **No settle.** A pipeline's direct write to the lorebook does not move the settle line, for every session
   under Full (today only sessions whose scenes end by themselves skip it). First find what the settle on a
   `sources` write protects (`lore_sources`, the reads that assume settled text): if taking it away can leave a
   row pointing at a message that Back removes, or breaks a reader, **stop and report** before changing it.
   A person's Apply still settles as today.
4. **Rows that already wait in the notes.** Automatic Apply stays as built. Under Full the match and
   `update-lore-entry` look in the notes first, then the lorebook, as the notes route does: a name that meets a
   waiting notes row changes that row (it drains at the next scene close); it never makes a second entry and
   never answers "not found". Test with a session that holds a waiting new entry and a waiting change from before.
5. **The card.** Check what **This session only** and its sentence (*The lorebook takes this session's changes by
   itself as each scene closes.*) show for a Full session that has nothing waiting and for one draining old rows.
   Change no copy unless a sentence is now false; a changed sentence is 🚧 and an open ★.
6. **Undo, proved.** Tests through the real outlets: under Full on the owner's own lorebook a routine's new entry,
   place, history day and link land in the lorebook and nothing in the notes, for a session whose scenes end by
   themselves and one whose don't; a shown entry is rewritten in place, name kept, with imprints; swipe,
   regenerate, Back and delete of the turn restore the earlier text and remove the new rows; Forward puts them
   back; after a hand edit of the field the take-back leaves it and marks it *replaced*; Back is not refused
   after a `sources` write; a branch's change to an entry on the original's line waits in the branch's notes;
   Review changes and Off behave exactly as before (existing tests unchanged); a session on a plugin-provided
   book and a notes-only session behave exactly as before; a second session on the same lorebook reads the write
   at once.
7. **Tests that pin the old rule** are rewritten to the new rule, never deleted or skipped; list each in the
   report with what it now asserts. Expected: `host.scenesEndRoute.int`, `host.ownBookFull.int`,
   `host.heldEntryChange.int`, `host.loreMatchShown.int`, `host.historyWrites.int`, `host.ownBookRoute.int`,
   `host.forkTiming.int`, `loreSources.int`, `autoApply.int`, `liveScenes.autoApply.int`, `applyForksLine.int`,
   `applyOwnBookLinksDays.int`, `imprints.int`, `sessions.lairKnock`, `sessions.lairWalk`, `sessions.lairFileRoom`,
   `loreLinks.int`, `sessionLoreWrites.int`, `durable.int`, `locations.int`, `heldAmendments.undo.int`,
   `heldAmendments.readers.int`, `branch.heldAmendments.int`, `rewind.int`, `sessions.sweepShown.int`,
   `sessions.chatMemoryShown.int`, `sessionViewPanel.applied.dom`, `sessionViewPanel.ownBookItems.dom`. A test that
   set Full only to reach the held path moves to Review changes so the held path stays covered.
8. **Docs and ledgers in the same change:** `docs/lorebooks.md` (Changes from a replaced reply; Your session's own
   notes; Bringing a session's changes into the lorebook, incl. "By itself, as scenes close"),
   `docs/lorebook-time.md`, `docs/genre-lair.md`, `docs/genre-story.md`, `docs/sessions.md` where they state the
   old rule; `../serene-pub-sdk/INTEGRATING.md` and `../serene-pub-sdk/guides/*.md` where they state it (prose
   only); NOMENCLATURE rows and §25. A declaration's text in SDK source that states the old rule is **listed in
   the report, not edited** (it may move a pinned hash; the lead does it with the rebuild).

## Files owned

`src/lib/server/pipelines/runtime/host.ts` (the routing, hold, settle and match points above only),
`src/lib/server/lorebooks/ownBook.ts` (`loreWriteRoute`, `loreWriteTargetFor`, `scenesEndByThemselves`,
`appliesItself`), `src/lib/server/pipelines/runtime/loreMatch.ts` (the match's book order only),
`src/lib/client/components/sessionForms/SessionViewPanel.svelte` (the card's sentence, only if false), the tests
above and new ones, the docs above, `NOMENCLATURE.md`, and `src/lib/server/lorebooks/imprints.ts` for corrections 1, 3 and 5 only. **Not**
`sessions/settle.ts` or `sessions/rewind.ts` (read; a needed change there is a stop), `sockets/entries.ts`, `sockets/sessions.ts`, `db/schema.ts`,
`Layout.svelte`, `startup/index.ts`, `runtime/dispatch.ts`, any SDK source file.

## Out of scope

Review changes and Off; cast members, stats, ties, annex (already direct); the entry change history; children (a
note filed under an entry); removing the waiting machinery, Apply, Take back or the card; the write setting
itself; any migration, setting, flag, event or new name; converting or moving rows that already wait.

## Stop and ask when

The dated change cannot reuse Apply's write or cannot be imprinted without a schema change; widening `holds`
changes what Back does on a session's own notes; Review changes or Off would behave differently; a
change is needed in `imprints.ts`, `settle.ts` or the SDK source; a write held today would be refused; a migration
or a new name is needed; a test of the old rule cannot be rewritten without losing coverage of the held path.

## Done means

The tests in Build 6 and 7 pass, with the neighbouring suites of `pipelines/runtime`, `server/lorebooks`,
`server/sessions`, `server/state` and the Lair socket tests. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc
--noEmit -p .` clean; `NODE_OPTIONS=--max-old-space-size=12288 npm run check` no new errors. Tests only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > log 2>&1"`
from the repo root, one run at a time; another session also runs tests on this checkout: before each run check
`ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` and wait (never `pgrep -f "vitest run"` in a
loop: it matches itself). An int test that opens a DB inside an `it` takes a 60 s timeout. **No
`npm run sdk:build`.** Do not re-pin hashes: list any that moved (none expected). Inside a transaction use only
`tx`. Comments state the rule, not the story (`shared/conformance/commentHistory.test.ts`). At most two workers at
once.

Verbatim for every worker brief:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `kill -9`.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-full-direct-2026-11-13.md`):
the rule as built, as a table of write kind × setting × session shape; what the settle protected and what you
did; the branch case; what happens to rows that wait; each rewritten test and what it asserts now; code left
unreachable; SDK declaration texts that still state the old rule; copy changed, verbatim; changed files; tests and
results; open ★; **Noticed, not done**. Say plainly that nothing was looked at in a running app.
