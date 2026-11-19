# BRIEF — worker `fnd-4-w1`: run-13 failures in `pipelines/boot` and `entries`

Supervisor: lane `fnd-4`. App repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/`.
Your report is your final message (not a file), under about 500 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: the SDK is not to change. If a fix needs the SDK, stop and report.)

## Goal

Each failing test below is one of: **(a)** it pins behaviour a lane changed on purpose → re-pin it, listing old → new
with the reason, never weakening an assertion; **(b)** a real defect → fix the code (small, named below), test
unchanged; **(c)** a flake → prove with three solo reruns, change nothing. The supervisor has done the diagnosis;
verify it before editing (file:line), and if what you find disagrees, stop on that item and report it.

Rules (quoted from the lane brief and CLAUDE.md):
- "Never 'fix' a test by deleting it, skipping it, or loosening a matcher. A registry or spec hash re-pin carries '(was …)'."
- "Comments state the rule, not the story." No lane tags or dates in comments or test titles.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- No new exported name, setting, migration or behaviour. No edits outside **Files owned**.
- `npx prettier --check` only, never `--write`.

## Files owned

- `entries/declarations.test.ts`
- `pipelines/config/panel/write.ts` (one import change, item 2)
- `pipelines/boot/lorebookTriggerControls.int.test.ts`
- `pipelines/boot/retrievalModeCull.int.test.ts`
- `pipelines/boot/specSlugRename.int.test.ts`

Readable: anything. Lane reports: `plans/REPORT-tl-2d-2026-11-16.md`, `plans/REPORT-kn-2a-2026-11-16.md`,
`plans/REPORT-ss-2a-2026-11-16.md`. Failure text: `plans/lead-full13.log` (grep the test title).

## Items

1. **`entries/declarations.test.ts`** "carries each field's declared default…" (line ~161): `expected null to be 1`.
   Kind (a): lane `tl-2d` removed the SDK history type's `year` `default: 1` on purpose (owner ruling: story dates
   never default to Year 1; `core:entry/history@1` hash `1d2cdefaa3b6d2` → `1d00acc7a87392`). Re-pin
   `fieldDefault(HISTORY_TYPE_ID, "year")` to `toBeNull()`; put it with the "declared with no default reads as
   absent" lines.

2. **`pipelines/boot/contentAddressing.int.test.ts`** (4 tests) — kind (b), **test unchanged**. A
   `TransactionDeadlockError`: the second `saveDocument` publish runs `followPresetOnMove` inside its transaction,
   which dynamically imports `config/named`; that module's static graph now reaches the default database:
   `config/named.ts → config/panel/index.ts → config/panel/write.ts → sessions/settingsForm.ts →
   utils/sessionAccess.ts → db/index.ts`. Evaluating `db/index.ts` there starts `initialiseDatabase()` inside the
   transaction's async context, and the guard refuses. The edge was added by lane `ss-2a`
   (`panel/write.ts:40` `import { patchSessionRow, valuesWith } from "$lib/server/sessions/settingsForm"`).
   Fix: drop that static import and load the two functions where they are used (~line 73) with
   `await import("$lib/server/sessions/settingsForm")`, as the rest of `write.ts` already does. Prove it with the
   supervisor's walker: `node /tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/walk.mjs src/lib/server/pipelines/config/named.ts`
   must print `no static path` (if it prints another chain, stop and report the chain; do not chase it).

3. **`pipelines/boot/lorebookTriggerControls.int.test.ts`** "after the change declares none of the four controls
   nothing read" (~88) and **`retrievalModeCull.int.test.ts`** "keeps exactly the controls that are read…"
   (~162): one extra control in each list. Kind (a): lane `kn-2a` added the param `knownToSpeaker` (boolean,
   default `true`) as the last field of every read's `params`, and the bindings read it
   (`params.knownToSpeaker !== false`). Confirm the extra key is `knownToSpeaker` and that it is read
   (`pipelines/runtime/bindings.retrieval.ts`), then add it to the expected lists. Pin what is true today; how the
   control shows on the panel is an open owner question (D36), not yours.

4. **`pipelines/boot/specSlugRename.int.test.ts`** "an install an earlier build left boots onto the new ids…"
   (~569): `expected [] to deeply equal [[3, 'contextBudget', 8.05]]` — the session-scope
   `pipeline_node_overrides` row is gone after boot. Likely kind (a): lane `ss-2a` added the boot pass
   `pipelines/boot/sessionOverrideFold.ts` (run from `boot/bootstrap.ts`), which moves each old session override
   into the session's registration values (`registrations.values`, written with `patchSessionRow`) and deletes the
   old row, or deletes it when every key already holds a usable value there, or leaves it when it cannot be held.
   Find out which branch this row took (read the fold and its report, or log `BootstrapReport.sessionOverrideFold`
   in a scratch run, not committed to the test).
   - Moved: re-pin — the old row is gone **and** the value `param.value + 1` now stands in the session's
     registration values at that node/slot/path on the renamed spec (read it back from the store; assert the
     exact value, not just presence). Keep every other assertion of the test as it is.
   - Deleted because a key already held a usable value: re-pin to assert that, naming the value that holds.
   - Lost (deleted with nothing carrying the value): that is a defect. Change nothing; report the branch,
     file:line and the row.

## Tests

Before every run: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Then exactly:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-4-w1-<n>.log 2>&1"`
One run at a time. Never pipe vitest into `head`. No full run, no `npm run build`, no `tsc` (the supervisor runs it).

## Done means

`entries/declarations.test.ts`, `pipelines/boot/contentAddressing.int.test.ts`,
`pipelines/boot/lorebookTriggerControls.int.test.ts`, `pipelines/boot/retrievalModeCull.int.test.ts`,
`pipelines/boot/specSlugRename.int.test.ts` green in one capped run (apart from anything you report as a defect).

## Report (final message)

Per item: kind, cause (lane, file:line), what you changed (old → new for every pinned assertion), test log and
result. Then `npx prettier --check` result on touched files, and **Noticed, not done**.
