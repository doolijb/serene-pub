# BRIEF — fnd-2d worker 1 — split `sockets/narrativeGraph.ts`, steps 1–2 (`narrativeGraph.shared.ts`, `narrativeGraph.apply.ts`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-2d`. You are the only agent editing these files right now. Other lanes run at the same time: `io-1` (lorebook export / import; it may touch `narrativeGraph.ts`) and `kn-2a-fix`. Both run vitest.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No `sdk:build` is needed in this lane: the SDK is not touched.)

Also: never `git checkout` / `restore` / `git show HEAD:… >` over a file (other lanes' uncommitted work sits in this tree); never `prettier --write`; never `kill -9`; never `pkill -f` with a generic pattern; no top-level `await` added anywhere; no full test run and no `npm run build`. Comments state the rule, not the story.

`$S` = `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad`.

## Goal

`src/lib/server/sockets/narrativeGraph.ts` (6,194 lines) is being split into sibling `narrativeGraph.*.ts` files by **mechanical moves only**. The lane's rule, verbatim from the lane brief:

> **Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved code.** Every name importable from `sockets/narrativeGraph` today stays importable from that path; the registration function stays there and registers every event in today's order. **Module-level state ends up in exactly one module, with the code that uses it**: `buildResumeStates` / `buildResumeScopes` (build only), `buildsBeingApplied` (apply only); if any other module reads one of them, stop that step and report. A handler that closes over registration locals moves only as a function taking them as an explicit argument object; if a move needs more than that to compile, stop that step and report.

> Per step: no new import cycle (new files import from `narrativeGraph.shared.ts`, never from `narrativeGraph.ts`); `tsc` 0 errors; export set unchanged (TS checker).

Every handler is already a top-level `export const …Handler`, and `registerNarrativeGraphHandlers` (the last statement) only calls `register(socket, xHandler, emitToUser)` on those names, so these are pure top-level moves: `registerNarrativeGraphHandlers` itself is never touched.

## Files owned

- `src/lib/server/sockets/narrativeGraph.ts` — through the tool only, nothing by hand.
- `src/lib/server/sockets/narrativeGraph.shared.ts`, `narrativeGraph.apply.ts` — new, written by the tool, nothing by hand.
- Scratch `$S/fnd-2d-w1-*`; logs `plans/fnd-2d-1.log`, `plans/fnd-2d-2.log`.

Readable: anything. Do not change the tool `$S/fnd-2d-move.cjs`, the specs `$S/fnd-2d-step*.json` or the supervisor's scripts `$S/fnd-2d-*.cjs` (if one is wrong, stop and report). Do not edit any other file.

## The tool

`$S/fnd-2d-move.cjs` is the move tool used on the last two splits (`fnd-2c-move.cjs`, verified there), retargeted by the supervisor: target `narrativeGraph.ts`; it skips copying imports of exactly `./narrativeGraph` / `$lib/server/sockets/narrativeGraph`, and self-check 3 refuses those two specifiers in the new file. `node $S/fnd-2d-move.cjs <spec.json> [--dry]`. It refuses to write unless every moved block is byte-identical in the new file (self-check 1), `narrativeGraph.ts` changed nowhere else outside imports (2), the new file does not import `narrativeGraph.ts` (3), and the moved code needs no name that stayed behind (4). It adds to `narrativeGraph.ts` an import of what it still uses from the new module and an `export { … } from` for the moved exported names, prunes unused imports in both files, and ends the new file with an `export { … }` of moved non-exported names `narrativeGraph.ts` still uses. Spec format: `newFile`, `header`, `top: [{ name, leading? }]`; `leading: "all"` takes every comment between the previous statement and the unit (used for detached section banners). Read the tool once before the first run.

## Steps

Before each real tool run and each test run: no vitest may be running (a run that loads `narrativeGraph.ts` while you rewrite it is spoiled). Wait with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done` (foreground, timeout up to 600000 ms, repeat if needed; a pattern without the `^node` anchor matches its own shell and never ends). Never a blind sleep.

For **each** step `<n>` = 1, 2, in order:

0. `git diff --stat -- src/lib/server/sockets/narrativeGraph.ts` and `md5sum` it. Step 1 starts from md5 `edc92203dae2374c05ce1b66130f7d0e` (the supervisor's copy is `$S/fnd-2d-orig-narrativeGraph.ts`); step 2 starts from the md5 step 1 left. If it differs, another lane edited the file: note what changed (`diff` against your last copy) in your report and go on — the tool resolves units by name from the file as it is now, and every move carries the bytes it finds. If their edit is inside a block this step moves, say so in the report.
1. `cp src/lib/server/sockets/narrativeGraph.ts $S/fnd-2d-w1-before-<n>.ts`; `wc -l` it. `node $S/fnd-2d-top.cjs $S/fnd-2d-w1-before-<n>.ts > $S/fnd-2d-w1-top-<n>.txt` (start-end of every top-level statement, without comments).
2. `node $S/fnd-2d-move.cjs $S/fnd-2d-step<n>.json --dry`. For every unit: its end line must equal the statement's end in `fnd-2d-w1-top-<n>.txt`, and its start may be earlier than the statement's start only by comment lines (for `leading: "all"` units also blank lines between comments). Otherwise stop and report.
3. Run it for real. Paste its summary into your report.
4. `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors (baseline 0).
5. `NODE_OPTIONS=--max-old-space-size=10240 node $S/fnd-2d-exports.cjs $S/fnd-2d-w1-exports-<n>.txt` then `diff $S/fnd-2d-exports-baseline.txt $S/fnd-2d-w1-exports-<n>.txt` → no difference (16 exports, all values; ignore its "host.ts diagnostics" line, it is a standalone program without the app's ambient types).
6. `NODE_OPTIONS=--max-old-space-size=10240 node $S/fnd-2d-cycles.cjs` → every `narrativeGraph*.ts` line says `cycle size 1`. If not, stop and report the members.
7. Independent proof: `node $S/fnd-2b-w1-diff.cjs $S/fnd-2d-w1-before-<n>.ts src/lib/server/sockets/narrativeGraph.ts src/lib/server/sockets/<new file>` → `missing 0`; report blocks, removed lines, added lines (its message says "host.ts"; it means `narrativeGraph.ts`). Also `diff <(sed -n '/^export function registerNarrativeGraphHandlers/,$p' $S/fnd-2d-orig-narrativeGraph.ts) <(sed -n '/^export function registerNarrativeGraphHandlers/,$p' src/lib/server/sockets/narrativeGraph.ts)` → empty (registration unchanged).
8. `ls src/lib/server/sockets/narrativeGraph.*.ts | grep -v '\.test\.ts$' | xargs grep -nE 'from "(\./narrativeGraph|\$lib/server/sockets/narrativeGraph)"'` → nothing (no new file imports `narrativeGraph.ts`). Step 2 also: `grep -n buildsBeingApplied src/lib/server/sockets/narrativeGraph*.ts | grep -v '\.test\.ts'` → only `narrativeGraph.apply.ts`.
9. The test run (below).

Expected units (re-derive with `--dry`; today's statement lines):

- **Step 1** → `narrativeGraph.shared.ts`, 15 units: `buildDuplicateCandidates` 200, `entryEndpointIndex` 396, `wireRelationship` 439, `sayingOf` 481, `wireRelationships` 516, `relationshipCountsOf` 535, `directEntryOf` 556, `StoryStateRead` 591, `storyStatesOf` 601, `withStoryStates` 645, `emptyBuildCounts` 666, `buildGraphList` 695, `worldLoreOf` 815, `shownNameOfBook` 3572, `afterCastTagRewrite` 3591. The section banners `// ─── List ───` (523), `// ─── Build (LLM extraction) ───` (808) and `// ─── Node CRUD ───` (3563–3569) stay in `narrativeGraph.ts` (they head handlers that stay or move later). Expected after: `narrativeGraph.ts` imports from `./narrativeGraph.shared` what it still uses; no moved unit is exported, so no re-export line; the new file ends with an `export { … }` of the moved names `narrativeGraph.ts` still uses. Expected `--dry` (supervisor's run): `buildDuplicateCandidates 190-207`, `entryEndpointIndex 390-427`, `wireRelationship 429-467`, `sayingOf 480-495`, `wireRelationships 515-521`, `relationshipCountsOf 525-542`, `directEntryOf 544-582`, `StoryStateRead 584-595`, `storyStatesOf 597-625`, `withStoryStates 644-663`, `emptyBuildCounts 665-675`, `buildGraphList 677-786`, `worldLoreOf 810-847`, `shownNameOfBook 3571-3579`, `afterCastTagRewrite 3581-3608`.
- **Step 2** → `narrativeGraph.apply.ts`, 39 units: `keyOfVersion` (632 today), then everything from `MAX_NODE_NAME_LENGTH` (1815, with the `// ─── Apply Proposal ───` banner and the audit comment above it) through `narrativeGraphApplyProposalHandler` (2268–3561), with `capText`, `ApplyRefusal`, `ReadRelationship` and `buildsBeingApplied` taking their detached banners/comments. (Line numbers shift after step 1; the names are what count.) Expected after: `narrativeGraph.ts` has `export { narrativeGraphApplyProposalHandler } from "./narrativeGraph.apply"` and imports it for the registration; `buildsBeingApplied` appears only in `narrativeGraph.apply.ts`.

Test runs — check no vitest is running first (wait as above), then `ls -d /tmp/serene-pub-vitest-* 2>/dev/null | sort > $S/fnd-2d-w1-tmp-before-<n>.txt`, then exactly this, one run at a time:

```
cd /home/jody/github/serene-pub && T="$(tr '\n' ' ' < $S/fnd-2d-tests-all.txt)" && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 $T > plans/fnd-2d-<n>.log 2>&1"
```

The list is 51 files (every `narrativeGraph*` test, every test that imports `sockets/narrativeGraph`, `knowledgeTiesHidden`, `activity.connectionLeak`, and the guards that scan socket files). Run it in the background and wait for it; don't poll in a tight loop. Read results with `sed 's/\x1b\[[0-9;]*m//g' plans/fnd-2d-<n>.log | grep -E "FAIL|Test Files|Tests "`; never pipe vitest itself into `head`. Baseline: the supervisor's pre-change run `plans/fnd-2d-0.log` (read it the same way) and the lead's `plans/lead-full12.log`; a failure is allowed only if the same test fails in one of them. An int test that times out under load: rerun that one file alone once; if it passes alone, report it as a load timeout. Anything else failing is a stop: report it with the failing assertion. Afterwards delete by name only the `/tmp/serene-pub-vitest-*` dirs that are new compared with your before-list and that your run made (if another lane's vitest ran meanwhile, leave any dir you are not sure of and say so).

## Stop and ask when

A move needs any change to a moved line to compile; an import cycle appears; the export set differs; registration text differs; the tool's self-check fails and the cause is not a tool bug; `--dry` resolves a unit to other lines than step 2 allows; a module-level state name ends up in a second module; a test fails that does not fail in a baseline. Report instead of improvising; a step that is not green is not followed by the next.

## Done means

Steps 1 and 2 landed in order, each with checks 4–9 green.

## Report

Final message: per step — the `--dry` output, `narrativeGraph.ts` md5 and lines before/after, the new file's lines, the import/re-export lines the tool wrote into `narrativeGraph.ts`, the trailing export list, pruned specifiers, checks 4–9 with numbers (tests: files/tests passed/failed and which); any other lane's edit seen in step 0; Noticed, not done. Under 600 words plus the pasted `--dry` outputs.
