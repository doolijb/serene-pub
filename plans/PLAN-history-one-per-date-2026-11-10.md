# PLAN — One history entry per date, and history used only for dated events — 2026-11-10

Status: **GO 2026-11-10** ("Review, then build"). Build from **§ Build scope** below; the research sections after it are the evidence. Not challenged yet.

## Owner ask (2026-11-10)

"make sure that only 1 history entry per date can be created, and make sure we aren't abusing history entries in our genres"

Binding: P1 (deterministic, never hidden), P2 (one module owns every write), and "0.6 is in users' hands" (stored-data changes ship with a pass and a second-boot test). The docs already describe *the* history entry of a day (`docs/lorebook-time.md:9-25`: compile files a day's scenes under that day's entry).

## Owner rulings (2026-11-10)

- **★H1: reuse.** "Reuse the existing (Recommended)": the day-entry paths find the existing entry, and a person's direct create or re-date onto a taken date is refused.
- **★H3: report in Loose ends.** "Report in Loose ends (Recommended)".
- **★H2: open, needs a design.** Owner: "Only at/after the forked point. But we need to reconcile what to do when a mid-session fork wants to create missing entries prior to the fork. Changing what happened prior to the fork how-ever should probably shift at what point the fork happened. Perhaps we should automatically place the fork point at the start of the session?"
- **★H4: open, needs a design.** Owner: "A public cast lore? Should also likely be reflected in scenes and history prose". A fallen hero becomes the cast member's public lore, not history, and the death should reach scenes and the day's history prose through the normal capture → compile path.

- **Direction: scenes first** (2026-11-10, verbatim): "We want to make sure we are encouraging pipelines/modders to be targeting scenes first for granular history updates, then history entries second, optimally compiling from scenes to history entries." The SDK's surfaces, docs and checks teach scenes → compile → history. A direct history write is the second choice, and it lands on the day's one entry (★H1).

- **Owner, 2026-11-10 (verbatim):** "There should already be a status we can add to the cast directly however. Perhaps we can also optionally allow the SDK to query dates on changes so a custom genre/pipeline can compile that into a context template." For ★H4 this means the fallen hero's dated cast state (cast amendment) is the first record. There is also a possible optional SDK read of dated changes, opted into by a genre (P1), for context templates.

### Rulings, second round (2026-11-10)
- **★H2: rule C accepted.** "Accept the rule (Recommended)". The ancestor owns days up to and including the fork point, and the fork amends them. An empty parent entry may be made. The first-write fork carries the session's uncompiled scenes. Nothing moves.
- **★S4: `note-scene@1` now.** "Add note-scene now (Recommended)".
- **DC clock, direction:** "Should probably leverage the book clock since that's available." DC uses the book's story clock instead of its separate `crawl-time`.
- **Open, research first:** "Maybe we should get rid of session only clocks all together since books can branch and every session has a book now?"
- **★S5, dated changes:** "No, we don't need to scaffold it all. Just make it possible via querying, don't need to plug it into the shipped handler. Can add a foruma into the docs for reference as an advanced technique." Lead's reading, to confirm: no aggregate `story-changes@1` and nothing wired into shipped genres. The missing dated data (entry and cast amendments with their dates, cast state) becomes reachable through queries, and the docs get a recipe as an advanced technique.

