# BRIEF — sense-prm worker 3 — the app integration: the query binding, Assemble renders and fits the block, and the lane's tests

Supervisor: lane `sense-prm` (`plans/briefs/BRIEF-sense-prm.md`; read "The rule to build" and Build items 1–3 and 5;
this brief is your contract). App repo `/home/jody/github/serene-pub`. **The SDK is built** with the new names
(do not rebuild it). Two earlier workers already landed (read their files before you start; do not redo them):

- SDK: `core:query/earlier-scenes@1` (`C.earlierScenes`; param `share`, default 0.15; ports `in: { scope, budget }`,
  `out: { main }`); `core:task/assemble@2` gained the optional in-port `earlierScenes: S.json`, a `renders` entry
  `earlierScenes: 'core:var/earlier-scenes@1'` and `ASSEMBLE_TEMPLATE_SCOPE.earlierScenes` (a laid-out string);
  `core:var/earlier-scenes@1` (`varEarlierScenes`, scope `earlierScenes: list of { name, summary }`);
  `SHIPPED_PROMPT_BLOCK_IDS` has `earlierScenes` after `history`; `isShippedPromptBlocks` also accepts the previous
  ten-id list. Story's reply wires `earlierScenes: $.gather.earlierScenes.read.main` into `prompt`; Narrate and the
  side-character turn wire `$.earlierScenes.main`; the Dungeon Crawler Narrator wires the query with its own
  `contextBudget` (`sceneBudget`) and **no** `budget` into its assemble (it has no fit).
