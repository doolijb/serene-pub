# REPORT — build lane `sense-prm` — 2026-11-12

Brief: `plans/briefs/BRIEF-sense-prm.md` (cold review folded in before the build). Saved by the lead from the
supervisor's report. **Status:** built as briefed, nothing stopped; no migration, no data pass; every published SDK
change is additive.

## The rule as built

- A template can place one block, `{{{earlierScenes}}}` (🚧 *Earlier in the story*): the summaries of this
  session's closed main-channel scenes that lost at least one line from the prompt
  (`sceneStartOf(scene) < firstKeptLineId`), oldest first, each with its shown name.
- A scene counts only when `summaryStatus = 'done'` (a person's or the routine's) and `history_entry_id IS NULL`. A
  scene made by selecting lines counts from its smallest selected line. A summary that is running, in review,
  failed, out of date, never written or reset by Back is absent, and the scenes around it still show; Forward
  brings a reset one back.
- `core:query/earlier-scenes@1` (`C.earlierScenes`) returns the eligible scenes as data (at most the newest 200)
  and `maxTokens = floor(share × budget.total)` (`share` 0.15; `null` with no budget).
- Assemble@2 (new optional in-port `earlierScenes`) decides per render, from the lines that render keeps: only
  scenes older than the first kept line; the newest that fit under `maxTokens`, oldest dropped first. A voice with
  no fit uses the first line it was given. No line is cut because a summary exists; with no eligible scene the
  prompt is byte-identical to before (tested).
- `planTranscriptCut` counts the block (`earlier: { scenes, maxTokens, measured }`) in the held scan and the fresh
  loop, so a cut is judged on what will really render; the 4-pass bound stands. Tested: lines cut with the block
  exceed those without it by at most `maxTokens` plus one line; over 20 and 9 turns the first kept line never
  moves on two turns running.
- Rendered (system block, straight after history): `Earlier in the story:` then a JSON list of
  `{ "name", "summary" }`.
- Wired: Story's reply, Narrate and the side-character turn; the Dungeon Crawler's Narrator (and its goal spec,
  which shares that branch). **The Lair is not wired** (the Sanctum's promise to the keeper). Chat untouched.
- Prompt blocks: `earlierScenes` after `history` in `SHIPPED_PROMPT_BLOCK_IDS` and the Default template;
  `isShippedPromptBlocks` also accepts the old ten-id list (`PREVIOUS_SHIPPED_PROMPT_BLOCK_IDS`); a list a person
  customised does not get the block by itself. The Default row is refreshed at boot by its seed key; a person's
  own template is untouched; a third seed changes nothing (tested).
- P1: the run's receipt notes say when summaries are in the prompt, why, and how to stop it (*Leave Earlier in the
  story out under Prompt blocks*).

## Names (all 🚧)

`core:query/earlier-scenes@1`, param `share`; `core:var/earlier-scenes@1` (`varEarlierScenes`); block id and
Assemble in-port `earlierScenes`; app `earlierScenesOf`, `EarlierScene`, `EARLIER_SCENES_MOST`,
`earlierScenesShown`, `earlierBlockTokens`, `EARLIER_SCENES_BLOCK_TOKENS`, `EarlierSceneCost`; SDK
`PREVIOUS_SHIPPED_PROMPT_BLOCK_IDS`; Dungeon Crawler step `sceneBudget`.

## Changed files

SDK: `contracts/src/queries.ts`, `contracts/src/tasks.ts`, `sdk/src/variables.ts`, `sdk/src/promptBlocks.ts`,
`core-catalog/src/genres/story/{respond,narrate,narrateCharacter}.ts`,
`core-catalog/src/genres/dungeon-crawler/{story,calls}.ts`, `sdk-tests/bands.test.ts`, `INTEGRATING.md` §1n,
`guides/extending.md`.
App: new `scenes/earlierScenes.ts` (+ int test); `pipelines/prompt/transcriptFit.ts`, `assemble.ts`,
`promptTypes.ts`, `liquidParity.fixtures.ts`; `pipelines/runtime/bindings.ts`;
`pipelines/entities/contextTemplateDefaults.ts`, `variableLayouts.ts`; new
`boot/seedContextTemplates.int.test.ts`, `runtime/earlierScenesQuery.int.test.ts`; edited tests
(`assembleTranscriptFit.int`, `cachePrefix`, `promptBlocks`, `contextTemplateWrappers`,
`variableTemplates.parity`, `shared/utils/templateValidation.test.ts`); docs `context-templates`,
`summarization`, `sessions`, `pipelines`, `genre-story`, `genre-lair`, `genre-dungeon-crawler`; NOMENCLATURE §15,
§25. Worker briefs `plans/briefs/BRIEF-sense-prm-w1…w3.md`.

## Open ★

- **★PRM-1** The Dungeon Crawler's Narrator gained a `sceneBudget` context-budget step feeding only the query, so
  its block is capped (the brief gave that voice no budget; uncapped would be up to 200 summaries). Cost: one more
  step in the pipeline panel with its safety-margin control. Lead: accepted as built.
- Customised Prompt blocks lists do not get the block by themselves.
- A compiled scene leaves the block and is then read only by keyword retrieval (the lorebook lane's question).
- A branch has no summaries for the story before its fork (the branch-cut lane).
- The Lair: wire only while Sanctum steering is on, stop its summarizer reading the Sanctum, or wire always.
- A summary is not filtered by who was present. Side channels have no scenes.
- **★PRM-2** receipt-note wording (provisional, as all copy).

## Noticed, not done

Prettier drift in touched files; `earlierScenesOf` maps a null scene name to `""`; the Prompt blocks editor likely
shows a stored old ten-id list as changed against the new default (unchecked); the `guides/extending.md` edit was
made after the build (the next `sdk:build` carries it); a worker's contrast test asserts one of three outcomes.

## Verification (lead, 2026-11-12)

Re-pinned: `story-respond@1.21.0` → `12007bbfaccef3`, `story-side-character@1.0.0` → `96a5d6e7ab8c5`,
`story-narrate@1.11.0` → `11626bcaa736fa`, `dungeon-crawler-respond@1.0.0` → `9539a78373383`,
`dungeon-crawler-goal@1.0.0` → `f76fb724eef6d`; `core:task/assemble@2` → `77b5ad64835be`; new
`core:query/earlier-scenes@1` `baf88f0f6b87b`; SDK digest → `1711e7316b52542f`. SDK `coreCatalog` 5/5, `bands`
40/40, `dungeonCrawlerStory` 27/27, `assembleWiring` 11/11. App: 70 files, 1104 of 1106 tests pass; the two
failures (`boot/paramsSlotWiring.test.ts`) are the speech work's (`core:spec/speak-message` leaves two slots
unwired). `tsc` clean. Scope review: pending.
