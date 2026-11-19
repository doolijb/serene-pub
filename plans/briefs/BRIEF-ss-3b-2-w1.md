# BRIEF — worker `ss-3b-2-w1`: the offer rule for prompts with no pipeline, hidden and switched-off prompts (owner P1), the agent-heading helper, Step 0 re-pinned

Supervisor: lane `ss-3b-2`. App repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/` unless they start with `src/` or `plans/`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`: don't run one.)

Also: run no git command that changes the index or the working tree (read-only `git diff` is fine). Never run prettier with `--write` and never pipe its output into a file. No migration. No `npm run build`, no full test run.

## Goal

1. **`promptsOffered`** (`pipelines/entities/prompts.ts` ~586–639) gets the owner's P1 rule:
   - Owner, 2026-11-17: *"Prompts should always be listed under a specific [pipeline]. Offer all for that node/pipeline to any user that owns a session. Only show disabled/hidden prompts to admins for use."*
   - Rename the call field `showHidden` → **`administrator`** (the viewer is an administrator). It now gates three things, not one.
   - New rules (replace the rule list in the doc comment; state each rule, no history):
     1. A prompt made for another pipeline (`createdForSpecId` set, not `specId`) is dropped. *(unchanged)*
     2. A prompt made for this pipeline is dropped when another call of the same pipeline has it as its default. *(unchanged)*
     3. **A prompt that records no pipeline (`createdForSpecId == null`) is offered only to an administrator** — to anyone else only where rule 4 keeps it. *(was: never dropped)*
     4. Kept whatever 1–3 say: the prompt in force (`inForce`) and this call's own default (`defaults.get(address)`).
     5. A hidden prompt (R54) is dropped unless `administrator` or it is the one in force. *(unchanged, renamed)*
     6. **A switched-off plugin's prompt (R67, `pluginsOff`) is dropped unless `administrator` or it is the one in force.** *(was: dropped for an administrator too)* The run still reads a stored one.
     7. Pool order is kept; nothing is added.
   - Order of checks inside the filter (so rule 4 still yields to 5 and 6 for a non-administrator, as today): in force → keep; switched-off plugin and not administrator → drop; hidden and not administrator → drop; own default → keep; no pipeline → keep only if administrator; another pipeline → drop; another call's default → drop; else keep.
   - Update the file header (lines ~23–29) in one or two sentences so it states rule 3 (rule, not history).
2. **Callers** pass `administrator` instead of `showHidden`: `pipelines/config/panel/choices.ts` (the `call` type ~493–498), `pipelines/config/panel/read.ts:581`, `pipelines/config/panel/write.ts:600`, `sessions/settingsForm.ts:860` (that one line only; another worker owns the rest of that file next).
3. **Marks for an administrator** in the panel's choices: in `choicesFor` (`choices.ts` ~505–512), when `call.administrator` is true, a prompt choice that is hidden gets its label suffixed ` (hidden from owners)` (the form's existing words, `settingsForm.ts:874`), and one whose plugin is switched off (`sets.pluginsOff.owns(ownerPluginId)`) gets ` (its plugin is switched off)`. Compute the mark before `ownerPluginId` is stripped. A non-administrator's labels are unchanged. Keep the strip of `createdForSpecId` / `ownerPluginId`.
4. **One exported helper in `pipelines/config/panel/groups.ts`** giving each model call's settings-group heading, so the session form (next worker) names a call exactly as the panel does: extract the code in `settingsGroupsOf` that builds `drafts[i].heading` (~415–433: `groupHeadingOf(node, definitionName(c.modelCall), language)` plus the branch suffix where two alternatives are headed alike) into
   `export function callHeadingsOf(args: { plan: GroupPlan; nodes: readonly GroupingNode[]; decls: readonly Pick<Decl, "nodeKey" | "typeLabel">[]; language?: string }): string[]` (index = `plan.calls` index), with a one-line doc comment, and make `settingsGroupsOf` use it. **The panel's output must not change** (`groups.int.test.ts` and `config/panel/index.int.test.ts` stay green unchanged).
