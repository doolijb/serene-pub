# BRIEF — hist-F-w2: NOMENCLATURE rows for "one history entry per date, scenes first"

Supervisor: lane hist-F. Plan `plans/PLAN-history-one-per-date-2026-11-10.md` (GO 2026-11-10). The code is already built. **No code changes.** The supervisor has written every row's text below; your job is to place it exactly, in one pass, and check each name you place against the code (grep it; report any that doesn't exist as written).

## Files owned (the only file you may edit)

`NOMENCLATURE.md`. (STYLE-GUIDE.md: no change this lane.)

Other sessions have uncommitted edits in this file, and another session edits it right after this lane. Use targeted `Edit`s only; never rewrite the file, never reorder or reformat existing rows, never touch rows not named here.

## Rules you're applying (NOMENCLATURE, quoted)

- "**R1 — One word, one meaning.** Where a word is already load-bearing in one place, the _other_ use renames. Not both."
- "**R3 — Qualify, never abbreviate to the bare noun.**"
- "🚧 **Provisional** — designed but not built, so the words may still move on contact with implementation." / "⏳ **Transitional** — real today, expires on a known event."
- §24: "Grep for it first — across `src`, the SDK, and the schema." "Say what it is **not**, in the declaration, if a near-neighbour exists."
- CLAUDE.md P6: "Everything that exists states its purpose, why it exists, what it owns and what it does not (and who does) — in its **NOMENCLATURE** row."
- When you add a term, record it in **§25 Change ledger** in the same change (the block below does that).

## How to read the file

Never read it whole (it's ~3,700 lines with very wide table rows). Use `grep -n "^## \|^### " NOMENCLATURE.md`, then `sed -n 'A,Bp'` small ranges, piping through `cut -c1-300` to see the start of rows. Find each anchor row by `grep -n` on its first cell (line numbers below are approximate and move as you insert).

Row format: one line, `| **term** … | text |`. Existing rows are column-padded by prettier; **don't pad new rows** (the file already fails `prettier --check`; that's expected). Never run `prettier --write`.

## Work

### §8 Content — insert three rows directly after the row starting `| **line** (of a lorebook) · **fork cut**` (~line 384)

Row 8-1:
```
| **one history entry per date** · **the day's entry** · **owning line** (of a history day) · `assertHistoryDateFree` · `historyDayOwnerRefusal` · `historyOwnerStep` · `historyEntryOver` · `CASE_HISTORY_OWNERS` 🚧 | **Built 2026-11-10 (owner ★H1 reuse, ★H2 rule C, ★H3; PLAN-history-one-per-date-2026-11-10, lanes hist-A, hist-G).** **Purpose:** a history date names one moment of a line's story, so a day has one history entry, as each line reads it. **Why:** two entries on one date made compile and stat dating disagree (opposite tie-breaks), and a genre could pile undated history onto _Year 1_. **Owns:** `scenes/historyEntryOfDate.ts` owns every history-date check: `assertHistoryDateFree(tx, { lorebookId, branchId, date, exceptId? })` (rule C first, then one per date on the target line; undated rows ignored; archived rows count; the caller holds `lockBookCalendar` and passes only `tx`) and `historyDayOwnerRefusal` (rule C's sentence, or null). The pure `historyOwnerStep(line, date)` (`shared/lorebooks/lineReading.ts`, test table `CASE_HISTORY_OWNERS`) names a day's **owning line** (rule C): a line owns dates strictly after its fork date, an ancestor owns the rest, and a dateless fork owns no dated history. `historyEntryOver(a, b)` (`state/reading.ts`) is the one tie-break: the later date, and of equal dates the lower id, so on a doubled date **the day's entry** is the oldest. Dates compare as the day (`dayOnly`, `compareDates`): partial dates are distinct (lead default). The day-entry paths reuse the day's entry instead of making a second: compile (`historyEntryOfDate(create: true)`, which creates on the owning line), `entries:iterateNext`, a blank session write (the summarize window's **New**), the Time-lens drop, and a pipeline's history write (`fileOntoHistoryDay`, §4). A person's `entries:create`, or re-date through `entries:update` (checked only when the date changes), is refused: _‹line› already has a history entry for ‹date›. Open it, or choose another date._ · _‹line› shares everything up to ‹fork date› with ‹owning line›. Change that day here as an amendment, or choose a later date._ · 🚧 _‹line› follows ‹owning line› with no fork date, so its dated history is ‹owning line›'s. Change that day here as an amendment._ **Not:** a database unique index (none; the check is on the write path and reads across lines). Bulk and system writers (import, attic ETL, starters, the provided-book upgrade, fold, line delete) land rows unchanged, and a doubled date surfaces as a Loose-ends chore (below). Undo and restore are exempt: they put back exact rows. ⚠ A fork's version of a day it doesn't own is an **amendment**, never an entry of its own. |
```

