# BRIEF — worker `time-t7b-w2` — the recipe: make living entries fade in recall (a rescore script, tested in the app)

Repos `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: lane `time-t7b`. Report back through your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need `sdk:build` or `sdk:test`: the supervisor runs `sdk:test`.)

Also: another session shares this checkout, so touch only the files below. Never `kill -9`. **No other product's name in any file.** It is a *session*, never a *chat*. Never write "no lorebook".

## Owner rulings this rests on (quote, don't reinterpret)

- 2026-11-13, Decay: "a value between 0 and 1, core by default will use a reasonable multiplier against that. Modders can query and calculate against that number how ever they want, or ignore it out-right."
- 2026-11-15, asked whether to build a ranking fade in core: **"Time Delta, keep a recipe for using recency in the SDK in the docs"**. So core does **not** rank by Decay; the recipe shows a pipeline author how to.
- Lead's correction (2026-11-15): the recipe is an **Admin › Scripts rescore script**, not plugin TypeScript; it lives in the SDK's `guides/time.md`, linked from `docs/pipelines.md` and `docs/scripts.md`; it is backed by **one app integration test that runs the recipe's exact text through the rescore seam** and shows a living entry's score falling and a Fact's unchanged.

## Facts (verified by the supervisor; re-check what you rely on)

- The seam: `core:script:candidates/rescore@1` (`../serene-pub-sdk/sdk/src/scripts.ts` ~352), semantics `transform`, ports `in: { candidates }`, `out: { candidates }`. Accepted on the ranking step's `scripts` slot (`../serene-pub-sdk/contracts/src/tasks.ts` ~810–817, phase `before`, port `candidates`).
- A script body runs in the app's sandbox (`src/lib/server/pipelines/scripts/chains.ts`, `makeScriptApplier`, ~199; `runScriptSource`): the type's first in-port name is the variable it is handed (`candidates`), and what the body `return`s is the new value. Model your test on `src/lib/server/pipelines/scripts/chains.runScript.int.test.ts` (registry row in `pipelineDefinitionRegistry`, a `pipelineScripts` row with `typeId`, `source`, `varsIn`, `varsOut`), but call the applier directly with a hand-built site: `{ nodeKey, definitionId, at: "in:candidates", slot: "scripts", phase: "before", port: "candidates", accepts: ["core:script:candidates/rescore@1"], extras: [] }` (`ScriptHookSite`, `../serene-pub-sdk/sdk/src/executor.ts` ~483).
- A keyword candidate is `{ id, source, tokens, signals, priority, position, pinned, payload, … }` (`src/lib/server/pipelines/ranking/keywordQuery.ts` ~844); its `payload` is the entry row as the session reads it, which carries `decayRate` (`src/lib/server/utils/lorebookEntries.ts` ~323, `decayRate: row.decayRate ?? 0`). `signals.lastRefRecency` is the **Recently referenced** signal (`keywordQuery.ts` ~1188; the weight `signalLastRefRecency`, label *Recently referenced*, `contracts/src/tasks.ts` ~544). The score is `score(...)` in `src/lib/server/pipelines/ranking/select.ts` ~322, which adds `weights.lastRefRecency * signals.lastRefRecency`; weights via `withDefaults` in `ranking/weights.ts`.
- The signal exists only for entries with keywords (`withKeys`) and looks at the last 100 messages (`LORE_MESSAGE_WINDOW`, `runtime/bindings.ts` ~335). A score change matters only when a budget or a per-type cap (**Most entries**) is reached; otherwise every candidate is read, and lore with a title renders in arrival order.

## Build

### 1. The guide section — `../serene-pub-sdk/guides/time.md`

Add one section **before** `## Not yet built`, titled exactly `## Make living entries fade in recall`. Short (about 25 lines of prose plus the script). Say, in this order and in plain words:

1. What Decay is: a number from 0 to 1 on every lorebook entry, set on the entry's row (**Decay**: **Fact** or **Living**); 0 is a fact, above 0 a living entry. **Core does not rank by it.** (Do not describe a time delta in the prompt: that half is not built yet.)
2. What a script can read: a **Rescore candidates** script (`core:script:candidates/rescore@1`) is handed `candidates`; each candidate's `payload` is the entry as the session reads it, `payload.decayRate` included, and `signals.lastRefRecency` is its **Recently referenced** signal, from 0 to 1.
3. That this is a **script pasted in Admin › Scripts** (type **Rescore candidates**) and attached to the scripts list before candidates on the step that ranks lore (its **Advanced** fold): not plugin TypeScript.
4. The script, in one ` ```js ` fence (not `ts`, not `playground`), **exactly this text** (you may adjust only if the sandbox refuses a construct; then say so in your report):

```js
// A living entry (Decay above 0) keeps less of its Recently referenced lift
// the higher its rate, never less than FLOOR of it; a fact is left as it was.
const FLOOR = 0.2

