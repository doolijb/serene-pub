# BRIEF — `ss-3b-1` worker 1 — one function decides which prompts a model call offers

App repo `/home/jody/github/serene-pub`. Supervisor: lane `ss-3b-1`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: run **no git command that changes the index or the working tree** (no add, reset, checkout, restore, stash, commit) — both repos are staged by the lead. **No SDK edit or build** (the SDK repo is read-only). No migration. Never `prettier --write`. Use absolute paths.

## Goal

Today two places decide which prompts a model call ("a step's prompts slot", control `prompts-ref`) offers:

- the Pipelines panel: `promptsForPipeline` in `src/lib/server/pipelines/config/panel/choices.ts` (≈ lines 487–509), fed by a `foreign` mark set in `pooled` (≈ 203–208), called by `choicesFor` (≈ 522–528); `read.ts:577` passes `[value, d.authorDefault]` as rows to keep and then filters hidden prompts for non-admins (≈ 572–578);
- the session settings form: `src/lib/server/sessions/settingsForm.ts` ≈ 820–837 offers the RAW pool (`listPrompts(db, d.nodeDefinitionId!, d.slot, at.specId)`), then filters hidden prompts for non-admins.

Make **one function in `src/lib/server/pipelines/entities/prompts.ts`** that both call. Rules, in this order (owner note 37, 2026-10-02: "Prompts need to be properly filtered by pipeline across the app"; owner D59, 2026-11-16: "A call offers only the prompts made for its own pipeline, plus its default"):

