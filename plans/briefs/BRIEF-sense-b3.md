# BRIEF — lane `sense-b3` — Stage B: a session's own book is a whole place to write (entries, places, history days, links)

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `plans/REPORT-sense-b1-2026-11-11.md`
and `plans/REPORT-sense-b2-2026-11-12.md` in full (both with their review sections); the design
`plans/DESIGN-own-book-write-path-2026-11-11.md` D2, D4, D12 and Challenger C1 (this brief wins where they differ);
`plans/PLAN-sensible-engine-2026-11-11.md` §1.3, §5.8, §5.9; CLAUDE.md Hard rules, Principles, "0.6 is in users'
hands"; NOMENCLATURE §1, §23, §24, §25; `docs/lorebooks.md` "Your session's own notes" and "Bringing a session's
changes into the lorebook". `plans/briefs/BRIEF-sense-clk.md`'s **Verbatim rules** bind you and your workers.

## Why, and what this lane is not

Today a pipeline's new entries, places, history-day writes and links go straight into the attached lorebook under
the Full write setting, and into the session's own book under Review, Off, or a lorebook someone else owns. The
next lane (`sense-b4`) makes the own book the only place for all of them. **This lane does not flip that.** It
makes the own-book route as good as the lorebook route first, because today it is not: on that route the match
misses the lorebook's entries and makes duplicates, a link cannot join an own-book entry to a lorebook entry, the
names list leaves own-book entries out, history days pile up beside the lorebook's, and a branch loses the links.
Those are faults for Review, Off and shared-lorebook sessions **today**; fixing them is this lane's whole value.
The owner's priority: what the model is told must be complete and faithful.

**The route (`loreWriteRoute`, `loreWriteTargetFor`, `sessionLoreWriteTo`) and what Full does are not changed
here.** Every test of this lane runs on the own-book route (a lorebook under Review, and a member's session on
someone else's lorebook), and every existing Full test must pass unchanged.

## Challenger round (2026-11-12)

A cold review raised five objections; all are accepted and folded into the items below (history days are never a
held change; `writeDatingAt` / `sessionStoryNowOf` untouched; ruleset tie rows excluded; three by-entry link
readers fixed; match is own book first).

## Rulings that bind

"A turn owns what it wrote." "Only Apply settles." (b) fold. A session never writes another session's rows. Genres
expect, never lock. A session, never a chat; every session has a lorebook.

## Build — on the own-book route, for a session that reads an attached lorebook

Begin by re-reading every cited line (they drift) and listing, in your first worker brief, every one-book
assumption you find on this path; the list below is a floor.

1. **Match over what the session reads, own book first.** `create-lore-entry`'s match (`pipelines/runtime/host.ts`
   ~11386, `loreMatch.ts` `findLoreMatch`) looks in the own book only, so an entry the lorebook already holds is
   created again in the own book. Rule: look in the **own book first** (as today, so a session that already holds
   its own copy keeps changing that copy; users' data has such pairs); only when the own book has no hit, look in
   the lorebook's entries as the session reads them, where a hit is a held change (built, `holdLoreEntryChange`).
   "Two or more hits" refuses within one book, never across the two. `bind` (`resolveBind`) accepts a member of the
   lorebook's cast as well as the own book's. A place's *Exits* (`exitsLineLinks` ~1892) resolve over both, own
   book first.
2. **A link may join the two books.** `resolveLoreLinkEnd` (~1409) and `link-lore-entries` (~11793) resolve each
   end over what the session reads. The link row is stored in the own book; its ends may be own-book entries or
   the lorebook's (the ruleset ties already store such rows: `rulesets/ties.ts` `rowForSide` ~343–464; follow that
   shape). `linksOnReadingThatWay` (`utils/relationshipGuards.ts` ~337) finds a standing link in either book, so a
   link the lorebook already holds is not written twice. The refusal "Both ends of a link live in one book" goes
   for these two books and stays for any other. The published outlet descriptions that say so are corrected.
   **Ruleset tie rows are not this lane's links:** a `narrative_relationships` row with `rules_run_id IS NOT NULL`
   (the ties' own copies of a lorebook row, `rulesets/ties.ts` ~405–460) is never counted as a standing own-book
   link here, never listed and never applied (item 7); one test with a tie copy present.
   **A session's private link must not act on anyone else.** Three readers find links by entry id with no book
   check; lane b1 excluded held amendments from the same places for this reason. Fix each, with a two-session
   test: `lorebooks/imprints.ts` `holds` ~218–224 (another session's own-book link must not turn a run's undo
   into "kept"); `utils/forkHistory.ts` ~209–216 and ~465–469 (an own-book link is not "main uses this entry");
   `lorebooks/ownBook.ts` ~1887–1896 (take-back still refuses when another session's own-book link names the
   entry, because taking the entry back would delete that link, but with a sentence that is true for it).
3. **History days: always the own book's, merged at Apply.** On this route a history write files onto **the own
   book's entry for that day, one per date there**, whether or not the lorebook has that date (as today, minus any
   second own-book entry for one date). It is never a held change to the lorebook's day: a held change replaces a
   whole field against a `base`, so two sessions appending to one day, or a compile of that day, would conflict for
   good. Dates are checked against the lorebook's calendar. "Does the lorebook hold this day" is asked through
   **one function** (the ruled, unbuilt "coarser covers finer" will change it). Sessions writing history at all is
   a later lane's question (owner: "Sessions own scene compilation. Books own history entry compilation"); do not
   widen or remove the write here.