return candidates.map((c) => {
	const rate = Number(c.payload?.decayRate) || 0
	const recency = c.signals?.lastRefRecency
	if (rate <= 0 || typeof recency !== 'number') return c
	const keep = Math.max(FLOOR, 1 - rate)
	return { ...c, signals: { ...c.signals, lastRefRecency: recency * keep } }
})
```

5. One sentence on why it is shaped so: the multiplier stays between `FLOOR` and 1 and never rises with the rate, so a living entry never outranks the same entry as a fact.
6. The caveats, plainly: the signal exists only for entries with keywords and looks at the last 100 messages; a score change matters only when a budget or a per-type cap (**Most entries**) is reached; a pipeline that wants none of it sets **Recently referenced** to 0, and then this script changes nothing.

Keep to the page's voice (read the whole page first). Mark it 🚧 like the rest of the page (the page already says "Everything here is 🚧 provisional").

### 2. The integration test — `src/lib/server/pipelines/scripts/livingRecallRecipe.int.test.ts` (new)

- Read `../serene-pub-sdk/guides/time.md` (resolve it like `src/lib/server/rulesets/piecesOnWire.test.ts` ~19 does: `new URL("../../../../../../serene-pub-sdk/guides/time.md", import.meta.url).pathname`; check the number of `../` from this file), find the `## Make living entries fade in recall` heading and take the **first ` ```js ` fence after it**, verbatim. Fail clearly if the heading or fence is missing.
- Store that text as a `core:script:candidates/rescore@1` script and run it through `makeScriptApplier` at the site above, over at least these candidates (world lore, same keyword signal): a **living** entry (`payload.decayRate: 0.5`, `signals.lastRefRecency: 0.8`), a **fact** (`decayRate: 0`, same signals), a living entry at rate 1 (falls to the floor), and a living entry with **no** `lastRefRecency` (unchanged).
- Assert, with `score(...)` from `ranking/select.ts` and `withDefaults` weights: the living entry's score after is **lower** than before; the fact's score is **unchanged** (deep-equal candidate too); the rate-1 entry keeps exactly `FLOOR` of its signal; the one with no signal is unchanged; and at every rate a living entry never scores above the same entry as a fact.
- Database setup and teardown exactly as the model test does (`createTestDb`; if you make a data dir, name it `serene-pub-vitest-livingRecallRecipe-*` and release it). `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`.

### 3. Two links

- `docs/pipelines.md`, at the end of `## Where the weights live`: one sentence: an entry's **Decay** doesn't change what recall picks; to make living entries fade, see the SDK guide [Make living entries fade in recall](./sdk/guides/time.md#make-living-entries-fade-in-recall).
- `docs/scripts.md`, under the types table in `## What a script can do` (after the paragraph "Plugins can add types of their own; they show the same way."): one sentence pointing to the same guide section as a worked **Rescore candidates** script.

## Files owned (the only files you may edit)

- `/home/jody/github/serene-pub-sdk/guides/time.md` (one new section only)
- `src/lib/server/pipelines/scripts/livingRecallRecipe.int.test.ts` (new)
- `docs/pipelines.md` (one sentence), `docs/scripts.md` (one sentence)

## Tests

Check that no vitest is running first (`pgrep -af vitest`; if one is, wait and check again), then from the app root:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/scripts/livingRecallRecipe.int.test.ts > plans/time-t7b-w2.log 2>&1"
```

Never pipe vitest into `head`. Then `npx prettier --check` on the test file, and `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep livingRecallRecipe` (no errors).

Comments state the rule, not the story.

## Stop and ask (in your report, do not decide) when

The candidate payload in the sandbox does not carry `decayRate`; the sandbox refuses the script and the fix would change what it does; you need any other file; a sentence would need a new name.

## Report

Changed files; the guide section's final text; the test count and result (paste the vitest summary line); tsc and prettier results.