5. **Tests.**
   - `pipelines/entities/promptsOffered.test.ts`: rename the option; rewrite "a prompt with no pipeline is kept, even as another call's default" into: dropped for a non-administrator; kept for an administrator; kept for anyone when it is this call's own default or in force. Add: a switched-off plugin's prompt is dropped for a non-administrator, kept (offered) for an administrator, kept for anyone in force. Keep the rest.
   - `pipelines/entities/promptsOffered.int.test.ts` (the Step 0 table, pinned): re-pin `EXPECTED` from the test's own `PROMPTS_TABLE` output under the new rule (run once, copy the printed table into `EXPECTED` in the same one-object-per-line form). Update the file's doc comment to name rule 3. `REMOVED_ON_ADMIN_SCREENS` must stay **unchanged** (an administrator's out-of-session screens keep note 37's rule). Add one assertion that the administrator's out-of-session view still offers a prompt that records no pipeline where note 37 did: e.g. `core:spec/summarize-character` `drafting.item.draft` lists *Default Scene Summarization* and *Scene Summarization (transcript)*. Rename the helper's `showHidden` param if you like (test-local).
   - Write to `plans/ss-3b-2-w1-table-diff.txt` (scratch, not a test) every row whose `offered` changed: `genre | preset | pipeline | nodeKey: old names → new names`, from the old `EXPECTED` (read it before you change it) vs. the new one. The supervisor reports this list to the owner.

## Expected outcome (check it; a difference is a finding to report, not to "fix")

Shipped prompts that record no pipeline: the three *Default Scene Summarization* rows used by `summarize-scene` / `summarize-history` (seed `../serene-pub-sdk/core-catalog/src/seed/prompts.ts` ~345–380), *Scene Summarization (transcript)* (~393) and *Speech direction* (~1247). So for a session's owner: every `summarize-character` / `summarize-world` call loses *Default Scene Summarization* and *Scene Summarization (transcript)*; `summarize-scene` / `summarize-history` drafting keeps only its default; `story-` / `dungeon-crawler-` / `guide-summarize-scene` drafting keeps only *Scene Summarization (transcript)*; `lair-summarize-scene` drafting keeps only *Lair Scene Summarization*. Rows left: Story's `story-respond` context, `story-generate-image` render, `story-illustrate-scene` context. **Stop and report** if any call's `inForce` changes or a call loses its own default or its in-force prompt.

## Files owned

`pipelines/entities/prompts.ts` (the `promptsOffered` doc comment and body, the file header), `pipelines/config/panel/choices.ts` (the prompts-ref branch of `choicesFor` and its `call` type only), `pipelines/config/panel/read.ts` (line ~581 only), `pipelines/config/panel/write.ts` (line ~600 only), `pipelines/config/panel/groups.ts` (the helper extraction only), `sessions/settingsForm.ts` (line ~860 only), `pipelines/entities/promptsOffered.test.ts`, `pipelines/entities/promptsOffered.int.test.ts`, `plans/ss-3b-2-w1-table-diff.txt`.

Re-read each file right before you edit it: other lanes have edited nearby code. **Files readable:** anything.

## Out of scope

The session form's rows and labels (next worker), any client file, docs, NOMENCLATURE, the SDK, `listPrompts`, what a run reads (`config/world.ts`), the Admin › Prompts library.

## Stop and ask when

A shipped call would lose its prompt in force or its default; the panel's output changes from the helper extraction; a test outside your files fails because of your change (report it, don't edit it); anything needs a new name beyond `administrator`, `callHeadingsOf` and the two marks above.

## Rules your work depends on (quoted)

- CLAUDE.md: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Lead: "Comments state the rule, never history."
- Brief (ss-3b): "An administrator's screens outside a session keep note 37's rule unchanged."
- Lead's reading of P1: "A prompt that records no pipeline belongs nowhere: it is offered to no session's owner … only where they are a step's declared default or the prompt in force (so nothing a session uses today disappears); an administrator still sees them." "Disabled or hidden prompts are shown to administrators only … an administrator sees them, marked as hidden / disabled."

## Done means (tests, each run as below, one at a time, at least one path)

Wait first: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done` (other lanes share vitest; waits can be long). Then
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-3b-2-w1-<n>.log 2>&1"` and read the log's summary with `tail -n 40`. Never pipe vitest into `head`.

1. `src/lib/server/pipelines/entities/promptsOffered.test.ts`
2. `src/lib/server/pipelines/entities/promptsOffered.int.test.ts`
3. `src/lib/server/pipelines/config/panel/groups.int.test.ts src/lib/server/pipelines/config/panel/index.int.test.ts`

`settingsForm.int.test.ts` is the next worker's; do not run or edit it. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` and report only errors in your files.

## Report

Your final message: files changed (with line ranges), each test run and its result, the expected-outcome check (match or the differences), the path of the table diff, anything you noticed and did not do. Under about 400 words.