4. **The session reads its own book everywhere it reads the lorebook.** The names vocabulary
   (`annotations/index.ts` `loadVocabulary` ~430–462) includes the own book's entries when a holder is given (the
   three `host.ts` sites already pass it, and a holder is set under Full too: say in the report what Full now reads
   and add one Full test); the dating of this path's own writes and the prompt's current date count own-book
   history days through **a helper called only from `host.ts`** (`loreWriteLineOf` ~1555, `fileOntoHistoryDay`,
   the prompt's `currentDate`). **`writeDatingAt` and `sessionStoryNowOf` are not changed**: stat values,
   `recordToTimeline`, cast versions and place stats date their rows through them
   (`state/write.ts` ~460, `state/durable.ts` ~241, `characters/versions.ts` ~1194, `state/placeStats.ts` ~233) and
   would start storing lorebook rows dated by an own-book entry. The graph's entry links
   (`utils/graphEntryLinks.ts` ~85–214) keep an own-book link whose end is a lorebook entry on the session's line
   and name ends as the session reads them (amendments, held ones included). One test per reader: the session sees
   it; another session of the same lorebook and the lorebook's own reading do not.
5. **A turn owns them.** Swipe, regenerate, Back and delete take an own-book entry, history day, paragraph and
   link written by the turn, cross-book links included; Forward and a failed re-tell restore them. A run started
   by a person's press with no turn message: say what happens today for each kind and make links behave as
   entries do (report the rule; do not invent a second one).
6. **A branch is the session as of the fork.** `copyOwnBookToBranch` (`lorebooks/ownBook.ts` ~677–860) copies the
   own book's links (and their ends' remap) for a session with an attached lorebook too, cut at the fork message.
   A link has no message column: its cut point is its made-row imprint's `message_id`
   (`copyNotesStatsAndLinks` ~978 skips links with no own-book end today). A copied own-book entry keeps
   `anchorBindingId` when the member is the attached lorebook's (today it is always nulled, ~771).
