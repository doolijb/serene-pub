# BRIEF — hist-C-w2: the shared `declaredNodeParams` helper and the packager warning `W_WRITES_HISTORY`

Supervisor: lane hist-C. You type; you do not decide names, copy or behaviour beyond this brief. All edits are in the SDK sibling repo `/home/jody/github/serene-pub-sdk` (most of it is uncommitted; edit with Edit only). Report path: `/home/jody/github/serene-pub/plans/briefs/REPORT-hist-C-w2.md` (if the write is refused, put the report in your final message).

## Owner rulings you apply (2026-11-10)

- **Scenes first:** "encouraging pipelines/modders to be targeting scenes first for granular history updates, then history entries second, optimally compiling from scenes to history entries."
- The history check is a **warning, not an error** (P5-style, like `W_SETTING_UNDESCRIBED`).
- The matching conformance law over the catalogue is **not** this lane's (it lands later with the Dungeon Crawler fix). Do not add a conformance requirement.

## Goal

### 1. Move C39's helper into the SDK as `declaredNodeParams`

Today `conformance/src/index.ts:2225-2236` holds a private `declaredParams(d, nodeKey)`: the node's own `config.params`, then every **default** preset's `params` row for that node laid over them (`Object.assign`, in order). Move it, **logic byte-for-byte equivalent** (C39's behaviour must not change), into `sdk/src/document.ts` (already re-exported by `sdk/src/index.ts` through `export * from './document.js'`, so no index edit), as:

```ts
/**
 * 🚧 The param values a document declares for one node: the node's own `config.params`, with
 * every **default** preset's `params` row for it laid over them, in order. What the packager's
 * `W_WRITES_HISTORY` and conformance C39 read a lore write's `entryType` from — one copy for
 * both. Pure.
 * @experimental
 */
export function declaredNodeParams(doc: Pick<SpecDocument, 'nodes' | 'presets'>, nodeKey: string): Record<string, unknown>
```
Put it near the other exported document helpers (not inside an unrelated section). Then in `conformance/src/index.ts` delete the private function and import `declaredNodeParams` from `'@serene-pub/sdk'` (follow the file's existing import lines), replacing its one call site (~2244). Touch nothing else in conformance. If the types of `presets` force a change in logic, stop and report.

### 2. `W_WRITES_HISTORY` in `cli/src/compiler.ts`

Place it right after the loop that compiles `e.pipelines` into `documents` (~1629-1642), with a short comment citing "Scenes first (owner, 2026-11-10)". Follow the `W_SETTING_UNDESCRIBED` pattern (~1764-1795) for the finding shape (`severity: 'warning'`, `file`/`line` from `locate(input.sources, <needle>)`, `code`, `message`, `fix`). Rule:

- For each compiled document `d`: if any node has `definitionId === 'core:inlet/summarize-request'`, skip the document (its save is previewed — exempt).
- For each node with `definitionId === 'core:outlet/create-lore-entry'`: resolve `const t = declaredNodeParams(d, n.key).entryType`. It warns when `t` is a string whose bare id (strip a trailing `@<digits>`) is exactly `core:entry/history`. Absent / other types are silent (the definition default is world lore).
- `message`: `` `pipeline '${d.id}' node '${n.key}' writes history entries directly — history is compiled from scenes` ``
- `fix`: `` `write the event as a scene note (note-scene@1) or a story line; Compile files it under the day's entry` ``
- `locate` needle: the pipeline id `d.id` (falls back to the first source as `locate` already does).
- If `CompileFinding` has an optional field naming the definition (read its JSDoc ~73-95), set it to `'core:outlet/create-lore-entry@1'` only if the sibling warnings set such a field; otherwise leave it out.
- Import `declaredNodeParams` through the existing `from '@serene-pub/sdk'` value import list.
- A warning never makes `ok` false (check how `ok` is computed and confirm).

### 3. Tests: new file `sdk-tests/writesHistory.test.ts`

Follow `sdk-tests/permissionGroups.test.ts`'s `build()` pattern (`compilePlugin` from `'../cli/src/compiler.js'`, `defineExtension`, slug `acme.lab`, `Object.assign(defineExtension(...), { pipelines: [...] })`) and `sdk-tests/loreBuilders.test.ts` for building lore-writing specs with core-catalog's `rememberNote` / `fileLore` (they take a `wiring()` collector from `'../core-catalog/src/shared/calls.js'` and `.defaults((p) => applyWiring(p, w))`). Spec ids under the plugin slug (`acme.lab:spec/...`). For the non-exempt specs use a non-summarize inlet (e.g. `C.userMessage.v1()`, as `sdk-tests/registry.test.ts` does; any inlet that compiles is fine). Cases, under `describe('W_WRITES_HISTORY: a pipeline that writes history directly (scenes first, warning only)', …)`:

1. A `create-lore-entry@1` node with `entryType: 'core:entry/history'` set as the node's own param (find how a literal param is set on a node — `params:` in the config or a preset row; pick the form the SDK supports and say which) warns once; severity `warning`; message names the pipeline and node; `fix` mentions `note-scene@1`; `r.ok` stays as it would be without the warning.
2. History set through a `rememberNote` default (`entryType: historyEntryType`) warns; the same through `fileLore` warns.
3. World lore (`worldLoreEntryType`) stays silent.
4. A spec on `C.summarizeRequest.v1()` that writes history through `rememberNote` is exempt (no warning).
5. `declaredNodeParams`: a default preset's params row overrides the node's own param; a non-default preset's does not.

Assert on `r.findings.filter((f) => f.code === 'W_WRITES_HISTORY')`. Never hand a DOM node to an assertion (none here).

## Files owned (edit only these)

`sdk/src/document.ts` (the helper only), `conformance/src/index.ts` (the import swap only), `cli/src/compiler.ts` (the warning only), `sdk-tests/writesHistory.test.ts` (new) — all under `/home/jody/github/serene-pub-sdk/`.

## Files readable

Anything in both repos. Read large files by line range (`sed -n`), never whole.

## Out of scope (never build)

- `contracts/src/outlets.ts`, guides, `INTEGRATING.md`, `sdk/src/variables.ts`, `core-catalog/` (worker w1 / not this lane).
- A conformance requirement over the catalogue; any change to C39's judgement.
- Any app (`serene-pub`) file. New names beyond `declaredNodeParams` and `W_WRITES_HISTORY`.

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a name not in this brief seems needed; moving the helper would change C39's behaviour; the compiled document shape differs from what this brief assumes (say how, with file:line).

## Done means

- Edits above made.
- From `/home/jody/github/serene-pub-sdk/sdk-tests`, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test writesHistory.test.ts permissionGroups.test.ts loreBuilders.test.ts conformance.test.ts > /tmp/claude-1000/hist-C-w2-tests.log 2>&1; echo test-exit=$?'` then `grep -n "^# \|not ok" /tmp/claude-1000/hist-C-w2-tests.log` (never pipe test output into `head`). If `/tmp/claude-1000` does not exist use the scratchpad you are given. All must pass; name any failure and whether it is yours.
- `npx prettier --check` already fails on these files before your edit; do not run prettier. Match the surrounding style by hand (tabs, single quotes, no semicolons).

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not run `sdk:build` at all; the supervisor does.)
- Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write`.
- Scratch files start with `hist-C-`.

## Report

Changed files with a one-line summary each; how a literal node param is set (case 1); the test command and pass/fail counts (name every failing test and whether it is yours); facts that did not match this brief; Noticed, not done.
