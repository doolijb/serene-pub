# BRIEF — build lane `sense-b4` — Stage B, the flip: a pipeline's new entries, places, history days and links always go to the session's own book

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then, in full,
`plans/REPORT-sense-b3-2026-11-12.md` (the own-book route as built, its section "What `sense-b4` (the flip) still
has to change", and its review section), `plans/REPORT-sense-b2-2026-11-12.md` (Apply, automatic Apply, take-back),
`plans/REPORT-sense-b1-2026-11-11.md` (held amendments), `plans/REPORT-sense-scn-2026-11-12.md` (scenes now end by
themselves two rounds late, which is what makes this flip seamless); the design
`plans/DESIGN-own-book-write-path-2026-11-11.md` D2, D4, D7, D12 (this brief wins where they differ);
`plans/PLAN-sensible-engine-2026-11-11.md` §1.3, §5.8, §5.9; CLAUDE.md Hard rules, Principles, "0.6 is in users'
hands"; NOMENCLATURE §1, §23, §24, §25; `docs/lorebooks.md` (the write-setting section and the two "notes"
sections). `plans/briefs/BRIEF-sense-clk.md`'s **Verbatim rules** bind you and your workers.

Words: a **build lane** is this stream of work; a **channel** is a session's message channel.

## Rulings that bind (owner)

"Only Apply settles." "A turn owns what it wrote." A branch: "One cut at the fork message." Apply runs by itself
"At scene close, unless a summary waits". (b) fold. Seamless by default; more control by opting in. A person's own
press writes as the person. On an earlier draft of another lane: "You're over complicating it": take the plainer
shape and say so.

## Rulings added 2026-11-12, after the challenger round

- Sessions that never end a scene (owner): "We can not opt in to scenes for the genres where it doesn't make sense
  for now". Lead's reading, said to the owner: **a session takes part in the flip only when its scenes are handled
  by a running scenes routine; every other session keeps today's behaviour for now** (Chat's notes, a plugin genre
  with no scenes routine, a session whose routine is Off or whose scene mode is not Automatic still write straight
  to the lorebook under Full).
- Branches (owner): "Yes" — a branch's changes still reach **its own line** by themselves as scenes end — "but we
  need to work on ensuring it doesn't make duplicates, but faithfully updating entries or creating children that
  expand on a particular aspect would be better". The first half is built here; the second (how pipelines choose
  to update, or to add a child, instead of duplicating) is a later build lane and is **not** built here.
- A cold review raised four objections; all are folded in below.

## The rule to build, in three sentences

