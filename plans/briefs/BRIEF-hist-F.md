# BRIEF — hist-F: docs and vocabulary for the history build

Plan: `plans/PLAN-history-one-per-date-2026-11-10.md`. Read all of it, especially every rulings section and § Build scope. Then read every lane report: `plans/REPORT-hist-{A,B1,B2,B3,C,D1,E,G}-2026-11-10.md`, and `plans/REPORT-hist-D2-2026-11-10.md` if it exists when you get to Dungeon Crawler; D2 runs alongside you, so read its brief `plans/briefs/BRIEF-hist-D2.md` for the two boot passes. Each report has a "Names for hist-F", "Copy for hist-F" or "Names/copy" section; those are your work list. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, and delegate to at most 2 `lane-worker` agents (suggested: w1 = `docs/`; w2 = `NOMENCLATURE.md` plus `STYLE-GUIDE.md` if needed). **No code changes.** Where a report and the code disagree, describe the code and flag it.

## What is true now (describe exactly this)

- **One history entry per date, per line**, as each line reads it.
  - Partial dates are distinct (*Year 2* ≠ *Year 2, Month 5*). Undated entries are ignored.
  - On a doubled date, the oldest entry (lowest id) is the day's entry.
- **Forks (rule C).** A line owns a history entry only for dates strictly after its fork date; on or before it, the day is the parent's, and a fork changes that day through amendments. A dateless fork owns no dated history.
- **Refusals.** A person's create, or re-date onto a taken date, is refused with the exact sentences in hist-A's and hist-G's reports.
- **Reuse.** The "day entry" paths reuse the day's entry instead of making a second one: compile, Add the next date, the summarize modal's New, a session write, and the Time-lens drop (which opens the existing entry).
- **Loose ends.** Two new chores: **Two history entries on one date** and **A line's own history before its fork**.
- **Pipelines.**
  - A history write files onto the day's entry, appending a paragraph that a retake undoes.
  - With no date, it uses the session's story day.
  - It's refused on a branch session's fork day.
  - A month or day without a year is refused.
  - `write_entry` refuses history.
- **Scenes first** (owner direction): pipelines put events into scenes. `note-scene@1` adds a note to a scene; notes reach the scene summary and Compile, and a retake undoes them. Compile always merges through the model, even for one scene. Compile stays a person's press. The packager warns on direct history writes (`W_WRITES_HISTORY`), and conformance law C40 checks the shipped catalogue.
- **Sessions and lines.**
  - A branch session's line forks at its first write and carries its uncompiled scenes.
  - A session's first `entries:create` forks inside the write, so a refused write forks nothing.
  - Compiling forks a branch session still riding the compiled line.
  - Next chapter starts at the followed session's own clock.
  - Starting a scene isn't a lorebook write.
- **Cast.**
  - A member whose cast version in force is deceased reads as background for lore. The narrator reads it; a player seat still shares it. This is due to change with the benched-seats plan; describe it as it is now.
  - `update-cast-member@1` accepts `nodeState` and `nodeVisibility`.
- **Dungeon Crawler.**
  - It writes no history. A death marks the fallen's cast member **deceased**, the narrator names the death, and the death reaches the day's history through scenes and Compile.
  - "The fallen" is a lasting list. Scenes are on, with a "New scene?" chip only when a day is crossed.
  - It uses the session story clock instead of its old crawl clock.
  - Old cairns become character lore on the fallen hero's cast member (`dc-cairns`), and old crawl clocks move into the session clock (`dc-crawl-clock`).

## Work

1. **App docs:**
   - `docs/lorebook-time.md` (§ History entries and scenes, the story clock, Branches);
   - `docs/summarization.md`;
   - `docs/sessions.md` (branch off, next chapter, compiling, first write);
   - `docs/lorebooks.md` (Loose ends chores);
   - `docs/genre-dungeon-crawler.md` (the ~18, ~254 cairn promises → deceased, scenes and compile; the clock);
   - `docs/lorebook-cast.md` (deceased reads as background);
   - `docs/pipelines.md` (history writes, note-scene);
   - any page `grep -rn "history entr" docs/` shows describing behaviour that changed.

   Say each rule once, in the house voice (STYLE-GUIDE §6.9, §10). Then run `npm run docs:build`.
2. **NOMENCLATURE.md:** read §1, §24, §25's row shape and §23. Add rows (🚧, 2026-11-10) for every new name the reports list. Put them in their groups (§8 Content for history, scenes and the chores; §9 Session; §4 Pipeline for ports and C40; §10 or the widget area for the SDK bits). Each row has a short charter where it's a concept (purpose / why / owns / not).
   - **Retired** (§23): the cairn as a history entry; the `loreFallen` junction; `DUNGEON_CRAWLER_ENTRY_TYPES.fallen`; the `crawl-time` host-state time declaration (the slot stays registered, retired from writes).
   - **Fix:** the stale `current-date@1` meaning, if NOMENCLATURE has one.
   - **One §25 ledger block:** *history: one entry per date, scenes first — 2026-11-10 (owner GO; PLAN-history-one-per-date-2026-11-10, lanes hist-A…G, D1/D1b/D2, B2/B3)*.
3. **STYLE-GUIDE.md:** only if a pattern changed (probably none). Report "no change" otherwise.

## Coordination

The variable-layouts session (`serene-pub-83`) edits NOMENCLATURE.md and STYLE-GUIDE.md **after** this lane reports. Finish your NOMENCLATURE edits in one pass. The lead tells that session when you've reported.

## Files owned

`docs/*.md` (the pages above and any the grep finds), `src/lib/generated/docs/**` (only through `npm run docs:build`), `NOMENCLATURE.md`, `STYLE-GUIDE.md`.

## Out of scope (write down, never build)

Any code (`src/`, the SDK, tests); plan and report files; benched seats (a later plan).

## Stop and ask when

A report and the code disagree; a name needs choosing; there's an R1 collision in NOMENCLATURE.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write` on a file.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob.
- Read NOMENCLATURE.md and STYLE-GUIDE.md by section (`grep -n "^## \|^### "` then `sed -n`), never whole.
- Scratch files start with `hist-F-`.

## Done means

- `npm run docs:build` succeeds.
- The docs tests pass (`docsIndex`, `docsHref`, `helpLinks`, `docsJump`, `docsPlaygroundProtocol`, `envDocsDrift`, `docsContextTemplate`; run them in a capped scope: `systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 --quiet bash -c 'npx vitest run <files>; echo test-exit=$?'`).
- Every listed name has a row.

## Report

`plans/REPORT-hist-F-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include pages changed, rows added, tests, **Noticed, not done**.