Row 8-2:
```
| **Two history entries on one date** (`doubled-history-date`) · **A line's own history before its fork** (`history-before-fork`) · `LooseEnd.alsoEntryIds` · `LooseEndsInput.line` · `data-loose-end-also` · _Other entry_ 🚧 | **Built 2026-11-10 (owner ★H3 "Report in Loose ends"; lane hist-A).** Two **Loose ends** chores (`CHORES`, `client/lorebooks/looseEnds.ts`). **Purpose:** report rows that break one history entry per date or rule C (made before the rule, or landed by a bulk writer) so a person fixes them; code never merges or moves them (P1). `doubled-history-date`: one row per doubled date on the line being read, opening the oldest, with `alsoEntryIds` (the others, ascending) drawn by `LooseEndsQueue` as _Other entry_ / _Other entry ‹n›_ links (`data-loose-end-also`); archived rows count, as on the server. `history-before-fork`: a fork's own history row dated on or before its fork date, while that line is read (`LooseEndsInput.line`, the line being read; absent reads as main). Fix lines 🚧 (owner ★): _Give one of them another date, or move what it says into the other and delete it._ · _Give it a date after the fork, or delete it._ **Not:** a refusal: the server refuses new writes; these list what is already there. |
```

Row 8-3:
```
| **scene note** · `scenes.notes` · `appendSceneNote` · `takeSceneNotesAt` · `restoreSceneNotes` · `SceneNotesTaken` · `RetractedState.sceneNotes` · _Noted in this scene:_ 🚧 | **Built 2026-11-10 (owner ★S4 "Add note-scene now"; lanes hist-B2, hist-B3).** **Purpose:** a home in a scene for a story fact that isn't a line (what a pipeline noticed), so it reaches history through the scene's summary and Compile (**scenes first**, §4). **Owns:** the scenes module (`scenes/liveScenes.ts`) owns every write. `scenes.notes` is a nullable jsonb `[{ text, runId, messageId, at }]` (migration `0150_chief_starjammers`). `appendSceneNote` is one atomic append to the named scene or the run channel's open scene, refusing with `SceneBoundaryRefusal`. `takeSceneNotesAt(tx, messageId, sessionId?)` → `SceneNotesTaken[]` takes a turn's notes on retake, Back and delete (`retractStateAnchoredTo`, `retractLoreOf`), recorded on `RetractedState.sceneNotes`; `restoreSceneNotes` puts them back on Forward. Notes are read under _Noted in this scene:_ by the summarize transcript (`runtime/transcript.ts` `sceneOf`, core-catalog `DEFAULT_TRANSCRIPT_TEMPLATE`) and by compile (after each scene's summary; a scene with notes but no summary isn't compiled). A pipeline writes one only through `core:outlet/note-scene@1` (§4). **Not:** a message (it adds none), a history write, or **Session notes** (a session's own lorebook, §24): ⚠ R1, always _scene note_, never a bare _note_. No recompile marker (lead decision B2-2: a person's Recompile re-reads every scene of the day). |
```

### §8 — amend two existing rows (append or replace only the quoted text)

- Row starting `| **background member**` (~line 353): before the final sentence `⚠ Not **card-less** (a member with no linked card).`, insert: `A member whose cast version in force is \`deceased\` (the binding's \`nodeState\`, carried on the lore read's bindings) reads as background for lore whoever seats it: the narrator reads it and its own seat doesn't; a player seat that seats it still shares it (owner 2026-11-10, lane hist-G; due to change with the benched-seats plan). ` (keep the backticks as code spans in the file).
- Row starting `| **story calendar** · **story clock**` (~line 380): replace the sentence `` `storyNowOf` reads the line's clock, else the newest dated entry, and the prompt's `currentDate` reads that. `` with `` `storyNowOf` reads the line's clock, else the newest dated entry. The prompt's `currentDate` and `core:var/current-date@1` read the **session's** story now (`sessionStoryNowOf`: the session's clock, else its line's present, else the newest history entry; the SDK description fixed 2026-11-10, lane hist-C). ``

