# BRIEF — worker `fnd-3-w2` — guard tests after the speech build + the comment ratchet (lane `fnd-3`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-3`. Triage source:
`plans/INVENTORY-standing-failures-2026-11-16.md` (rows quoted below). **Re-verify every file:line and every
cause before editing: a row may be wrong.**

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Make these four test files pass by updating the **tests**, and clear the comment ratchet by rewording the
flagged comments. No product behaviour changes; no product **import** changes.

## Part 1 — tests

| File | Test | Cause (inventory) | Fix (inventory) |
|---|---|---|---|
| `src/lib/server/adapters/importBoundary.test.ts` | nothing under shared/… | `src/lib/shared/speech/voicebank.ts:23` imports `../connectionAdapters/speechFacts` relatively; the test's regex can't tell where it resolves | resolve relative import paths in the test against the importing file, then judge the resolved path. **Do not edit product imports for a test.** If the resolved target really is a server adapter module reachable from shared/, stop and report (that would be a product defect) |
| importBoundary | allowlist / STATIC (2 tests) | `isConcreteAdapter` (test ~69) matches the loader `getSpeechAdapter` | exclude `get*Adapter` loaders in the lookahead (check the other loaders' names so the exclusion is exact, not broad) |
| importBoundary | registry consumers | new importers `speech/getSpeechAdapter.ts`, `speech.conformance.test.ts` | add both to `CONSUMERS`, each with one reason stated as a rule |
| `src/lib/server/adapters/registry.test.ts` | route all four families (times out) | thunks for `ComfyAdapter`, `KoboldCppEmbeddingAdapter` (`registry.ts` ~173, ~238) are unmocked and load the db | add the two `vi.mock` stubs in the file's existing style |
| `src/lib/shared/conformance/wiring.test.ts` | out-ports consumed | speak's `cueMap` / `spokenAs` have no consumer | add to `UNCONSUMED_OUT_SHAPES` with reasons |
| wiring.test.ts | in-ports filled | speak `text` (⏳ alias), `language` (has a fallback); `firsthandFor` / `firsthandBy` on 3 queries (replaced by programme 1.2); `clock-step.unless` | add to `UNFILLED_IN_PORTS` with those reasons |
| `src/lib/client/components/sessionPage/narrateDraft.dom.test.ts` | page declares both keys | the source regex expects one line; the code wraps after `if (direction !== null)` (`src/routes/…/+page.svelte` ~546; find the file the test reads) | `\s+` in the regex (test ~246) |

Excuse-list entries: read the existing entries in `wiring.test.ts` first and match their form (subject, then a
`reason` that says what the port is, why nothing consumes/fills it in core, and when the entry closes). Verify each
reason in code before writing it: e.g. find where speak's `language` fallback is applied, where `text` is marked
⏳, what consumes `firsthandFor/By` today and whether `plans/PLAN-programme-2026-11-15.md` §1.2 replaces it, and
what `clock-step.unless` is for. Use ⏳ / 🚧 only as the existing entries do (⏳ transitional, 🚧 provisional).

## The rule for every row (lane rule, from the owner's programme 0.3 brief)

> "Class A rows: update the test's expectation to what the code does today, only after confirming the code's
> present behaviour is intended (find the change that moved it; if it looks like an accident, stop on that row
> and report it as a possible defect instead of pinning it). Excuse lists (`UNCONSUMED_OUT_SHAPES`,
> `UNFILLED_IN_PORTS`, `CONSUMERS`, `dispatchable`) get one reason per entry, stated as a rule."
>
> "`importBoundary` 'nothing under shared/…': fix the test's path resolution; product imports stay as they are."
>
> "No product behaviour changes in this lane. A row whose honest fix is a product change: stop on that row, report."

Report, per row, the evidence of intent: the product line (file:line) plus a doc / plan / NOMENCLATURE line or
`git log -S` commit that describes it.

## Part 2 — the comment ratchet

`src/lib/shared/conformance/commentHistory.test.ts` fails on these flagged comment lines (re-run it to get the
current list; line numbers may have moved):

```
src/lib/client/components/connections/modelsList.ts:194   [no longer]  * already says it (the "No longer listed" badge, the download line).
src/lib/client/shell/leaveDestination.ts:21                [no longer]  // A cold load (`page.state` is `{}`), junk, or Apps no longer registered.
src/lib/server/db/dataUpgrades/0137_loadout_voices.ts:11   [no longer]  * Raw SQL through `tx` only (schema.ts no longer has the star columns); no ids
src/lib/server/embedding/indexingActivity.ts:4             [used to]    * The composer's notice used to carry "Indexing 12 of 40 lorebook entries".
src/lib/server/lorebooks/imprints.ts:676                   [no longer]  // Back never writes into a book its session no longer reads: a
src/lib/server/pipelines/runtime/runRegistry.ts:120        [no longer]  * nothing: it no longer blocks re-run and remove actions. Set and cleared
src/lib/server/sessions/honorModeRetired.ts:35             [no longer]  * (the 0.7 squash, or the importer no longer accepting older files).
src/lib/server/sessions/settings.ts:335                    [no longer]  * are no longer its business — that is sheet latitude (`state/handEdits.ts`).
src/lib/server/sockets/localOnnxModels.ts:1125             [no longer]  * exist (`ensureLocalOnnxConnections`), so their existence no longer says
src/lib/server/utils/activityStore.ts:290                  [used to]    * the progress the composer's notice used to carry. Written only by
src/lib/server/utils/activityStore.ts:630                  [deliberately not] // Deliberately NOT startScene's abort-and-evict, for two different
src/lib/server/utils/androidWrapper.ts:3                   [used to]    * this env var before spawning the server). Used to hide features that don't
```

Rule (lane brief): **"rewrite each flagged comment as a present-tense rule (comments state the rule, not the
story; never delete a comment that carries a rule), then `npm run comments:ratchet`. Skip any flagged file under
`src/lib/server/sockets/sessions*.ts`: lane `fnd-2c` is moving that file now; list what you skipped."**

