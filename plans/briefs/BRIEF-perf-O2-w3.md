# BRIEF perf-O2-w3 — re-pin `bootstrap.queries.int.test.ts` after the shared document map, and measure

Supervisor: perf-O2 (lane brief `plans/briefs/BRIEF-perf-O2.md`). You are a lane-worker. Paths below are under
`/home/jody/github/serene-pub/src/lib/server/pipelines/` unless absolute.

## Context (already built, do not change)
- `bootstrapPipelines` (`boot/bootstrap.ts` ~`:443-465`) creates one `Map<string, SpecDocument | null>` by spec slug,
  empty, right before `seedCoreSpecs(db, { docs })`. It is first filled in pass 2 (`reconcilePublishedConfigs`,
  `boot/seed.ts`), after pass 1's heals (`healNodeExpose`, `healClauseChains`), and handed on to
  `refitRegistrations(db, undefined, docs)`, `reconcilePresetBindings(db, docs)` and `scanContextTemplateFits(db, docs)`.
  All fill it lazily through `publishedDocuments(db, [slug], docs)` (`registrations/door.ts:72`).
- `seedCoreScripts` (`boot/seedScripts.ts`) reads every core seed-key row once per pass.
- **Baseline before those changes**, second `bootstrapPipelines` on the counting handle (79 published specs):
  total statements **3,840**; `from "pipeline_edges"` selects (= `loadDocument` calls) **173**; `loadDocument` calls seen
  by the test's `vi.mock` **138** over **66** distinct version ids; `pipeline_nodes … spec_version_id` selects **573**;
  `pipeline_scripts` selects by `seed_key` **112**; per-variable offer selects **19**.
- The test file currently holds a **temporary** measurement line (the `;(await import("node:fs")).appendFileSync(...)`
  right after `const qs = queries.slice()`) that appends these numbers to
  `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perf-O2-measure.txt`,
  and a `loaded.length = 0` before the counted boot. Use the line to measure, then **remove the appendFileSync line**
  before you finish (keep `loaded.length = 0` if your new pin uses `loaded`).

## What to do
1. Run the test once as it is and read the new line in `perf-O2-measure.txt` (the "after" numbers). If the edges count
   and the mocked count still differ, find out why (grep for other readers of `pipeline_edges`, or a `loadDocument`
   path the mock cannot see) and say so in your report; do not change source files.
2. Edit `boot/bootstrap.queries.int.test.ts` only:
   - **Node selects:** drop the absolute `toBeLessThanOrEqual(600)` pin. Keep the relative pin against
     `published.length`, and lower its factor to what you measure with a small margin (e.g. measured / published,
     rounded up, plus ~0.5). Comment: the measured count, the published count, and what the remaining selects are
     (per spec: `declarationsAndVariableKeys` ×2 — reconcile and scan —, `chainNodesFor`, the pass-1 `healNodeExpose`,
     `reconcilePlacedNodes`, plus one per document load). Verify that breakdown against what you measure; if it does not
     add up, write what you found instead.
   - **Per-variable offers:** replace the fixed `≤ 25` with a bound by the distinct variables the scan sees: switch the
     drizzle `logger` to record params as well (`logQuery(query: string, params: unknown[])`), and assert the number of
     per-variable offer selects equals the number of distinct `variable_id` params among them (each variable read
     once). Comment the measured number and why.
   - **Document loads (new pin):** on the counted second boot, `loadDocument` runs at most once per published slug.
     Pin both: the `from "pipeline_edges"` count ≤ `published.length` (or ≤ the measured count plus a small margin if
     that is lower — say which and why), and, from the `vi.mock` record `loaded`, no version id is loaded twice
     (`new Set(loaded.map(l => l.versionId)).size === loaded.length`) — **only if that holds when you measure**; if some
     version is legitimately loaded twice, find which step loads it (stack or caller) and pin the measured count instead,
     with the reason in a comment.
   - Keep the full-registry pin (≤ 6) and the per-row `layoutByReference` pin (= 0).
   - **Scripts:** add a pin that `pipeline_scripts` selects by `seed_key` drop by `CORE_SCRIPTS.length - 1` relative to
     the baseline only if you can state it robustly; simpler and preferred: comment the measured count and pin it with a
     small margin, saying what the remaining ones are (`scriptIdFor` from `refDefaults` in `config/named.ts`, per spec).
   - **Order test [C16]:** keep its body. Rewrite its comment to say what is true now: one document map is created
     empty in `bootstrapPipelines` right before `seedCoreSpecs`, first filled in pass 2 (`reconcilePublishedConfigs`)
     after pass 1 heals present versions in place, and handed on to the refit, the preset reconcile and the scan; this
     test fails if any document of a healed version is read before the heal. Remove the sentences "Never hand one map
     across those steps…" / "one map per step is the shape".
   - Write every measured number and the reason for each pin in the test's comments. Comment ratchet: say what the code
     does now; avoid "no longer", "used to", "previously", "deliberately not". Don't cite "baseline" numbers in the
     test comments; only the current measured values.
   - Update the file's header comment if it no longer describes the file.
3. `boot/presetReconcile.ts`, the comment at ~`:100-102` only: it says the map is "created in `bootstrapPipelines`
   after pass 1"; correct it to "created in `bootstrapPipelines` before `seedCoreSpecs` and first filled after pass 1
   (see the comment there)". No other edit in that file.
4. Sanity check of the order test: temporarily invert its final expose assertion, confirm it fails, restore it. Report
   that you did.

## Files owned (edit only these)
`boot/bootstrap.queries.int.test.ts`; `boot/presetReconcile.ts` (the one comment in step 3).

## Out of scope — never touch
Every other file, including all source files of the boot. No SDK edit, migration or setting.

## Rules
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- **Do not run `prettier --write` at all.** `npx prettier --check <file>` only; the test file passed prettier before;
  keep it passing, fixing by hand.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No sdk:build is needed.)
- Never `git checkout`/`restore`/`stash` anything.
- Int tests only inside `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files>`; check
  `pgrep -af "vitest run"` first and wait if another session's run is up. Never pipe vitest into `head`; redirect to
  `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perf-O2-w3-*.log`.
  `console.log` output from tests is not shown in that log; that is why the measurement writes a file.

## Done means
- `boot/bootstrap.queries.int.test.ts` green with the new pins and the temporary line removed; then one run of
  `boot/bootstrap.queries.int.test.ts boot/bootstrap.int.test.ts` together, green.
- `npx tsc --noEmit -p .` shows no error in the test file.

## Report
Final message: the "after" numbers (total statements, edges count, mocked loads and distinct versions, node selects,
scripts-by-seed-key, offers), the explanation of any count gap, each pin with its value and reason, the inversion check,
test results with log paths, tsc and prettier results.
