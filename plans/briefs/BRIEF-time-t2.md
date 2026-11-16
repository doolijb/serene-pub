# BRIEF — build lane `time-t2` — an entry's Beginning and Decay

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §1–§5 and §10, `plans/REPORT-timeline-b-2026-11-14.md` (what the
Timeline switch hides), `NOMENCLATURE.md` §1, §24, the lorebook group section and §23, `STYLE-GUIDE.md` (the
form and copy sections), `docs/lorebook-time.md`, `docs/lorebooks.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

Every lorebook entry gains two properties a person can see and set, in one quiet row of the entry form:

- **Beginning:** *Perpetual* (no date; every entry today) or *Began at ‹date›* (the entry is not read at a
  moment before that date).
- **Decay:** *Fact* (rate 0; every entry today) or *Living* with a rate above 0 and at most 1.

**Decay changes no recall in this lane**: the number is stored, shown, edited, copied and exported, and nothing
ranks by it yet (lane T7 does, after a measurement). Existing data reads exactly as before: a second boot
changes nothing.

## Owner rulings this lane builds (quote them in worker briefs)

- 2026-11-13: "Decay: Fact | Living" and "Beginning: Perpetual | Began at date"; "Yes on labels."
- 2026-11-13: the rate is "a value between 0 and 1, core by default will use a reasonable multiplier against
  that. Modders can query and calculate against that number how ever they want, or ignore it out-right."
- 2026-11-14, "Lets go with all your recommendations", which rules: *Beginning is the date of the entry's first
  version; no date = perpetual* (not a new stored switch); *Decay is one number; 0 is a fact*; the screen: **the
  entry's own row in words**, collapsed, opening on demand ("Keep the form quiet. Beginning and Decay sit in one
  collapsed row that shows its values in words and opens on demand; the defaults should make it rare to open").
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't
  enabled." So with the lorebook's Timeline off, Beginning is not shown or settable; Decay stays (it will count
  in rounds).
- 2026-11-14 (today): "continue with the feature completion buildouts" — the go for this lane.
- Standing: cast members get no Decay and no Beginning (a presence already says when they are there). History
  entries keep their own date editor; this row does not replace it.

## What exists (re-verify every line before relying on it)

- An entry's own date is `year`, `month`, `day` among its fields (`ENTRY_DATE_PARTS`,
  `src/lib/shared/lorebooks/amendments.ts` ~265; never set by a dated change). `loadEntryDates`
  (`src/lib/server/state/reading.ts` ~543) reads it through `historyEntryDate(e.fields)`.
- The line rule takes any row's date and never cuts an undated row (`src/lib/shared/lorebooks/lineReading.ts`
  ~365–391).
- The Timeline switch: `bookTimeline()` in `src/lib/client/lorebooks/bookData.svelte.ts`; server
  `src/lib/server/lorebooks/timeline.ts`.
- The entry form: `src/lib/client/lorebooks/EntryWorkspace.svelte` with `EntryCoreFields`, `EntryAdvancedFields`
  (under `lorebooks/sections/` or beside it; find them).
- The timeless copy: `src/lib/server/lorebooks/timelessCopy.ts`. Duplicate: `utils/lorebookDuplicate.ts`.
  Export / import: `utils/lorebookExportBuilder.ts`, `lorebookExportMapper.ts`, the import in
  `sockets/lorebooks.ts`.
- Highest migration is `0161`.

## Build

### A. First, find out what Beginning already does (supervisor, read-only, before any worker starts)

Answer with file:line in the report:
1. Can an entry of every entry type (World lore, Place, Item, Character lore, a ruleset's types) carry `year`,
   `month`, `day` today, on create and on update, or only History? Where is it refused or dropped?
2. With a date on a non-history entry, do the readers leave it out at an earlier moment: the workspace list at a
   moment, a session's recall (`entryOnReadingSql`, `state/entriesOnReading.ts`), the prompt's lore? Which do
   and which do not?
3. Does anything treat "has a date" as "is a history entry" (sorting, the History scope, one-per-date rules,
   compile, loose ends, the timeline lens)? List each place; those must key on the entry type, never the date.

Then build only what is missing so that the rule holds: **an entry with a Beginning is not read at a moment
before it, on any line, by the workspace or by a session; an entry without one reads as today; with the
Timeline off the Beginning plays no part.** If making this hold needs more than the Files owned, or changes how
history entries read, stop and report.

### B. Storage

- **Decay:** one column on `lorebook_entries`, a real number, NOT NULL, default 0. Add it to
  `src/lib/server/db/schema.ts`, then **generate** the migration (never hand-write):
  `SERENE_PUB_DATA_DIR=<your scratch dir> npx drizzle-kit generate --config ./src/lib/server/db/drizzle.config.ts --name entry_decay`.
  Its index must be `0162`; check `drizzle/meta/_journal.json`'s `when` is later than `0161`'s. One migration
  only. No data pass: the default is today's behaviour.
- The server clamps a written rate into 0–1 (a non-number is refused with a sentence). A dated change may not
  carry the rate (it is the entry's, like its date): refuse it where `cleanFields` (`sockets/amendments.ts`
  ~941–1004) refuses the date parts, with a sentence.
- **Beginning:** no new column. It is the entry's own date parts. A dated change on the entry may not be dated
  before the Beginning (plan §5.1): refuse on write with a sentence that names both dates. Setting a Beginning
  later than an existing dated change of the entry is refused the same way.
- Both travel with the entry: duplicate, export and import (additive, absent = 0 / no date), starter-kit copies.
  The **timeless copy** clears every kept entry's Beginning and keeps its Decay. The edit history
  (`lore_redlines`) records a change to either as it records other fields; check, don't assume.
- Name the column and the wire field by `NOMENCLATURE.md` §24 (lead's proposal: `decay_rate` / `decayRate`;
  UI words **Beginning**, **Perpetual**, **Began at**, **Decay**, **Fact**, **Living** are ruled).

### C. The row in the entry form

One collapsed row in the entry form for every entry type except History and cast members, below the type's own
fields and above the advanced fields. Collapsed, it reads in words, for example:

- *Perpetual · Fact*
- *Began at Year 12, Mo. 3, Day 4 · Living, fades slowly*

Open, it shows:
- **Beginning**: two choices, *Perpetual* and *Began at*, the second with the lorebook's date fields (reuse the
  date editor history entries use; the calendar's words when one is declared). Hidden when the Timeline is off.
- **Decay**: two choices, *Fact* and *Living*; *Living* shows the rate as a slider 0–1 with three marked stops
  in words (*slowly* 0.25, *steadily* 0.5, *quickly* 0.75; choosing *Living* starts at 0.25; a stored value
  between stops shows its number). One sentence of help each (STYLE-GUIDE: help is one sentence):
  *Beginning: the entry is not read before this date.* / *Decay: a living entry is recalled less as the story
  moves on without it.* 🚧 all copy.
- Until lane T7 nothing fades. Say so in the row while it is true, in the Decay help's place: *Decay: stored
  now; recall does not use it yet.* 🚧 (P1: never imply a behaviour that is not there.)
- It saves with the entry's own Save, like any other field; read-only where the form is read-only.
- Number input values are numbers (`bind:value` on a number input); no `crypto.randomUUID`,
  `navigator.clipboard`.

Showing a filter's cause (plan §5.6), only what this lane makes true: where the workspace reads at a moment and
an entry is left out because it begins later, nothing new is drawn in this lane (lane T8's *could exist here*
does that). Do not build it.

### D. Docs and names

`docs/lorebook-time.md` (a section on Beginning and Decay, plain words, one example), `docs/lorebooks.md` if the
entry form is described there; `NOMENCLATURE.md`: rows for **Beginning** and **Decay** with their charters (P6:
what each owns, what it does not, and who does: recall weighting is T7's; the Timeline switch owns hiding) and a
§25 ledger line for every new name. No retired word (§23). No other product's name in any file.

## Files owned

- `src/lib/server/db/schema.ts` (the one column), `drizzle/0162_*.sql`, `drizzle/meta/*` (generated)
- `src/lib/server/sockets/entries.ts`, `src/lib/server/sockets/amendments.ts` (the refusals and the clamp only)
- `src/lib/server/utils/lorebookEntries.ts`, `lorebookDuplicate.ts`, `lorebookExportBuilder.ts`,
  `lorebookExportMapper.ts`; the import insert in `src/lib/server/sockets/lorebooks.ts`
- `src/lib/server/lorebooks/timelessCopy.ts`
- `src/lib/server/state/entriesOnReading.ts`, `src/lib/server/state/reading.ts` — only if step A shows the rule
  does not hold, and only the smallest change
- `src/lib/shared/lorebooks/amendments.ts`, `src/lib/shared/sockets/types.ts`
- `src/lib/client/lorebooks/EntryWorkspace.svelte`, the entry form's field components, one new component for
  the row under `src/lib/client/lorebooks/time/`
- tests beside each; `docs/lorebook-time.md`, `docs/lorebooks.md`, `NOMENCLATURE.md`

## Out of scope (write down, never build)

Recall or ranking by Decay; the time delta in the prompt; SDK names of any kind (defaults on entry types,
outlets, queries: lane T5); bulk set (T8); the versions timeline and any change to **Save as of ‹date›**,
**Change the base** or the amendments list (T4); *could exist here*; cast members; knowledge marks; the
Chronicle; the Timeline card. `src/lib/server/pipelines/**` is another session's this hour: do not edit it. No
SDK edit, no `sdk:build`.

## Stop and ask when

CLAUDE.md §Decisions applies; step A's answer means history entries or session recall would read differently
for existing data; a second migration or a data pass seems needed; a name beyond those above is needed.

## Done means

- The migration is generated, index 0162, and a test shows a second boot changes nothing.
- Tests (targeted files only, each run as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t2-<name>.log 2>&1"`
  from the repo root, one run at a time; check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` first,
  another session also runs tests; never pipe vitest into `head`; an int test opening a DB inside an `it` takes
  a 60 s timeout): the clamp and refusals; an entry with a Beginning is absent before it and present from it,
  in the workspace reading and in a session's reading, on main and on a line; with the Timeline off it is
  present; a dated change before the Beginning is refused; duplicate, export → import round trip, timeless copy;
  the row (collapsed words, both editors, hidden Beginning with the Timeline off, read-only).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` has 0 errors. Do not run the full suite.
- Comments state the rule, not the story (a ratchet test counts phrases like "no longer", "used to").

## Report

Your final message is the report (the harness refuses a subagent's write to the report path; the lead saves it
as `plans/REPORT-time-t2-2026-11-14.md`): step A's answers with file:line; changed files; tests run with
results; every name, sentence and label added; open ★; **Noticed, not done**. Under about 900 words.

## Corrections after the cold review (2026-11-14) — these rule over the text above

1. **Only History can hold a date today.** "An entry's own date is among its fields" is true only for a type
   that declares `year`, `month`, `day`: `splitUpdate`'s `declaredFields` loop drops them on write
   (`src/lib/server/utils/lorebookEntries.ts` ~662–666, ~693) and `toEntryRow` on read (~278–280; export goes
   through it). The date checks sit behind one History gate (`sockets/entries.ts` ~1276–1279 `roles.order`; create
   ~1069). So section B's Beginning is:
   - let the date parts through create, `splitUpdate`, `toEntryRow` and the export mapper for **every** entry
     type (cast members excluded);
   - run the calendar landing check and `assertRedateKeepsLines` for any dated entry;
   - keep `assertHistoryDateFree` and `historyEntryOfDate` (`scenes/historyEntryOfDate.ts` ~279–330) for History
     only: a Beginning on a day a history entry holds is **accepted** (test it), and two entries may begin on
     one day;
   - the readers already cut any row whose fields hold a date (`entryOnReadingSql`,
     `state/entriesOnReading.ts` ~69–77; the workspace list `entries.ts` ~1609–1613; `historyDateColumns`,
     `lineSql.ts` ~104–114): verify with tests, change nothing there unless a test fails.
   Step A stays, as the check of all this.
2. **The Time lens will draw an entry with a Beginning** (`src/lib/client/lorebooks/time/storyTime.ts` ~84–85
   `isDated`, ~170–186 `storyItems`, `kind: "world"`). That is wanted: it begins there. Read the file, add a test
   that such an entry shows at its date, and report what the lens words it as; edit the file only if it mislabels
   the entry as history. Added to Files owned for that.
3. **The edit history must record both.** `redlineKeysOf` (`src/lib/server/lorebooks/redlines.ts` ~193–207)
   counts only content, keys, secondary keys, name and the type's declared fields. Add `lorebooks/redlines.ts`
   (`redlineKeysOf`, `entryWireValues`) to Files owned: a save that changes the rate or the Beginning is
   recorded, and **Restore** puts both back (test).
4. **No word of fading until something fades (P1).** The collapsed row shows the number: *Perpetual · Fact*,
   *Began at Year 12, Mo. 3, Day 4 · Living · 0.25*. The slider shows its number; no *slowly / steadily /
   quickly*, no "fades". Choosing *Living* starts at 0.25; *Fact* is 0. Help while nothing reads it: *Decay:
   stored now; recall does not use it yet.* 🚧
5. **Timeline off, on a forked line.** `readingOf` keeps the line's fork cuts with the Timeline off
   (`state/reading.ts` ~233–243) and `rowReadsOnLine` cuts a dated row at its step's fork even with no moment
   (`shared/lorebooks/lineReading.ts` ~365–376). **Lead's decision (★T2-1 for the owner): leave that as it is.**
   Lines are not part of the timeline ("Branches aren't part of the timeline", `docs/lorebook-time.md`), so an
   entry that began on the parent line after the fork still does not read on the fork, as every dated row does.
   Replace the Goal's "with the Timeline off the Beginning plays no part" by: **with the Timeline off no moment
   is read, so a Beginning hides nothing on the entry's own line; a line's fork cut applies as before.** Test
   both. Do not edit any reader for this.
6. **The switch-off prompt counts Beginnings.** `timelineCountsOf` (`src/lib/server/lorebooks/timeline.ts`
   ~187–218) gains the count of non-history entries with a date, and the Timeline card's prompt names it (*‹n›
   entr(y/ies) with a beginning* 🚧) with the other things it lists. `holdsSomethingDated` then counts them too
   (a lorebook with a Beginning holds something dated). `timeline.ts`, `time/TimelineCard.svelte` and their
   tests are added to Files owned for this only.
7. **Names (R1).** *Living* already names a Story preset and *Fact* sits near **model facts**. The labels are
   ruled and stay; the NOMENCLATURE rows record the collision and give the qualified forms (*a living entry*,
   *Decay: Living*, *Decay: Fact*). Code never has a bare `living` or `fact` identifier: the stored thing is the
   rate; living is `rate > 0`.
8. The lead added, before this lane, a key `timelineOffByPass` in `lorebooks.extra_json` and
   `withoutTimelinePassMark` in `timeline.ts`, used by `lorebookDuplicate.ts` and `sockets/lorebooks.ts`; leave
   them as they are.