### §9 Session — insert after the row starting `| **branch**` (~line 450)

Row 9-1:
```
| `line_on_first_write` (a branch session's line forks at its first write) · `moveRidingScenes` · `forkRidingSessions` · `BRANCH_SESSION_SCENES` 🚧 | **Built 2026-11-10 (owner ★H2 rule C and Q4; ★E-2 "Compiling forks the session first"; lanes hist-E, hist-G).** A branched session (`sessions.line_on_first_write`) gets its own line at its first lorebook write (`ensureSessionLine`, `lorebooks/sessionLine.ts`), never at branch time. `entries:create` forks inside its transaction, after the lock and checks, so a refused write forks nothing. On the fork, `moveRidingScenes` moves the session's own uncompiled scenes in the attached book onto the new line, as `moveRidingProposals` moves its proposals. Starting or ending a scene isn't a lorebook write and forks nothing. Compile first forks every branch session still riding the compiled line and attached to this book (`forkRidingSessions`, `sockets/scenes.ts`); when only such a session's scenes were waiting, the press is refused with `BRANCH_SESSION_SCENES` 🚧: _The scenes waiting here belong to a branch session, which compiles them on its own line._ **Not:** session-start forking (dropped, ★H2 Q4). A riding session attached to another book isn't forked. |
```

### §9 — the Dungeon Crawler row (starts `| **Dungeon Crawler** (\`core:genre/dungeon-crawler\`)`, ~line 573)

Amend three spots in that row, nothing else:
1. In its first cell, `**crawl time** 🚧` → `**crawl time** ⏳`.
2. `` `writes { lore: false, scenes: false }`, no `summarize` `` → `` `writes { lore: true, scenes: true }` (lore since 2026-10-17, scenes since 2026-11-10), `summarize.scene` (2026-11-10, §9 **the fallen**) `` (if the exact text differs, change only the writes/summarize words and report what you found).
3. `**Crawl time** (\`core:slot/crawl-time@1\`, UI _Time_) is the genre's own clock on the world — ⚠ not the **story clock**, which walks a lorebook calendar.` → `⏳ **Crawl time** (\`core:slot/crawl-time@1\`, UI _Time_) was the genre's own clock on the world; retired from writes 2026-11-10 (owner ★C1): the crawl runs on the session's **story clock**, and the slot stays registered so old rows still display (§23).`

Then insert directly after the Dungeon Crawler row:

Row 9-2:
```
| **the fallen** (`progress.fallen`) · `fallenOf` · `peopleOf` · `storyNowClock` · `core:spec/dungeon-crawler-summarize-scene` (`DUNGEON_CRAWLER_SUMMARIZE_SCENE_SPEC_ID`, `dungeonCrawlerSummarizeSceneSpec`) · node keys `channel.story.deaths.deceased.*` · `channel.story.time.clock.*` · `rested.clock.*` · boot passes `dc-cairns` · `dc-crawl-clock` 🚧 | **Built 2026-11-10 (owner ★H4, ★C1; lanes hist-D1, hist-D1b; the boot passes are lane hist-D2's, named in its brief).** The Dungeon Crawler's death and clock vocabulary once it stopped writing history. **Purpose:** a death is recorded as the fallen hero's cast state and in the genre's own list, and reaches history only through scenes and Compile. A death places `update-cast-member@1 { nodeState: "deceased" }` for the fallen seat's member (node keys `channel.story.deaths.deceased.*`, cause `action`) and appends `{ name, where, seat, castMemberId }` to the annex's **`progress.fallen`**, the lasting list of the fallen (never spent; taken back with its turn). `fallenOf` reads it for the Planner; `peopleOf(listing, fallen)` leaves a fallen hero's character lore out of the people the party may meet. ⚠ The same people as the session settings' **The fallen** (the seats a death retired), from a different store: the annex list is the record. The clock is the session's story clock: `advance-story-clock@1` at create (`to: { hour: 8, day: 'today' }`), each round (`channel.story.time.clock.*`) and each rest (`rested.clock.*`), each skipping on refusal; `storyNowClock(now)` renders the story now as the genre's clock line. Scenes: `writes.scenes: true`, `scenes.triggers.timeAction: false` (★D1-1, open), `summarize.scene` → `core:spec/dungeon-crawler-summarize-scene`. Boot passes: **`dc-cairns`** retypes each old cairn history row in place to character lore anchored to the matched member (with a `deceased` cast version and a `progress.fallen` item), else to world lore titled 🚧 _Cairn of ‹name›_; **`dc-crawl-clock`** copies a session's latest `crawl-time` into its unset session clock. **Not:** history (C40 checks the catalogue); `note-scene@1` (unused here: the Narrator's own sentence about the death is the record). |
```

