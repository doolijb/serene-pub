# BRIEF — build lane `fnd-2a` — split `pipelines/runtime/bindings.ts` by area (programme 0.2, first file)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-file-splits-2026-11-15.md` §1 (the map; **re-derive every line range**, the file has moved
since), `src/lib/server/pipelines/runtime/bindings.relationships.ts` and `bindings.state.ts` (the pattern to
copy), `src/lib/server/pipelines/boot/readsPairing.test.ts`, `declaredReads.test.ts`, `bindingCompat.ts`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write`. Never commit. Delete
only your own `/tmp/serene-pub-vitest-*` dirs by name. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-2a-<n>.log 2>&1"`,
strictly one run at a time (check for a running vitest first; a peer session shares the checkout). No
`sdk:build` is needed; the SDK is not touched.

## The rule of this lane

**Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved
code.** A handler body is cut from `bindings.ts` and pasted into its new file byte for byte (indentation may
shift by the enclosing function's depth and nothing else). Every name importable from `bindings.ts` today stays
importable from it (re-export). `coreBindings(run)` keeps returning one map with the same keys. If a move needs
a logic change to compile, stop that step and report it.

## Steps (one at a time; each ends with its checks green before the next starts)

Follow §1 of the inventory:
1. `bindings.shared.ts` (shared helpers; public ones re-exported from `bindings.ts`).
2. `bindings.prompt.ts` (`promptBindings()`: prompt assembly, the template-context binding and the context
   builders that depend on it, built inside the one function).
3. `bindings.retrieval.ts` (lore lanes with `loreFor`, triggers, vector search, entity search, docs).
4. `bindings.turnOrder.ts`.
5. `bindings.providers.ts` (`generateBinding` / `generateJsonBinding` move with their registrations).
6. `bindings.outlets.ts(run)`.
7. `bindings.summarize.ts(run)`.

For every step:
- New files import shared helpers from `bindings.shared.ts` or other leaves, **never from `bindings.ts`** (no new
  import cycle; `bindings.relationships.ts`'s existing back-import of `castEntityRefs` is repointed to the
  shared module in step 1).
- Add the new file to the named list in `boot/readsPairing.test.ts` (~24–28) **in the same step**, and prove the
  test still inspects it (temporarily break one `reads<…>()` pairing in the new file, see the test fail, restore).
- Module-level constants and caches end up in exactly one module.
- Checks per step: `npx tsc --noEmit -p .` (10 GB heap) 0 errors; the tests
  `pipelines/boot/readsPairing.test.ts`, `declaredReads.test.ts`, `registryHashes.test.ts`, `specHashes.test.ts`,
  `paramsSlotWiring.test.ts`, `runtime/bindingCompat*.test.ts`, every `runtime/bindings.*.test.ts` and
  `bindings.*.int.test.ts`, `runtime/allPipelines.int.test.ts`; failures allowed only if they are in
  `plans/lead-full8.log`'s standing list (`paramsSlotWiring` ×2, `allPipelines` "core:oracle/speak").
- A key-set proof: before step 1 record `Object.keys(coreBindings(run)).sort()` (a throwaway test or script in
  the scratch area); after every step the list is identical.

## Done means

`bindings.ts` is the assembly plus what the inventory says stays (target under ~1,500 lines; report the real
number and what remains and why); all seven checks green after the last step; `NODE_OPTIONS=--max-old-space-size=12288
npm run check` 0 errors; a one-paragraph note in `CONTRIBUTING.md` (or the nearest contributor doc that describes
bindings; inventory) saying where a new binding goes; `NOMENCLATURE.md` untouched unless a new exported name was
unavoidable (then §25).

## Stop and ask when

A step needs a logic change; a cycle cannot be avoided without moving something the inventory says stays; a test
that reads `bindings.ts` as text turns up; the key-set proof differs.

## Report

Final message = the report (lead saves `plans/REPORT-fnd-2a-<date>.md`): per step, lines moved, new file, size
of `bindings.ts` after, checks; the final file list with line counts; anything left in `bindings.ts` and why;
**Noticed, not done**. Under about 600 words.
