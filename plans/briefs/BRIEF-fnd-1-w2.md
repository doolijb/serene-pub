# BRIEF — lane `fnd-1`, worker w2 — faster type checks (tsc + svelte-check)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-1` (brief `plans/briefs/BRIEF-fnd-1.md`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You have no reason to run `sdk:build` or vitest in this task: don't run either. Another worker runs vitest at the same time; that is expected and you leave it alone.)

## Goal

The lead's grouped verification runs `npx tsc --noEmit -p .` and `npm run check` (`svelte-kit sync && svelte-check
--tsconfig ./tsconfig.json`). Both type-check everything, including 2,504 test files (701k lines, 54% of checked
TypeScript), from scratch every time. Make both faster without any file falling out of type-checking.

## Steps (measure each before and after; record wall seconds and max RSS via `/usr/bin/time -v`)

1. **Baseline.** `NODE_OPTIONS=--max-old-space-size=10240 /usr/bin/time -v npx tsc --noEmit -p . --extendedDiagnostics`
   once (keep the output in `plans/fnd-1-w2-tsc0.log`): files, lines, memory used, check time, total time, error
   count. Then `/usr/bin/time -v npm run check` once (`plans/fnd-1-w2-check0.log`): wall, max RSS, error count.
   Both must already report 0 errors; if not, stop and report the errors (do not fix them).
2. **Incremental tsc.** Add `"incremental": true` and `"tsBuildInfoFile": "./node_modules/.cache/tsc/tsconfig.tsbuildinfo"`
   to `tsconfig.json` `compilerOptions` (under `node_modules`, so already ignored by git). Measure a cold run (no
   buildinfo) and a warm run with no change, and a warm run after touching one test file's content trivially
   (revert the touch afterwards). Confirm svelte-check is not broken or slowed by the option (it reads the same
   file). If `incremental` makes `npm run check` misbehave, keep it out of `tsconfig.json` and propose the
   command-line form (`tsc --noEmit -p . --incremental --tsBuildInfoFile …`) in the report instead.
3. **`svelte-check --incremental`** (supported by the installed 4.7.6: "Use incremental checks with a disk cache
   of svelte2tsx outputs … .svelte-kit"). Measure cold and warm. Use it in `npm run check` only if warm is faster
   and the error output is identical on a clean tree; if it writes anywhere not git-ignored, say where.
4. **Split.** A new `tsconfig.app.json` at the root that `extends: "./tsconfig.json"` and sets only `exclude`:
   the generated `.svelte-kit/tsconfig.json` `exclude` list restated (a child's `exclude` replaces the base's,
   it does not merge; paths in a root config are relative to the root, so `../node_modules/**` becomes
   `node_modules/**` etc.; `include` is inherited unchanged, relative to the base, so don't repeat it — verify
   with `--listFilesOnly`) plus the test files: `src/**/*.test.ts`, `src/**/*.spec.ts`, `scripts/**/*.test.ts` (check what exists). Point `npm run check`
   (and `check:watch`) at it. `npx tsc --noEmit -p .` keeps checking every file, tests included.
   - Before deciding the exclude list, count non-DOM test `.ts` files that import a `.svelte` component (tsc types
     such an import through the ambient `*.svelte` declaration, svelte-check types it fully). If DOM tests
     (`*.dom.test.ts`, `*.dom.test.svelte.ts`) are the ones that import components, keep them in svelte-check
     (exclude only the other test files) and say so; report the count either way.
   - **Coverage proof** (a script in the scratchpad, prefixed `fnd1-w2-`): the set of files svelte-check checks
     today (= `npx tsc -p tsconfig.json --listFilesOnly` restricted to the repo's own files, plus every `.svelte`
     file under `src/`) must be a subset of (tsc's `-p tsconfig.json` list) ∪ (svelte-check's new set = `tsc -p
     tsconfig.app.json --listFilesOnly` own files, plus every `.svelte` under `src/`). Print the three counts and
     the difference (must be empty). Note: `--listFilesOnly` lists files pulled in by imports too, so also list
     files matched by each config's `include`/`exclude` directly if that differs.
   - Measure `npm run check` after the split (cold and, if step 3 is adopted, warm) and the full tsc again.
5. Both `npx tsc --noEmit -p .` and `npm run check` must end at 0 errors under the new configuration.
6. Update `CONTRIBUTING.md`'s test/check section (around lines 70–80) only where a command or what it covers
   changes: one or two plain sentences (what `npm run check` covers now, that `npx tsc --noEmit -p .` covers the
   tests). CLAUDE.md is not yours: put any line the lead should change there in your report.

## Rules (quoted from the lane brief and CLAUDE.md)

- "No product code changes behaviour in this lane: only test infrastructure, test files' database set-up, and tool configuration."
- "no file may fall out of both passes: prove it with a file-count check."
- CLAUDE.md Decisions: a new setting / name outside what is asked is propose-and-wait (★). `tsconfig.app.json`
  and the `tsBuildInfoFile` path are the asked names; anything else new goes in the report as ★, not built.
- Never `prettier --write`; `npx prettier --check` on files you changed (JSON configs included, if prettier covers them).
- Comments state the rule, not the story. No other product's name in any file.
- Never `kill -9` anything; never kill a process you didn't start.

## Files owned

`tsconfig.json`, new `tsconfig.app.json`, `package.json` (the `check` and `check:watch` scripts only),
`CONTRIBUTING.md` (test/check section only), scratch files prefixed `fnd1-w2-` in
`/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/`, logs
`plans/fnd-1-w2-*.log`. Nothing else.

## Stop and ask when

Baseline errors are not 0; a file would fall out of both passes; a change would need editing source files to keep
0 errors; `incremental` or the split changes which errors are reported on an unchanged tree.

## Done means

Before/after table (wall, max RSS, files checked) for tsc cold/warm and `npm run check` cold/warm; the coverage
proof's counts with an empty difference; both commands at 0 errors; prettier --check clean.

## Report

Final message: the table, what you adopted and what you rejected with the measured reason, the coverage counts,
the exact new commands, the test-files-importing-.svelte count, CONTRIBUTING lines changed, lines the lead should
change in CLAUDE.md, anything noticed but not done. Under 500 words.