### §4 Pipeline — insert after the row starting `| **step label** · **step purpose**` (~line 166), in this order

Row 4-1:
```
| **scenes first** 🚧 | **Ruled 2026-11-10 (owner direction, verbatim: "We want to make sure we are encouraging pipelines/modders to be targeting scenes first for granular history updates, then history entries second, optimally compiling from scenes to history entries.").** **Purpose:** history is compiled, not written. Pipelines put story events into scenes (a story line, or a **scene note** through `note-scene@1`), and a person's Compile files a day's scenes under the day's one history entry (§8 **one history entry per date**). A direct history write is the second choice and lands on the day's entry (**a pipeline's history write**, below). Compile stays a person's press (lead default S3). Taught by the outlet contract (`contracts/src/outlets.ts`: _History is compiled, not written_), the SDK guides (_Story events: scenes first_) and INTEGRATING §1l; checked by `W_WRITES_HISTORY` and **C40**. **Not:** a lock: a history write still works, and every refusal is in words (P1). |
```

Row 4-2:
```
| **Note it in the scene** (`core:outlet/note-scene@1`, SDK `noteScene`) 🚧 | **Built 2026-11-10 (owner ★S4; contract lane hist-C, host lane hist-B2).** An outlet: in-ports `text` · `scene` · `sources`, out `main`, `effects: 'write'`. It appends a **scene note** (§8) to the run channel's open scene, or a named one; it adds no message and never writes history. UI label 🚧 (★C-1) _Note it in the scene_, which avoids _Notes_ (**Session notes**, §24). Refused in words: _a note needs text._ · _this genre keeps no scenes._ · lore writes Off (the existing sentence) · _there is no scene ‹x›._ · _that scene belongs to another session._ · _no scene is open to note; open one first (propose-scene-cue@1)._ · _‹node› has no session to note a scene in — …_ |
```

Row 4-3:
```
| **a pipeline's history write** · `fileOntoHistoryDay` · _filed onto ‹date›'s entry_ 🚧 | **Built 2026-11-10 (owner ★H1 reuse; lead default S1 append; fourth-round ruling "The session's story 'now'"; lanes hist-B1, hist-G).** `create-lore-entry@1` with a history entry type goes through `fileOntoHistoryDay` (`runtime/host.ts`). The date is the write's `fields` year, else the session's story now taken literally (★G-3). Then `assertDateLands` → `historyDayOwnerRefusal` → `historyEntryOfDate(create: true)`, and the day entry's content gains the write as a paragraph through the imprinted `changeLoreEntry`, so a retake reverts it and removes an entry the write made (stamped `provenance: "pipeline"`). `match` is ignored; when the day's entry already existed the receipt says _filed onto ‹date›'s entry_. Refused 🚧: _‹node›: a history date needs a year. Give this write a year in its fields, or leave the date out to use the story's day._ (a month or day with no year) · _‹node›: history needs a date. Give this write a year in its fields, or give the story a dated history entry first._ (no year and no story now) · rule C's sentence on or before a fork date. A history re-date through `update-lore-entry@1` gets the lock, `assertDateLands`, `assertHistoryDateFree(exceptId)` and `assertRedateKeepsLines`, only when the date changes. The chat tool `write_entry` refuses history: _History comes from scenes: capture the moment and compile it, or write world lore._ **Not:** a second entry for the day, ever. |
```

Row 4-4:
```
| **`W_WRITES_HISTORY`** · **C40** (`historyWriteFindings`) · `declaredNodeParams` 🚧 | **Built 2026-11-10 (lead default S6: a warning, not an error; lanes hist-C, hist-D1).** `W_WRITES_HISTORY` is the packager's warning (`cli/src/compiler.ts`) on a `create-lore-entry` node whose resolved entry type is `core:entry/history`: _writes history entries directly — history is compiled from scenes_. A document with a `summarize-request` inlet is exempt: its save is previewed. Conformance law **C40** (_scenes first_, `conformance/src/index.ts`) runs the same predicate (`historyWriteFindings`) over the shipped catalogue. Both read node params through `declaredNodeParams(doc, nodeKey)` (`sdk/src/document.ts`, exported), which C39 now shares. **Not:** an error: the package still builds. |
```

