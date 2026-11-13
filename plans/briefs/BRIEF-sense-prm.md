# BRIEF — build lane `sense-prm` — a reply reads the summaries of earlier scenes

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then, in full:
`plans/REPORT-sense-sum-2026-11-12.md` (the routine that saves scene summaries, and what "saved by the routine"
means for Back), `plans/DESIGN-e-scenes-2026-11-12.md` (★E5 and the owner's answer), `docs/context-templates.md`
(the default template, variables, layouts, "How entries and older messages are chosen"), `docs/summarization.md`,
`../serene-pub-sdk/INTEGRATING.md` (the steps for a new query and a new variable), CLAUDE.md Hard rules, Principles
and "0.6 is in users' hands", NOMENCLATURE §1, §23, §24, §25. `plans/briefs/BRIEF-sense-clk.md`'s **Verbatim
rules** bind you and your workers. Line numbers below are from an inventory on 2026-11-12: re-read before editing.

Words. A **build lane** is this stream of work; a **channel** is a session's message channel. "Compile" means
scenes → a history entry and is not this. "Read the scene" (`reply-duties`' `scene`) means the **place**, not a
scene row: do not reuse it.

## Rulings that bind (owner)

- Scene summaries in the reply's prompt: "Yes, as its own lane next".
- Model comprehension and replies faithful to the characters and the prompt come first.
- "Core does nothing unless declared." Seamless by default; no new setting.
- "Sessions own scene compilation. Books own history entry compilation and graphs."
- "You're over complicating it": take the plainer shape and say so.

## The gap, in one example

A long Story session: scenes 1–9 are closed and summarized, the transcript budget holds only the lines of scenes
8–10. Today the model sees nothing of scenes 1–7 unless a person compiled them into a history entry **and** a
keyword happens to match. The summaries the routine now saves are read by nobody.

## The rule to build, in four sentences

When a reply's prompt is assembled, it gains one block, 🚧 *Earlier in the story:*, holding the summaries of this
session's closed main-channel scenes **any of whose lines are no longer in the prompt**, oldest first, each under
its scene's name. A scene is in the block only when it has a usable summary (`summaryStatus = 'done'`, a person's or the
routine's) and has not been compiled into a history entry (`history_entry_id IS NULL`: once compiled it is the
lorebook's, and reaches the prompt as history does today). The block has its own share of the context budget; when
the summaries do not fit, the oldest are left out first. Nothing else about what the model reads changes: no line
is cut because a summary exists.

## Build

1. **A query that reads the scenes (SDK contracts + app binding).** 🚧 `core:query/earlier-scenes@1` (*Earlier
   scenes*; check §23/§24 and say what you chose; never `scene-summaries`, which is the routine's spec). Scope
   in-port; one declared param, the block's share of the budget (🚧 `share`, default 0.15), and a `budget` in-port
   like `session-history`'s. It returns the session's eligible scenes **as data**, in story order: for each, the
   name as shown (`sceneDisplayNames`), the summary, and the id of its **first** line (`sceneStartOf`). Eligible:
   this session's; channel `main`; closed; `summaryStatus = 'done'`; `history_entry_id IS NULL`. A scene made by
   selecting lines (no range) counts too: a person wrote or saved its summary, and `sceneStartOf` already gives its
   smallest selected id.
   Order by `sceneStartOf` (`scenes/historyEntryOfDate.ts` ~71), the story-order key; do not write a second
   ordering. One small host read in a new module under `src/lib/server/scenes/`, bound in
   `pipelines/runtime/bindings.ts`. Bounded: at most the newest 200 eligible scenes.
2. **A variable and its layout.** 🚧 `core:var/earlier-scenes@1` (`earlierScenes`), with a sample for the template
   preview, and shipped layout rows like `history`'s (`entities/variableLayouts.ts` ~758–771): a heading and, per
   scene, its name and summary. Add `earlierScenes` to `SHIPPED_PROMPT_BLOCK_IDS`
   (`../serene-pub-sdk/sdk/src/promptBlocks.ts` ~69–80) and to the Default context template
   (`contextTemplateDefaults.ts` ~95–203) **after `history` and before `relationshipsPerspectives`**, inside an
   `{{#if}}` so an empty block prints nothing. The position is chosen for comprehension (compiled history, then the
   later scenes, then the lines); it buys nothing for prefix reuse, since per-turn lore already sits earlier in the
   system block. `promptBlocks.test.ts` holds the template and the id list in step; keep it so.
   **Saved block lists.** `resolvePromptBlocks` drops a block the template produces that a saved list does not name
   (`../serene-pub-sdk/sdk/src/promptBlocks.ts` ~230–238), and `isShippedPromptBlocks` compares length (~166), so a
   stored list equal to the old ten would stop counting as shipped and `applyPromptBlocks` would start reordering
   custom templates (`prompt/assemble.ts` ~737). Required: a stored list that equals the shipped list **without
   `earlierScenes`** still counts as shipped and gets the block in its shipped place; test it. A list a person
   really reordered or switched blocks off in does not get the block by itself: add the docs line "add *Earlier in
   the story* under Prompt blocks" and carry it as a ★ (appending it automatically is a new behaviour). No data
   pass; if one seems needed, stop and ask. The shipped Default row is re-projected at boot when its
   source drifts (`boot/seedContextTemplates.ts`): confirm that path carries this edit to an existing install and
   that a second boot changes nothing, with a test.
3. **Assemble decides which scenes show, after the transcript is cut.** The scenes reach `core:task/assemble@2` as
   a new optional in-port (data, not rendered text). Assemble renders into the block only the scenes **whose first
   line is older than the first line the prompt keeps** (`sceneStartOf(scene) < firstKeptLineId`): any scene that
   lost a line to the cut is summarized. A cut is made in chunks of about a quarter of the budget with no regard to
   scene boundaries, so a scene can lose its opening and keep its tail; that scene's summary shows, and the model
   reads its tail twice, which is the cheaper mistake (comprehension first). Then the block's own budget: keep the
   newest summaries that fit `share` of the budget's total, dropping the oldest first, measured with the estimator
   the fit already uses.
   **The cut must count the block.** `planTranscriptCut` (`prompt/transcriptFit.ts` ~198–219) estimates a held or
   fresh cut from the first render, in which the block is nearly empty (the read goes two budgets back). Left
   uncounted, a held cut that "fits" goes over once the block fills, and the prompt's first line then moves on most
   turns, which is the shape the held cut exists to prevent. So pass `planTranscriptCut` each eligible scene's
   `(firstLineId, tokens)` and the share cap, and at each candidate first line add the block that line would
   produce (newest summaries under the cap), minus the block already measured. Held and fresh cuts are then judged
   on what will really render and the existing pass bound stands. Test: over N turns in that band the prompt keeps
   the same first line.
   A voice with **no** fit (no `budget` wired into assemble) uses the first line it was given as the first kept
   line.
4. **The core genres wire it (SDK core catalog).** Story's three voices that write the story: the reply
   (`genres/story/respond.ts`: the query beside `gather.history.read` ~563, the in-port on `prompt` ~1180), Narrate
   (`genres/story/narrate.ts` ~308, ~580) and the side-character turn (`genres/story/narrateCharacter.ts` ~226,
   ~471), so a character's reply and the narrator pressed on the next turn know the same story; and the Dungeon
   Crawler's Narrator (`genres/dungeon-crawler/story.ts` ~1636–
   1658: no fit; its own template `DUNGEON_CRAWLER_NARRATE_TEMPLATE`, `calls.ts` ~57–102, gains the block in the
   same relative place). Chat writes no scenes and is not touched. **The Lair is not wired in this lane**: its
   summaries read the keeper's Sanctum as asides (`genres/lair/summarizeScene.ts` ~46), the keeper is told "Only
   you see it: the party and anyone you invite never hear what we say here." (`registry/genres.ts` ~1169), and a
   summary the routine saved, which nobody reviewed, would carry that into every Narrate and character turn even
   with Sanctum steering off. Carry it as a ★. Story Minimal keeps the node (it is Story's
   spec) and simply has no summarized scenes, so the block is empty: test that it prints nothing.
5. **What must stay true**, each with a test:
   - A routine-saved summary that Back reset (`none`) leaves the block at once; Forward brings it back.
   - A scene being summarized, in review, failed, out of date (`none` with old text) or never summarized is absent,
     and the scenes around it still show (a gap is normal).
   - The prompt for turn N+1 still starts with the prompt for turn N when no scene left the transcript
     (`prompt/cachePrefix.test.ts`); when one did, the change is the block and nothing before it.
   - The held transcript cut (`HELD`) still works; the block never causes a line to be cut that would have been
     kept without it by more than the block's own share.
   - A session with no eligible scene renders a prompt byte-identical to today's.
6. **Docs and ledgers in the same change:** `docs/context-templates.md` (the default template, the variables
   table, "How entries and older messages are chosen"), `docs/summarization.md` (what a saved summary is for:
   today its opening claim is not true until this lands), `docs/sessions.md` ~99 (what the model sees),
   `docs/pipelines.md` ~259–278, `docs/genre-story.md` ~69, `docs/genre-lair.md`, `docs/genre-dungeon-crawler.md`
   ~241, the SDK guide that lists variables and prompt blocks, `INTEGRATING.md`, NOMENCLATURE rows with charters
   (P6) and §25.

## Open ★ to carry into the report (build nothing for them)

- **Compiled scenes.** A scene compiled into a history entry leaves the block and is then read only when the
  entry is retrieved by keyword. That is today's rule for history; whether history should be read in order instead
  is the lorebook's lane.
- **A branch session** has no scene rows for the lines copied from its original, so the story before the fork has
  no summaries in the block. The branch-cut lane owns that.
- **The Lair.** Not wired, for the Sanctum's promise to the keeper. Options for the owner: wire its story voices
  only while Sanctum steering is on; have the Lair's summarizer stop reading the Sanctum; or wire it always.
- **Who a summary is written for.** A summary is omniscient: it is not filtered by which characters were present.
- **Side channels** have no scenes of their own (main only).

## Files owned

SDK: `contracts/src/queries.ts`, `contracts/src/tasks.ts` (assemble@2's new optional in-port only),
`sdk/src/variables.ts`, `sdk/src/promptBlocks.ts`, `core-catalog/src/genres/story/respond.ts`,
`genres/story/narrate.ts`, `genres/story/narrateCharacter.ts`, `genres/dungeon-crawler/story.ts` and `calls.ts`,
tests, the guides named above.
App: a new module under `src/lib/server/scenes/`, `src/lib/server/pipelines/runtime/bindings.ts` (the new query
binding; assemble's binding for item 3), `src/lib/server/pipelines/prompt/` (`assemble.ts`, `transcriptFit.ts`,
`promptBlocks.ts` as item 3 needs), `src/lib/server/pipelines/entities/contextTemplateDefaults.ts`,
`entities/variableLayouts.ts`, `boot/seedContextTemplates.ts` only if the re-projection needs it, their tests, the
docs above.

## Out of scope

Cutting or shortening the transcript by scene; any change to `session-history`, the history read's size, the
lore ranker or history-entry retrieval; summaries of open scenes; cast or presence filtering; branches; side
channels; Chat; the Sanctum; any setting, toggle, duty or migration; the summarizer and its routine.

## Stop and ask when

A published SDK name, port or result **shape** would change or go (assemble@2 gaining an optional in-port is
additive: say so; anything else, stop); a migration or data pass is needed; the fit cannot be kept convergent
without changing how lines are cut; the Default template's re-projection would overwrite a template an admin has
edited; a genre's reply would need a new setting to stay as it is.

## Done means

The new tests and item 5's pass; `prompt/cachePrefix.test.ts`, `prompt/promptBlocks.test.ts`,
`parity/contextTemplateWrappers.test.ts`, `entities/variableTemplates.parity.test.ts`,
`runtime/historyWindow.int.test.ts`, `runtime/assembleTranscriptFit.int.test.ts`, `boot/paramsSlotWiring.test.ts`
pass; `npm run sdk:test` for the touched SDK tests; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`
clean. Tests run only inside `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx
vitest run --maxWorkers=3 …"`, never two runs at once. **One** `npm run sdk:build`, and only after
`pgrep -af "vite dev"` shows no serene-pub dev server; if one is up, finish the rest and report "blocked on your
dev server". Do not re-pin hashes: list every pin that moved (Story's three specs, the Dungeon Crawler's reply,
`assemble@2`, the SDK digest) and the lead re-pins.

## Report

**Return the full report as your final message**, after every worker has finished (the lead saves it as
`plans/REPORT-sense-prm-2026-11-12.md`): the rule as built in sentences a modder could read; one rendered example
of the block; names chosen and why; how the fit and the block interact, with the pass bound; what each genre's
voice now reads; provisional copy verbatim; changed files in each repo; tests and results; pins that moved; open
★; **Noticed, not done**.