### Rulings, third round (2026-11-10)
- **★C3:** keep session clocks for now. "Keep them for now (Recommended)". The blockers stay parked in § Clocks.
- **★C2:** next chapter carries the clock. "Carry the clock (Recommended)".
- **GO:** "Review, then build (Recommended)".
- **★S5:** "Docs recipe only".
- **★C1:** DC uses the session story clock. "Session story clock (Recommended)".
- **★H4 Q3 (old cairns' text):** the owner asked "Does this exist prior to the last pre release version?" Answer: yes. The cairn history write is in the SDK commit of 2026-10-25 (`c632f43`, alongside 0.6.0-pr-6) and so ships in pr-6 and pr-7 (2026-10-31). A data pass is needed.
- **★H4 Q3 ruled:** "Cast/character lore, ad a visibility setting I.e. private, public/known, legendary. Worth taking another look into lore affinity/exposure after all these sprints so cast members can build a knowledge base over time with exposure". The `dc-cairns` pass retypes each epitaph to **character lore bound to the matched cast member**, falling back to world lore when no member matches. **Lore visibility levels and lore affinity/exposure are a separate design, researched read-only, and not part of this build.**

### Rulings, fourth round (2026-11-10, after lanes A, B1, E)
- **Fork day:** "Keep it — scenes first (Recommended)". A branch session's direct history writes with content on its fork day stay refused. Compile handles that day by amendment.
- **Default date:** "The session's story 'now' (Recommended)". A pipeline history write with no date files onto the session's story-now day, creating that day's entry if needed (replaces `writeDatingAt` in hist-B1's `fileOntoHistoryDay`).
- **Stray scenes (★E-2):** "Compiling forks the session first". Compiling a scene whose session still rides its parent's line (`line_on_first_write` set) first forks that session's line (`ensureSessionLine`, carrying its uncompiled scenes), so the scene compiles onto its own line.
- **Deceased lore:** "Yes, but we should add a seat section for benched cast members who were in the session but are no longer active. We can probably use this to replace the off toggle on seats". A member whose cast version in force is `deceased` reads as background for lore (the narrator reads it). **The benched seat section is a new design, researched read-only first, and not part of this build.**

### Rulings, fifth round (2026-11-10)
- **Note label on a one-scene day:** "Always merge via the model". Compile sends even a single-scene day through the model's merge (no passthrough), so scene notes are rewritten into prose. A lead decision replaces S2: no recompile marker (hist-B2 ★B2-2).

### Challenge answers (plan-challenger, 2026-11-10)
1. **Bulk writers merging or skipping on their own reshapes data against ★H3.** Accept: rows land unchanged and the chore surfaces doubled dates.
2. **The old-cairn default (world lore) contradicts "public cast lore".** Asked again of the owner.
3. **"Cast amendments" are frozen.** Accept: moot after ★S5 (no new reads).
4. **★S5's reading and the DC clock's noun.** Ruled by the owner (above).
5. **Lane order.** Accept: the order is fixed, the law moves into D, and B then E run one after the other.
6. **S1 append** must use the imprinted `changeLoreEntry` path (host.ts:1992-2000), so a retake takes the paragraph back. Accept: noted for the hist-B brief.

## Build scope (consolidated)

Lead defaults are marked **(default)**. They are the research's recommendations, not yet ruled one by one, and are listed for the owner's confirmation in the build report.

**1. One owner of history dates (core).**
- New module `src/lib/server/lorebooks/historyDates.ts` (from `scenes/historyEntryOfDate.ts`).
- `assertHistoryDateFree(tx, {lorebookId, branchId, date, exceptId?})`: one entry per date as each line reads it, by `compareDates`; undated rows ignored.
- Pure `historyOwnerStep(line, date)` in `shared/lorebooks/lineReading.ts` (rule C): a line owns dates strictly after its fork date; an ancestor owns the rest, and a dateless fork owns no dated history.
- The two opposite tie-breaks (`historyEntryOfDate.ts:10`, `reading.ts:447`) are unified.
- Partial dates are distinct (**default**, from `compareDates`).
- **People** (`entries:create`, `entries:update` re-date) are refused, with two sentences:
  - *"‹line› already has a history entry for ‹date›. Open it, or choose another date."*
  - *"‹line› shares everything up to ‹fork date› with ‹parent›. Change that day here as an amendment, or choose a later date."*
- **Day-entry paths reuse** (★H1): compile, iterateNext, the Time-lens drop and session writes find the owning entry. Where none exists, they create an empty one on the owning line, and a fork's prose is a line amendment.
- **Other writers** call the check: lorebook import, attic ETL, starter kits and primers, the provided-book upgrade, fold (*Merge ‹book› into these notes*) and line delete. Bulk and system writers (import, attic ETL, starters, provided-book upgrade, fold, line delete) **land their rows unchanged**, and a doubled date surfaces through item 8's chore, the ruled ★H3 path; they never merge or skip on their own. A writer that can't do this goes to the owner as a ★ before its lane builds. Undo and restore are exempt.
- No DB unique index.

**2. Pipeline writes (core host).**
- `create-lore-entry@1` with history:
  - resolves the date (fields, else `writeDatingAt`);
  - runs `assertDateLands`;
  - finds the owning day's entry and **appends** its content as a paragraph (**default**, S1), with the receipt note *"filed onto ‹date›'s entry"*.
- `update-lore-entry@1` gets the date, line and free-date checks.
- The chat tool `write_entry` refuses `kind:"history"`.

**3. `core:outlet/note-scene@1` (SDK contract + core host, ★S4 ruled).**
- New nullable `scenes.notes jsonb` `[{text, runId, messageId, at}]` (generated migration, second-boot test).
- Appends to the lane's open scene, or a named one.
- Refused in words when `writes.scenes:false`, when the scene is another session's, or when no scene is open.
- Notes reach `summarize-request@1` and `compileScenesForEntry`.
- A note on an already-compiled scene marks its day for recompile (**default**, S2).
- It never writes history and never adds messages.

**4. SDK teaching.**
- **Contract prose:** `outlets.ts:1616-1622,1695` says *"History is compiled, not written…"* and drops history as an ordinary choice.
- **Guides:**
  - a **Story events: scenes first** section in `guides/writing-lore-from-a-pipeline.md` (fix :36);
  - the summaries guide says a summarizer writes a scene for review;
  - an INTEGRATING.md subsection;
  - the `entries.ts:185` history doc.
- **Packager warning** `W_WRITES_HISTORY` (a warning, not an error: **default**, S6) in `cli/src/compiler.ts`, keyed on a resolved history `entryType`. `summarize-request@1` specs are exempt. The `declaredParams` helper moves into the SDK and is shared with C39. The matching conformance law over the catalogue lands in **hist-D**, with the Dungeon Crawler fix, so `sdk:test` never sits red.
- **Compile** stays a person's press (**default**, S3), and the docs say so.
- **Dated reads (★S5, ruled "Docs recipe only"):** no new query nodes. The docs show, as an advanced technique, how to combine the dated reads that already exist (`history-entries@1`, `stat-trail@1`, `lorebook-state@1` at a date, `current-date@1`) into a context template. Entry amendments and cast versions stay unreadable from pipelines for now.

**5. Cast state from pipelines (core + SDK).**
- `update-cast-member@1` accepts `nodeState` (and `nodeVisibility`), checked against `CAST_STATE_WORDS` (`runtime/castMember.ts:172-205`, contract doc).

**6. Dungeon Crawler (SDK core-catalog + core data passes).**
- **Deaths:**
  - A death places `update-cast-member@1 {nodeState: "deceased"}` for the fallen seat's member (cause `action`). The fallen stay at `normal` visibility (**default**).
  - "The fallen" comes from a lasting `progress.fallen` list.
  - The cairn history write (`lore.ts:41,335-347`) and the history `fallen` query (`story.ts:985-989`) are removed.
- **Scenes on:**
  - `writes.scenes: true` plus a `summarizeScene()` spec, with Lair's scene mode (**default**).
  - The Narrator names a death in its own sentence.
  - The scene summary prompt asks for deaths, departures and arrivals.
- **Clock:** `crawl-time` → the session story clock through `advance-story-clock@1` (create, turns, rests; cause `action`). The brief and journal read the story now, the prompt uses `current-date@1`, and DC's book stays free-form (**default**).
- **Cairn lore fixes** (from `plans/PROPOSAL-lore-visibility-knowledge-2026-11-10.md`): DC's "people the party may meet" listing (`respond.ts:84`) leaves anchored cairn rows out. Whether a deceased AI companion's lore reads as background (so the narrator reads its epitaph) is an open ★ for the owner.
- **Data passes:**
  - `dc-cairns`: each existing cairn becomes a `deceased` cast version plus a `progress.fallen` entry, and the epitaph is retyped in place to character lore bound to the matched member (world lore when none matches), as ruled.
  - `dc-crawl-clock`: the latest `crawl-time` goes into the session clock.
  - Each has a second-boot test.

**7. Lines and sessions (core).**
- `ensureSessionLine` carries the session's own uncompiled scenes onto the new line, as `moveRidingProposals` does.
- Scene capture (`liveScenes.ts:1230`) and `sessionLoreWrite` (`messages/writes.ts:251-290`) fork the line on first write wherever book writes already do.
- Next chapter starts at the followed session's story now (`sessions.ts:903-932,1540-1556`).

**8. Loose ends (core + client).**
- New chore **Two history entries on one date**, which opens both entries.
- New chore **A line's own history before its fork**.
- New dated writes on a doubled date are refused until it's fixed (★H3).

**9. Docs and vocabulary.**
- `docs/lorebook-time.md`, `docs/summarization.md`, `docs/genre-dungeon-crawler.md` and the SDK guides.
- NOMENCLATURE rows for every new name, plus the stale `current-date@1` doc (variables.ts:755) and the `crawl-time` slot comment.
- §25 ledger.

**Lanes** (at most 2 supervisors live):

| Lane | Owns |
|---|---|
| `hist-A` history dates | items 1 and 8 |
| `hist-B` host writes | items 2, 3 (core side) and 5 (core side) |
| `hist-C` SDK teaching | items 3 (contract), 4 and 5 (contract) |
| `hist-D` Dungeon Crawler | item 6 |
| `hist-E` lines | item 7 |
| `hist-F` docs | item 9 |

Order: A first; then the C contract half (note-scene@1, the widened update-cast-member, the outlet prose) with an `sdk:build`; then B; then E after B (E calls the scenes module B extends, never in parallel); D after B and C; F last. SDK rebuilds wait for no serene-pub `vite dev` to be running.

## What the code does today

### Dates
- A history entry's date is jsonb `fields {year, month?, day?}` (`schema.ts:8675`). Year is required; undated legacy rows exist.
- Two dates are equal when `compareDates === 0` (`shared/lorebooks/storyDate.ts:88`). A missing part counts as 0, so *Year 2* ≠ *Year 2, Month 5*.
- The line is `branch_id` (NULL = main). A fork reads its own rows plus its ancestors' rows dated up to its fork date (`lineSql.ts:78`).
- Amendments can't re-date (`amendments.ts:243-272`).

### Nothing on the server refuses a second entry on a taken date
- The only refusal is client-side, for edits only (`client/lorebooks/sections/index.ts:262-283`), and new entries skip it.
- Two readers already expect duplicates and break the tie in opposite ways, so on a doubled date compile and stat dating disagree:
  - compile picks the highest position (`scenes/historyEntryOfDate.ts:10`);
  - `writeDatingAt` picks the lowest id (`state/reading.ts:447`).

### Writers with no same-date check
- `entries:create` and `entries:update` (`sockets/entries.ts:681`, `:996`); session writes are dated at the session clock (`messages/writes.ts:301`).
- `entries:iterateNext` (`:1719`).
- The pipeline ports `create-lore-entry@1` and `update-lore-entry@1` (`runtime/host.ts:10998`, `:2001`). These also skip `assertDateLands`, and the update port is a second date writer with no line check, already a P2 bug.
- Lorebook import (`sockets/lorebooks.ts:4090`).
- The attic 0.5.3 ETL (`attic/etl/lore.ts:233`), whose date normalising can create new collisions.
- Starter kits and primers (`starterKits.ts:717`, `providedPrimers.ts:258`).
- The provided-book upgrade (`providedBooks.ts:1418`).
- Fold / *Merge ‹book› into these notes* (`foldInParent.ts:1747`), which **creates** duplicates.
- Line delete (`forkHistory.ts:58,264`).
- Undo/restore (`state/write.ts:1226`, `imprints.ts:181`).

**Compile** (`historyEntryOfDate.ts:104-162`) is the one path that finds or creates, but it checks only the line it was asked about.

### Genre audit: one genre abuses history
- **Dungeon Crawler writes a "cairn" history entry for every death.**
  - Where: `core-catalog/src/genres/dungeon-crawler/lore.ts:41,335-347`, with the epitaph at `death.ts:146-150`.
  - It writes up to 8 per turn, **undated**, so all of them land on the field default *Year 1*.
  - It bypasses scenes and compile, and the second death in any session already breaks "one per date".
- **Dungeon Crawler reads every history entry in its book as "the fallen"** (`story.ts:985-989`, `preamble.ts:516-575`). Once a crawl day is compiled, that day's narrative is fed to the Planner as an epitaph. The real state is the seat's `fate` slot (`death.ts:47,141`); where they fell is already in the progress annex (`death.ts:154`).
- **Latent doors:**
  - The chat tool `write_entry` accepts `kind:"history"` (`runtime/tools/writeTools.ts:43,78`) and would file undated history per call.
  - The summarize specs end in a history `save`, which every caller previews and stops before today (`scenes.ts:1899,1558`, `summarize.ts:56`). But the outlet contract invites "a summarizer writes history every time it runs" (`contracts/src/outlets.ts:1616-1622`).
- Story, Chat, Lair and Guide write no history. Lair reads it as lore, which is the intended use.

## Proposal

1. **One owner of "this date's history entry"** (P2): `assertHistoryDateFree(tx, { lorebookId, branchId, date, exceptId? })`, beside `historyEntryOfDate` (rename the module `lorebooks/historyDates.ts`).
   - **Rule:** a row conflicts if any line of the book reads both it and another history row with `compareDates === 0` (★H2). The line logic reuses `assertRedateKeepsLines` (`forkHistory.ts:430`). Undated rows are ignored.
   - **Where it runs:** it is called under `lockBookCalendar` on every writer above.
   - **Two tie-breaks:** the readers' opposite tie-breaks are unified on one rule.
2. **Refuse or reuse (★H1).** A direct create or re-date by a person is refused. Placeholder wording: *"‹line› already has a history entry for ‹date›. Open it, or choose another date."* The paths that mean "the entry of this day" find it instead of making a second one: Time-lens drop, iterateNext, session writes, and the pipeline create.
3. **Pipeline ports.** `create-lore-entry@1` and `update-lore-entry@1` get the same `assertDateLands` and line checks the socket paths have, plus the free-date check.
4. **Dungeon Crawler stops writing history (★H4).**
   - "The fallen" is built from seats whose fate is `dead`, plus a `fallen` record in the progress annex. The `fallen` history query is removed.
   - Existing cairn rows are handled per ★H4.
5. **Latent doors closed.** `write_entry` refuses `kind:"history"` (*history comes from scenes*). The outlet contract prose stops offering history as a direct pipeline write. Both are lead decisions: they close doors nothing uses.
6. **Existing duplicates (★H3):** a data pass with a second-boot test.
7. **Undo and restore** put back exact rows that were taken, so they are exempt (lead decision).
8. **No DB unique index for now.** A write-path check is the primary guard. An index can't express cross-line reads, and it would break line delete's move-onto-fork. Revisit after the data pass.

Partial dates follow `compareDates`: *Year 2*, *Year 2 Month 5* and *Year 2 Month 5 Day 3* are three different dates (lead default, from the code's own comparator). Changing that would be a separate ruling.

## ★ Open

- **★H1:** on a taken date, do the "make the day's entry" paths reuse the existing entry (recommended), or refuse?
- **★H2:** across lines, may a fork keep its own entry for a date main already has before the fork point? Recommended: **no**. One per date as each line reads it; a fork changes a day it inherited through amendments.
- **★H3:** existing duplicates. Recommended: **report, not auto-merge**. Each doubled date is listed in the book's **Loose ends** as a new chore, *Two history entries on one date*. It opens both, and the person moves or merges content. New writes on that date are refused until it's fixed. The alternative is an automatic merge (content joined, references repointed through `pointOnto` plus the seven references it misses), which is deterministic but changes people's prose without asking.
- **★H4:** Dungeon Crawler's fallen. Recommended: **(b) a world-lore cairn**, so the docs' promise that "a cairn … stays in the world" holds (`docs/genre-dungeon-crawler.md:18,254`). It is linked to the place, and existing cairn rows are retyped to world lore by a data pass. The alternative is (a): no lorebook trace, with the fallen kept in seat fate and the annex only.

## Size

- Check and wiring into ~12 writers: about 1 day.
- Port fixes: small.
- Loose-ends chore, or the merge pass: about 1 day.
- Dungeon Crawler and its retype pass: about 1 day.
- Tests and docs: about 0.5-1 day.

Lanes, after rulings: core write paths; SDK Dungeon Crawler; the data passes; docs and NOMENCLATURE.

## ★H2 design (research 2026-11-10, read-only)

**Facts:**
- A fork point is a story date only: `lorebook_branches.fork_year/month/day`. NULL means a dateless fork that keeps following its parent. The cut includes the fork day itself (`lineReading.ts:14-28,118-129`, `lineSql.ts:78-94`).
- A session's line is forked at its **first book write**, at the session's clock then (`sessionLine.ts:111-131`), not at branch time.
- Fork dates never move, except on line delete. Branches are outside undo.
- Nothing checks a fork's write dated on or before its fork date: create, compile-create, re-date, Time-lens drop and iterateNext all let it through.
- **Fork-day clash:** a fork that compiles its own fork day first makes the parent's later compile of that day a second entry. So a fork can't own its fork day.
- **Mid-session leak (medium confidence):** scene capture (`liveScenes.ts:1230`) and `sessionLoreWrite` (`messages/writes.ts:251-290`) never call `ensureSessionLine`. A branched session's early scenes therefore land on the parent line and compile into main.

**Options:**
- **(A) Shift the fork point earlier on a write before it.** Every earlier read changes, invariants break, it can't be undone, and it fails P1. Rejected.
- **(B) Fork at the session start.** "Start" isn't stored. It is NULL for clockless sessions, and parent rows the session was already reading would vanish mid-play. It fixes neither the clash nor the leak.
- **(C) The ancestor owns the day; the fork amends it.** Recommended.

**Recommended rule (C):**
- A line owns a history entry only for a date **strictly after** its fork date. On or before it, the day's entry is the ancestor's, and a fork's version of that day is a line amendment (`compileSaveOf`, already built).
- **Day-entry paths** (★H1 reuse): compile, iterateNext, the pipeline create and the Time-lens drop reuse the ancestor's entry. When there's none, they create an empty one on the nearest ancestor that may own the date.
- **A person's direct create or re-date** onto a date on or before the fork is refused: *"‹line› shares everything up to ‹fork date› with ‹parent›. Change that day here as an amendment, or choose a later date."*
- **Enforcement:** one pure `historyOwnerStep(line, date)` in `shared/lorebooks/lineReading.ts`, used only by `lorebooks/historyDates.ts` (refuse and redirect).
- **The owner's "shift the fork point" concern is answered without moving anything:** missing days before the fork become shared entries plus fork amendments. And on first write, `ensureSessionLine` moves the session's own scenes that aren't compiled yet onto the new line, as `moveRidingProposals` already does for proposals.

**Open ★ for H2:**
- **Q1:** the fork day is shared ("at" = shared).
- **Q2:** a fork's compile may create an empty entry on the parent.
- **Q3:** session lore writes dated on or before the fork are refused, or become a parent row plus an amendment.
- **Q4:** session-start forking is dropped, and first-write forking carries the session's own scenes that aren't compiled yet.
- **Q5:** dateless forks own no dated history.
- **Q6:** a manual "Move fork earlier" verb: deferred.

## ★H4 design (research 2026-11-10, read-only)

**Facts:**
- **"Cast lore" is not built yet.** It is the S5 rename of character lore (NOMENCLATURE:454).
- **No lore entry has a "public" value.** "Public" exists only on relationships (`schema.ts:38`). Character lore anchored to a seated member is already read by every prompt in the session (`prompt/characterLore.ts:161-169`).
- **The cast status exists:** `active|deceased|missing|departed` (`schema.ts:36`, SDK `CAST_STATE_WORDS`). It is stored as `nodeState` on a dated cast version (`characters/versions.ts:1343-1347`). It is shown on the cast page, and prompts see it through the graph context.
- **A pipeline can't set it today.** `update-cast-member@1` (`outlets.ts:2105-2152`) writes a dated cast version tied to the turn, but its check refuses `nodeState` (`runtime/castMember.ts:183-186`), even though the writer underneath supports it.
- **Only seats can fall in DC,** and each seat carries `castMemberId` (`preamble.ts:284`). Card-less seats get their own member. A new character retires the fallen's seat, after which the seat's fate can't be read any more.
- **DC writes no scenes.** It has `writes.scenes: false` (`registry/genres.ts:1621`) and no `summarize.scene`. The only scene port a pipeline has is `propose-scene-cue@1` (a boundary); no port writes a scene summary or note.
- **The death reaches the narration only as an instruction** (`death.ts:151`). The scene summary prompt doesn't ask for deaths (`seed/prompts.ts:350`).
- **`crawl-time` is not the story clock** (`slots.ts:553-557`). Cast versions and scenes would all be dated at the book's present.

**Recommendation:** the cast status is the record, the scene carries the story, and history comes from compile. New deaths write no lore.
1. **Widen the port.** `update-cast-member@1` accepts `nodeState` (and `nodeVisibility`), checked against `CAST_STATE_WORDS` (`castMember.ts:172-205`, the contract doc).
2. **Record the death on the cast.** A DC death places one `update-cast-member@1` with `nodeState: "deceased"` per fallen seat. It is dated and tied to the turn, so a retake takes it back. The `loreFallen` cairn arm and the history `fallen` query are removed.
3. **A durable list of the fallen.** "The fallen" for the Planner comes from a lasting `progress.fallen [{name, where, seat, castMemberId}]` in the progress annex. It survives the seat being retired and is undone with the turn.
4. **Scenes first.**
   - DC turns scenes on (`writes.scenes: true` plus a `summarizeScene()` spec like Lair's).
   - The Narrator must name the death in its own sentence (`death.ts:151`).
   - The scene summary prompt asks for "deaths, departures and arrivals".
   - Compile carries the death into the day's history entry, and the graph build's `deceased` inference confirms it.
5. **Data pass `dc-cairns`.** Each existing cairn becomes a `deceased` cast version, matched by `sourceMessageId` → fate change → seat, else by a unique name. Each also gets a `progress.fallen` entry, and the epitaph is retyped in place to **world lore** "Cairn of N" (linked to the place if it resolves). The second boot is a no-op.

**Open ★ for H4:**
- **Q1:** do the fallen also get `legendary` visibility, or stay `normal`?
- **Q2:** should DC drive the book's story clock from `crawl-time` (`advance-story-clock@1`), so its scenes, cast versions and compile have real days? This would be a separate lane.
- **Q3:** old epitaphs become world lore (recommended), or character lore bound to the member?
- **Q4:** are DC scenes automatic (summarized at a boundary) or suggested?

**Size:** port + DC about 1.5 days; scenes in DC S–M; data pass S–M; the clock bridge (Q2) M.

## Scenes first in the SDK (research 2026-11-10, read-only)

**Facts:**
- **No pipeline port writes into a scene.**
  - `propose-scene-cue@1` only suggests a boundary (`outlets.ts:750-756`).
  - A genre's `summarize.scene` runs as a preview that a person applies (`sockets/scenes.ts:1600,1833`).
  - The scene events (`scene-opened`, `scene-closed`, `scene-summary-applied`) can trigger a pipeline but not write back.
  - The scene and compile widget requests are core-only (`sdk/src/widgets.ts:2846-2897`).
  - A pipeline's only scenes-first route is a story line (`create-message@1`). A non-message fact has no scene home, so authors reach for `create-lore-entry` with history, the Dungeon Crawler pattern.
- **Compile is closed to pipelines and plugins** (it runs outside the executor, `sockets/scenes.ts:1092-1284`). That is right under P1, but it isn't documented.
- **The docs teach the opposite.**
  - `outlets.ts:1616-1619`: "a summarizer writes history every time it runs".
  - `:1695` offers history as an ordinary choice.
  - `guides/writing-lore-from-a-pipeline.md` never mentions scenes, and its `:36` suggests `match` for a running summary.
  - The summaries guide registers a summarizer every 10 turns without saying what it writes.
  - INTEGRATING.md has nothing on scenes first.
- **Dated reads.**
  - `stat-trail@1` (`queries.ts:3181`) is the only "what changed, when" read, one stat per node.
  - `history-entries@1`, `lorebook-entries@1`, `cast-presences@1` and `lorebook-state@1` read state, not a trail.
  - Nothing reads entry or cast amendments with their dates, or scenes by day.
  - Templates can already `#each` any band (`templateScopeAt.ts:14-20`); only the data is missing.

**Recommendation:**
- **(a) Docs and contract wording (about 0.5 day).**
  - Replace the outlet example with "a room-builder writes locations every time it runs", and add: *"History is compiled, not written. Put events into scenes; a person's Compile files them under the day's one entry. A history write here is the second choice and reuses its day's entry."*
  - Drop history from the param text.
  - Add a **Story events: scenes first** section to the lore guide.
  - The summaries guide says a summarizer writes a *scene*, held for review.
  - Add an INTEGRATING.md subsection.
- **(b) Packager warning `W_WRITES_HISTORY` (about 0.5 day)** (`cli/src/compiler.ts` after :1642, the P5 pattern).
  - Any `create-lore-entry` node whose resolved `entryType` is history warns: *"writes history entries directly — history is compiled from scenes"*. Specs on `summarize-request@1` are exempt, because they are previewed.
  - The `declaredParams` helper moves into the SDK, shared with conformance C39.
  - A conformance law runs over the catalogue; it fails until the Dungeon Crawler fix lands.
- **(c) New port `core:outlet/note-scene@1` (about 1.5-2 days).**
  - It adds a note `{text, runId, messageId, at}` to the open scene (or a named one), in a new `scenes.notes` jsonb (migration plus second-boot test).
  - Notes reach the scene summary and compile.
  - It is refused when `writes.scenes:false`, when the scene is another session's, or when no scene is open.
  - It never writes history and never adds messages.
- **(d) Core pipeline history writes (about 0.5 day, after `assertHistoryDateFree`).**
  - `create-lore-entry@1` with history resolves the date (fields, else `writeDatingAt`) and runs `assertDateLands`.
  - It then finds the day's entry and **appends** its content as a paragraph, with a receipt note *"filed onto ‹date›'s entry"* (★H1 reuse).
  - `update-lore-entry@1` gets the date and line checks.
  - `write_entry` refuses history.
- **Dated reads: optional `core:query/story-changes@1`.**
  - Opt-in (P1): it reads only when a genre wires it.
  - Params: `kinds` (history | scenes | stats | entries | cast), `since`, `last`. Output: changes grouped by day, with the fork cut and binding visibility applied, published as a band templates can iterate.
  - First slice (about 1 day): history, scenes and stats. Entry and cast amendments come after (about 2 days in full).

**Open ★ (SDK):**
- **S1:** a pipeline's history write appends to the day's entry.
- **S2:** a note on an already-compiled scene marks the day for recompile.
- **S3:** compile stays a person's press.
- **S4:** `note-scene@1` now, or the story-line route only for 0.6.
- **S5:** `story-changes@1` now, and its first slice.
- **S6:** the history warning is a warning, not an error.

## Clocks (research 2026-11-10, read-only)

**Facts:**
- A session has its own clock, `sessions.story_clock_*` (schema.ts:2727-2749). Unset means it follows its line's present. It is also the session's **reading moment**: dated rows are cut at it (reading.ts:342-356).
- The line present is `lorebooks` / `lorebook_branches.story_clock_*`. It falls back to the newest history entry. Its only writer is the book editor, and it is outside undo.
- `sessionStoryNowOf` reads the session clock first, then the line clock, then history (storyTime.ts:358-368). The SDK doc for `current-date@1` (variables.ts:755), which calls it "the lorebook's clock", is stale.
- **`advance-story-clock@1` writes the session's clock only** (host.ts:9582-9600). Each move is a `clock` state proposal, and a retake or delete takes it back.
- A branch's clock is stepped back to its fork point (branch.ts:545-561).
- **Next chapter drops the clock**: it falls back to the line's present (sessions.ts:903-932).
- Timeline crons run on each session's clock.
- **Not every session owns a line.** A plain session on a shared book rides the book's line; only branches and branch-off starts fork at their first write.
- **DC's `crawl-time`** is a separate session-scoped slot.
  - Written by: create (epoch `1-01-01 08:00`), story turns (its own `addMinutes`) and rests.
  - Read by: the Planner brief ("Day N, HH:MM"), the journal, and the "It is ‹v›" prompt line.
  - Its grain is minutes. DC reads only its own notes, so the session clock is effectively its book's clock.

**Recommendation:**
- **(a) DC moves onto the story clock now, with no core change.**
  - create → `advance-story-clock@1 {to: {hour: 8, day: 'today'}}`.
  - Story turns and rests → `advance-story-clock@1 {by, unit: 'minutes', cause: 'action'}`.
  - The brief and journal read the session's story now.
  - The `crawl-time` host-state `time` decl goes, and the prompt uses `current-date@1`. The slot stays registered so old rows still display.
  - A data pass `dc-crawl-clock` writes each DC session's latest `crawl-time` into its session clock, verbatim, skipping sessions that already have one (the second boot is a no-op).
  - This gives ★H4's scenes, `deceased` versions and compile real crawl days.
- **(b) Remove session-only clocks: not yet.** Blockers, listed only:
  1. Plain sessions on a shared book don't own a line.
  2. Readers who can only view a book can't fork one.
  3. Clock undo lives on the session columns.
  4. A branch needs its own time before its first write.
  5. Reading a shared book at a past date would need a fork.
  6. Rule C gives a line clock before its fork date no meaning.
  7. Timeline crons fire per session.
  8. Migration would need write rights on other people's books.
- **The narrower real gap:** next chapter drops the clock. It should start at the followed session's story now (a one-column copy in the create path).

**Open ★:**
- **C1:** DC on the session story clock, with cause `action`.
- **C2:** next chapter carries the clock, rather than close-out moving the line's present.
- **C3:** keep session clocks, with the blockers parked.
- **C4:** DC's book stays free-form (no calendar).