Row 4-5:
```
| `update-cast-member@1`'s **cast state** (`nodeState` · `nodeVisibility` in `changes`) · `NODE_VISIBILITIES` 🚧 | **Built 2026-11-10 (plan item 5; contract lane hist-C, host lane hist-B2).** _Change a cast member_ may set `nodeState` (checked against `CAST_STATE_WORDS`: active · deceased · missing · departed) and `nodeVisibility` (normal · legendary · hidden; `NODE_VISIBILITIES` in `runtime/castMember.ts`), dated and tied to the turn like its other changes; `{ follow: true }` is refused for both. Refused: _'‹value›' is not a cast state; …_ · _'‹value›' is not a cast visibility; …_ |
```

### §23 Retired words — append two rows at the end of the table (after the row starting `| **Show all character fields** (the Settings › User card)`, before the `---`)

```
| **cairn** (as a Dungeon Crawler history entry) · `loreFallen` · `DUNGEON_CRAWLER_ENTRY_TYPES.fallen` · `MOST.fallen` · `WorldWrites.fallen` · the `channel.story.fallen` history query | **Retired 2026-11-10** (owner ★H4; lane hist-D1). A death wrote an undated history entry (_Here lies ‹name›…_) for each fallen hero, which piled onto _Year 1_ and broke one history entry per date, and every history entry in the book was read back as _the fallen_. Use instead: the cast member's `deceased` state, **`progress.fallen`** (§9 **the fallen**), and the death reaching history through scenes and Compile. Old rows are retyped by the `dc-cairns` boot pass (character lore on the matched member, else world lore titled _Cairn of ‹name›_, where _cairn_ survives only as a lore title's word). |
| the `crawl-time` host-state `time` declaration · **crawl time** as the Dungeon Crawler's clock | **Retired 2026-11-10** (owner ★C1 "Session story clock"; lane hist-D1). The genre kept its own minute clock beside the story clock, so its scenes, cast versions and compile had no real days. Use instead: the session's **story clock**, moved through `advance-story-clock@1`. ⏳ The slot `core:slot/crawl-time@1` stays registered, retired from writes, so old rows still display; the `dc-crawl-clock` boot pass copies the latest value into the session clock. |
```

### §25 Change ledger — one block, inserted directly before the line `## 26. Shell` (after the `### advanced controls — 2026-11-10` block), with one blank line before and after

