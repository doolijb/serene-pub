# BRIEF — sense-prm worker 2 — app parts that need no SDK build: the scenes read, the fit arithmetic, the template and layout, the seed test

Supervisor: lane `sense-prm` (`plans/briefs/BRIEF-sense-prm.md`; read "The rule to build" and Build items 1–3, 5
for context; this brief is your contract). App repo: `/home/jody/github/serene-pub`. Another worker is adding the
SDK half at the same time (query `core:query/earlier-scenes@1`, variable `core:var/earlier-scenes@1`, prompt block
id `earlierScenes`); the SDK is **not built yet**, so do not depend on new SDK exports, and do not run tests that
need them.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## The rule (owner-ruled; build exactly this)

When a reply's prompt is assembled it gains one block, 🚧 *Earlier in the story*, holding the summaries of this
session's closed main-channel scenes **any of whose lines are no longer in the prompt** (`sceneStartOf(scene) <
firstKeptLineId`), oldest first, each under its scene's name. A scene is in the block only when it has a usable
summary (`summaryStatus = 'done'`, a person's or the routine's) and has not been compiled into a history entry
(`history_entry_id IS NULL`). The block has its own share of the context budget; when the summaries do not fit, the
oldest are left out first. No line is cut because a summary exists. A session with no eligible scene renders a
prompt byte-identical to today's.

## Build, exactly

### A. The scenes read — new `src/lib/server/scenes/earlierScenes.ts`

```ts
/** 🚧 The most eligible scenes the read returns: the newest 200. */
export const EARLIER_SCENES_MOST = 200
export interface EarlierScene { sceneId: number; name: string; summary: string; firstLineId: number }
export async function earlierScenesOf(db: Db, sessionId: number): Promise<EarlierScene[]>
```
- Eligible: `scenes.session_id = sessionId`; `channel = 'main'`; `summary_status = 'done'`;
  `history_entry_id IS NULL`; summary not blank (trimmed); and either a closed range scene
  (`closed_at_message_id IS NOT NULL`) or a selection scene (`opened_at_message_id IS NULL` with a non-empty
  `selected_message_ids`). An open scene (opened, not closed) is never eligible.
- Order: story order by `sceneStartOf` (`src/lib/server/scenes/historyEntryOfDate.ts` ~71, the one scene-start
  rule; import it, never write a second ordering), ties by scene id; a scene whose start is `null` is dropped.
- Bounded: read ids + `opened_at_message_id` + `selected_message_ids` (no summary) for every eligible row, compute
  starts in code, keep the **newest 200** by start, then read name/summary/etc. for those ids only. Return oldest
  first.
- `name` is the name as shown: `sceneDisplayNames(db, rows)` (`src/lib/server/scenes/liveScenes.ts` ~661; dynamic
  `await import` as `sockets/scenes.ts` does); a `null` name becomes `""` (say in your report whether any code path
  leaves a scene's name null). `summary` trimmed. `firstLineId` = `sceneStartOf(scene)`.
- Read-only, plain `db` (no transaction). A header comment (🚧) states the rule above and what this is **not**:
  not `sceneSummaryDueOf` (the routine's look), not `scenesToSummarize` (*Summarize all*), not the history read.

### B. The fit arithmetic — `src/lib/server/pipelines/prompt/transcriptFit.ts`

Add (with doc comments in the file's voice):
```ts
/** 🚧 Tokens the block's heading and fence add to its entries — an estimate the re-measure pass corrects. */
export const EARLIER_SCENES_BLOCK_TOKENS = 10
export interface EarlierSceneCost { firstLineId: number; tokens: number }
/** Which earlier scenes show for a prompt whose first kept line is `firstKept`. */
export function earlierScenesShown<T extends { firstLineId: number }>(
  scenes: readonly T[], firstKept: number, maxTokens: number | null, tokensOf: (s: T) => number
): T[]
/** The block's estimated size: the shown scenes' tokens plus EARLIER_SCENES_BLOCK_TOKENS, or 0 when none show. */
export function earlierBlockTokens<T>(shown: readonly T[], tokensOf: (s: T) => number): number
```
- `earlierScenesShown`: `scenes` arrive in story order (oldest first). Keep those with `firstLineId < firstKept`
  (any scene that lost a line to the cut shows — the model then reads its kept tail twice, the cheaper mistake).
  Then, newest first, keep adding while `Σ tokens + EARLIER_SCENES_BLOCK_TOKENS <= maxTokens`; **stop at the first
  that does not fit** (the block is a contiguous run of the newest; oldest dropped first). `maxTokens === null`: no
  cap. Return oldest first. `firstKept` may be `Infinity` (no line kept / none given): every scene qualifies.
- `planTranscriptCut` gains an optional input
  `earlier?: { scenes: readonly EarlierSceneCost[]; maxTokens: number | null; measured: number }` where `measured`
  is the block's estimated size (`earlierBlockTokens`) in the render that `total` measured. At a candidate first
  line `ids[p]` the estimate is
  `total − Σ tokens[0..p) − measured + earlierBlockTokens(earlierScenesShown(scenes, ids[p], maxTokens, s => s.tokens))`.
  Use it in **both** the held scan and the fresh loop (fresh: start at `p = 0` with `est = total` exactly as today,
  then recompute with the formula after each step). The early `return null` stays as it is
  (`total <= budget`). Absent `earlier`, behaviour and every existing test are unchanged byte for byte. Update the
  module comment with one paragraph: why the cut counts the block (the first render measures it nearly empty
  because the read goes two budgets back; left uncounted, a held cut that "fits" goes over once the block fills and
  the first line moves most turns), and that the existing pass bound (4, in the binding) stands.
- Tests in `src/lib/server/pipelines/prompt/transcriptFit.test.ts` (new `describe` blocks; leave existing ones):
  1. `earlierScenesShown`: only scenes starting before the first kept line; a scene that lost only its opening
     line shows; newest kept under the cap, oldest dropped first, stops at the first that does not fit; `null` cap
     keeps all; empty input → empty; result oldest first.
  2. `planTranscriptCut` with `earlier`: a held cut that fits without the block but not with it is **not** taken
     (a fresh cut is made instead); one that fits with it is taken; absent `earlier` equals today's result.
  3. Bound: for the same input with and without `earlier`, the tokens of lines cut with the block exceed those
     cut without it by at most `maxTokens` plus the largest single line's tokens.
  4. **Over N turns the first line holds:** model it on the existing "moves the cut in chunks, a few times over
     twenty turns" test: each turn adds a line; the "render" measures with every read line and the block as it
     would show at the first read line (nearly empty), plans with `earlier`, applies the cut, re-measures with the
     block at the kept line, and the result fits; across 20 turns the first kept line changes only a few times (the
     same count bound the existing test uses, or state the one you chose and why) and never on two turns running.
     Add the contrast: the same simulation **without** `earlier` in the plan (but the real size still including
     the block) goes over the budget or moves the first line on more turns — so the test proves the block must be
     counted.

### C. The shipped template, its Liquid twin, and the layout

- `src/lib/server/pipelines/entities/contextTemplateDefaults.ts` `SHIPPED_CONTEXT_TEMPLATE` (~95–203): directly
  after the `history` block's `{{/if}}`, with **no blank line** before it, add
  ```
  {{#if earlierScenes}}
  {{{earlierScenes}}}
  {{/if}}
  ```
  so the blank line that precedes `{{#if relationshipsPerspectives}}` follows the new block. A prompt with no
  earlier scenes then renders the same bytes it always did. Add to the module comment one short paragraph: the block
  sits after history and before the relationships for comprehension (compiled history, then the later scenes, then
  the lines); it buys nothing for prefix reuse since per-turn lore already sits earlier; no blank line, like the
  pairs described above, so an empty block prints nothing; `SHIPPED_PROMPT_BLOCK_IDS` (SDK) carries the same order.
- `src/lib/server/pipelines/prompt/liquidParity.fixtures.ts` `SHIPPED_CONTEXT_TEMPLATE_LIQUID` (~37; its history
  block ~62): add the Liquid twin of the new block in the same place, in the file's own whitespace style, so the two
  stay equivalent. Leave the other templates in that file alone.
- `src/lib/server/pipelines/entities/variableLayouts.ts`: a row right after the `core:var/history@1` row (~758–771),
  shaped like history's:
  ```ts
  {
    variableId: "core:var/earlier-scenes@1",
    key: "earlierScenes",
    content: { name: "JSON", source: <Handlebars, below>, render: <function, below>, explicit: true },
    wrapper: { name: "Titled JSON block", wrap: jsonBlock("Earlier in the story:") }
  }
  ```
  `render`: `""` for anything that is not a non-empty array; else
  `JSON.stringify(list.map((s) => ({ name: s.name, summary: s.summary })))` (minified, `name` then `summary`).
  `source`: Handlebars that reproduces `render` byte for byte for the variable's list of `{ name, summary }`, in the
  file's one-tag-per-line style with `~` where the output has no line breaks (follow the `characterLore` /
  `anchoredEntries` source and its `jsonValue … indent=0` calls; read the file's "Reading a shipped layout" comment
  and the parity test `entities/variableTemplates.parity.test.ts` to see what it checks). A short doc comment above
  the row: one heading, then per scene its name and summary, oldest first; an empty list renders nothing, heading
  included.

### D. The Default row reaches an existing install — new `src/lib/server/pipelines/boot/seedContextTemplates.int.test.ts`

`boot/seedContextTemplates.ts` re-projects core's shipped rows by `seedKey` when the source drifts; a person's own
template has `seedKey` NULL and is never touched. Do **not** change `seedContextTemplates.ts` unless the test proves
it necessary (then stop and report instead). Test, on a fresh test DB (follow the setup of an existing `*.int.test.ts`
that calls `createTestDb`; 60 s timeout on each `it` that opens a DB):
1. Seed once. Set the Default row's (`CONTEXT_TEMPLATE_SEED_KEY`) source to the previous template — the current
   `SHIPPED_CONTEXT_TEMPLATE` with the exact new block removed (assert the removal changed the string). Insert a
   person's own context template in the same pool (`seedKey` NULL, another name) whose source is that previous
   template.
2. Seed again: `refreshed` contains the Default's seed key; its source equals `SHIPPED_CONTEXT_TEMPLATE`; the
   person's row is byte-identical to what was inserted.
3. Seed a third time: `refreshed` is empty, the Default is in `present`, and its `updatedAt` did not move — a second
   boot changes nothing.

## Words (binding)

It is a **session**, never a *chat* (Chat is only a genre's name). "Compile" means scenes → a history entry and is
never used for this. "Read the scene" means the place. No reference to any other project or product anywhere.
Every new name is 🚧.

## Files owned (edit or create only these)

`src/lib/server/scenes/earlierScenes.ts` (new), `src/lib/server/scenes/earlierScenes.int.test.ts` (new),
`src/lib/server/pipelines/prompt/transcriptFit.ts`, `src/lib/server/pipelines/prompt/transcriptFit.test.ts`,
`src/lib/server/pipelines/entities/contextTemplateDefaults.ts`, `src/lib/server/pipelines/entities/variableLayouts.ts`,
`src/lib/server/pipelines/prompt/liquidParity.fixtures.ts`,
`src/lib/server/pipelines/boot/seedContextTemplates.int.test.ts` (new).

## Files readable

Anything. Useful: `scenes/sceneSummaryDue.ts` (a read-only scenes query in this style), `scenes/liveScenes.ts`
(`sceneDisplayNames`), `scenes/liveScenes.routineSummary.int.test.ts` (test DB setup, scenes with summaries, and
`rewindTurn` / `forwardTurn` from `sessions/rewind`), `db/schema.ts` `scenes` (~4780–4860).

## Tests for A (in `earlierScenes.int.test.ts`)

1. An eligible scene is returned with its shown name (a default-numbered `Scene N`), trimmed summary and first line
   id; several come back oldest first by start, not by id.
2. A selection scene (no range) with a `done` summary is returned with its smallest selected id as `firstLineId`.
3. Absent, while the scenes around each still show (a gap is normal): `running`, `review`, `failed`, `none` never
   summarized, `none` with old text (out of date), compiled (`history_entry_id` set), an open scene, a side-channel
   scene, another session's scene, a blank summary.
4. A person's summary (origin `person` or NULL) and a routine's (origin `routine`) both count.
5. **Back and Forward:** a routine-saved `done` scene that `rewindTurn` resets to `none` is absent at once;
   `forwardTurn` brings it back (reuse the setup in `liveScenes.routineSummary.int.test.ts` ~151–185).
6. Bound: with 205 eligible scenes, the newest 200 by start come back, oldest first.

## Out of scope

The query binding, the assemble binding, `assemble.ts`'s render, docs, NOMENCLATURE — later work. Any SDK file.
`session-history`, retrieval, the summarizer, `sockets/scenes.ts`, `liveScenes.ts`, `sceneSummaryDue.ts` (read only:
other sessions have uncommitted work there). Any setting, migration or data pass.

## Stop and ask when

A migration or data pass seems needed; `seedContextTemplates.ts` would need a change; the template edit cannot be
byte-neutral for an empty block; a Handlebars source cannot reproduce `render` byte for byte.

## Rules (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`.
  Inside `db.transaction(async (tx) => …)` use only `tx`. Do not start a dev server.
- Run only your targeted test files, in a capped scope, one run at a time, output to a log file (never pipe vitest
  into `head`):
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/sense-prm-w2-<name>.log 2>&1"`
  then read the log. An int test that opens a DB inside an `it` needs a 60 s timeout.
- `npx prettier --check <file>` on each file you changed (only the files you changed; if a file was already
  unformatted before you, say so rather than reformatting it).
- **Do not run `npm run sdk:build`.** Run only: `scenes/earlierScenes.int.test.ts`,
  `pipelines/prompt/transcriptFit.test.ts`, `pipelines/boot/seedContextTemplates.int.test.ts`, and
  `pipelines/prompt/liquidParity.test.ts` (if that one fails only for want of the new SDK build, say so and move on).
- Re-read the cited lines before changing anything. Do what is asked, at the size asked. Findings go under
  **Noticed, not done**, never fixed in passing.

## Done means

The four test files above pass (or liquidParity is reported as waiting on the SDK build); prettier clean on changed
files; your report lists each changed file with what changed, the exact Handlebars source of the new layout, test
names and results, anything you could not do, and **Noticed, not done**.

## Report

Return your report as your final message (do not write a report file).
