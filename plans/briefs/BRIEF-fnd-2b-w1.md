# BRIEF — fnd-2b worker 1 — the move tool for `host.ts`, and steps 1–3 (`host.types.ts`, `host.loreWrites.ts`, `host.helpers.ts`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-2b`. You are the only agent editing these files right now.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No `sdk:build` is needed in this lane: the SDK is not touched.)

Also: never `git checkout` / `restore` / `git show HEAD:… >` over a file (other lanes' uncommitted work sits in this tree; to undo a step, only re-apply your own reverse move); never `prettier --write`; never `kill -9`; never `pkill -f` with a generic pattern; no top-level `await` added anywhere. Comments state the rule, not the story. No other product's name in any file.

## Goal

`src/lib/server/pipelines/runtime/host.ts` (13,150 lines) is being split into sibling files by **mechanical moves only**. The lane's rule, verbatim from the lane brief:

> **Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved code.** Every name importable from `runtime/host` today stays importable from that path (three tests `vi.mock(".../runtime/host", importOriginal)` and 151 files import it). `createHost` stays the one entry point and keeps its closure state. A module-level cache or map ends up in exactly one module. If a move needs a logic change to compile, stop that step and report.

> Per step: no new import cycle (new files import shared helpers from `host.helpers.ts` / `host.types.ts`, never from `host.ts`; the existing cycle with `loreSources.ts` / `loreMatch.ts` is repointed to the new leaf if that removes it, else left and named); `npx tsc --noEmit -p .` 0 errors; then the tests.

You do: **(A)** adapt the previous lane's move tool to `host.ts`; **(B)** add a probe test; **(C)** steps 1, 2, 3, one after the other, each verified before the next.

`$S` = `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad`.

## Files owned

- `src/lib/server/pipelines/runtime/host.ts` — through the tool only, nothing by hand.
- `src/lib/server/pipelines/runtime/host.types.ts`, `host.loreWrites.ts`, `host.helpers.ts` — new, written by the tool, nothing by hand.
- `src/lib/server/pipelines/runtime/loreSources.ts` and `loreMatch.ts` — the one import line from `runtime/host` in each (step 1, C1b).
- `src/lib/server/pipelines/runtime/host.fnd2bKeys.int.test.ts` — new probe (B).
- Scratch `$S/fnd-2b-move.cjs`, `$S/fnd-2b-w1-*`; logs `plans/fnd-2b-w1-*.log`.

Readable: anything. Do not change the specs `$S/fnd-2b-step1.json`, `$S/fnd-2b-step2.json`, `$S/fnd-2b-step3.json` (if one is wrong, stop and report). Do not edit any other file.

## (A) The tool: `$S/fnd-2b-move.cjs`

Copy `$S/fnd-2a-move.cjs` (verified on the previous split; read it whole first) to `$S/fnd-2b-move.cjs` and change only this:

1. The target file is `src/lib/server/pipelines/runtime/host.ts` (rename the constant; messages say `host.ts`).
2. `host.ts` has no `coreBindings`: look it up only when the spec has `entries`, `post` or `group`; die if a spec sets any of those (these specs carry `top` only).
3. When copying imports into the new file, skip a declaration whose module is `./host` **or** `$lib/server/pipelines/runtime/host` (exactly those strings; `./host.types` etc. are copied). Self-check 3 refuses either in the new file.
4. **Type-only imports.** `tsconfig` has `verbatimModuleSyntax: true`, so `import { type A } from "m"` still loads `m` at run time. In `pruneImports`' regeneration, when every kept named specifier has an inline `type` and there is no default or namespace import, emit `import type { A, B } from "m"` (inline `type ` dropped from each). In the comment-preserving branch, if that case would arise, die with a message instead. The import the tool inserts into `host.ts` follows the same rule (all type-only → `import type { … }`; mixed → `{ type A, B }` as now).

Nothing else changes: the self-checks (removed blocks byte-identical in the new file; `host.ts` changed nowhere but the removed ranges and the import/re-export lines; no import of the host module; no moved code using a name left in `host.ts`) stay as they are. Moved declarations get no added `export`; the new file ends with an `export { … }` of moved non-exported names `host.ts` still uses; `host.ts` re-exports every moved name it exported before.

## (B) Probe: `src/lib/server/pipelines/runtime/host.fnd2bKeys.int.test.ts`

Exactly this content (the lane deletes it when it ends):

```ts
/** Lane fnd-2b's probe: the run-time export set of `runtime/host`, unchanged by the split. */
import { expect, test, vi } from "vitest"

vi.mock("$lib/server/db", async () => {
	const { testDbModule } = await import("$lib/server/utils/testDb")
	return testDbModule()
})

test("runtime/host exports the same names", async () => {
	const mod = await import("$lib/server/pipelines/runtime/host")
	expect(Object.keys(mod).sort()).toEqual([
		"HostScopeError",
		"STEP_TYPES_FOR_TEST",
		"createHost",
		"narratorNameFor"
	])
}, 60_000)
```

## (C) Steps

Before the first real run of the tool: `pgrep -af vitest` must show no vitest (the supervisor's baseline run may still be going; a run that loads `host.ts` while you rewrite it is spoiled). Wait and re-check until none.

For **each** step `<n>` = 1, 2, 3, in order:

1. `cp src/lib/server/pipelines/runtime/host.ts $S/fnd-2b-w1-before-<n>.ts`; `wc -l` it.
2. `node $S/fnd-2b-move.cjs $S/fnd-2b-step<n>.json --dry`. Every unit must resolve to the statement lines below (the start may be earlier by the unit's own doc comment lines); otherwise stop and report.
3. Run it for real. Paste its summary into your report.
4. `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors.
5. `node $S/fnd-2b-exports.cjs $S/fnd-2b-w1-exports-<n>.txt` then `diff $S/fnd-2b-exports-baseline.txt $S/fnd-2b-w1-exports-<n>.txt` → no difference (ignore its "host.ts diagnostics" line).
6. `node $S/fnd-2b-cycles.cjs` → after step 1 (with C1b done) every `host*.ts` line must say `cycle size 1`. If a cycle remains or appears, stop and report its members.
7. Independent proof: a short script of your own that diffs `$S/fnd-2b-w1-before-<n>.ts` against the new `host.ts` and confirms every removed line block (contiguous removed lines, outside the import header) appears verbatim, in order, in the new file. Report the count of removed lines and blocks.
8. No new file contains `from "./host"` or `from "$lib/server/pipelines/runtime/host"`: `grep -n` it.
9. The test run (below). Baseline failures: whatever `plans/fnd-2b-0.log` shows failing (the supervisor's pre-change run; read it with the `sed … | grep` form below); the lane's standing list also allows `allPipelines.int.test.ts` "every provider has a dispatch path". Anything else failing is a stop: report it.

Expected statement lines (today's `host.ts`):

- **Step 1** → `host.types.ts`: `PendingFire` 179–198, `HostScope` 200–539, `HostScopeError` 1043, `ChannelShaping` 2243, `CoreHostServices` 2254–2256. Expected after: `host.ts` imports what it still uses from `./host.types` and re-exports `type PendingFire`, `type HostScope`, `HostScopeError`, `type CoreHostServices` from it. **C1b:** in `loreSources.ts`, change `import { HostScopeError, type HostScope } from "$lib/server/pipelines/runtime/host"` to `… from "$lib/server/pipelines/runtime/host.types"`; in `loreMatch.ts`, `import { HostScopeError } from "$lib/server/pipelines/runtime/host"` likewise. Nothing else in either file.
- **Step 2** (re-derive with `--dry`) → `host.loreWrites.ts`: the 24 units from `linkEndId` (today 1366) to `exitsLineLinks` (today 2170–2239). `embeddingModule` / `embeddingApi` (1353–1355) stay for step 3.
- **Step 3** (re-derive) → `host.helpers.ts`: the 39 units of the spec — today 542–1338 except `HostScopeError`, plus `embeddingModule`, `embeddingApi`, `foldedSectionsIn` (2264), and `toCandidate` … `toLoreEntry` (12918–13150). Expected after: `host.ts` holds only its file doc comment, imports, the re-export lines, the `// db is the global Db` comment and `createHost`; `narratorNameFor` and `STEP_TYPES_FOR_TEST` re-exported from `./host.helpers`.

Test runs — check `pgrep -af vitest` shows none first (wait and re-check if one runs), then `ls -d /tmp/serene-pub-vitest-* | sort > $S/fnd-2b-w1-tmp-before.txt`, then exactly this, one run at a time:

```
cd /home/jody/github/serene-pub && T="$(cat $S/fnd-2b-tests.txt) src/lib/server/pipelines/runtime/host.fnd2bKeys.int.test.ts" && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 $T > plans/fnd-2b-w1-<n>.log 2>&1"
```

(`host.*.int.test.ts` in that list already matches the probe; listing it twice is harmless.) Read results with `sed 's/\x1b\[[0-9;]*m//g' plans/fnd-2b-w1-<n>.log | grep -E "FAIL|Test Files|Tests "`; never pipe vitest itself into `head`. Afterwards delete by name only the `/tmp/serene-pub-vitest-*` dirs that are new compared with the before-list.

## Stop and ask when

A move needs any change to a moved line to compile; an import cycle remains or appears; the export set differs; the tool's self-check fails and the cause is not a tool bug; `--dry` resolves a unit to other lines than above; a test outside the baseline/standing failures fails. Report instead of improvising; a step that is not green is not followed by the next.

## Done means

The tool exists; the probe exists; steps 1, 2, 3 landed in order, each with checks 4–9 green.

## Report

Final message: the tool's changes (a line each); per step — the `--dry` output, `host.ts` lines before/after, the new file's lines, the import/export/re-export lines the tool wrote into `host.ts`, the trailing export list, pruned specifiers, checks 4–9 with numbers; anything you changed in the tool beyond (A) and why; Noticed, not done. Under 600 words plus the pasted `--dry` outputs.
