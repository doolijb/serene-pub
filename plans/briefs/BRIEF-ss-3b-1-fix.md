# BRIEF — worker task `ss-3b-1-fix` — scope-review fixes to lane `ss-3b-1` (which prompts a model call offers)

Repo `/home/jody/github/serene-pub`. SDK not touched. Read first: `plans/REPORT-ss-3b-1-2026-11-17.md`.
Re-verify every file:line.

Owner: 2026-10-02 "Prompts need to be properly filtered by pipeline across the app"; 2026-11-16 "A call offers
only the prompts made for its own pipeline, plus its default". The lane's aim: the Pipelines panel and the
session settings form never offer different lists, and what is offered is what can be stored.

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only, **never `--write`**; no migration. Inside `db.transaction` only `tx`. Comments
state the rule, not the story. Lane `wt-1b` is editing SDK query contracts, `pipelines/runtime/bindings*.ts`,
a new function beside `sessions/firsthandFilter.ts`, `pipelines/config/panel/ganged.ts` and docs: do not touch
those. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-3b-1-fix-<n>.log 2>&1"`
(always at least one path), after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .`.

## Fixes

1. **A disabled plugin's prompts, one rule for both surfaces (R67).** The panel drops a disabled plugin's
   prompts **before** calling `promptsOffered` (`src/lib/server/pipelines/config/panel/choices.ts` 87–92), so
   one that is in force vanishes from the panel (breaking "the prompt in force is always kept"); the form
   feeds the raw `listPrompts`, so it can offer one, `updateSetting` stores it, and the run reads it
   (`resolvePromptFields`, `pipelines/entities/prompts.ts` ~263, no plugin check). Put the rule inside the
   shared path: a disabled plugin's prompt is not offered **unless it is in force** (then it is listed like
   any in-force value), and both surfaces get their pool through the same call. Tests: with the plugin
   disabled, neither surface offers its prompt; when it is in force, both list it; the two lists are equal.
   Report what the run does with a stored prompt of a disabled plugin today (unchanged: do not alter the run).
2. **What is not offered cannot be stored through the panel either.** The panel's write
   (`pipelines:setOption` → `writeOption`, `config/panel/write.ts` 552–573 → `assertSelectable`,
   `entities/prompts.ts` 192–245) checks only step type, slot, declared fields and hidden-for-non-admin: a
   forged request can store another pipeline's prompt, or another call's default, which the form then shows as
   in force. Make `writeOption` refuse a prompt reference that `promptsOffered` does not offer for that call
   (for every writer, administrators included: their list comes from the same function), in the existing
   refusal manner of that write with one sentence (★). A value that is **already stored** is untouched
   (re-saving the same in-force value is allowed: it is offered because it is in force). Then correct the
   comments the lane wrote that say selection "never refuses" (`db/schema.ts` ≈6509, the `prompts.ts` header
   ≈28) to the rule as built. Tests: forged writes of another pipeline's prompt and of another call's default
   are refused at session scope and at configuration scope; an offered prompt is stored; re-saving the in-force
   value passes.
3. **Carry the lost test case.** The deleted `panel/promptsForPipeline.test.ts` had "the internal mark never
   reaches the client": assert in `config/panel/index.int.test.ts` that no prompt choice sent to a client
   carries `createdForSpecId`.

Append a "Scope review and fix task" section to `plans/REPORT-ss-3b-1-2026-11-17.md`, including for the
owner's open question (D69): the scene summary prompts offered on character and world summary calls are **not**
interchangeable there: those pipelines pass batches as message arrays (`summarizeSpec.ts` 176–198) and swap
only the system prompt (`utils/summarizer/templates.ts` 41–70) while the user prompt still asks for bullet
points of character facts; the scene prompt demands prose and the transcript prompt refers to a transcript that
is not given; on naming calls a scene-title prompt would name character and world entries. Also note for lane
`ss-3b-2`: `client/components/pipelines/PipelineConfigOptions.svelte:1342` still cites `promptsForPipeline`;
`NOMENCLATURE.md:2682` records it as the rule; no ledger line yet for `promptsOffered` / `promptDefaultsOf`.

## Report (under 250 words)

Per fix: what changed (file:line); the refusal sentence (★); what the run does with a disabled plugin's stored
prompt; tests and counts with log names; `tsc`; anything not done.
