# BRIEF — worker `ss-3b-2-w3`: docs, NOMENCLATURE and the SDK's `promptReach` doc comments for prompt rows on every model call

Supervisor: lane `ss-3b-2`. App repo `/home/jody/github/serene-pub`; SDK repo `/home/jody/github/serene-pub-sdk` (doc comments and one guide only).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs **no** `sdk:build`: don't run one.)

Also: run no git command that changes the index or the working tree, in either repo (never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`). Never run prettier with `--write` and never pipe its output into a file.

## What was built (describe this; don't change code)

1. **Which prompts a model call offers** — one function, `promptsOffered` (`src/lib/server/pipelines/entities/prompts.ts` ~586–645), used by the session's **Settings** form and the **Pipelines** panel (in a session and outside it), and by both writes (a prompt the call doesn't offer is refused):
   - a prompt **made for another pipeline** is not offered;
   - a prompt made for this pipeline is not offered on a call when **another call of the same pipeline starts on it** (its shipped default);
   - a prompt that **records no pipeline** (a copy made in **Admin › Prompts › Add prompt**, every plugin's prompt, some shipped summary prompts: *Default Scene Summarization*, *Scene Summarization (transcript)*, *Speech direction*) is offered **to administrators only** — to anyone else only where it is that call's default or already in use;
   - always offered: the prompt **in use** and the call's **own default**;
   - **hidden** prompts (Admin › Prompts, **Hide selected prompts from session owners**) and prompts of a **switched-off plugin** are offered **to administrators only**, marked *(hidden from owners)* / *(its plugin is switched off)*; one a session already uses stays listed for its owner.
   - A prompt written from a pipeline's own settings (Admin › Pipelines: **New prompt**, or duplicating one there) records that pipeline. **There is no way yet to give an existing prompt a pipeline afterwards** (say nothing that implies one).
   - An administrator's **Admin › Pipelines** screens outside a session still list prompts that record no pipeline.
2. **The Settings tab's derived form** gives the session's owner a **prompt row on every model call that has a choice**: two prompts or more offered, or one in use that isn't the call's default. Advanced controls on or off. Each row is named after the call: the agent's name (*Reply · prose prompt*), else the step's own label (*Generate image prompt*; a step already named for its prompt keeps its name: *Scene prompt*), else the pipeline's name. Each row has **Read the wording**. A row locked by the preset or genre is read-only with *Set by the session's preset.* / *…genre.* A call offering one prompt has no row. In shipped genres today that is Story's reply, **Generate image** and **Illustrate the scene** (check the exact pipeline display names in `docs/` or `src/lib/server/pipelines/entities/promptsOffered.int.test.ts`'s pipeline slugs → names via `docs/genre-story.md` / `docs/pipelines.md`). The same choice as the **Pipelines** card's **Prompt** row: changing it in one place changes it in the other. Guests see none of this.
3. **`promptReach`** (`expose: { promptReach: 'owner' }`) is no longer read by core to decide whether the owner gets the choice: every model call with a choice gets a row. It is kept (not removed or renamed: the owner's call) and is ⏳ transitional; its only value is `'owner'`.

## Goal

### A. Docs (app repo; `docs/sessions.md` is shared with live lanes: re-read right before each edit, touch only the lines named)
- `docs/sessions.md`:
  - the Settings tab list (~434, *A card for each pipeline the session runs…*): add that each card holds a prompt row for each model call that has a choice, named after the call (one short clause or sentence);
  - *Pipeline settings in a session* (~599, the **Prompt** bullet): replace *"Story's reply also offers its prompt in the derived **Settings**, as **Prompt** on the reply's card"* with the general rule (every model call with a choice, named after the call) and say which prompts a call offers, in the user's words (1 above), in at most two sentences;
  - ~604 if it contradicts.
- `docs/pipelines.md`: line ~15 (what a session's owner chooses) and ~229 (*Which prompt a step uses…*): which prompts a call offers (rules in 1, user's words); that a prompt made in **Admin › Prompts › Add prompt** records no pipeline and so is offered to administrators only (unless it is a call's default or already in use), while one written from a pipeline's own settings is offered on that pipeline's calls; hidden and switched-off plugins' prompts; the **Prompt** setting is on every model call with a choice, no longer only Story's reply. One sentence for authors that `promptReach` is ignored (⏳) if the page addresses authors anywhere near; else skip.
- Docs rules: second person, plain words, no code ids except where the page already uses them; bold UI names; every sentence a fact a user can check. No history ("used to", "now", "no longer").

### B. `NOMENCLATURE.md` (shared: re-read before each edit; read §1 Governing rules, §24 Naming something new, §6 Config and the rows **settings group** (~266), **prompt reach · hidden prompt** (~281), **exposed · setting reach**, **settings form**, **step label** (~167) first)
- New rows in §6's *value cascade and exposure* table (beside **prompt reach**), each with a charter (P6: purpose, why it exists, what it owns, what it does not and who does):
  - **model call** — an oracle owning a person-facing connection or sampling slot (`modelCallsOf`, `pipelines/config/panel/groups.ts`; transcription and speech sampling don't count); one **settings group** each (UI *agent*). Check it against the existing uses (§4 ~167 says *model call* = an oracle whose definition declares a `connection` slot, SDK `isModelCall`); reconcile, don't contradict (R1, R5): if the two definitions differ, say which is which and flag it in your report.
  - **prompt row** — the settings form's field for one model call's prompt (`sessions/settingsForm.ts`): shown to the session's owner (and an administrator who owns the session) where the call offers a choice; named after the call; the choice, never the text; owns nothing stored (writes the session's registration values, the same address as the Pipelines card's **Prompt**).
  - **prompts offered** (`promptsOffered`, with `promptDefaultsOf`) — the one rule for which prompts a call offers, rules as in 1; owns the offer, not the run (the run reads whatever is stored) and not the library listing (`listPrompts`).
- Update **prompt reach** to ⏳ transitional: core no longer reads it to show the choice; the only value `'owner'`; kept until the owner rules on removal.
- §25 Change ledger: one new entry `### prompt rows on every model call — 2026-11-17 (owner ★S3-a, D58, D59, P1; lanes ss-3b-1, ss-3b-2)` with a table row in the ledger's existing shape: *before* (one **Prompt** row on Story's reply, gated by `promptReach`; `promptsForPipeline` in `config/panel/choices.ts`; a prompt with no pipeline offered everywhere) → *after* (`promptsOffered`, `promptDefaultsOf`; the **prompt row** per model call with a choice; P1) → date and reason. Ledger rows are history by design.

### C. SDK doc comments (no code change; `sdk/src/builder.ts:593` is running code pinned by `sdk-tests/stepLabel.test.ts:145`: **do not change it**)
- `../serene-pub-sdk/sdk/src/builder.ts` ~246 and ~510–518, `../serene-pub-sdk/sdk/src/document.ts` ~69: mark `promptReach` ⏳ transitional (R6): the host offers a session's owner the prompt choice of every model call that offers one, whatever this says; kept so existing specs build; its only value is `'owner'`. State the rule, no history.
- `../serene-pub-sdk/guides/where-values-come-from.md` ~67–70: the sentence *"The one choice a step may hand its owner is **which prompt** it writes from: `{ expose: { promptReach: 'owner' } }` … never their text."*: rewrite so it says the host offers the owner the prompt choice of every model call that has one (the prompts made for the pipeline, plus the call's default; hidden ones and ones made for no pipeline only to administrators), never the text; `promptReach` is ⏳ and ignored.

### D. One stale comment
`src/lib/client/components/pipelines/PipelineConfigOptions.svelte` ~1342 cites `promptsForPipeline` (gone): make it cite `promptsOffered` (comment text only; touch nothing else in that file).

## Files owned
`docs/sessions.md` (the lines named), `docs/pipelines.md`, `NOMENCLATURE.md` (the rows and the ledger entry named), `../serene-pub-sdk/sdk/src/builder.ts` (doc comments ~246, ~510–518 only), `../serene-pub-sdk/sdk/src/document.ts` (~69 doc comment only), `../serene-pub-sdk/guides/where-values-come-from.md` (~67–70), `src/lib/client/components/pipelines/PipelineConfigOptions.svelte` (the one comment).

**Files readable:** anything.

## Out of scope
Any code, tests, `INTEGRATING.md` (it does not describe the prompt pool), `STYLE-GUIDE.md`, generated docs under `src/lib/generated/`.

## Stop and ask when
A doc would need to promise something not built; a NOMENCLATURE definition collides with an existing meaning; a new word beyond **prompt row**, **model call**, **prompts offered** seems needed.

## Rules your work depends on (quoted)
- CLAUDE.md: "When you add or rename a term, record it in **§25 Change ledger** in the same change." · "**P6 Charters.** Everything that exists states its purpose, why it exists, what it owns and what it does not (and who does) — in its **NOMENCLATURE** row." · "It is a **session**, never a *chat*." · "**R6** mark ⏳ transitional / 🚧 provisional vocabulary."
- NOMENCLATURE R1: "One word, one meaning." R3: "Qualify, never abbreviate to the bare noun." R5: "Reconcile vocabularies at boundaries; never merge them."
- STYLE-GUIDE §10: "Sentence case everywhere" · "One name per thing, across the whole flow" · "Help is one sentence."
- Lead: "Comments state the rule, never history."

## Done means
No tests to run for docs. Run, once, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`:
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/shared/conformance/commentHistory.test.ts > plans/ss-3b-2-w3-1.log 2>&1"` and read `tail -n 30`. Never pipe vitest into `head`.

## Report
Your final message: files changed (line ranges), every new or changed sentence a user reads (quote each), the **model call** reconciliation, the test result, anything you noticed and did not do. Under about 450 words.
