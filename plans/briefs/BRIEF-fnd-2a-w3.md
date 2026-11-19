# BRIEF — fnd-2a worker 3 — steps 3 (`bindings.retrieval.ts`) and 4 (`bindings.turnOrder.ts`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-2a`. You are the only agent editing these files right now.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No `sdk:build` is needed in this lane: the SDK is not touched.)

Also: never `git checkout` / `restore` / `git show HEAD:… >` over a file (step 1 already changed `bindings.ts`; HEAD is no longer a restore point); never `prettier --write`; never `kill -9`; never `pkill -f` with a generic pattern. Comments state the rule, not the story. No other product's name in any file.

## Goal

`src/lib/server/pipelines/runtime/bindings.ts` is being split into sibling files by **mechanical moves only**. The lane's rule, verbatim:

> **Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved code.** A handler body is cut from `bindings.ts` and pasted into its new file byte for byte (indentation may shift by the enclosing function's depth and nothing else). Every name importable from `bindings.ts` today stays importable from it (re-export). `coreBindings(run)` keeps returning one map with the same keys. If a move needs a logic change to compile, stop that step and report it.

> New files import shared helpers from `bindings.shared.ts` or other leaves, **never from `bindings.ts`**.

> Module-level constants and caches end up in exactly one module.

Steps 1 and 2 have landed and are verified (`bindings.shared.ts`, `bindings.prompt.ts`). You do steps 3 and 4, **one after the other**: step 4 starts only when every step-3 check is green. If step 3 fails a check you cannot fix inside the rules, stop and report; do not start step 4.

The move tool is written and verified: `$S/fnd-2a-move.cjs` where `$S` = `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad`. Run `node $S/fnd-2a-move.cjs <spec> --dry` first (prints resolved ranges, writes nothing), then without `--dry`. It copies and prunes imports, writes the new file, edits `bindings.ts`, and self-checks that every moved block is byte-identical before writing. The specs are written: `$S/fnd-2a-step3.json`, `$S/fnd-2a-step4.json`. Do not change them; if one is wrong, stop and report.

## Files owned

- `src/lib/server/pipelines/runtime/bindings.ts` (through the tool only)
- `src/lib/server/pipelines/runtime/bindings.retrieval.ts`, `bindings.turnOrder.ts` (new, written by the tool)
- `src/lib/server/pipelines/boot/readsPairing.test.ts` (the `FILES` list only)
- Scratch files `$S/fnd-2a-w3-*`, logs `plans/fnd-2a-w3-*.log`.
- The tool `$S/fnd-2a-move.cjs`: only to fix a bug that blocks a step; say exactly what you changed and why.

Do **not** edit `src/lib/server/pipelines/runtime/bindings.fnd2aKeys.test.ts` (the supervisor's probe) or anything else.

## Expected `--dry` output

Step 3 (paste it into your report): the 22 top units of the spec, in this order — `LORE_MESSAGE_WINDOW` (starting at its own `/**` "How many recent rows…" doc; the `⚠ This file's Unsupplied population is ZERO` note above it stays in `bindings.ts`), `retrievalParamsFrom`, `exclusionsFrom`, `withFingerprints`, `clampListingLimit`, `LORE_LANES`, `LORE_READS`, `LANE_READS`, `CHARACTER_LANE_READS`, `HISTORY_LANE_READS`, `TRIGGER_BANDS`, `TRIGGER_READS`, `loreFor`, `VECTOR_SOURCE_ALIASES`, `LORE_SOURCES`, `DEFAULT_ENTITY_MAX_ENTRIES`, `DEFAULT_ENTITY_MAX_MESSAGES`, `DEFAULT_MAX_MENTIONS`, `SEMANTIC_SEARCH_SOURCES`, `DOCS_BAND`, `RECALLED_LINES_BAND`, `RECALLED_LINES_SHARE`; one run `lorebook-entries … entity-link`; one run `docs-search`. The tool should then import `LORE_LANES` (still read by `SHARED_CORE_HANDLERS`) and `retrievalBindings` into `bindings.ts`, and re-export `exclusionsFrom` and `SEMANTIC_SEARCH_SOURCES` from `./bindings.retrieval`.

Step 4 (re-derive after step 3 lands): top `TURN_STRATEGIES` (its range starts at the long "One next-speaker implementation behind six type ids" doc directly above the one-line doc), `TurnStrategyName`, `turnEntries`; one run `turn-round-robin … turn-unprompted` that starts at the `// The six turn strategies` comment — the `// ── Tasks ──` line above it stays in `bindings.ts` (`keepLeadingLines`). Expected: `TURN_STRATEGIES` and `turnOrderBindings` imported into `bindings.ts`; no re-export.

## For each step, in order

1. Record before: `wc -l` of `bindings.ts`, and the registration count — matches of `/reads<\s*typeof C\.\w+\s*>\(/g` (the regex `readsPairing.test.ts` uses; it spans lines, so count with `node -e` over the file text, not `grep`) summed over `bindings.ts` and every non-test `bindings.*.ts`.
2. `--dry`, compare with the expectation above, then run the tool.
3. Add the new file's path to `FILES` in `boot/readsPairing.test.ts` (after the last `bindings.*.ts` entry already there; same style). Nothing else in that file (`bindings.pluginStorage.ts` missing from the list is known; leave it).
4. `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors.
5. The registration count (step 1's regex) summed over `bindings.ts` + all `bindings.*.ts` non-test files is unchanged.
6. **readsPairing proof**: in the new file, change one handler's `NodeInput<typeof C.<x>>` to a different contract name that exists (e.g. in `bindings.retrieval.ts` the `docs-search` handler's contract; in `bindings.turnOrder.ts` the `turn-pool` handler's), with `md5sum` of the file recorded first. Run only `readsPairing.test.ts` (capped form below), see it fail naming the new file, put the line back, confirm `md5sum` identical, run it again green. (`tsc` may complain while it is broken; that is expected and the break lasts only for that one run.)
7. The test run below. Baseline is exactly 3 failures, all standing: `paramsSlotWiring.test.ts` ×2 and `allPipelines.int.test.ts` "every provider has a dispatch path". Anything else failing — in particular `bindings.fnd2aKeys.test.ts`, which compares the key set, each handler's read declaration and each handler's compiled source with the pre-split baseline (it already ignores the bundler's collision renames such as `templateContext2`) — is a stop: report it with `diff $S/fnd-2a-<keys|reads|src>-baseline.txt $S/fnd-2a-<…>-current.txt`.
8. `git diff --color-moved=zebra --stat -- src/lib/server/pipelines/runtime/bindings.ts` and confirm, with a short script like the supervisor's, that every removed hunk of more than 3 lines is present verbatim in the new file.

Test runs: check `pgrep -af vitest` shows none running (a peer session shares the checkout; if one is running, wait and re-check). Before the run, `ls -d /tmp/serene-pub-vitest-* | sort > $S/fnd-2a-w3-tmp-before.txt`; after, delete by name only dirs new compared with that list. Exactly this form, one run at a time, `<n>` = 3 or 4:

```
cd /home/jody/github/serene-pub && P=src/lib/server/pipelines && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 $P/boot/readsPairing.test.ts $P/boot/declaredReads.test.ts $P/boot/registryHashes.test.ts $P/boot/specHashes.test.ts $P/boot/paramsSlotWiring.test.ts $P/boot/bindingCompat.test.ts $P/runtime/bindings.cardless.test.ts $P/runtime/bindings.relationships.linkHop.test.ts $P/runtime/bindings.s4Emit.test.ts $P/runtime/bindings.fnd2aKeys.test.ts $P/runtime/bindings.entryKnowledge.int.test.ts $P/runtime/bindings.firsthand.int.test.ts $P/runtime/allPipelines.int.test.ts > plans/fnd-2a-w3-<n>.log 2>&1"
```

Read results with `sed 's/\x1b\[[0-9;]*m//g' plans/fnd-2a-w3-<n>.log | grep -E "FAIL|Test Files|Tests "`; never pipe vitest itself into `head`.

## Stop and ask when

A move needs any change to a moved line to compile; an import cycle appears (any `bindings.*.ts` importing `./bindings`); the tool's self-check fails and the cause is not a tool bug; `--dry` differs from the expectation; any test outside the 3 standing failures fails. Report instead of improvising.

## Done means

Steps 3 and 4 landed, each with checks 4–8 green, in that order.

## Report

Final message: per step — the `--dry` output, `bindings.ts` lines before/after, new file lines, the import/export/re-export lines the tool wrote into `bindings.ts`, pruned specifiers, checks 4–8 with numbers; any tool change; Noticed, not done. Under 500 words plus the pasted `--dry` outputs.