For a session that reads an attached lorebook **and whose scenes end by themselves** (`scenesRoutineOn` from
`sense-scn`, and the session's scene mode is Automatic), a **pipeline's** write of a new entry, a place, a history
day or a link goes to the session's own book **whatever the lorebook's write setting**, exactly as it already does
under Review, Off and on someone else's lorebook (`sense-b3` made that route whole). It reaches the lorebook only
by Apply, which runs by itself as scenes end when the lorebook is yours and its write setting is Full. Every other
session, and everything else about the write setting, is unchanged in this build lane.

## Build

Begin by re-reading every cited line and listing, in your first worker brief, every caller of
`sessionLoreWriteTo`, `loreWriteTargetFor`, `forkedLoreLine`, `pendingLineFork` and `ensureSessionLine`, and for
each whether it is one of this lane's four kinds of write.

1. **One route for these four kinds, where scenes end by themselves.** `sessionLoreWriteTo`
   (`pipelines/runtime/host.ts` ~1616) returns the own-book target with `alsoReads` for a session that reads an
   attached lorebook and meets the rule above, for `create-lore-entry` (~11493), `update-lore-entry` (~11779,
   ~11815; an attached-book entry is already held), `link-lore-entries` (~11981) and history days
   (`fileOntoHistoryDay`). Decide "meets the rule" **once per write**, in one function, and say in the report
   exactly what it reads. The `book` branch stays for sessions that do not meet it, and for the lorebook annex
   (`writeLorebookAnnexDocument` ~2817, which only reads `.lorebookId`: give it its own small function, not a flag
   on the shared one). For a session that meets the rule the `{ notes: true }` distinction goes (★b3-1): a
   filing-tool write gets the same two-book reading and dating.
   **Ruleset ties follow the row** (`rulesets/ties.ts` `routingOf` ~240–262, `rowForSide` ~428–439, the place and
   item fields ~880–902, ~1084–1107): today under Full a tie or a rules field for a room the run just made would be
   skipped ("this session does not write the lorebook the place is in") or written into the lorebook with one end
   in the own book, and would fork a branch's line early. An entry that lives in the session's own book is an
   own-book landing for its ties and rules fields. Change only that; test it under Full: a Rule Based run's new
   room gets its rules field and an Exits tie, both in the own book.
2. **History days stop writing through.** The `writeThrough: true` escape (~2306, ★B1-9) is removed: under Full a
   history write files onto the own book's day, one per date, and is merged at Apply as `sense-b3` built.
3. **No line is forked by these writes.** `forkedLoreLine` (~1657) and `pendingLineFork` (~1679) leave this path.
   **An Apply forks instead:** `applyOverlayItems` (`lorebooks/ownBook.ts` ~1835) reads the line outside its
   transaction today (~1897); for a session with `line_on_first_write` set it calls `ensureSessionLine` **inside
   its transaction and then reads the line again**, so what it applies (pressed or automatic) lands on the
   session's own line as a direct write did, never on its parent's. **Automatic Apply runs for a branch session
   too** (remove the `branchOfSessionId == null` condition at ~2791 and ~2913; the other conditions stay): the
   owner ruled a branch's changes still reach its own line by themselves. Tests: a branch's automatic Apply lands
   on its own line and nothing reaches the original's line; cast versions or values that fork the line first
   leave the entries applying onto that same line. `ensureSessionLine` keeps its other callers (cast versions,
   values, a person's press, scenes).
4. **The `sources` settle goes for these kinds.** `recordLoreSources` stays (provenance); the `settleThrough`
   beside it at `create-lore-entry` (~11544), `update-lore-entry` (~11734) and `link-lore-entries` (~11878) is
   removed: the write is the session's until Apply, and Apply settles. Every other settle trigger stays (a
   person's Summarize Save at `sockets/entries.ts` ~941, a scene's summary saved, `settleOnWrite`).
5. **Dating and sentences.** `ownBookDaysCounted` dates every write on this path; Full's "Both ends of a link live
   in one book." goes for the session's two books (the third-book refusal stays). `update-lore-entry` resolves its
   entry own-book-first like the rest of the route (b3 noted it was lorebook-first).
   **Accepted, pinned by one test and reported as a ★:** while a new history day waits in the own book, stat
   values, timeline captures and cast versions written meanwhile are still dated by the lorebook's latest day
   (`writeDatingAt` and `sessionStoryNowOf` are not this lane's; `state/write.ts` ~424–462, `state/durable.ts` ~241,
   `characters/versions.ts` ~1916), and a moved day does not re-date them.
6. **What a person sees under Full.** The "This session only" card now shows new entries, places, days and links
   while they wait, with the existing sentence that this lorebook takes them by itself as scenes close. The
   lorebook's own pages show them after the Apply. Check, and fix only if broken: a place written this turn is
   usable at once by the same session (places list, the map, the Lair's and the Dungeon Crawler's room flows,
   retrieval, keyword match, the names list); a place's stat values written by the same run find the place.
7. **Tests that pin write-through are rewritten to the new rule, never weakened**: `host.historyWrites`,
   `host.forkTiming` (the first write no longer forks; an Apply does), `host.ownBookRoute` (the Full sentence),
   `sessions.lairWalk`, `sessions.lairKnock`, `sessions.lairFileRoom`, `messages/loreLinks`,
   `state/sessionLoreWrites`, `lorebooks/imprints.int` (keep the kept/revert rule tested through a direct writer),
   `state/durable`, `state/locations`, `state/ownNotesLine`, and any other the compiler or a run shows. New tests:
   under Full on your own lorebook, a run's room, link and history day sit in the own book, are read by the
   session and by nobody else, are taken by a swipe and Back, and are in the lorebook after the scene ends; a
   member's session holds them and never applies by itself; a branch applies onto its own line; a Chat session, a
   session whose scenes routine is Off and one whose scene mode is Suggested or Manual still write straight to the
   lorebook exactly as before (pin each).
8. **Docs and ledgers in the same change:** `docs/lorebooks.md` (~203 "sessions write to the lorebook as they
   play", ~209, ~213, ~220, ~224), `docs/lorebook-time.md` (~176–180: a session's line is made by its first Apply,
   not its first write), `docs/session-actions.md`, `../serene-pub-sdk/guides/storage.md` (~49–66, ~82–88),
   `INTEGRATING.md` ~1411, the JSDoc in `../serene-pub-sdk/contracts/src/outlets.ts` (~1840, ~1905, ~2031),
   NOMENCLATURE rows and §25.

## Files owned

`src/lib/server/pipelines/runtime/host.ts` (the lore write path only; **no other build lane touches this file**),
`src/lib/server/lorebooks/ownBook.ts` (the route's readers for these kinds, Apply's line fork, the branch
condition), `src/lib/server/rulesets/ties.ts` (item 1's one change),
`src/lib/server/lorebooks/sessionLine.ts` (only if Apply's fork needs it), the tests named in item 7 and new ones,
the docs above. SDK: `guides/storage.md`, `INTEGRATING.md`, `contracts/src/outlets.ts` (JSDoc only).

## Out of scope

The write mode, its columns, its readers and its UI; cast members and versions; ruleset ties beyond item 1's one
change; how a pipeline chooses to update an entry or add a child instead of duplicating (a later build lane);
sessions that do not meet the rule (Chat's notes and `docs/genres.md` stay as they are); stat values, `recordToTimeline` and `state/write.ts`; scenes and summaries
(`sockets/scenes.ts`, `scenes/`); a person's own press in the session (`sockets/entries.ts`); the lorebook annex's
routing; retiring `loreWriteRoute` / `loreWriteTargetFor` / `ensureSessionLine` as names (other callers remain);
automatic Apply's conditions; any migration, setting or new settle trigger.

## Stop and ask when

A migration is needed; a published SDK name, port or result **shape** would change (a result's `route` and
`lorebookId` **values** now always name the own book for these kinds: say so in the report, and stop only if a
shipped core document reads them: grep `../serene-pub-sdk/core-catalog/src`); a shipped genre's flow breaks
because a row it just wrote is not where it looks, or a tie or rules field for an own-book row cannot follow it
with item 1's one change (report the flow and the smallest fix; do not reroute values or cast in this lane); the Lair's or the Dungeon Crawler's room, map or "file the current room" flows cannot be made
to work with rooms in the own book; existing stored data would need a pass.

## Done means

Item 7's tests and the new ones pass; the suites `sense-b1`…`sense-b3` added pass unchanged
(`heldApply`, `applyTakeBack`, `autoApply`, `applyOwnBookLinksDays`, `heldAmendments.*`, `host.heldEntryChange`,
`host.ownBookRoute` except its Full sentence, `ownBookRoute.undo`, `branch.*`); the Lair and Dungeon Crawler socket
suites pass; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean. Tests run only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 …"`.
**Do not run `npm run sdk:build`** (another build lane may be building the SDK; this lane's SDK edits are docs and
JSDoc): say in the report that the next SDK build carries the JSDoc.

## Report

**Return the full report as your final message**, after every worker has finished (the lead saves it as
`plans/REPORT-sense-b4-2026-11-12.md`): the rule as built in sentences a modder could read; every caller found and
what it does now; what still routes to the lorebook and why; the tests rewritten and what each now proves;
provisional copy verbatim; changed files in each repo; tests and results; open ★; **Noticed, not done**.
