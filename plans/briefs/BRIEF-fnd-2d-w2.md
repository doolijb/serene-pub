# BRIEF — fnd-2d worker 2 — split `sockets/narrativeGraph.ts`, steps 3–5 (`narrativeGraph.merge.ts`, `narrativeGraph.build.ts`, `narrativeGraph.relationships.ts`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-2d`. You are the only agent editing these files right now. Other lanes run at the same time: `io-1` (lorebook export / import; it may touch `narrativeGraph.ts`) and `kn-2a-fix`. Both run vitest.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No `sdk:build` is needed in this lane: the SDK is not touched.)

Also: never `git checkout` / `restore` / `git show HEAD:… >` over a file (other lanes' uncommitted work sits in this tree); never `prettier --write`; never `kill -9`; never `pkill -f` with a generic pattern; no top-level `await` added anywhere; no full test run and no `npm run build`. Comments state the rule, not the story.

`$S` = `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad`.

## Goal

`src/lib/server/sockets/narrativeGraph.ts` (6,194 lines at the start; 3,949 now) is being split into sibling `narrativeGraph.*.ts` files by **mechanical moves only**. Steps 1–2 are done (`narrativeGraph.shared.ts`, `narrativeGraph.apply.ts`, by worker 1 with the same tool). The lane's rule, verbatim from the lane brief:

> **Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved code.** Every name importable from `sockets/narrativeGraph` today stays importable from that path; the registration function stays there and registers every event in today's order. **Module-level state ends up in exactly one module, with the code that uses it**: `buildResumeStates` / `buildResumeScopes` (build only), `buildsBeingApplied` (apply only); if any other module reads one of them, stop that step and report. A handler that closes over registration locals moves only as a function taking them as an explicit argument object; if a move needs more than that to compile, stop that step and report.

> Per step: no new import cycle (new files import from `narrativeGraph.shared.ts`, never from `narrativeGraph.ts`); `tsc` 0 errors; export set unchanged (TS checker).

> 4. `narrativeGraph.build.ts`: build, with its two maps. **`activity.connectionLeak.test.ts` (~322–343) lists this file and requires a `status: "error",` write there**: update its file list in the same step (the only test edit allowed besides a path string a test reads as text).

> 5. `narrativeGraph.relationships.ts`: relationships. Note: lane `time-t6c2` added knowledge-tie refusals to the update / delete handlers; they move with their handlers, unchanged.

Every handler is a top-level `export const …Handler`, and `registerNarrativeGraphHandlers` (the last statement) only calls `register(socket, xHandler, emitToUser)` on those names, so these are pure top-level moves: `registerNarrativeGraphHandlers` itself is never touched.

## Files owned

- `src/lib/server/sockets/narrativeGraph.ts` — through the tool only, nothing by hand.
- `src/lib/server/sockets/narrativeGraph.merge.ts`, `narrativeGraph.build.ts`, `narrativeGraph.relationships.ts` — new, written by the tool, nothing by hand.
- `src/lib/server/sockets/activity.connectionLeak.test.ts` — step 4 only, one path string (below).
- `src/lib/shared/conformance/commentHistory.ratchet.json` — only the `src/lib/server/sockets/narrativeGraph*` keys (below).
- Scratch `$S/fnd-2d-w2-*`; logs `plans/fnd-2d-3.log`, `plans/fnd-2d-4.log`, `plans/fnd-2d-5.log`.

Readable: anything. Do not change the tool `$S/fnd-2d-move.cjs`, the specs `$S/fnd-2d-step*.json` or the supervisor's scripts `$S/fnd-2d-*.cjs` (if one is wrong, stop and report). Do not edit any other file.

## The tool

`$S/fnd-2d-move.cjs` is the move tool used on the last two splits, retargeted to `narrativeGraph.ts`: it skips copying imports of exactly `./narrativeGraph` / `$lib/server/sockets/narrativeGraph`, and self-check 3 refuses those two specifiers in the new file. `node $S/fnd-2d-move.cjs <spec.json> [--dry]`. It refuses to write unless every moved block is byte-identical in the new file (self-check 1), `narrativeGraph.ts` changed nowhere else outside imports (2), the new file does not import `narrativeGraph.ts` (3), and the moved code needs no name that stayed behind (4). It adds to `narrativeGraph.ts` an import of what it still uses from the new module and an `export { … } from` for the moved exported names, prunes unused imports in both files, and ends the new file with an `export { … }` of moved non-exported names `narrativeGraph.ts` still uses. Spec format: `newFile`, `header`, `top: [{ name, leading? }]`; `leading: "all"` takes every comment between the previous statement and the unit (used for detached section banners). Read the tool once before the first run.

## Steps

Before each real tool run and each test run: no vitest may be running (a run that loads `narrativeGraph.ts` while you rewrite it is spoiled). Wait with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done` (foreground, timeout up to 600000 ms, repeat if needed; a pattern without the `^node` anchor matches its own shell and never ends). Never a blind sleep.

For **each** step `<n>` = 3, 4, 5, in order:

0. `git diff --stat -- src/lib/server/sockets/narrativeGraph.ts` and `md5sum` it. Step 3 starts from md5 `71ff1b58f9d2099bd2d85886f0fc1f63` (what step 2 left); each later step from the md5 the previous step left. If it differs, another lane edited the file: note what changed (`diff` against your last copy) in your report and go on — the tool resolves units by name from the file as it is now, and every move carries the bytes it finds. If their edit is inside a block this step moves, say so in the report.
1. `cp src/lib/server/sockets/narrativeGraph.ts $S/fnd-2d-w2-before-<n>.ts`; `wc -l` it. `node $S/fnd-2d-top.cjs $S/fnd-2d-w2-before-<n>.ts > $S/fnd-2d-w2-top-<n>.txt` (start-end of every top-level statement, without comments).
2. `node $S/fnd-2d-move.cjs $S/fnd-2d-step<n>.json --dry`. For every unit: its end line must equal the statement's end in `fnd-2d-w2-top-<n>.txt`, and its start may be earlier than the statement's start only by comment lines (for `leading: "all"` units also blank lines between comments). Otherwise stop and report.
3. Run it for real. Paste its summary into your report. **Step 4 only:** then, in `src/lib/server/sockets/activity.connectionLeak.test.ts` (`FILES`, ~line 325), change the string `"src/lib/server/sockets/narrativeGraph.ts"` to `"src/lib/server/sockets/narrativeGraph.build.ts"` and nothing else. Before that, confirm `grep -c 'status: "error",' src/lib/server/sockets/narrativeGraph.ts` is 0 and the same grep on `narrativeGraph.build.ts` is 4; if not, stop and report.
4. `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors (baseline 0).
5. `NODE_OPTIONS=--max-old-space-size=10240 node $S/fnd-2d-exports.cjs $S/fnd-2d-w2-exports-<n>.txt` then `diff $S/fnd-2d-exports-baseline.txt $S/fnd-2d-w2-exports-<n>.txt` → no difference (16 exports, all values; ignore its "host.ts diagnostics" line).
6. `NODE_OPTIONS=--max-old-space-size=10240 node $S/fnd-2d-cycles.cjs` → every `narrativeGraph*.ts` line says `cycle size 1`. If not, stop and report the members.
7. Proofs: `node $S/fnd-2d-verify-top.cjs $S/fnd-2d-orig-narrativeGraph.ts` → `units verbatim once: 96 bad: 0` (every original top-level unit, with its adjacent comments, appears verbatim exactly once across the `narrativeGraph*.ts` modules; report its per-file counts). Also `node $S/fnd-2b-w1-diff.cjs $S/fnd-2d-w2-before-<n>.ts src/lib/server/sockets/narrativeGraph.ts src/lib/server/sockets/<new file>`; report blocks / removed / missing / added. A "missing" range is acceptable only if it is an import-block range, or a range that spans a banner line which stayed in `narrativeGraph.ts` and whose parts on each side of that line are each verbatim in the new file (check and say which). Also `diff <(sed -n '/^export function registerNarrativeGraphHandlers/,$p' $S/fnd-2d-orig-narrativeGraph.ts) <(sed -n '/^export function registerNarrativeGraphHandlers/,$p' src/lib/server/sockets/narrativeGraph.ts)` → empty.
8. `ls src/lib/server/sockets/narrativeGraph.*.ts | grep -v '\.test\.ts$' | xargs grep -nE 'from "(\./narrativeGraph|\$lib/server/sockets/narrativeGraph)"'` → nothing. Module state: `grep -nE 'buildResumeStates|buildResumeScopes|buildsBeingApplied' src/lib/server/sockets/narrativeGraph*.ts | grep -v '\.test\.ts'` → the two build maps only in the file that holds `buildGraph` (`narrativeGraph.ts` before step 4, `narrativeGraph.build.ts` after), `buildsBeingApplied` only in `narrativeGraph.apply.ts`.
9. Comment ratchet: `node $S/fnd-2d-ratchet.mjs`. Its `diff <file> <recorded> -> <now>` lines name the files whose comment-history count differs from `commentHistory.ratchet.json`. Move the counts for moved comments by editing only the `src/lib/server/sockets/narrativeGraph*` keys of that JSON: set each to its "now" value, add a key for a new file with a nonzero count (alphabetical place: `narrativeGraph.apply.ts` < `narrativeGraph.build.ts` < … < `narrativeGraph.ts`), and remove a `narrativeGraph*` key whose count is now 0. The sum over the `narrativeGraph*` keys must stay 10 and `"total"` stays 533 (do not edit it). Rerun the script: no `diff` line may name a `narrativeGraph*` file. If a `diff` line names any other file, leave it alone and report it. Expected: step 3 no change; step 4 `narrativeGraph.build.ts` 6, `narrativeGraph.ts` 1; step 5 `narrativeGraph.relationships.ts` 1 and the `narrativeGraph.ts` key removed.
10. The test run (below).

Expected units (re-derive with `--dry`; the names are what count):

- **Step 3** → `narrativeGraph.merge.ts`, 16 units: `MEMBER_STORY_KEY` (with the `// ─── A cast member's own story (absorb / undo) ───` banner), `MemberStory`, `rewriteMergeLogCastTags`, `resolveRestoredCastTags`, `isBlankMember`, `memberIsLinked`, `snapshotMemberStory`, `deleteMemberStats`, `stillThere`, `reviveRow`, `restoreMemberStory`, `sameJson`, `restoreCastVersions`, `narrativeGraphMergeNodeHandler` (with the `// ─── Merge Node ───` banner), `absorbPairOf`, `narrativeGraphUndoMergeHandler`. Supervisor's `--dry` on the current file: `MEMBER_STORY_KEY 2051-2063`, `MemberStory 2065-2088`, `rewriteMergeLogCastTags 2090-2178`, `resolveRestoredCastTags 2180-2247`, `isBlankMember 2249-2281`, `memberIsLinked 2283-2374`, `snapshotMemberStory 2376-2431`, `deleteMemberStats 2433-2443`, `stillThere 2445-2460`, `reviveRow 2462-2473`, `restoreMemberStory 2475-2608`, `sameJson 2610-2611`, `restoreCastVersions 2613-2707`, `narrativeGraphMergeNodeHandler 2709-3262`, `absorbPairOf 3264-3273`, `narrativeGraphUndoMergeHandler 3275-3798`. Expected after: `narrativeGraph.ts` re-exports the two handlers and imports them plus `rewriteMergeLogCastTags` and `deleteMemberStats` (the node delete that stays uses them), which the new file's trailing `export { … }` lists.
- **Step 4** → `narrativeGraph.build.ts`, 4 units: `buildResumeStates` (with its one-line comment), `buildResumeScopes`, `narrativeGraphBuildHandler` (with the `// ─── Build (LLM extraction) ───` banner), `buildGraph`. Plus the test path edit in 3.
- **Step 5** → `narrativeGraph.relationships.ts`, 15 units: `EndpointColumns` (with the `// ─── Endpoints ───` banner), `endpointColumns`, `resolveEndpoint`, `endOf`, `assertLinkDate`, `assertLinkScene`, `assertRelationshipWords`, `wayWords`, `reverseWords`, `statedEndpoint`, `narrativeGraphUpdateRelationshipHandler` (with `// ─── Relationship CRUD ───`), `narrativeGraphDeleteRelationshipHandler`, `narrativeGraphCreateRelationshipHandler` (with `// ─── Create Relationship ───`), `narrativeGraphTieSidesHandler` (with `// ─── Ties on the graph … ───`), `narrativeGraphSetTieSideHandler`. Expected after: `narrativeGraph.ts` holds the imports, the list handler, the node delete, the merge-references check, the merge-log list, the two duplicate handlers, the registration and the comments around them (about 700 lines).

Test runs — check no vitest is running first (wait as above), then `ls -d /tmp/serene-pub-vitest-* 2>/dev/null | sort > $S/fnd-2d-w2-tmp-before-<n>.txt`, then exactly this, one run at a time:

```
cd /home/jody/github/serene-pub && T="$(tr '\n' ' ' < $S/fnd-2d-tests-all.txt)" && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 $T > plans/fnd-2d-<n>.log 2>&1"
```

The list is 51 files (every `narrativeGraph*` test, every test that imports `sockets/narrativeGraph`, `knowledgeTiesHidden`, `activity.connectionLeak`, `commentHistory` and the guards that scan socket files); a run takes about a minute. Read results with `sed 's/\x1b\[[0-9;]*m//g' plans/fnd-2d-<n>.log | grep -E "FAIL|Test Files|Tests "`; never pipe vitest itself into `head`. Baseline: `plans/fnd-2d-0.log` (one failure: `wiring.test.ts` "§3 executor options … every RunOptions member has been ruled on", another lane's) and the lead's `plans/lead-full12.log`; a failure is allowed only if the same test fails in one of them. An int test that times out under load: rerun that one file alone once; if it passes alone, report it as a load timeout. Anything else failing is a stop: report it with the failing assertion. Afterwards delete by name only the `/tmp/serene-pub-vitest-*` dirs that are new compared with your before-list and that your run made (if another lane's vitest ran meanwhile, leave any dir you are not sure of and say so).

## Stop and ask when

A move needs any change to a moved line to compile; an import cycle appears; the export set differs; registration text differs; the tool's self-check fails and the cause is not a tool bug; `--dry` resolves a unit to other lines than step 2 allows; a module-level state name ends up in a second module; the `status: "error",` counts differ from step 3's expectation; a test fails that does not fail in a baseline. Report instead of improvising; a step that is not green is not followed by the next.

## Done means

Steps 3, 4 and 5 landed in order, each with checks 4–10 green.

## Report

Final message: per step — the `--dry` output (one line per unit), `narrativeGraph.ts` md5 and lines before/after, the new file's lines, the import/re-export lines the tool wrote into `narrativeGraph.ts`, the trailing export list, checks 4–10 with numbers (tests: files/tests passed/failed and which), the ratchet keys you set; the test path edit; any other lane's edit seen in step 0; Noticed, not done. Under 700 words.