7. **Listed and applied.** `overlayItemsOf` lists links whose ends are both outside the own book (a link between
   two lorebook entries, or between a lorebook entry and a lorebook member) as items of their own, and a held
   history paragraph as the entry change it is. `applyOverlayItems`: such a link moves to the lorebook on the
   session's line; an own-book day entry whose date the lorebook holds is **merged onto the lorebook's day** (a
   paragraph after what it holds), never a second entry for one date, and **before the own-book day is deleted
   every `history_entry_id` that names it is pointed at the lorebook's day** (scenes cascade on it; links,
   amendments and values would lose their dating: `db/schema.ts` ~4788, ~5146, ~9327, ~10509); a link with a
   member end moves when that member is the lorebook's. Every applied item files an `origin: 'apply'` record (built) and take-back handles
   the new kinds or refuses in a sentence (a merged day refuses unless the paragraph is still the day's last).
8. **Docs and ledgers in the same change:** `docs/lorebooks.md` (the two sections above), `docs/session-actions.md`
   ~136 (what a branch copies), `../serene-pub-sdk/guides/storage.md` ~49–66, the JSDoc in
   `../serene-pub-sdk/contracts/src/outlets.ts` ~1840, ~1905, ~2031 and `host.ts` ~1404, NOMENCLATURE rows and §25.

## Files owned

`pipelines/runtime/host.ts` (the create, link, history and match paths and `resolveLoreLinkEnd`, `exitsLineLinks`,
`writeLoreLink`; **no other lane touches this file**), `pipelines/runtime/loreMatch.ts`,
`utils/relationshipGuards.ts`, `scenes/historyEntryOfDate.ts`, `annotations/index.ts`, `utils/graphEntryLinks.ts`,
`utils/forkHistory.ts` and `lorebooks/imprints.ts` (the by-entry link readers of item 2 only; the retraction rule
must not change), `lorebooks/ownBook.ts` (list, Apply, take-back, branch copy), `state/write.ts` (only if item 5
needs it; the review expects it does not: say why in the report). **Not** `state/storyTime.ts` or
`state/reading.ts`.
`sockets/sessions.ts` and `src/lib/shared/sockets/types.ts` (the list payload's new item kind, additive),
`SessionViewPanel.svelte` (the new item kind, existing layout), tests beside each, the docs above. SDK:
`contracts/src/outlets.ts` JSDoc only; `guides/storage.md`.

## Out of scope

The route and what Full does; `loreWriteRoute`, `loreWriteTargetFor`, `sessionLoreWriteTo`'s rule, the lorebook
annex's router; the write mode; session lines (`ensureSessionLine`, `line_on_first_write`, `forkRidingSessions`);
cast members and versions; stat values and `recordToTimeline`; scenes; ruleset ties (`rulesets/ties.ts`) beyond
reading its shape; a person's own press in the session (`sockets/entries.ts` `entries:create`, Summarize's Save);
a change to an existing lorebook **link** (link overlay rows); any migration; any new setting; any settle trigger.

## Stop and ask when

Anything needs a migration or a schema change (the design's `narrative_relationships.overlay_of` /
`source_message_id` are **not** assumed: if a cross-book link cannot be owned by its turn without one, stop and
report the options); a published SDK name, port or result shape would change other than additively (JSDoc may
change); an existing Full-route test would have to change; the own book's calendar can differ from the lorebook's
in a way item 3 cannot settle; a reader cannot get the holder without a signature change that ripples past the
owned files.

## Done means

Tests for every numbered item on both own-book situations (your own lorebook under Review; a member's session on
someone else's lorebook), including: a re-created lorebook entry is a held change, not a duplicate; a link between
an own-book room and a lorebook room, taken back with its turn, restored by Forward, copied to a branch cut after
it and absent from one cut before; a link the lorebook already holds is not written again; two history writes for
one date make one own-book day; a history write for a date the lorebook holds is a held paragraph; Apply merges a
day and moves a link; take-back for each or its refusal sentence; each reader of item 4. **Every existing test on
the Full route passes unchanged.** `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean;
`NODE_OPTIONS=--max-old-space-size=12288 npm run check` shows no new error in files you touched. Tests run only
inside `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run
--maxWorkers=3 …"`. If SDK code changed (JSDoc only is expected): `pgrep -af "vite dev"` and
`pgrep -af "vitest|tsx --test"` show nothing else live, then one `npm run sdk:build`; report pins, **do not
re-pin**.

## Report

**Return the full report as your final message**, after every worker has finished (the lead saves it as
`plans/REPORT-sense-b3-2026-11-12.md`): the one-book assumptions found and what each does now; the rules as built,
in sentences a modder could read; what `sense-b4` (the flip) will still have to change and which Full tests pin
write-through; provisional copy verbatim; changed files in each repo; tests and results; pins; open ★;
provisional names; **Noticed, not done**.
