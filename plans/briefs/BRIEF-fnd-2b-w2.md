# BRIEF — fnd-2b worker 2 — the case-extract tool, steps 4 (`host.read.*.ts`) and 5 (`host.call.ts`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-2b`. You are the only agent editing these files right now.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No `sdk:build` is needed in this lane: the SDK is not touched.)

Also: never `git checkout` / `restore` / `git show HEAD:… >` over a file (steps 1–3 already changed `host.ts`; HEAD is no longer a restore point, and other lanes' uncommitted work sits in this tree; to undo a step, re-apply your own reverse edit); never `prettier --write`; never `kill -9`; never `pkill -f` with a generic pattern; no top-level `await` added anywhere. Comments state the rule, not the story. No other product's name in any file.

## Goal

`src/lib/server/pipelines/runtime/host.ts` is being split by **mechanical moves only**. The lane's rule, verbatim:

> **Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved code.** Every name importable from `runtime/host` today stays importable from that path. `createHost` stays the one entry point and keeps its closure state: `liveChannel`, `liveRowId`, `turnMessageId` and the cases that assign them (`create-message`, `update-message`) **stay inside `createHost`**. If a move needs a logic change to compile (a closure variable that would have to become a parameter counts as a signature change, not a logic change, and is allowed only in the form the inventory describes: a function taking `{ db, scope, host, node, q }` plus the caches it reads), stop that step and report.

> Per step: no new import cycle (new files import shared helpers from `host.helpers.ts` / `host.types.ts`, never from `host.ts`); `npx tsc --noEmit -p .` 0 errors; then the tests.

Steps 1–3 have landed and are verified: `host.types.ts`, `host.loreWrites.ts`, `host.helpers.ts`; `host.ts` (10,852 lines) is now its imports, re-exports and `createHost`. You do step 4 (four sub-steps 4a–4d) and step 5, in that order, each verified before the next.

The supervisor has decided the form: a moved `read` case's block body becomes the body of a module-level `async` function in a new sibling file, taking `HostReadArgs` (`{ db, scope, host, node, q }`) destructured to what it uses, plus the per-host cache or cache reader it uses; the `case` in `host.ts` becomes `case "x":` + `return readX({ db, scope, host, node, q }[, cache])`. Step 5 moves the whole body of `call` into `hostCall(…)` the same way. Moved lines are byte-identical except that each is dedented by the enclosing depth (4 tabs for a `read` case body, 2 for `call`'s body); a line that begins inside a string or template literal keeps every byte.

`$S` = `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad`. The specs are written: `$S/fnd-2b-step4a.json`, `4b`, `4c`, `4d`, `$S/fnd-2b-step5.json`. Do not change them; if one is wrong, stop and report.

## Files owned

- `src/lib/server/pipelines/runtime/host.ts` — through the tool only.
- New, written by the tool: `host.read.lorebookEntries.ts`, `host.read.sessionCast.ts`, `host.read.summarize.ts`, `host.read.retrieval.ts`, `host.call.ts` (all in `src/lib/server/pipelines/runtime/`).
- `src/lib/server/pipelines/runtime/host.types.ts` — one hand edit only, (B) below.
- Scratch `$S/fnd-2b-extract.cjs`, `$S/fnd-2b-w2-*`; logs `plans/fnd-2b-w2-*.log`.

Readable: anything (the previous tool `$S/fnd-2b-move.cjs` is a good base for the import copying, pruning and the `host.ts`-changed-nowhere-else check: reuse its functions). Do not edit `host.fnd2bKeys.int.test.ts` or any other file.

## (A) The tool: `$S/fnd-2b-extract.cjs`

`node $S/fnd-2b-extract.cjs <spec.json> [--dry]`, TypeScript compiler API from `/home/jody/github/serene-pub/node_modules/typescript`. `--dry` prints, per extract, the resolved line ranges (case line, body first–last, closing line) and the B-set (below), and writes nothing.

