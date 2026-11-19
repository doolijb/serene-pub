# BRIEF — worker task `perf-2-fix` — one home for the variable-layout rules that `world.ts` now answers in memory

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-perf-2-2026-11-17.md` (cut 1),
`plans/briefs/BRIEF-perf-2.md` (the rule: no behaviour change; prompts byte-identical). Re-verify every
file:line.

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only, **never `--write`**; no migration. Inside `db.transaction` only `tx`. Comments
state the rule, not the story. No other lane is editing. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-2-fix-<n>.log 2>&1"`
(always at least one path), after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .`.

## The problem

To read a build's variable layouts once, lane `perf-2` re-implemented in `src/lib/server/pipelines/config/world.ts`
(~1611–1677; the `origin` rule ~1629–1645) the rules that the database helpers hold: `pubLayoutOf`,
`layoutByReference`, `defaultVariableTemplateFor`, `layoutOfValue` / `resolveVariableTemplate`,
`isAutomaticRow`, `referencedLayoutOf` (in `pipelines/entities/variableTemplates.ts`,
`pipelines/entities/variableLayouts.ts`, `pipelines/boot/seedVariableTemplates.ts`,
`pipelines/registrations/values.ts` 284–291: find each). Each rule now has two homes; the comments at
`variableLayouts.ts` 1471–1472 ("the one lookup the world and the template preview share") and
`variableTemplates.ts` 88–90 ("so the screen and the run agree") are false; the parity test
(`config/variableResolution.int.test.ts:426`) compares the in-memory answer with a **copy** of the rule, not
with `layoutOfValue`.

## Fix

1. **One home per rule.** For each of those rules, extract a **pure** function over rows already in hand (no
   database access), exported from the module that owns the rule today; the database helper becomes "read the
   rows, call the pure function"; `world.ts`'s `variableLayoutLookups` calls the same pure functions over its
   batched rows and its own copies are deleted. No rule's logic changes: move, do not rewrite; where a helper's
   SQL `WHERE` / `ORDER BY` carries part of the rule (uniqueness makes ties impossible: `db/schema.ts`
   6753, 6783–6789; fallback order is by `id` ascending), the pure function states it explicitly and the
   helper's query stays as it is. Keep import directions sane: `world.ts` already imports
   `entities/variableLayouts` statically; do not create a cycle and do not make `defaults.ts`'s import path
   reach `world.ts` (check with a quick import walk and say what you checked). Drop the two dynamic imports in
   `readVariableLayoutRows` (~1564–1569) of modules `world.ts` already loads statically.
2. **Comments true again:** the two comments above describe the shared pure functions.
3. **The parity test tests the real thing:** assert `variableLayoutLookups`' answers against the **database
   helpers themselves** (`await layoutOfValue(db, id, V)` and siblings), and add fixtures: a seed row whose
   key sits on a different variable, an empty-string reference, a preset-level reference to a layout that no
   longer exists, a disabled plugin's layout, a withdrawn row.
4. **Baselines:** both prompt-baseline tests (`pipelines/runtime/unknownEntries.reply.int.test.ts`,
   `sockets/sessions.lairUnknownEntries.int.test.ts`): fingerprints byte-identical to `plans/perf-2-shas-*.txt`
   (final) and statement counts unchanged (Story second world 1036, the Lair 2500): report them. Also run
   `config/variableResolution.int.test.ts`, the variable-layout / template entity tests you touch, and
   `sessions/sessionSettings.runHost.int.test.ts`.

Append a "Scope review and fix task" section to `plans/REPORT-perf-2-2026-11-17.md` (the review found no
behaviour difference in any cut; cut 3 saves nothing in Story, which still builds the narrator name on each
rewind check: listed under What remains).

## Report (under 250 words)

Each rule → its one home (file, function) and its callers; the import walk; fixtures added; baseline shas and
counts; tests and counts with log names; `tsc`; anything not done.
