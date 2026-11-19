# BRIEF — fnd-2a worker 1 — the move tool, and step 1 (`bindings.shared.ts`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-2a`. You are the only agent editing these files right now.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No `sdk:build` is needed in this lane: the SDK is not touched.)

Also: never `git checkout` / `restore`; never `prettier --write`; never `kill -9`; never `pkill -f` with a generic pattern; no top-level `await` added anywhere. Comments state the rule, not the story. No other product's name in any file.

## Goal

`src/lib/server/pipelines/runtime/bindings.ts` (10,363 lines) is being split into sibling files by **mechanical moves only**. The lane's rule, verbatim from the lane brief:

> **Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved code.** A handler body is cut from `bindings.ts` and pasted into its new file byte for byte (indentation may shift by the enclosing function's depth and nothing else). Every name importable from `bindings.ts` today stays importable from it (re-export). `coreBindings(run)` keeps returning one map with the same keys. If a move needs a logic change to compile, stop that step and report it.

> New files import shared helpers from `bindings.shared.ts` or other leaves, **never from `bindings.ts`** (no new import cycle; `bindings.relationships.ts`'s existing back-import of `castEntityRefs` is repointed to the shared module in step 1).

> Module-level constants and caches end up in exactly one module.

Seven steps will reuse one tool, so your job is: **(A)** write that tool, **(B)** use it for step 1, **(C)** verify step 1.

## Files owned

- `src/lib/server/pipelines/runtime/bindings.ts` (only through the tool, plus nothing by hand)
- `src/lib/server/pipelines/runtime/bindings.shared.ts` (new, written by the tool)
- `src/lib/server/pipelines/runtime/bindings.relationships.ts` (one import line and one comment, see B3)
- `src/lib/server/pipelines/boot/readsPairing.test.ts` (the `FILES` list only)
- Scratch: `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/fnd-2a-*` (call it `$S` below), logs `plans/fnd-2a-w1-*.log`.

Readable: anything. Do **not** edit `src/lib/server/pipelines/runtime/bindings.fnd2aKeys.test.ts` (the supervisor's probe) or anything else.

## (A) The tool: `$S/fnd-2a-move.cjs`

Node CommonJS, using the TypeScript compiler API from `/home/jody/github/serene-pub/node_modules/typescript`. `$S/fnd-2a-analyze.cjs` is a working read-only analysis of the same file (top-level statements, the `coreBindings` object-literal entries, the post-literal statements, leading-comment ranges) — start from it.

Invocation: `node $S/fnd-2a-move.cjs <spec.json> [--dry]`. `--dry` prints what it resolved (every unit and run with its 1-based line range and first line of text) and writes nothing.

### Spec (JSON)

```jsonc
{
  "newFile": "bindings.shared.ts",            // sibling of bindings.ts
  "header": "/**\n * …\n */",                 // the new file's doc comment, verbatim
  "top": [                                     // top-level declarations of bindings.ts to move
    { "name": "STATUS" },
    { "name": "SessionCastRead", "leading": "all" },
    { "name": "readsOfDescriptor", "leading": "last" }
  ],
  "entries": ["core:task/card-strokes@1"],     // keys of the coreBindings literal to move (may be empty)
  "keepLeadingLines": { "core:task/turn-round-robin@1": 1 }, // optional, see below
  "post": false,                               // true: move every coreBindings statement after the literal except `return bindings`
  "group": null,                               // or { "name": "promptBindings", "run": true }
  "spreadComment": "// …"                      // one comment line put above the spread in coreBindings (when group is set)
}
```

### Resolving ranges (1-based lines, whole lines only)

- **A top-level unit** = its comment lines + the statement's lines. `leading` picks the comments:
  - `"adjacent"` (default): the comment lines directly above the statement, walking up until a blank line or a non-comment line.
  - `"last"`: only the one comment block (`/** … */` or a run of `//` lines) immediately above the statement.
  - `"all"`: every comment line between the previous top-level statement's last line and this statement (blank lines in between included, leading blank lines excluded).
- **An entry run**: consecutive properties of the `const bindings: Bindings = { … }` literal in `coreBindings` whose keys are all in `entries` form one run. A run's range starts at the first line after the previous property's last line, skipping blank lines, and ends at the last line of its last property (the line that carries its closing `)` and, when present, its `,`). `keepLeadingLines[k]` = n leaves the first n lines of run-start entry `k`'s range in `bindings.ts` (a section header such as `// ── Tasks ──` that heads the entries left behind).
- **The post block** (`post: true`): from the first non-blank line after the literal's closing `\t}` to the last line before `return bindings` (its own leading blank lines excluded).
- Fail loudly if any named unit or key is not found, if a key appears twice, or if a spread property (`...x()`) would be inside a run.

### What it writes

1. **The new file**, in this order: `header`; a blank line; the imports (below); a blank line; the top units in their original order, one blank line between units; then, when `group` is set:
   - no post block: `export function <name>(run: RenderRun = {}): Bindings {` / `\treturn {` / the runs (one blank line between runs) / `\t}` / `}` — omit `run: RenderRun = {}` when `group.run` is false;
   - with a post block: `export function <name>(run: RenderRun = {}): Bindings {` / `\tconst bindings: Bindings = {` / the runs / `\t}` / blank line / the post block / blank line / `\treturn bindings` / `}`.
   Moved lines are written **byte-identical** (entries already sit at two tabs and the post block at one tab, the same depth they have in `coreBindings`, so no re-indentation is needed).
   Then, if any moved top-level name that was not already declared `export` is still referenced from `bindings.ts` after the move, a trailing `export { … }` statement naming those (type-only names — interfaces and type aliases — as `type X`). Do **not** add `export` to a moved declaration's own line.
2. **`bindings.ts`**: the moved ranges removed. Where a top unit is removed and the seam leaves two blank lines, drop one. When `group` is set, the first entry run's lines are replaced by `\t\t<spreadComment>` and `\t\t...<name>(run),` (or `...<name>(),`); later runs are removed outright; the post block is removed (with its leading blank line) and `return bindings` stays. Then, after the last import declaration of the file, add:
   - `import { … } from "./<newFile without .ts>"` for the group function and every moved name still referenced in `bindings.ts` (type-only ones with `type`);
   - `export { … } from "./<newFile without .ts>"` for every moved name that `bindings.ts` declared `export` before the move (type-only ones with `type`).
   Skip either statement when its list is empty.
3. **Imports of the new file**: copy every import declaration of `bindings.ts` (as it is after step 2, with each declaration's own leading comments) into the new file, never one whose module is `./bindings`; then prune.
4. **Prune** both files: remove each import specifier whose local name has no reference outside import declarations, deciding by symbol resolution (`ts.createProgram([file], { noResolve: true, … })` and `checker.getSymbolAtLocation` on each identifier compared with the specifier's own symbol — so a local variable that shadows an import does not count as a use). Remove the specifier's own leading comment lines with it. Remove a declaration left with no specifiers, with its leading comments. Never remove a side-effect import (`import "x"`).
5. **Self-checks, before writing anything** (abort with a message and write nothing if one fails):
   - the concatenation of every removed range (top units in order, then runs in order, then the post block) equals, character for character, the concatenation of the same blocks as written into the new file;
   - no line outside the removed ranges and the inserted import/export/spread lines changed in `bindings.ts` (diff the before/after line arrays);
   - the new file does not import from `./bindings`.
   Print a summary: lines removed from `bindings.ts`, new file line count, the names imported/exported/re-exported, and the import specifiers pruned from each file.

Keep the tool generic: later steps reuse it unchanged for `bindings.prompt.ts` (a group with `run` and a post block), `bindings.retrieval.ts`, `bindings.turnOrder.ts`, `bindings.providers.ts`, `bindings.outlets.ts`, `bindings.summarize.ts`.

## (B) Step 1 — `bindings.shared.ts`

B1. The spec (`$S/fnd-2a-step1.json`), top units only, no entries, no group:

| name | `leading` | today's lines (re-derive with `--dry`) |
|---|---|---|
| `STATUS` | adjacent | 67–96 |
| `bandIntentFrom` | adjacent | 514–562 |
| `SessionCastRead` | **all** (takes the `castEntityNames` note above it too) | 648–725 |
| `castEntityRefs` | adjacent | 727–837 |
| `readsOfDescriptor` | **last** (the one-line `/** Transcript rows as prose … */` above it belongs to `transcriptProseOf` and stays) | 1475–1499 |
| `seatRefLookupOfCandidates` | adjacent | 1673–1698 |
| `stepSlots` | adjacent | 1808–1828 |

Header (verbatim):

```
/**
 * Helpers more than one bindings module reads: the status texts, the band
 * intent read off a source's params, the cast vocabulary and its read shape,
 * a connection descriptor's media reads, the turn-order cast lookup built from
 * candidates, and a step's connection and sampling.
 *
 * A leaf: `bindings.ts` and every `bindings.*.ts` import these from here, and
 * this module imports from no bindings module.
 */
```

Run `--dry` first and paste its resolved ranges into your report. Then run it for real.

B2. Expected result: `bindings.ts` imports `STATUS`, `bandIntentFrom`, `castEntityRefs`, `readsOfDescriptor`, `seatRefLookupOfCandidates`, `stepSlots`, `type SessionCastRead` from `./bindings.shared` (whichever it still references) and re-exports `castEntityRefs` from it. The trailing export list of the new file names the moved non-exported names `bindings.ts` still uses.

B3. In `bindings.relationships.ts`: change `import { castEntityRefs } from "./bindings"` to `from "./bindings.shared"`, and delete the five `// ⚠ A cycle with bindings.ts…` comment lines directly above it (they describe the cycle this removes). Nothing else in that file.

B4. In `boot/readsPairing.test.ts`, add `"src/lib/server/pipelines/runtime/bindings.shared.ts"` to `FILES` (after `bindings.ts`, keep the list's style). Nothing else.

## (C) Verify step 1 (all must pass; report each with numbers)

1. `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors.
2. `git diff --stat -- src/lib/server/pipelines/runtime/bindings.ts` and `git diff --color-moved=zebra -- src/lib/server/pipelines/runtime/` reviewed: every removed line is a moved line; report the counts.
3. `reads<typeof C.…>(` occurrences: `grep -c` over `bindings.ts` + `bindings.shared.ts` after equals `bindings.ts` before (record "before" first; expect it unchanged since shared has no registrations).
4. **readsPairing proof**: `bindings.shared.ts` has no registration, so prove the file is read: temporarily append to it the two comment lines `// reads<typeof C.worldLore>(` and `// 	async (input: NodeInput<typeof C.characterLore>) =>`, run only `readsPairing.test.ts` (capped form below), see it fail naming `bindings.shared.ts`, delete the two lines, `md5sum` before/after identical, run it again green.
5. Tests — check `pgrep -af vitest` shows none running first (a peer session shares the checkout; if one is running, wait and re-check), then exactly this, one run at a time:

```
cd /home/jody/github/serene-pub && P=src/lib/server/pipelines && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 $P/boot/readsPairing.test.ts $P/boot/declaredReads.test.ts $P/boot/registryHashes.test.ts $P/boot/specHashes.test.ts $P/boot/paramsSlotWiring.test.ts $P/boot/bindingCompat.test.ts $P/runtime/bindings.cardless.test.ts $P/runtime/bindings.relationships.linkHop.test.ts $P/runtime/bindings.s4Emit.test.ts $P/runtime/bindings.fnd2aKeys.test.ts $P/runtime/bindings.entryKnowledge.int.test.ts $P/runtime/bindings.firsthand.int.test.ts $P/runtime/allPipelines.int.test.ts > plans/fnd-2a-w1-1.log 2>&1"
```

   Read results with `sed 's/\x1b\[[0-9;]*m//g' plans/fnd-2a-w1-1.log | grep -E "FAIL|Test Files|Tests "` — never pipe vitest itself into `head`. The baseline is exactly 3 failures, all standing: `paramsSlotWiring.test.ts` ×2 and `allPipelines.int.test.ts` "every provider has a dispatch path". Anything else failing — in particular `bindings.fnd2aKeys.test.ts` (it compares the key set, every handler's read declaration and every handler's compiled source against the pre-split baseline) — is yours: stop and report it with the diff of `$S/fnd-2a-*-current.txt` against `$S/fnd-2a-*-baseline.txt`.
   Before the run, `ls -d /tmp/serene-pub-vitest-* | sort > $S/fnd-2a-w1-tmp-before.txt`; after, delete by name only dirs that are new compared with that list.

## Stop and ask when

A move needs any change to a moved line to compile; an import cycle appears that the spec cannot avoid; the tool's self-check fails and the cause is not a tool bug; any test outside the 3 standing failures fails. Report instead of improvising.

## Done means

The tool exists and is generic; step 1 landed; checks C1–C5 green as above.

## Report

Write your report as your final message (the supervisor reads it): the tool's path and a 5-line description of how it resolves ranges and prunes imports; the `--dry` output for step 1; `bindings.ts` line count before/after; `bindings.shared.ts` line count; the import/export/re-export lines the tool wrote into `bindings.ts`; pruned specifiers; C1–C5 results with numbers; anything you noticed but did not do. Under 500 words plus the pasted `--dry` output.