```
### history: one entry per date, scenes first — 2026-11-10 (owner GO; PLAN-history-one-per-date-2026-11-10, lanes hist-A…G, D1/D1b/D2, B2/B3)

| Was | Is | Cost |
| --- | --- | --- |
| _(new)_ | 🚧 **one history entry per date** · **the day's entry** · **owning line** · `assertHistoryDateFree` · `historyDayOwnerRefusal` · `historyOwnerStep` · `historyEntryOver` · `CASE_HISTORY_OWNERS` (§8) | `scenes/historyEntryOfDate.ts`, `shared/lorebooks/lineReading.ts`, `state/reading.ts`, `sockets/entries.ts`, `client/lorebooks/time/TimeLens.svelte` |
| on a doubled date compile picked the highest position and `writeDatingAt` the lowest id | one tie-break, `historyEntryOver`: the lowest id | `pickEntryOfDate` |
| _(new)_ | 🚧 chores `doubled-history-date` · `history-before-fork`, `LooseEnd.alsoEntryIds`, `LooseEndsInput.line`, `data-loose-end-also`, _Other entry_ (§8) | `client/lorebooks/looseEnds.ts`, `LooseEndsQueue.svelte`, `LorebooksWorkspace.svelte` |
| _(new)_ | 🚧 **scene note** · `scenes.notes` · `appendSceneNote` · `takeSceneNotesAt` · `restoreSceneNotes` · `SceneNotesTaken` · `RetractedState.sceneNotes` · _Noted in this scene:_ (§8) | `0150_chief_starjammers`, `scenes/liveScenes.ts`, `state/write.ts`, `messages/store.ts`, `runtime/transcript.ts`, `sockets/scenes.ts`, core-catalog `summarizeScene.ts` |
| _(new)_ | 🚧 **scenes first**; **Note it in the scene** (`core:outlet/note-scene@1`, `noteScene`) (§4) | `contracts/src/outlets.ts`, `runtime/bindings.ts`, `runtime/host.ts`, `boot/registryHashes.test.ts`, SDK guides, INTEGRATING §1l |
| `create-lore-entry@1` with history made a new row per write (undated → _Year 1_) | 🚧 **a pipeline's history write** (`fileOntoHistoryDay`, _filed onto ‹date›'s entry_) (§4) | `runtime/host.ts` |
| `write_entry` accepted `kind: "history"` | refused: _History comes from scenes: …_ | `runtime/tools/writeTools.ts` |
| _(new)_ | 🚧 `W_WRITES_HISTORY` · C40 (`historyWriteFindings`) · `declaredNodeParams` (§4) | `cli/src/compiler.ts`, `conformance/src/index.ts`, `sdk/src/document.ts` |
| `update-cast-member@1` refused `nodeState` | accepts `nodeState` · `nodeVisibility`; `NODE_VISIBILITIES` (§4) | `runtime/castMember.ts`, `contracts/src/outlets.ts` (doc only) |
| a branch session's own scenes stayed on the parent line after its fork; compile could file another session's riding scenes into the parent | 🚧 `line_on_first_write` fork carries them (`moveRidingScenes`); compile forks riding sessions first (`forkRidingSessions`, `BRANCH_SESSION_SCENES`); `entries:create` forks inside its transaction (§9) | `lorebooks/sessionLine.ts`, `sockets/entries.ts`, `sockets/scenes.ts`, `messages/writes.ts` |
| **Next chapter** fell back to the line's present | starts at the followed session's own clock | `sockets/sessions.ts` |
| a seated `deceased` member's lore was its own seat's | reads as background (§8 **background member**) | `prompt/characterLore.ts`, `runtime/host.ts` |
| `core:var/current-date@1` described as the lorebook's clock; §8 said `currentDate` read the line's clock | the session's story now (§8 **story calendar** · **story clock**) | `sdk/src/variables.ts` |
| compile could pass one scene's summary through unchanged | always merges through the model (owner, "Always merge via the model") | `utils/summarizer/index.ts` |
| **cairn** history entries; `loreFallen`; `DUNGEON_CRAWLER_ENTRY_TYPES.fallen`; the `channel.story.fallen` query | retired (§23); 🚧 **the fallen** (`progress.fallen`) and the rest of §9 **the fallen** | `core-catalog/src/genres/dungeon-crawler/*`, `registry/genres.ts`, `shared/annexField.ts`, `seed/prompts.ts`; boot pass `dc-cairns` (hist-D2) |
| **crawl time** (`crawl-time` host-state `time` declaration) | retired (§23); the session's story clock | `registry/hostState.ts`, `registry/slots.ts`; boot pass `dc-crawl-clock` (hist-D2) |
```

## Checks before you report

- `grep -c` each new first-cell name: each appears exactly once as a row's first cell in §4, §8, §9 or §23.
- Grep the code for each identifier you placed (`src/lib`, `../serene-pub-sdk/*/src`); list any that don't exist as written (D2's `dc-cairns`/`dc-crawl-clock` may not exist yet: say so, don't change them).
- R1: grep NOMENCLATURE for `scene note`, `owning line`, `day's entry`, `the fallen`, `scenes first` and report any other row that uses one of them in a different meaning.
- `git diff --stat NOMENCLATURE.md` before and after: your change adds about 14 lines and modifies 3.

## Out of scope (write down, never build)

Code, tests, the SDK, docs, STYLE-GUIDE.md. Any row not listed here. Benched seats.

## Stop and ask when

An anchor row isn't where described or its text differs from what's quoted; an identifier doesn't exist in the code; you find an R1 collision. Report it; don't improvise a name.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: don't run one.)
- Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write`.
- Scratch files start with `hist-F-w2-`.

## Done means

Every row above placed exactly once, the three amendments made, the §25 block in place; the checks above run.

## Report

Write `plans/briefs/REPORT-hist-F-w2.md` (if the harness refuses, put it in your final message): each insertion with its line number, the amendments, the check results (missing identifiers, collisions), Noticed-not-done.