Spec fields: `newFile`; `header` (the new file's doc comment, verbatim); `imports` (extra import lines added to the new file before pruning); optional `preamble` (text placed after the imports, before the functions); `extract`: list of `{ method, case?, name, bindings, signature, call }`.

Resolving, in `host.ts`: `createHost` → its `const host: CoreHostServices = { … }` → the method property named `method` (`read` / `call`).

- **Case mode** (`case` given): the method body's `switch` → the clause whose expression is the string literal `case`. Require: the clause has exactly one statement, a Block; the clause line, with its leading tabs removed, is exactly `case "<case>": {`; the Block's closing `}` is alone on its line. Body = the lines strictly between. `c` = the clause line's leading tab count; body lines are dedented by `c` tabs. In `host.ts` the lines from the clause line to the closing-brace line become exactly two: `<c tabs>case "<case>":` and `<c+1 tabs><call>`.
- **Method mode** (no `case`): the method's header line ends with `{` and its closing line, trimmed, is `}` or `},`. Body = the lines strictly between. `c` = the header line's leading tab count; body lines dedented by `c` tabs. In `host.ts` the body lines become one line: `<c+1 tabs><call>`.
- **Dedent rule**: an empty line stays empty; a line whose start lies strictly inside a string literal, no-substitution template, template head/middle/tail token stays byte-identical; any other line must start with `c` tabs (die otherwise; also die on a whitespace-only non-empty line) and loses exactly those.
- **New function** text = `signature` + `\n` + dedented body + `\n}`.

Writes: the new file = `header`, blank line, imports, blank line, `preamble` + blank line when given, the functions in spec order separated by one blank line, final newline. Imports = every import declaration of `host.ts` (after the replacement, with each declaration's own leading comments), never one whose module is `./host` or `$lib/server/pipelines/runtime/host`, plus `imports`; then prune by symbol resolution exactly as `fnd-2b-move.cjs` does (including its all-type-only → `import type` rule); then, if two declarations import from the same module and are both `import type` or both plain, merge the later one's specifiers into the earlier one. `host.ts` gets `import { <every extract name> } from "./<newFile without .ts>"` after its last import declaration, then its imports are pruned.

**Self-checks, before writing anything** (abort, write nothing, print why):

1. Re-indenting each dedented body (the `c` tabs put back on exactly the lines that lost them) equals the original body text character for character; and each function text is in the new file verbatim.
2. `host.ts` changed nowhere but the replaced ranges, the inserted import and the pruned import lines (the before/after line-array diff `fnd-2b-move.cjs` uses).
3. The new file imports nothing from `./host` or `$lib/server/pipelines/runtime/host`.
4. **Scope.** On the original `host.ts` (`createProgram([file], { noResolve: true, … })`), for every identifier in the body (shorthand properties through `getShorthandAssignmentValueSymbol`): a declaration in `host.ts` outside the body and inside `createHost` puts its name in **B**; one outside `createHost` puts it in **A**. Require **B == set(`bindings`)** exactly, **A ∩ `bindings` = ∅**, no `this` and no `arguments` in the body. Parse `signature + "}"` as a function and require its parameters' binding names == set(`bindings`) minus nothing — every bound name is used, every used closure name is bound. (For method mode the method's own parameters are in B.)
5. **No fall-through** (case mode): in a copy of the original text with the line `__fnd2bProbe__()` inserted right after the Block's closing-brace line, a `noResolve` program with `allowUnreachableCode: false` reports diagnostic 7027 at the probe. No 7027 there → die (the case could fall through to the next one; a function would return instead).
6. In the new file (`noResolve` program), no 2304/2552 diagnostic names `createHost` or a name declared anywhere inside `createHost`.

Print a summary: `host.ts` lines before/after, new file lines, the import written into `host.ts`, pruned specifiers per file.

## (B) Before 4a: `HostReadArgs` in `host.types.ts` (the one hand edit)

Add `NodeRef` to its `import type { … } from "@serene-pub/sdk"` list (after `HostServices`), and insert, between `CoreHostServices`'s closing `}` and the blank line before `export { type ChannelShaping }`:

```ts

/**
 * What a `read` case that lives outside `createHost` is handed: the host's
 * database, scope and self, the node that asked and its query.
 */
export interface HostReadArgs {
	db: Db
	scope: HostScope
	host: CoreHostServices
	node: NodeRef
	q: Record<string, any>
}
```

Then `tsc` → 0 errors before 4a.

## For each step `<n>` = 4a, 4b, 4c, 4d, 5, in order

1. `cp src/lib/server/pipelines/runtime/host.ts $S/fnd-2b-w2-before-<n>.ts`; `wc -l`.
2. `--dry`. Expected B-sets (these were computed on the code; anything else is a stop): `lorebook_entries` {q, scope, node, db, lorebookReads}; `session_cast` {q, scope, node, db, channelShaping}; `summarize_source` {q, scope, node, db}; `summarize_span` {q, scope, node, db, host}; `embedding_status` {}; `vector_search` {q, scope, node}; `entity_annotations`, `recalled_lines`, `mention_spans`, `entity_link` each {q, scope, node, db}; `call` {payload, handles, scope, node, db, run, host, toolDoors}.
3. Run it for real.
4. `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors. A type error is a stop unless it is in a line the tool wrote (signature, call, import) and the fix keeps every moved line as it is: then report the fix.
5. `node $S/fnd-2b-exports.cjs $S/fnd-2b-w2-exports-<n>.txt` and `diff $S/fnd-2b-exports-baseline.txt $S/fnd-2b-w2-exports-<n>.txt` → identical (ignore the "diagnostics" line).
6. `node $S/fnd-2b-cycles.cjs` → every line `cycle size 1`.
7. `grep -n 'from "./host"\|runtime/host"' <new file>` → nothing.
8. The test run below. Allowed failures: only `allPipelines.int.test.ts` "every provider has a dispatch path" (the baseline `plans/fnd-2b-0.log` and every run since show exactly that one). Anything else is a stop: report it.

Test runs — `pgrep -af vitest` must show none first (wait and re-check), `ls -d /tmp/serene-pub-vitest-* | sort > $S/fnd-2b-w2-tmp-before.txt`, then exactly this, one run at a time:

```
cd /home/jody/github/serene-pub && T="$(cat $S/fnd-2b-tests.txt)" && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 $T > plans/fnd-2b-w2-<n>.log 2>&1"
```

(`host.*.int.test.ts` in the list includes the probe `host.fnd2bKeys.int.test.ts`.) Read results with `sed 's/\x1b\[[0-9;]*m//g' plans/fnd-2b-w2-<n>.log | grep -E "FAIL|Test Files|Tests "`; never pipe vitest itself into `head`. Afterwards delete by name only `/tmp/serene-pub-vitest-*` dirs new compared with the before-list.

## Stop and ask when

A self-check fails and the cause is not a tool bug; a B-set differs from the list above; a moved line would need any change to compile; a cycle appears; the export set differs; a test outside the allowed failure fails. Report instead of improvising; a step that is not green is not followed by the next.

## Done means

The tool exists; `HostReadArgs` added; 4a, 4b, 4c, 4d and 5 landed in order, each with checks 4–8 green.

## Report

Final message: the tool (a 6-line description of how it resolves, dedents and checks); per step — the `--dry` output, `host.ts` lines before/after, new file lines, the import written into `host.ts`, pruned specifiers, checks 4–8 with numbers; any fix beyond the specs and why; Noticed, not done. Under 600 words plus the pasted `--dry` outputs.