CONTRIBUTING §Comments, verbatim: "A comment is for the reader of the code as it is now. It states something the
code cannot: an invariant, a constraint the shape depends on, or the reason this way was chosen over the obvious
one. Keep it to the present tense and to a few lines. Leave out: **How it got here.** Which migration introduced a
column, what a function did before, or the bug that prompted the change… **Commentary on the comment.** 'This is
deliberate', 'the whole reason this exists', 'do not remove'. State the rule the reader must not break; the rule
is what makes the removal wrong."

How:
- Read the whole comment block around each flagged line (not just the line) and rewrite only as much of it as
  needed to state the rule in the present tense. Keep every rule it carries. Pure history with no rule may go.
- Edit **comment text only**. Never change code, strings, or a UI label (if a comment quotes a UI label that
  contains a flagged phrase, refer to the label without quoting the phrase, e.g. by its role or the code that
  renders it).
- Do not edit the phrase list or the test.
- Then run the commentHistory test; when it passes, run `npm run comments:ratchet` and inspect
  `git diff src/lib/shared/conformance/commentHistory.ratchet.json`: it may only **lower** counts or drop entries,
  for the files you touched. Any raised count or new file there is another lane's in-flight edit: stop and report
  it, and restore just those lines of the JSON by hand to their previous values (never `git checkout`).

## Files owned

The four test files above; the comment lines flagged above (comment text only) in those 11 product files;
`src/lib/shared/conformance/commentHistory.ratchet.json` (via the script).

## Files readable

Anything. `src/lib/server/sockets/sessions.ts` and `sessions.*.ts`: never edit.

## Out of scope

Product code and imports; the SDK (read only); other failing tests; `paramsSlotWiring`, `panel/groups`.

## Stop and report (do not decide) when

A cause differs from the row; the present behaviour looks accidental; the fix needs a product change or a new
name/setting; a comment cannot be stated as a rule without changing what it claims.

## Running tests

Strictly one vitest at a time across the machine. Before **every** run:

```
until ! ps -eo pid,args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 5; done
```

Then only:

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-3-w2-<n>.log 2>&1"
```

Read logs with `grep`/`sed -n`; never pipe vitest into `head`. Formatting: `npx prettier --check <file>` only.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane runs no `sdk:build` at all.)

Never `git checkout` / `restore` in either repo. No `npm test`, no full run, no `npm run build`.

## Done means

`importBoundary.test.ts`, `adapters/registry.test.ts`, `wiring.test.ts`, `narrateDraft.dom.test.ts`,
`commentHistory.test.ts` pass in a capped run; prettier `--check` clean on every file you touched.

## Report

Final message: per row the change and the evidence of intent; each comment before → after (one line each); the
ratchet total before → after and the JSON diff summary; rows stopped and why; anything noticed but not done.