- App: `src/lib/server/scenes/earlierScenes.ts` (`earlierScenesOf(db, sessionId)` → `EarlierScene[]`
  `{ sceneId, name, summary, firstLineId }`, oldest first, at most 200); `prompt/transcriptFit.ts`
  (`EARLIER_SCENES_BLOCK_TOKENS`, `EarlierSceneCost`, `earlierScenesShown`, `earlierBlockTokens`, and
  `planTranscriptCut`'s optional `earlier: { scenes, maxTokens, measured }`); the Default template has the block
  after `history` (`entities/contextTemplateDefaults.ts`); the layout row `core:var/earlier-scenes@1` in
  `entities/variableLayouts.ts` (JSON content, *Titled JSON block* wrapper headed `Earlier in the story:`); the
  Liquid twin in `prompt/liquidParity.fixtures.ts`; `boot/seedContextTemplates.int.test.ts`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## The rule (owner-ruled; build exactly this)

A reply's prompt gains one block, 🚧 *Earlier in the story*, holding the summaries of this session's closed
main-channel scenes **any of whose lines are no longer in the prompt** (`sceneStartOf(scene) < firstKeptLineId`),
oldest first, each under its scene's name, only scenes with `summaryStatus = 'done'` and no history entry. The block
has its own share of the budget (`maxTokens`); when the summaries do not fit, the oldest are left out first. No line
is cut because a summary exists. A session with no eligible scene renders a prompt **byte-identical** to today's.

## Build, exactly

### 1. The query binding — `src/lib/server/pipelines/runtime/bindings.ts`

Beside `"core:query/scene-summary-due@1"` (~8519), add `"core:query/earlier-scenes@1": reads<typeof C.earlierScenes>(…, { ports: ["scope", "budget"], params: ["share"] })`
in the same style (dynamic `await import` of `$lib/server/db` and `$lib/server/scenes/earlierScenes`; a halt
sentence when the run is not scoped to a session: `"there is no session to read earlier scenes from — the run is not scoped to a session"`).
`share`: a finite number in `[0, 1]`, else 0.15. `maxTokens = floor(share × budget.total)` when `budget.total` is a
positive finite number, else `null`. Return `ok({ main: { maxTokens, scenes } })` with `scenes` from
`earlierScenesOf`. A short 🚧 doc comment. Writes nothing.

### 2. Assemble renders the block — `src/lib/server/pipelines/prompt/assemble.ts` (and `promptTypes.ts` if a context type lists keys)

- `RenderInput.earlierScenes?: ReadonlyArray<{ name: string; summary: string }>` (doc: the scenes the binding chose,
  oldest first; absent or empty renders nothing).
- Laid out like `currentDate` (~797–805): `const earlierScenesLaidOut = await layout("earlierScenes", input.earlierScenes?.length ? input.earlierScenes : undefined)`;
  on the context as `earlierScenes`; add `"earlierScenes"` wherever `currentDate` is listed as a laid-out key (the
  `laidOutSafeFor` key list, `prepareExplicitLayouts`'s `inUse`, `CORE_RENDERED_BANDS`-style lists only if
  `currentDate` is in them). Find every place in `src/lib/server/pipelines/prompt/` and `entities/` that names
  `currentDate` as one of Assemble's own keys and mirror it for `earlierScenes` **inside Files owned**; list any
  place outside Files owned that needs it (do not edit it).
- An empty block must print nothing: with no scenes the rendered prompt is byte-identical to a render without the
  field.

### 3. Assemble chooses the scenes and the fit counts the block — the `"core:task/assemble@2"` binding (~5851–6330)

- Read `input?.earlierScenes`; accept only `{ maxTokens: number | null, scenes: Array<{ name: string, summary: string, firstLineId: number }> }`
  (drop malformed entries; a malformed whole reads as no block). Add `"earlierScenes"` to the binding's `reads`
  `ports` list.
- Cost of one scene: `count(JSON.stringify({ name, summary }))` with the run's counter (`ctx.countTokens`), else
  `Math.ceil(length / 4)` when there is no counter.
- `renderWith(lines, …)` (~6080) derives the first kept line from the lines it is handed: the id of the first line
  in `lines` that passes `isCuttableLine`, else `Infinity`; it passes
  `earlierScenes: earlierScenesShown(scenes, firstKept, maxTokens, cost).map(({ name, summary }) => ({ name, summary }))`
  to `render`. So the media fit, the first render and every pass all show the block that matches their lines, and a
  voice with **no** fit (no `budget`) shows the block for the first line it was given.
- Both `planTranscriptCut` calls (~6200 and ~6265) pass
  `earlier: { scenes: <each eligible scene as { firstLineId, tokens: cost }>, maxTokens, measured: earlierBlockTokens(<the scenes shown in the render being measured>, cost) }`
  when the port carried scenes; absent otherwise (then the plan is exactly today's). The 4-pass bound stays.
- **Receipt note (P1: every automatic action shows its cause and how to switch it off).** When at least one scene
  qualified for the final render (lost a line), push one note onto `rendered.notes` after the transcript note, worded
  exactly (🚧 provisional copy):
  - some shown, none left out: `earlier scenes: the summaries of N scene(s) are in the prompt (‹names, joined with ", "›), because some of their lines are no longer in it. Leave Earlier in the story out under Prompt blocks to stop it.`
  - some shown and M older left out: the first sentence, then ` M older one(s) were left out to keep the block within its share of the window (‹maxTokens› tokens).`, then the last sentence.
  - none fit: `earlier scenes: N scene(s) lost lines from the prompt, but none of their summaries fit the block's share of the window (‹maxTokens› tokens). Leave Earlier in the story out under Prompt blocks to stop it.`
  Use the singular/plural forms the file's existing notes use (`line was` / `lines were`): `1 scene` / `N scenes`,
  `1 older one was` / `M older ones were`. No note when no scene qualified, so the ordinary payload is unchanged.

### 4. Tests (all inside Files owned)

Write the new cases in the existing files where they belong; follow each file's setup.

- `src/lib/server/pipelines/runtime/assembleTranscriptFit.int.test.ts` (the binding, end to end):
  a. With scenes on the port and no cut: only scenes whose `firstLineId` is older than the first line given show
     (a scene starting at or after it does not); the block renders under `Earlier in the story:` after history.
  b. With a cut: a scene that lost only its opening line shows; scenes wholly in the kept lines do not.
  c. Cap: with `maxTokens` small, the newest that fit show and the oldest are left out; the receipt note says so.
  d. **Over N turns in the band the prompt keeps the same first line** with the block counted (model it on the
     existing "keeps the same first line on the next turn while it still fits"): drive ≥ 8 turns that each add a
     line, with eligible scenes in the cut zone, and assert the first kept line changes only when the conversation
     outgrows the cut (not most turns) and every prompt fits the budget.
  e. No `earlierScenes` on the port, and a port with `scenes: []`: the rendered prompt is byte-identical to a render
     without the field, and no earlier-scenes note.
  f. No `budget` (no fit): the block shows the scenes older than the first line given.
  g. The held cut (`HELD`) still works with the block: a second turn keeps the first turn's cut.
- `src/lib/server/pipelines/prompt/cachePrefix.test.ts`: (i) turn N+1's prompt starts with turn N's when no scene
  left the transcript, with eligible scenes present; (ii) when one did (the first kept line moved past a scene's
  start), the two prompts are equal up to the block and differ first inside the block.
- `src/lib/server/pipelines/prompt/promptBlocks.test.ts`: the template ↔ `SHIPPED_PROMPT_BLOCK_IDS` check holds with
  the new block; a stored list equal to the previous ten (shipped without `earlierScenes`) counts as shipped
  (`isShippedPromptBlocks`) and the render keeps the block in its shipped place; a list a person reordered or
  switched a block off in does not get the block (it is dropped, as any unlisted block is).
- Story Minimal prints nothing: Story Minimal keeps the node (it is Story's spec) and simply has no summarized
  scenes. Prove the cheapest honest way: the query binding on a session with no `done` scene returns `scenes: []`,
  and the assemble binding with that port renders byte-identically to no port. If there is a light way to assert
  that Story Minimal's resolved reply spec contains the `earlierScenes` query, add it; else say so.
- `src/lib/server/pipelines/runtime/earlierScenesQuery.int.test.ts` (new, or fold into an existing bindings int
  test): the binding returns `maxTokens = floor(0.15 × total)` by default, honours `share`, gives `null` with no
  budget, and halts with the sentence on an unscoped run.
- Fix, do not weaken: `parity/contextTemplateWrappers.test.ts` (it rebuilds 0.5's template from 0.6's: the new block
  has no 0.5 counterpart, so remove it in the rebuild the way the test already treats other 0.6-only blocks, if
  any, and say how); `entities/variableTemplates.parity.test.ts` (hard-coded key lists need `earlierScenes`; give
  its shaped/list cases `{ name, summary }` objects for this variable — worker 2 found the generic list case drops
  `summary`).

### 5. Run (one run at a time, capped, to a log) and report

`prompt/cachePrefix.test.ts`, `prompt/promptBlocks.test.ts`, `parity/contextTemplateWrappers.test.ts`,
`entities/variableTemplates.parity.test.ts`, `runtime/historyWindow.int.test.ts`,
`runtime/assembleTranscriptFit.int.test.ts`, `boot/paramsSlotWiring.test.ts`, `prompt/transcriptFit.test.ts`,
`prompt/liquidParity.test.ts`, `prompt/assemble.test.ts`, `config/promptBlocks.int.test.ts`,
`src/lib/shared/utils/templateValidation.test.ts`, `src/lib/shared/utils/contextConfigCards.templateFields.test.ts`,
`src/lib/shared/utils/docsContextTemplate.test.ts`, `scenes/earlierScenes.int.test.ts`,
`boot/seedContextTemplates.int.test.ts`, your new test files; then **once**, read-only for the report,
`boot/specHashes.test.ts` and `boot/registryHashes.test.ts`: **do not re-pin**; list every pin that moved with its
id/name and new value. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report errors in files
you or the earlier workers touched; list others as not ours).

## Words (binding)

It is a **session**, never a *chat* (Chat is only a genre's name). "Compile" means scenes → a history entry and is
never used for this. "Read the scene" means the place. No reference to any other project or product anywhere.
Every new name is 🚧.

## Files owned (edit or create only these)

`src/lib/server/pipelines/runtime/bindings.ts` (the new query binding and the assemble binding only),
`src/lib/server/pipelines/prompt/assemble.ts`, `src/lib/server/pipelines/prompt/promptTypes.ts`,
`src/lib/server/pipelines/prompt/transcriptFit.ts` (only if a helper is missing; say why),
`src/lib/server/pipelines/prompt/promptBlocks.ts` (only if a test proves it needs a change; it has bytes the Edit
tool calls binary: change it with a careful shell edit or report instead),
the test files named in item 4 and `src/lib/server/pipelines/runtime/earlierScenesQuery.int.test.ts` (new).

## Files readable

Anything. Other sessions have uncommitted work across the tree (`sockets/scenes.ts`, `scenes/`, socket auth, image
adapters, client components): leave it alone, and do not "fix" failures that are theirs; list them. Known unrelated
failure: `db/dataUpgrades/0108_layering_registrations.int.test.ts`.

## Out of scope

Docs, NOMENCLATURE, the SDK, `host.ts`, `world.ts`, `session-history`, retrieval, the summarizer, the Lair, Chat,
any setting, toggle, duty or migration, re-pinning hashes.

## Stop and ask when

A published SDK name, port or result shape would need to change; the fit cannot be kept convergent within the
4-pass bound without changing how lines are cut; a file outside Files owned must change (`world.ts`, `host.ts`, a
shelf mapping…): report which and why instead; a migration or data pass seems needed.

## Rules (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`.
  Inside `db.transaction(async (tx) => …)` use only `tx`. Do not start a dev server. **Do not run `npm run sdk:build`.**
- Run only targeted test files, in a capped scope, one run at a time, output to a log (never pipe vitest into `head`):
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/sense-prm-w3-<name>.log 2>&1"`
  then read the log. An int test that opens a DB inside an `it` needs a 60 s timeout.
- `npx prettier --check <file>` on each file you changed (only those files; if one was already unformatted before
  you, say so rather than reformatting it).
- Re-read the cited lines before changing anything. Do what is asked, at the size asked. Findings go under
  **Noticed, not done**, never fixed in passing.

## Done means

Every test file in item 5 passes (other sessions' failures listed as theirs); `tsc` clean for the lane's files;
moved pins listed with new values; your report lists each changed file with what changed, the exact receipt-note
wording as built, one rendered example of the block (copied from a test's output), test names and results, anything
you could not do, and **Noticed, not done**.

## Report

Return your report as your final message (do not write a report file).
