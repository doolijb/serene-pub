# BRIEF — build lane `cm-1` — cast Memory: a character may read as of its own point (programme 1.5)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-memory-distances-repairs-2026-11-17.md` part 1 (**re-verify every file:line**),
`plans/PLAN-entry-time-and-lines-2026-11-14.md` 55–130 (the ruled design, the read path, rule 7) and 215–230
(★1, ★13), `plans/REPORT-kn-2a-2026-11-16.md` and `plans/REPORT-wt-1b-2026-11-17.md` (the two per-speaker read
params, how the speaker is resolved once in the host's lore read, the panel's one switch per pipeline),
`plans/REPORT-tm-1-2026-11-16.md` / `-tm-2-` (with the timeline off, story time plays no part: `timelessNull`,
`reading.timelineOff`), `docs/lorebook-cast.md`, `docs/lorebook-time.md`, `STYLE-GUIDE.md` (advanced folds;
one sentence of help; date fields), `NOMENCLATURE.md` §1, §24 and rows **reading**, **line**, **moment**,
**cast version**, **known**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only, never `--write`. **Migration: generated only** (`npm run db:generate`; never hand-written; its
index must exceed the highest applied, 0168: check `drizzle/meta/_journal.json`; add the column(s) to
`db/schema.ts` and generate in the **same** change; no row seeded at a fixed id; a test that a second boot
changes nothing). Never `npm test` / `npm run build` at the SDK root; `sdk:build` only from the app root after
checking no dev / preview server (`pgrep -af "vite"`; the Svelte language server's esbuild does not count; an
isolated walk instance may be running a built server on another port: that is not a `vite dev`, but **ask
`pgrep -af "node build"` too and wait for it to end before `sdk:build`**) and no vitest is up. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/cm-1-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. Inside `db.transaction` only `tx`. No
full run, no `npm run build`.

## Owner

2026-11-13: "That works, make it an advanced fold on the cast member. Also provide a vertical time view like i
suggested for other entries" · "I think we need to simplify that to one mechanism though we can display it in
different ways." Ruled 2026-11-14 ("Lets go with all your recommendations", ★1, ★13): "a cast version's
**Memory** is a reading (line and date) plus one optional date, *nothing before*, that applies to events. Time
travel, a mind in a younger body, a time loop and amnesia are these two values." Stored on the
`character_versions` row (new, a migration). Read path step 1: "pick the reading: the session's, or the
speaking character's own Memory". Rule 7: "A Memory naming a deleted line falls back to the line it forked
from, and says so." 2026-11-15: "When querying on a characters history/knowledge, have it be a toggle that's
on by default". Standing: with the Timeline off, dates play no part; a narrator voicing everyone reads all;
comprehension and fidelity first; the model is never told what a character does not know.

## What Memory is (do not widen it)

Two values on a cast version, both optional, both empty by default (then the character reads as the session
does, exactly as today): **a reading** (a line of the lorebook and a story date on it) and **nothing before**
(a story date). They change only **what that character reads when it is the speaker of a turn**. It is not a
list of what the member saw (the Timeline tab shows a member's scenes; the Knows tab shows ties).

## Build

1. **Storage (migration).** On `character_versions`: the Memory's line (a reference to the lorebook's line /
   branch, nullable) and date parts (year, month, day, nullable), and *nothing before*'s date parts (nullable):
   follow how a version's own date and line are stored on that row (`db/schema.ts` ~9700–9790) for column
   shapes and naming (§24; ★ names). Generated migration; export / duplicate / branch-copy paths that copy a
   cast version carry the new columns the way they carry the version's own date (find every copier of
   `character_versions`: the lorebook duplicate, the session branch copy, the notes overlay, starter kits; the
   lorebook **file** is frozen: do not add the columns to the export format (owner 2026-11-16: "We aren't ready
   to re-enable exports"); the io round-trip test's column classification must list them as "not carried, by
   ruling").
2. **The save door.** The cast version's existing save path (find it: `characterVersions:*` /
   `writeMemberEdit`) accepts and validates the values: the line must be a line of this lorebook; a date must
   land on the lorebook's calendar (`assertDateLands`); *nothing before* may not be after the Memory's date
   when both are set (refuse in words, ★); only whoever may edit that version may set them. A Memory dated
   after the story's now is **allowed** (foreknowledge).
