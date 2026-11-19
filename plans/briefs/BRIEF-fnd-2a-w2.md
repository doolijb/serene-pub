# BRIEF — fnd-2a worker 2 — steps 2 (`bindings.prompt.ts`) and 3 (`bindings.retrieval.ts`)

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

Step 1 has landed (`bindings.shared.ts`, verified). You do steps 2 and 3, **one after the other**: step 3 starts only when every step-2 check is green. If step 2 fails a check you cannot fix inside the rules, stop and report; do not start step 3.

The move tool is written and verified: `$S/fnd-2a-move.cjs` where `$S` = `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad`. Run `node $S/fnd-2a-move.cjs <spec> --dry` first (prints resolved ranges, writes nothing), then without `--dry`. It copies and prunes imports, writes the new file, edits `bindings.ts`, and self-checks that every moved block is byte-identical before writing. The specs are written: `$S/fnd-2a-step2.json`, `$S/fnd-2a-step3.json`. Do not change them; if one is wrong, stop and report.

## Files owned

- `src/lib/server/pipelines/runtime/bindings.ts` (through the tool only)
- `src/lib/server/pipelines/runtime/bindings.prompt.ts`, `bindings.retrieval.ts` (new, written by the tool)
- `src/lib/server/pipelines/boot/readsPairing.test.ts` (the `FILES` list only)
- Scratch files `$S/fnd-2a-w2-*`, logs `plans/fnd-2a-w2-*.log`.
- The tool `$S/fnd-2a-move.cjs`: only to fix a bug that blocks a step; say exactly what you changed and why.

Do **not** edit `src/lib/server/pipelines/runtime/bindings.fnd2aKeys.test.ts` (the supervisor's probe) or anything else.

## Expected `--dry` output

Step 2 (before it runs, lines of today's file): top `playerLabelOf` 1152–1161, `recentStoryOf` 1163–1183, `sideTalkOf` 1185–1194, `scratchpadOf` 1196–1202, `transcriptProseOf` 1208–1230 (starts at the one-line `/** Transcript rows as prose … */`), `envoySpeakerCard` 1232–1251, `replyLabelOf` 1575–1586, `factIdentity` 9869–9895; one run `card-strokes … assemble@2` 5192–6383; post 9207–9864. If `--dry` differs, stop and report.

Step 3: re-derive after step 2 lands; it must list the 22 top units of the spec (`LORE_MESSAGE_WINDOW` starting at its own `/**` "How many recent rows…" doc — the `⚠ This file's Unsupplied population is ZERO` note above it stays in `bindings.ts`), one run `lorebook-entries … entity-link`, and one run `docs-search`. Paste it into your report.

## For each step, in order

1. Record before: `wc -l` of `bindings.ts`, and the registration count — matches of `/reads<\s*typeof C\.\w+\s*>\(/g` (the regex `readsPairing.test.ts` uses; it spans lines, so count with `node -e` over the file text, not `grep`) summed over `bindings.ts` and every non-test `bindings.*.ts`.
2. `--dry`, compare with the expectation above, then run the tool.
3. Add the new file's path to `FILES` in `boot/readsPairing.test.ts` (after the last `bindings.*.ts` entry already there; same style). Nothing else in that file.
4. `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors.
5. The registration count (step 1's regex) summed over `bindings.ts` + all `bindings.*.ts` non-test files is unchanged.
6. **readsPairing proof**: in the new file, change one handler's `NodeInput<typeof C.<x>>` to a different contract name that exists (e.g. in `bindings.prompt.ts` `C.cardStrokes` → `C.cueLines` on the card-strokes handler; in `bindings.retrieval.ts` one in `docs-search`), with `md5sum` of the file recorded first. Run only `readsPairing.test.ts` (capped form below), see it fail naming the new file, put the line back, confirm `md5sum` identical, run it again green. (`tsc` may complain while it is broken; that is expected and the break lasts only for that one run.)
7. The test run below. Baseline is exactly 3 failures, all standing: `paramsSlotWiring.test.ts` ×2 and `allPipelines.int.test.ts` "every provider has a dispatch path". Anything else failing — in particular `bindings.fnd2aKeys.test.ts`, which compares the key set, each handler's read declaration and each handler's compiled source with the pre-split baseline — is a stop: report it with `diff $S/fnd-2a-<keys|reads|src>-baseline.txt $S/fnd-2a-<…>-current.txt`.
8. `git diff --color-moved=zebra --stat -- src/lib/server/pipelines/runtime/bindings.ts` and confirm, with a short script like the supervisor's, that every removed hunk of more than 3 lines is present verbatim in the new file.

Test runs: check `pgrep -af vitest` shows none running (a peer session shares the checkout; if one is running, wait and re-check). Before the run, `ls -d /tmp/serene-pub-vitest-* | sort > $S/fnd-2a-w2-tmp-before.txt`; after, delete by name only dirs new compared with that list. Exactly this form, one run at a time, `<n>` = 2 or 3:

```
cd /home/jody/github/serene-pub && P=src/lib/server/pipelines && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 $P/boot/readsPairing.test.ts $P/boot/declaredReads.test.ts $P/boot/registryHashes.test.ts $P/boot/specHashes.test.ts $P/boot/paramsSlotWiring.test.ts $P/boot/bindingCompat.test.ts $P/runtime/bindings.cardless.test.ts $P/runtime/bindings.relationships.linkHop.test.ts $P/runtime/bindings.s4Emit.test.ts $P/runtime/bindings.fnd2aKeys.test.ts $P/runtime/bindings.entryKnowledge.int.test.ts $P/runtime/bindings.firsthand.int.test.ts $P/runtime/allPipelines.int.test.ts > plans/fnd-2a-w2-<n>.log 2>&1"
```

Read results with `sed 's/\x1b\[[0-9;]*m//g' plans/fnd-2a-w2-<n>.log | grep -E "FAIL|Test Files|Tests "`; never pipe vitest itself into `head`.

## Stop and ask when

A move needs any change to a moved line to compile; an import cycle appears (any `bindings.*.ts` importing `./bindings`); the tool's self-check fails and the cause is not a tool bug; `--dry` differs from the expectation; any test outside the 3 standing failures fails. Report instead of improvising.

## Done means

Steps 2 and 3 landed, each with checks 4–8 green, in that order.

## Report

Final message: per step — the `--dry` output, `bindings.ts` lines before/after, new file lines, the import/export/re-export lines the tool wrote into `bindings.ts`, pruned specifiers, checks 4–8 with numbers; any tool change; Noticed, not done. Under 500 words plus the pasted `--dry` outputs.