1. **Another pipeline's prompt is not offered.** A prompt whose `createdForSpecId` is set and is not this pipeline's spec id is dropped (exactly today's `foreign` rule).
2. **Within one pipeline, a call is not offered a prompt that another call of the same pipeline uses as its default.** Applies only to prompts whose `createdForSpecId === specId` (the pipeline's own prompts). "Another call's default" = the shipped default of every OTHER `prompts-ref` declaration of the same pipeline (its address `nodeKey\u0000slot\u0000path` differs from this call's).
3. **A prompt that records no pipeline (`createdForSpecId == null`) stays offered** — rules 1 and 2 never drop it. Do not change that.
4. **Kept whatever 1–2 say:** the prompt **in force** here (the value) and **this call's own default**.
5. **Hidden prompts (R54):** when the viewer is not an administrator, a prompt with `hidden === true` is dropped unless it is the one in force (not merely the default — today's behaviour in both places). An administrator sees hidden ones.
6. Pool order is preserved; nothing is added that is not in the pool.

Ids may arrive as numbers or digit strings (`"12"`); compare as numbers (the form has an `idOf` helper at ≈ 834 doing exactly that).

The **defaults** are the shipped Default config's values, `shippedConfigValuesOf(...)` (`src/lib/server/pipelines/config/named.ts` 618): the form already holds it as `declared` (settingsForm ≈ 586), the panel as `shipped` (read.ts 319). Both maps hold EVERY address (samplings, connections too), so only `prompts-ref` declarations' addresses may count as defaults — a sampling id equal to a prompt id must never drop a prompt. A `prompts-ref` decl has no `authorDefault` (declarations.ts ≈ 420–438), so `d.authorDefault` is not a default for prompts; use the shipped map (falling back to `d.authorDefault` costs nothing, but say what you did).

### Shape (decide details; say what you chose)

```ts
/** Each prompts slot's shipped default in one pipeline, by address — prompts-ref declarations only. */
export function promptDefaultsOf(decls: ReadonlyArray<Decl-like>, defaults: ReadonlyMap<string, unknown>): Map<string, number>

/** The prompts one model call offers (the rules above). */
export function promptsOffered<T extends { id: number; createdForSpecId: number | null; hidden?: boolean }>(
	pool: readonly T[],
	call: { specId: number; address: string; defaults: ReadonlyMap<string, number>; inForce: unknown; showHidden: boolean }
): T[]
```

`prompts.ts` already imports `declarations` from the panel barrel, and `choices.ts` will import from `prompts.ts`: a static import cycle. Every use is inside a function, so ESM tolerates it; if a test shows otherwise, report it rather than restructuring files.

## Changes

A. **`prompts.ts`:** add the function(s) with a doc comment that states the rules and cites note 37 and D59. Correct the comments this makes false: the module header (≈ 23–26, "`created_for_spec_id` … **never refuses**"), `PromptRecord.createdForSpecId` (≈ 60, "Grouping only, never a permission") and ≈ 279 ("Grouping only; it stays selectable everywhere"). New truth, in one sentence each: `created_for_spec_id` sorts the picker AND narrows what a call offers (another pipeline's prompt is not offered unless in force or the call's default); selection (`assertSelectable`) still never refuses on it.

B. **`choices.ts`:** delete `promptsForPipeline` and the `foreign` mark. `pooled` carries `createdForSpecId` on PROMPT entries only (an opt replacing `markForeign`; context-template entries must not gain the field). `choicesFor`'s `prompts-ref` branch calls `promptsOffered` and strips `createdForSpecId` from what it returns (the client never sees it — keep `hidden` as it is sent today). Replace `choicesFor`'s third parameter (`keep`) with the call context the panel needs (decide the shape; `choiceSets` may also return its `specId`). Correct the comment on `pooled` (≈ 174–177, "**The grouping never refuses.** A row written while configuring replies stays selectable in the narrator…"): grouping still never refuses for context templates; prompts are narrowed by `promptsOffered`.

C. **`read.ts` ≈ 571–578:** compute `promptDefaultsOf(declared, shipped)` once per view (note: in `namespaceView` the decls variable is called `declared`, the defaults map `shipped`); pass the call `{ specId: at.specId, address: key, defaults, inForce: value, showHidden: viewer.isAdmin }`; the local hidden filter goes (it moved into the function). Change nothing else in `read.ts`.

D. **`settingsForm.ts` ≈ 817–837 (the prompt row only; other lanes edited other parts — re-read first):** the row's `offered` list comes from `promptsOffered(await listPrompts(...), { specId: at.specId, address: addr, defaults: promptDefaultsOf(decls, declared), inForce: value, showHidden: viewer.isAdmin })`; the local hidden filter goes. Update the comment at ≈ 817–819 to say the list is what the call offers (`promptsOffered`). Change nothing else in the file — not the header comment, not the label, not the gate.

E. **Comments only, outside the panel:** `src/lib/server/db/schema.ts` ≈ 6507 ("`created_for_spec_id` sorts the picker without ever refusing") and ≈ 6537–6540 ("GROUPING ONLY, never a permission"), and `src/lib/server/sockets/pipelines.ts` ≈ 913–915 ("Grouping only — it stays selectable everywhere the node is reused") — say what is now true for prompts. Leave the context-template comments (`schema.ts` ≈ 6830, 6866; `sockets/pipelines.ts` ≈ 1268–1270) alone: templates are not narrowed. **Not one character of code in these two files.**

F. **Unit test:** new `src/lib/server/pipelines/entities/promptsOffered.test.ts`, replacing `src/lib/server/pipelines/config/panel/promptsForPipeline.test.ts` (delete that file with `rm`; its export is gone). Cover: own-pipeline prompts kept; another pipeline's dropped; no-pipeline prompts kept (also when one is another call's default); another call's default (own pipeline) dropped; in force kept though foreign / another's default / hidden; own default kept though foreign / another's default; hidden dropped for a non-admin unless in force, kept for an admin; a hidden own default not in force dropped for a non-admin; digit-string ids; order preserved; `promptDefaultsOf` ignores non-prompt addresses. If importing `prompts.ts` pulls a module that needs a DB, mock as the repo's other unit tests do.

## Files owned

`src/lib/server/pipelines/entities/prompts.ts`, `src/lib/server/pipelines/config/panel/choices.ts`, `src/lib/server/pipelines/config/panel/read.ts` (≈ 571–578 and one line computing the defaults), `src/lib/server/sessions/settingsForm.ts` (≈ 817–837 only), `src/lib/server/db/schema.ts` and `src/lib/server/sockets/pipelines.ts` (the named comments only), the new unit test, deleting `panel/promptsForPipeline.test.ts`.

## Files readable

Anything. Useful: `src/lib/server/pipelines/config/named.ts` 618–715, `src/lib/server/pipelines/config/panel/declarations.ts` 410–440, `src/lib/server/pipelines/config/panel/types.ts`.

## Out of scope (never build)

Prompt rows on other calls; the row's label; `promptReach`; any SDK file; docs; NOMENCLATURE; narrowing context templates; disabled-plugin filtering in the form; any change to what a run reads; any change to `assertSelectable` or a write path.

## Stop and ask (in your report) when

A new user-facing name, setting or migration seems needed; the cycle import breaks a test; a rule above is ambiguous for a case you meet; anything outside the files owned would need a change.

## Done means

- `npx prettier --check` on every changed file (report the result; do not `--write` — if it fails only on lines you did not touch, say so).
- The unit test passes, run exactly as:
  `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/entities/promptsOffered.test.ts > plans/ss-3b-1-1.log 2>&1"`
  (always at least one path; never pipe vitest into `head`). Do NOT run the int tests: the supervisor runs them.
- `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "entities/prompts|panel/choices|panel/read|settingsForm|promptsOffered" ` prints nothing (report any error in these files).

## Report

Your final message: changed files with what changed (one line each), the function signatures as built, the test result (counts), prettier and tsc results, open questions, **Noticed, not done**. Under 400 words.