3. **The fold.** On the Member tab's version zone in `client/lorebooks/CastWorkspace.svelte`, behind **Show
   advanced controls** (`showsAdvancedControls`, `client/advancedControls.ts`; the cast workspace does not use
   it yet: follow `BookSettings.svelte`), a fold 🚧 **Memory** (★ label) with: *Remembers as of* — a line pick
   and a date (reuse the existing line + date control the workspace or `SessionLorebookReading` uses; do not
   build a seventh date form: if none is reusable as a component, use the smallest existing one and say so)
   and *Nothing before* — a date; each with one sentence of help (★); a **Clear** for each. Shown only when the
   lorebook keeps a timeline (with the Timeline off the fold is absent, and stored values are kept untouched).
   The owner's "vertical time view" for a cast member already exists as the Timeline tab: verify and say so; do
   not build another.
4. **The read.** In the host's lore read, where the speaker is already resolved for `knownToSpeaker` and
   `speakerInCast` (`pipelines/runtime/host.read.lorebookEntries.ts`), and in the earlier-scenes read: when the
   speaker's cast version **in force** has a Memory:
   - **the reading** replaces the session's reading for that speaker's lore reads: entries, versions, links
     and history are read at `readingOf(line, date)` (`state/reading.ts:217`) instead of the session's reading;
   - ***nothing before*** leaves out **events** dated before it for that speaker: history days, scene
     summaries and earlier scenes (not undated lore, not Perpetual entries);
   - a narrator turn, a turn with no single speaker, or a speaker with no Memory reads exactly as today
     (prompt bytes identical);
   - the session's transcript in the window is not filtered (as with the other two params);
   - **rule 7:** a Memory whose line was deleted falls back to the line it forked from (walk up until a line
     exists; main at the end) and the receipt says so (★ sentence).
   Receipts: one line per read in the manner of the other two filters (★). Statement cost: the speaker's
   version is already loaded for the cast read; the Memory rides on it: no extra statement when no Memory is
   set (prove against `plans/perf-2-shas-final.txt`: both baselines byte-identical in shas **and** counts).
5. **The switch.** One on-by-default read param, in the manner of `knownToSpeaker` and `speakerInCast`
   (boolean, default `true`, declared on the same reads that carry `speakerInCast`, placed after it; name by
   §24, ★), read by the host from the query that asked, and gathered by the panel into one switch per pipeline
   (`pipelines/config/panel/ganged.ts` `GANGED_PARAMS` is a table: add the entry). Off → the speaker reads as
   the session does. SDK: the param on the contracts, doc comments, the guide, `INTEGRATING.md`; `sdk:build`;
   registry hashes re-pinned with "(was …)"; param-enumerating tests re-pinned (old → new).
6. **Timeline off:** Memory plays no part (the fold is absent, the read ignores stored values); test.
7. **Docs and names:** `docs/lorebook-cast.md` (Memory: what the two values do, with the four examples the
   ruling names), `docs/lorebook-time.md`, `docs/pipelines.md` (the third switch), `NOMENCLATURE.md` (a
   **Memory** row with its charter: purpose, why it exists, what it owns, what it does not — the Timeline tab
   and the Knows tab own the other two things; §25).

## Tests

Storage: the migration applies; a second boot changes nothing; copies carry the columns; the lorebook file
does not. Save door: each refusal; foreknowledge allowed. Read: a fixture world with two lines and dated
entries: a speaker with a Memory on the other line at an earlier date reads that line's entries as of that
date; *nothing before* drops earlier history days and scene summaries and keeps Perpetual lore; a deleted
line falls back with the receipt; narrator turn and param off are byte-identical to today; the Timeline off.
Panel: the one switch. Both prompt baselines byte-identical with unchanged counts. DOM: the fold shows only
with advanced controls on and a timeline; saves; Clear. SDK suite: the four known failures only. `tsc` 0;
`npm run check` 0 errors in lane files.

