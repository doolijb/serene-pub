# BRIEF — fnd-2c worker 2 — steps 3–6 of the `sockets/sessions.ts` split (`sessions.pipelines.ts`, `sessions.create.ts`, `sessions.update.ts`, `sessions.layout.ts`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-2c`. You are the only agent editing these files right now. Another lane (`fnd-3`) runs at the same time: it edits test files and comments elsewhere and also runs vitest.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No `sdk:build` is needed in this lane: the SDK is not touched.)

Also: never `git checkout` / `restore` / `git show HEAD:… >` over a file (other lanes' uncommitted work sits in this tree; `sessions.ts` itself carries uncommitted edits that must survive byte for byte); never `prettier --write`; never `kill -9`; never `pkill -f` with a generic pattern; no top-level `await` added anywhere; no full test run and no `npm run build`. Comments state the rule, not the story.

`$S` = `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad`.

## Goal

`src/lib/server/sockets/sessions.ts` is being split into sibling `sessions.*.ts` files by **mechanical moves only**. Steps 1–2 are done (`sessions.shared.ts`, `sessions.messages.ts`; `sessions.ts` is now 8,659 lines). The lane's rule, verbatim from the lane brief:

> **Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved code.** Every name importable from `sockets/sessions` today stays importable from that path (188 importers; `ownBooks.fold.int.test.ts` mocks `./sessions` for `pushSessionToParticipants`: the re-export must stay and the mock must still take effect for the code that calls it; prove it by running that test). `registerSessionHandlers` stays the one entry point and **registers every event in today's order**. A module-level map, cache or lock ends up in exactly one module. […] if a move needs more than that to compile, stop that step and report.

> Per step: no new import cycle (new files import shared helpers from `sessions.shared.ts`, never from `sessions.ts`; an existing cycle is left and named); `tsc` 0 errors; the export set of `sockets/sessions` unchanged.

Every handler is a top-level `export const …Handler`; `registerSessionHandlers` only calls `register(socket, xHandler, emitToUser)` on imported names, so these are pure top-level moves and `registerSessionHandlers` is never touched.

## Files owned

- `src/lib/server/sockets/sessions.ts` — through the tool only, nothing by hand.
- `src/lib/server/sockets/sessions.pipelines.ts`, `sessions.create.ts`, `sessions.update.ts`, `sessions.layout.ts` — new, written by the tool, nothing by hand.
- Scratch `$S/fnd-2c-w2-*`; logs `plans/fnd-2c-w2-*.log`.

Readable: anything. Use the tool `$S/fnd-2c-move.cjs` as it is (worker 1 built and verified it; read it first). Do not change it, the specs `$S/fnd-2c-step3.json` … `step6.json` or any other `$S/fnd-2c-*` script (if one is wrong, stop and report). Do not edit any other file.

## Waiting for vitest

Before each real run of the tool and before each test run, no vitest may be running (a run that loads `sessions.ts` while it is rewritten is spoiled, yours, the supervisor's or the other lane's). Check with `ps -eo pid,etime,args | grep -i vitest | grep -v grep`: **any** line (node, npm exec, sh -c wrapper) means wait. Wait in the foreground with `until ! ps -eo args | grep -i vitest | grep -qv grep; do sleep 20; done` (timeout up to 600000 ms; repeat if it times out), never a blind sleep. Worker 1 once started while a run was still going: check again right before you start.

## Steps

For **each** step `<n>` = 3, 4, 5, 6, in order:

1. `cp src/lib/server/sockets/sessions.ts $S/fnd-2c-w2-before-<n>.ts`; `wc -l` it. `node $S/fnd-2c-top.cjs $S/fnd-2c-w2-before-<n>.ts > $S/fnd-2c-w2-top-<n>.txt`.
2. `node $S/fnd-2c-move.cjs $S/fnd-2c-step<n>.json --dry > $S/fnd-2c-w2-dry-<n>.txt`, then `node $S/fnd-2c-w1-cmp.cjs $S/fnd-2c-w2-dry-<n>.txt $S/fnd-2c-w2-top-<n>.txt $S/fnd-2c-w2-before-<n>.ts`. Every unit's end must equal its statement's end and its start may be earlier only by comment lines; the `leading: "all"` units (marked below) may also carry blank lines between comments (cmp reports those as BLANK: check by eye that they are only the banner comments named below). Otherwise stop and report.
3. Wait for vitest (above), then run the tool for real. Paste its summary into your report.
4. `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors.
5. `NODE_OPTIONS=--max-old-space-size=10240 node $S/fnd-2c-exports.cjs $S/fnd-2c-w2-exports-<n>.txt` then `diff $S/fnd-2c-exports-baseline.txt $S/fnd-2c-w2-exports-<n>.txt` → no difference (86 exports; ignore its "host.ts diagnostics" line).
6. `NODE_OPTIONS=--max-old-space-size=10240 node $S/fnd-2c-cycles.cjs` → every `sessions*.ts` line says `cycle size 1`. If not, stop and report the members.
7. Independent proof: `python3 $S/fnd-2c-w1-proof.py $S/fnd-2c-w2-dry-<n>.txt $S/fnd-2c-w2-before-<n>.ts src/lib/server/sockets/sessions.ts src/lib/server/sockets/<new file>` → every unit verbatim in the new file; every listed difference in `sessions.ts` is an import line, the inserted import / re-export lines, or a dropped blank seam line (say so, with the count). Also `diff <(sed -n '/^export function registerSessionHandlers/,$p' $S/fnd-2c-orig-sessions.ts) <(sed -n '/^export function registerSessionHandlers/,$p' src/lib/server/sockets/sessions.ts)` → empty (registration order unchanged), and `node $S/fnd-2c-verify-top.cjs $S/fnd-2c-orig-sessions.ts` → `bad: 0` (every original unit verbatim exactly once across `sessions*.ts`).
8. `grep -nE 'from "(\./sessions|\$lib/server/sockets/sessions)"' src/lib/server/sockets/sessions.*.ts` → nothing.
9. The test run (below).

Expected units (today's statement lines, after step 2; they shift after each step, the names are what count):

- **Step 3** → `sessions.pipelines.ts`, 21 units: `appletCardFor` 1617, `genreRowFor` 1648, `sessionsModesHandler` 1689, `sessionsGenreOfHandler` 1717, `sessionsUpgradeModeHandler` 1748, `sessionsConvertRulesetHandler` 1784, `sessionsFunctionCandidatesHandler` 1832 (**all**: with the `/* --- the rebinding seams … */` banner above it), `sessionsBindFunctionHandler` 1904, `sessionsNodeSwapOptionsHandler` 2007, `sessionsPipelineCardsHandler` 2118, `sessionsSetNodeRebindHandler` 2145, `sessionsFireActionHandler` 2219 (holds the busy door inline), `sessionsPipelinesHandler` 2674, `sessionsSetSessionPresetHandler` 2731, `sessionsPresetStatusHandler` 2816, `buildSessionActions` 4256, `sessionsActionsHandler` 4310, `sessionsActionsSeenHandler` 4332, `buildSessionFunctions` 4366, `sessionsFunctionsHandler` 4401, `sessionsSetFunctionHandler` 4423.
- **Step 4** → `sessions.create.ts`, 2 units: `MAX_SEEDED_SWAPS` 81 (it sits **inside the import block**: self-check 2 does not cover lines above the last import, so check 7's proof must show the only change there is that unit's two lines — its doc line and the const — gone), `sessionsCreateHandler` 309.
- **Step 5** → `sessions.update.ts`, 3 units: `SeatCardNames` 202 (a type alias), `sessionsSaveDraftHandler` 4795, `sessionsUpdateHandler` 4833.
- **Step 6** → `sessions.layout.ts`, 22 units: `sessionGenres` 3292, `copyLayoutOnFirstOpen` 3314, `panelLayoutAnswer` 3356, `startedFromUpdatedAnswer` 3414, `sessionsPanelLayoutStartedFromUpdatedHandler` 3454, `sessionsPanelLayoutGetHandler` 3481, `clearPlacedWidgetValues` 3513, `sessionsPanelLayoutStartFromHandler` 3563, `isWidgetSettingsPayload` 3624, `seatedWidgetSettings` 3662, `drawableLayout` 3693, `sessionsPanelLayoutSetHandler` 3726, `sessionsLayoutPresetSaveHandler` 3820, `sessionsLayoutPresetRenameHandler` 3896, `sessionsLayoutPresetDeleteHandler` 3943, `sessionsLayoutPresetUsageHandler` 3984, `pushListToOthers` 4029 (**all**: with the `/* ── the L4 verbs … */` banner above it), `managedAnswer` 4040, `sessionsLayoutPresetShareHandler` 4080, `sessionsLayoutPresetCloneHandler` 4117, `sessionsLayoutPresetUpdateHandler` 4152, `sessionsLayoutPresetSetNewSessionLayoutHandler` 4218.

Test runs — wait for vitest, then `ls -d /tmp/serene-pub-vitest-* 2>/dev/null | sort > $S/fnd-2c-w2-tmp-before-<n>.txt`, then exactly this, one run at a time:

```
cd /home/jody/github/serene-pub && T="$(node $S/fnd-2c-tests-for.cjs <n>)" && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 $T > plans/fnd-2c-w2-<n>.log 2>&1"
```

(Each run is 24–50 files, about 5–12 minutes: run it in the background and wait for its completion notice, don't poll in a tight loop.) Read results with `sed 's/\x1b\[[0-9;]*m//g' plans/fnd-2c-w2-<n>.log | grep -E "FAIL|Test Files|Tests "`; never pipe vitest itself into `head`. Baseline: `plans/fnd-2c-0.log` (118 files: the only failure is `allPipelines.int.test.ts` "routes each provider the specs use", a standing failure that sometimes passes). Any other failure is a stop: report it with the failing assertion. Afterwards delete by name only the `/tmp/serene-pub-vitest-*` dirs that are new compared with your before-list and that your run made (if another vitest ran meanwhile, leave any dir you are not sure of and say so).

## Stop and ask when

A move needs any change to a moved line to compile; an import cycle appears; the export set differs; the tool's self-check fails (report its message; do not edit the tool); `--dry` resolves a unit to lines step 2 does not allow; a test fails that does not fail in the baseline. Report instead of improvising; a step that is not green is not followed by the next.

## Done means

Steps 3, 4, 5, 6 landed in order, each with checks 4–9 green.

## Report

Final message: per step — the `--dry` output, `sessions.ts` lines before/after, the new file's lines, the import/re-export lines the tool wrote into `sessions.ts`, the trailing export list, pruned specifiers (counts; names for `sessions.ts`), checks 4–9 with numbers (tests: files/tests passed/failed and which); Noticed, not done. Under 600 words plus the pasted `--dry` outputs.
