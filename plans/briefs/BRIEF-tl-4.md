# BRIEF — build lane `tl-4` — three ruled follow-ups to the undated default (owner rulings D53a, D53b, D55)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/REPORT-tl-3a-2026-11-16.md`, `plans/REPORT-tl-2e-2026-11-16.md`, rows D53 and D55 in
`plans/DISCUSS-LATER.md`, `docs/lorebook-time.md`, `docs/genre-story.md`, `NOMENCLATURE.md` §1, §24.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `npm test` / `npm run build`
at the SDK root; `sdk:build` only from the app root after checking no dev / preview server (`pgrep -af "vite"`;
the Svelte language server's esbuild does not count) and no vitest is up. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-4-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No migration. Inside `db.transaction`
only `tx`. No full run, no `npm run build`. Lanes `fnd-4` (failing tests under `pipelines/boot`,
`pipelines/runtime`, some `sockets/*.int.test.ts`) and `io-2` (the lorebook file's reader / writer) are
running: do not edit their files; re-read any file right before editing.

## Owner (2026-11-16)

D53(a): "Make both follow the new rule". D53(b): "Say 'story time when the lorebook keeps it'". D55: "Leave
them out while the timeline is off"; earlier, 2026-11-14: "No history entries for undated lorebooks, maybe
scenes only". Standing: existing sessions and lorebooks keep their switch ("Go with the safest option for
existing lorebooks"); comprehension and fidelity first.

## Build

1. **Two paths still give a new Story session's own notes a timeline** (the column default): the import of
   sessions (`src/lib/server/sockets/import.ts` ~1347, ~1498, which calls `insertOwnBook` itself) and the
   `ownBookFor` fallback (`src/lib/server/lorebooks/ownBook.ts` ~160–167). Both pass `timelineEnabled` from
   `timelineDefaultFor(genre, preset defaults)` (`lorebooks/timeline.ts`), exactly as
   `sockets/sessions.create.ts` does: one shared way to ask, not three copies (if `insertOwnBook` can take the
   genre / preset and decide, do it there; say what you chose). The fallback runs for a session that **already
   exists** and has lost its notes: it is a new lorebook, so the new default applies; it never changes an
   existing lorebook. A session whose genre requires a timeline still gets one. Tests for both paths, per
   shipped Story preset and one required genre; a second boot changes nothing.
2. **Story's description** (the genre's `about`, SDK core-catalog; grep "health, time, conditions"): "time"
   becomes "story time when the lorebook keeps it", fitted to the sentence. This is shipped copy in the SDK:
   edit there, `sdk:build`, `npm run sdk:test` (capped; four known failures), re-pin any registry hash with
   "(was …)", and the docs that quote it.
3. **History entries are left out of a prompt while the timeline is off.** Retrieval emits rows with source
   `history` whatever the timeline (`pipelines/runtime/host.read.lorebookEntries.ts` ~745–766). When the
   reading's lorebook keeps no timeline (`reading.timelineOff`, the same test lane `tl-2e` uses), history
   entries are not retrieved: not in any lore lane, not in `history-entries@1`, not in search / listing tools
   the model can call (find every read that can return a history entry to a run and list each: part → before →
   after). They return when the timeline is switched on; nothing is deleted. Receipts say it in the existing
   manner for a filter (one line, e.g. the count left out and why: sentence ★). A lorebook that keeps a
   timeline: byte-identical. The person's own lists and views are not this lane.
4. **Docs:** `docs/lorebook-time.md` (with the timeline off, history is hidden in lists **and** left out of
   prompts), `docs/context-templates.md` if it lists history, `docs/sessions.md` only if a sentence becomes
   false; `NOMENCLATURE.md` §25.

## Tests

Item 1 as above. Item 3: per read, timeline off → no history rows and the receipt line; timeline on →
unchanged; switching on brings them back; both prompt baselines (shas unchanged for the shipped worlds unless a
world plays with the timeline off and has history: then show the diff and that this is the only cause).
`tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`sockets/import.ts` (the two `insertOwnBook` calls), `lorebooks/ownBook.ts` (`ownBookFor`'s insert,
`insertOwnBook`'s timeline input), `pipelines/runtime/host.read.lorebookEntries.ts` and sibling reads that
return history, their tests, the SDK genre copy, the docs.

## Stop and ask when

CLAUDE.md §Decisions applies; a shipped pipeline relies on history entries on a timeline-off lorebook to work
at all (not just to be richer); the import cannot know the preset; a prompt baseline changes for another reason.

## Report

Final message = the report (lead saves `plans/REPORT-tl-4-<date>.md`): per item what changed; the table of
reads for item 3; tests changed (old → new); sentences (★); **Noticed, not done**. Under about 500 words.

## Added 2026-11-16 (from full run 13) — two more items, same owner rulings

5. **Dungeon Crawler counts its days from the crawl's own start.** Since a new dated session starts on today's
   real date, the Rest line prints "Day 739445, 08:00 → Day 739445, 16:00." (pinned as "Day 1, 08:00 → Day 1,
   16:00." in `src/lib/server/sockets/sessions.dungeonCrawlerRounds.int.test.ts`, failing; real sessions show
   it too). `clockLabel` (SDK `core-catalog/src/genres/dungeon-crawler/storyScripts.ts` 115–121, used by
   `rest.ts:160`) counts days from Year 1. Owner 2026-11-16: "the genre/session can set it's own fictional time
   if one isn't set/chosen. Or it's offered by the current point from a starter lorebook."; "There shouldn't be
   a scenario where it defaults to 1-1-1. The exception would be if the genre/presets session init pipeline
   changes the date." Build: the Dungeon Crawler's **create pipeline sets the crawl's own first day explicitly**
   when the session starts on its own new notes with no date chosen by the person (its fictional Year 1, day 1,
   08:00, as it played before; the SDK's `dungeon-crawler/create.ts` comment already says "Year 1, day 1": make
   the code say it too), so "Day 1" prints again and the pinned test passes **unchanged**. When the person
   picked a date on the start form, or the session starts on an existing lorebook / a starter lorebook with a
   present, that date stands and the label counts from the session's first day (find the cheapest stored anchor:
   the session's first clock; if none exists without a new stored fact, print the story date there instead and
   report it as ★). Walk the Lair the same way and report what its clock lines print now (fix only if the same
   defect shows). `docs/genre-dungeon-crawler.md` checked.
6. **Re-pin the next-chapter test** (D52(b) ruled 2026-11-16: "Keep, it defaults from the current, last active
   point, but offer a branch/date picker as well"): `sockets/sessions.creationModes.int.test.ts` "a following
   session is followed by a following one" now expects the following session to start today when the lorebook
   has no date anywhere (old → new in the report; the picker is another lane).

## Cold review corrections (2026-11-16) — these rule over the text above

1. **Item 1: the decision lives in `insertOwnBook`** (it reads the session's genre and preset and asks
   `timelineDefaultFor`), so all three callers that pass no timeline follow the rule: the import
   (`sockets/import.ts` ~1346 / ~1497), the `ownBookFor` fallback, and **the boot pass `ensureOwnBooks`**
   (`lorebooks/ownBook.ts` ~273–300). The import sets neither genre nor preset (the genre is the column default,
   Story; no preset): that gives "off", and it is **not** a stop. An explicit `timelineEnabled` passed by a
   caller (create) still wins. Test "per shipped Story preset" applies to the fallback only.
2. **Item 3, the reads, corrected:** `session-history@1` is the transcript, not history entries (leave it).
   History entries reach a run through: the lore lanes (`host.read.lorebookEntries.ts` ~745–766),
   `history-entries@1`, entity search and vector search (`bindings.retrieval.ts` ~760–765), and the tools
   `search_entries`, `get_entry`, `read_summary` through `entriesFor` (`tools/coreTools.ts` ~119–360;
   `read_summary`'s description and options still list "history": with the timeline off the option is absent
   or returns the existing timeline-off sentence; pick what the tool already does for an unavailable kind).
   No shipped pipeline breaks: new timeline-off sessions keep their memory as scene summaries through
   `earlier-scenes`.
3. **Item 3, one gap: report, do not build.** `earlier-scenes` skips a scene already compiled into a history
   entry (`scenes/earlierScenes.ts:59`). On a lorebook whose timeline was switched **off after** days were
   compiled, those days would leave both blocks. Do not change `earlier-scenes`; list the case in the report
   with the count of shipped paths that reach it (it is D60 for the owner).
4. **Item 5 replaced: no date is written by the Dungeon Crawler.** The only clock outlet names a time of day
   and never a date (`contracts/src/outlets.ts` 1505–1520), and new notes are on the real calendar, so "Year
   1" would print as the real year 1. Build instead: **`clockLabel` counts the crawl's days from the session's
   first day** (day 1 = the day the session's clock started on), so "Day 1, 08:00 → Day 1, 16:00." prints
   whatever the calendar date is, and the pinned test passes unchanged. Find the anchor in what is stored (the
   session's first clock stamp, the earliest message / scene stamp, or the create receipt): the cheapest that
   is stable across Back, a rest and a branch. If nothing stored can give it without a new stored fact, stop on
   this item and report the smallest fact needed (no migration in this lane). The Lair has no day labels: no
   change.