## Workers (at most 2 at once; sequential on a shared file)

1: the migration, the save door, the copiers, the SDK param and its build. 2: the read, the receipts, the
fixture world, the panel entry. Then 3: the fold and docs. Briefs `plans/briefs/BRIEF-cm-1-w<n>.md`.

## Stop and ask when

CLAUDE.md §Decisions applies; a cast version cannot name a line without a new table; "the version in force
for the speaker" is ambiguous on a branch (state the rule the cast read uses and follow it); the read would
cost a statement when no Memory is set; a prompt baseline moves; the reusable date control does not exist and
a new one would be the seventh.

## Report

Final message = the report (lead saves `plans/REPORT-cm-1-<date>.md`): the columns and migration index; the
save door's rules; the fold (labels and sentences ★); the read (what each value changes, rule 7, receipts ★);
the param (name ★) and the panel; statement counts; tests; **Noticed, not done**. Under about 700 words.

## HELD (2026-11-17) — cold review; waits on the owner (rulings page CM1–CM4 / D74)

Not launched. The design holds; corrections for the rewrite:
1. **The read.** `sessionReadingOf` (`state/reading.ts` 331–380) carries `holderBookId` (the notes overlays),
   `sessionCuts` and `timelineOff`, which `readingOf` (217) does not: build the speaker's reading as the
   **session's reading with only the line and moment swapped**. Pick the version in force at the **session's**
   reading (the body), take its Memory once, never re-resolve the cast at the Memory's reading (the book memo
   is keyed by the reading, `host.read.lorebookEntries.ts:255`; the cast inside it resolves at that reading,
   :357). The speaker's own profile stays at the session's reading. Cost, stated honestly: one extra book read
   whenever a Memory is set; zero extra statements when none is.
2. **Rule 7 cannot work as written:** `amendments:deleteBranch` deletes the branch row
   (`sockets/amendments.ts` ~2406) and the existing `branchId` key cascades (`db/schema.ts:9727`). No cascade
   for the Memory's line: `deleteBranch` **moves Memories on that line to its parent in the same transaction**,
   as it already moves sessions (~2379–2386), and says so in the delete's result (★: it changes the delete flow).
3. **Copiers, corrected:** the duplicate (`lorebooks/tableRegistry.ts` 853–866) spreads the row and remaps only
   `branchId`: the new line column must be remapped through `maps.branches`; `lorebooks/timelessCopy.ts`
   386–434 clears both values (as it clears the version's own date); `lorebooks/foldInParent.ts` 1462–1480,
   1541–1568 (Apply); `sockets/narrativeGraph.merge.ts` 702–725 (clear or remap). The session branch copy and
   starter kits insert no versions. An overlay row lives in the notes while the line belongs to the attached
   lorebook: validate "a line of this lorebook" against the lorebook of the member the overlay stands for
   (`overlay_of`). `writeCastVersion` copies the version in force (`characters/versions.ts` 1672–1676), so a
   Memory carries forward to new versions: intended. Keep the Memory out of the change keys a pipeline can
   write (a person's setting). Round-trip test: add the line column to `REFS` as `"branch"`
   (`sockets/lorebooks.roundTrip.int.test.ts` 622–633).
4. **The "vertical time view" is the versions rail** (`VersionRail`, `CastWorkspace.svelte` 104, 2394; built
   2026-11-14), not the Timeline tab.
5. **Invariants with tests:** a Memory never moves write dating (`host.loreWrites.ts` 263–266, 407–410), the
   clock, or `current-date`.
6. **UI:** reuse `SessionLorebookReading` (32–70) through `lorebookId` and bindable `branchId` / `clock` with
   copy props (its wording is about sessions; a null clock means "follows the line's present", while a Memory
   needs a date), or `VersionDateDialog`.
7. **Cut:** A storage, copiers, save door, the `deleteBranch` move ‖ the SDK param and the panel entry (under
   Advanced); B the read and its fixture; C the fold and docs.
