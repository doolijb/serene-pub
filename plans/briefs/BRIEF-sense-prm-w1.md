# BRIEF — sense-prm worker 1 — the SDK half: query, variable, prompt block, assemble in-port, genre wiring

Supervisor: lane `sense-prm` (`plans/briefs/BRIEF-sense-prm.md`, read its "The rule to build" and Build items 1, 2, 4
for context; this brief is your contract). SDK repo: `/home/jody/github/serene-pub-sdk`. App repo:
`/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

A reply's prompt gains one block, 🚧 *Earlier in the story*, holding the summaries of this session's closed
main-channel scenes whose lines are no longer in the prompt. The app (another worker) reads the scenes and fits the
block. **You build the SDK declarations and wire the core genres.** Nothing renders here; you declare and wire.

## Build, exactly

1. **`contracts/src/queries.ts` — new query** `export const earlierScenes = pin(describeQueryDefinition({...}))`,
   placed right after `sceneSummaryDue` (~1335). Model it on `sceneSummaryDue` and on `sessionHistory`'s `budget`
   port (~260–281).
   - `id: 'core:query/earlier-scenes@1'`, `i18n: { name: { en: 'Earlier scenes' } }`, `timeoutMs: 2000`.
   - One param in a `params` slot (`kind: 'parameters'`, `facet: 'weights'`):
     `share: { type: 'number', min: 0, max: 1, default: 0.15, label: { en: 'Share — earlier scenes' },
     description: { en: 'How much of the context window the summaries of earlier scenes may take. When they do not fit, the oldest are left out first.' } }`.
     (If `max` is not a supported key on a number field, drop it and say so.)
   - Ports: `in: { scope: S.sessionScope, budget: S.budget }`, `out: { main: S.json }`.
   - JSDoc (🚧, `@experimental`) stating: `main` is `{ maxTokens: number | null, scenes: Array<{ sceneId: number,
     name: string, summary: string, firstLineId: number }> }` — the session's closed `main`-channel scenes with a
     usable summary (`summaryStatus = 'done'`, a person's or the routine's) that are not compiled into a history
     entry, in story order (oldest first, by where each scene starts: its opening line, else its smallest selected
     line), at most the newest 200; `name` is the scene's name as shown; `firstLineId` is its first line's message
     id. `maxTokens` is `floor(share × budget.total)`, or `null` when `budget` is unwired (then the block is not
     capped). It returns data, never rendered text: `core:task/assemble@2` decides which scenes show (only those
     whose first line is older than the first line the prompt keeps) and fits them to `maxTokens`. Say what it is
     **not**: not `core:query/scene-summary-due@1` (the routine's look, one scene), not `core:spec/scene-summaries`
     (the routine that writes the summaries), not `core:query/session-history@1`. A query writes nothing.
   - Do not export a new TypeScript type for the shape; the JSDoc carries it.

2. **`contracts/src/tasks.ts` — `core:task/assemble@2`, additive only** (~1191–1460):
   - `ports.in.earlierScenes: S.json` with a JSDoc: optional; fed only by `core:query/earlier-scenes@1`'s `main`;
     unwired, the block is empty and the prompt is what it was; the binding renders into `earlierScenes` only the
     scenes whose first line is older than the first line the prompt keeps, newest first under `maxTokens`, and its
     transcript fit counts the block.
   - `slots.variables.renders.earlierScenes: 'core:var/earlier-scenes@1'` (beside `history`).
   - `ASSEMBLE_TEMPLATE_SCOPE.earlierScenes: { type: 'string', optional: true, description: 'The summaries of earlier scenes whose lines are no longer in the prompt, laid out.' }` (beside `history`).
   - Nothing else in `tasks.ts` changes. No other node definition is touched.

3. **`sdk/src/variables.ts` — new variable** right after `varHistory` (~478):
   `export const varEarlierScenes = defineVariable({ id: 'core:var/earlier-scenes@1', i18n: { name: { en: 'Earlier in the story' } }, description: { en: "The summaries of this session's finished scenes whose lines are no longer in the prompt, oldest first, each with its scene's name." }, scope: { earlierScenes: { type: 'list', of: { type: 'object', fields: { name: { type: 'string', description: { en: "The scene's name, as shown." } }, summary: { type: 'string', description: { en: "The scene's summary." } } } } } }, sample: [ { name: 'Scene 1 · The ferry', summary: 'Ash and Rell crossed the river at dusk and lost the mule to the current.' }, { name: 'Scene 2 · Greyford', summary: 'In Greyford the reeve refused them lodging until Rell paid in salt.' } ] })`
   with `/** @experimental */` and a short comment. Check that it is exported from the package index the same way
   `varHistory` is (follow `varHistory` everywhere it is listed in the SDK: index exports, any `allVariables`-style
   list, any doc listing; if a list lives in a file outside **Files owned**, stop and say which).

4. **`sdk/src/promptBlocks.ts`**:
   - `SHIPPED_PROMPT_BLOCK_IDS`: insert `'earlierScenes'` **after `'history'`, before `'relationshipsPerspectives'`**.
   - `BLOCK_LABELS.earlierScenes: 'Earlier in the story'`.
   - `isShippedPromptBlocks`: a stored list equal, entry for entry (same rule: same ids, none `enabled: false`), to
     the shipped list **without `earlierScenes`** (the ten ids as they were before this change) still answers
     `true`. Keep that previous list as an `@internal` constant `PREVIOUS_SHIPPED_PROMPT_BLOCK_IDS` with a comment:
     a stored list from before the block was added means "leave the template alone", so the shipped template
     renders the block in its place; a list a person reordered or switched a block off in is not "shipped" and
     does not get the block by itself (the docs say how to add it). Update the module comment on the order (the
     block sits after history, before the relationships, for comprehension: compiled history, then the later scenes,
     then the lines).
   - Nothing else changes in `resolvePromptBlocks` / `PROMPT_BLOCKS_DECL`.

5. **Core genres wire it** (`core-catalog/src/genres/`). Re-read each cited range first.
   - **Story reply** `story/respond.ts`: in the `gather` (`mode: 'parallel'`, ~548–600) add a chain
     `.chain('earlierScenes', (c) => c.query('read', ($) => C.earlierScenes.v1({ scope: $.input.sessionScope, budget: $.contextBudget.available, params: slot.params() })))`
     beside `history`, with a short comment (the summaries of scenes whose lines left the window; the fit is
     `prompt`'s). On the `prompt` assemble (~1181) add `earlierScenes: $.gather.earlierScenes.read.main`.
     Do not gate it on `reading` (reply duties); the summaries are the session's own.
   - **Story Narrate** `story/narrate.ts` (~293–320 reads, ~580 assemble) and **the side-character turn**
     `story/narrateCharacter.ts` (~212–235, ~471): add an `earlierScenes` query node beside the history read the
     same way (`scope`, `budget: $.contextBudget.available`, `params: slot.params()`), and the in-port on their
     `prompt` assemble. Follow each file's own node shapes (a plain `.query(...)` if there is no gather).
   - **Dungeon Crawler Narrator** `dungeon-crawler/story.ts` (~1606–1660, the `told` chain → `prompt`): it has no
     budget and no fit. Add, before the query, a context budget for the Narrator's own model:
     `.task('sceneBudget', ($) => C.contextBudget.v1({ sampling: slot.samplingOf(sibling($.context, 'say')), connection: slot.connectionOf(sibling($.context, 'say')), params: slot.params() }))`
     — copy the exact `samplingOf`/`connectionOf`/`sibling` forms the file already uses for `say` (re-read; adjust
     the reference to whatever the file's existing `connection: slot.connectionOf(sibling($.context, 'say'))` uses),
     then `.query('earlierScenes', ($) => C.earlierScenes.v1({ scope: $.input.sessionScope, budget: $.sceneBudget.available, params: slot.params() }))`,
     and `earlierScenes: $.earlierScenes.main` on the Narrator's `prompt` assemble. Do **not** wire `budget` into the
     Narrator's assemble (it stays without a fit). Comment why: the budget sizes only the block's share. Give both
     steps the `telling` expose the neighbours use if they take one. If the step order makes `$.context` unreachable
     where you need it, place the two steps where it is reachable and say where.
   - **`dungeon-crawler/calls.ts`** `DUNGEON_CRAWLER_NARRATE_TEMPLATE` (~57–102): after the `scenario` block and
     before `{{/systemBlock}}`, with no blank line, add
     `{{#if earlierScenes}}\n{{{earlierScenes}}}\n{{/if}}` so the template renders byte-identically when the block
     is empty. Update the template's comment in one clause.
   - **The Lair is not wired.** Do not touch `genres/lair/**`. Chat is not touched.

## Words (binding)

- It is a **session**, never a *chat* (Chat is only a genre's name). "Compile" means scenes → a history entry and is
  never used for this. "Read the scene" (`reply-duties`' `scene`) means the place: do not reuse it.
- Every new name above is 🚧 provisional; mark comments 🚧.
- No reference to any other project or product in code, comments, tests or docs.

## Files owned (edit only these)

`contracts/src/queries.ts`, `contracts/src/tasks.ts` (only the three additive edits in item 2),
`sdk/src/variables.ts`, `sdk/src/promptBlocks.ts`, `core-catalog/src/genres/story/respond.ts`,
`core-catalog/src/genres/story/narrate.ts`, `core-catalog/src/genres/story/narrateCharacter.ts`,
`core-catalog/src/genres/dungeon-crawler/story.ts`, `core-catalog/src/genres/dungeon-crawler/calls.ts`,
and an SDK index file **only** if `varHistory`/`sceneSummaryDue` are listed there explicitly (say so).

## Files readable

Anything in either repo. Useful: `contracts/src/queries.ts` `sessionHistory` and `sceneSummaryDue`;
`core-catalog/src/shared/sceneSummaries.ts` (how a query with `params: slot.params()` is wired);
`sdk-tests/coreCatalog.test.ts`, `sdk-tests/dungeonCrawlerStory.test.ts` (what they assert).

## Out of scope

Docs (`INTEGRATING.md`, guides): the supervisor writes them. The Lair, Chat, `session-history`, the lore queries,
any setting, toggle, duty or migration. Re-pinning hashes (the lead re-pins). Any app file.

## Stop and ask when

A published SDK name, port or result shape would change or go (the additions above are additive); a list you must
extend lives outside Files owned; `max` on a number field or `S.json` on an in-port is refused by the SDK's own
validation in a way you cannot satisfy with the shapes above; `$.context` / `$.contextBudget` is not reachable where
the wiring must go.

## Rules (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` anything.
- Re-read the cited lines before changing anything. Do what is asked, at the size asked. Findings along the way go
  under **Noticed, not done**, never fixed in passing.

**Do not run `npm run sdk:build` and do not run SDK tests**: the supervisor runs the one build after you finish.
You may run `npx prettier --check <file>` on each file you changed (the SDK uses its own prettier config; match the
file's existing style: tabs, single quotes, no semicolons).

## Done means

Every edit above in place; each changed file passes `npx prettier --check`; your report lists, per file, what you
changed (with the new node keys and port refs exactly as written), anything you could not do and why, and
**Noticed, not done**.

## Report

Return your report as your final message (the supervisor reads it; do not write a report file).
