# BRIEF — worker `ss-2a-fix-w1` — the run and the panel call one "would the run use this value?" rule

Repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/`. Supervisor: lane `ss-2a-fix`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to run `sdk:build` in this task: no SDK change.)

Also: never `prettier --write` (nor on a scratch copy); never `git checkout / restore / stash`; no migration; no `npm run build`; no full `npm test`. Inside `db.transaction(async (tx) => …)` use only `tx`. Never pipe vitest into `head`.

## Goal

The supervisor has added the shared rule to `pipelines/registrations/values.ts` (read it: `ValueKinds`,
`valueKindsOf`, `templateOfValue`, `layoutOfValue`, `StoredValueReading`, `readStoredValue`, `sessionLayerAt`,
`addsOnlyAt`). Do not change those signatures; if one is wrong, stop and report. Make `config/world.ts` and the panel
call `readStoredValue`, so no copy of the run's skip rules remains in them, with **no behaviour change in the run**.

### 1. `pipelines/config/world.ts` — the minimum to call the rule (most-read code in the app)

- `derefLayout` (~831–844): body becomes a call to `layoutOfValue(db, value, variableId)` (dynamic
  `await import("$lib/server/pipelines/registrations/values")` inside the closure, as the file does elsewhere: the
  static destructure at ~966 is declared later in the same function). Keep its doc comment, shortened to say the rule
  lives in `values.ts`. `derefLeftover` unchanged.
- `derefTemplate` (~897–917): body becomes `templateOfValue(db, value)` the same way. Keep the ⚠ comment (it is the
  rationale for inline templates), pointing at `values.ts`.
- `pushValues` (~970–1005): build once, before it, `const kinds = { promptSlots, templateSlots, layoutSlots:
  variableSlots, layoutVariables: variableAt }` (world's own sets; `variableAt` is keyed `nodeKey\0slot\0path`, the
  same key `ValueKinds.layoutVariables` uses). In the loop: `const read = await readStoredValue(db, kinds, { nodeKey,
  slot, path }, value); if (!read) continue`, then by `read.kind`: `prompt` → push each field (as now);
  `template` → push `source` then `engine` (exactly what `pushTemplate` pushes, same order); `layout` → push
  `{ ...read.layout, reason: "leftover" as const }` at the path (what `derefLeftover` produced); `value` → push
  `read.value`. The explicit `null`/`undefined` check and the "not a number" check go (they are the rule now).
- Do **not** touch the leftover-override loop (~1066–1116), `pushTemplate`'s other caller, or anything else.
- The pushes must be byte-identical to before: same addresses, values, scopes, order. Before: prompt fields empty →
  nothing pushed; dangling template → nothing; dangling / wrong-variable layout → `push` dropped `undefined`. After:
  `readStoredValue` returns undefined → `continue`. Same.

### 2. `pipelines/config/panel/read.ts` `layers()` (~87–173)

- Get the variable keys alongside the declarations: replace `declarations(db, at.specVersionId)` in `layers()` by
  `declarationsAndVariableKeys(db, at.specVersionId)` (same module, `panel/declarations.ts`; `declarations` is its
  `.decls`), and `const kinds = valueKindsOf(decls, variableKeys)`.
- Session values (~155–156): replace `if (value === undefined || value === null) continue` by
  `if (!(await readStoredValue(db, kinds, address, value))) continue`, where `address` is split from the key
  (`key.split("\u0000")` → nodeKey, slot, path). Update the comment: "The run skips a value it would not use
  (`readStoredValue`); so does this."
- Leftover rows (~165–171): a leftover counts only where the run would use it: skip one for which
  `readStoredValue(db, kinds, address, value)` is undefined. (The run reads a leftover by its own loop; for every
  address the panel shows, it reads the same as the rule.)
- The genre / preset / instance layers: unchanged (out of scope; note it if you see a mismatch).

### 3. Tests

- **New** `pipelines/registrations/values.int.test.ts`: one **table-driven** test of `readStoredValue` (`it.each`
  or a loop over rows `{ name, at, value, expected }`), with a hand-built `ValueKinds` literal and real rows
  inserted with `createTestDb()` from `$lib/server/utils/testDb` (see how
  `pipelines/boot/sessionOverrideFold.int.test.ts` sets up a db and its temp dir `serene-pub-vitest-<name>-`; a
  bootstrap is not needed if plain inserts work). Rows: `null`; `undefined`; prompt slot: a numeric id with fields →
  `{kind:"prompt",fields}`, a digit string `"<id>"` → same, `"abc"` → undefined, `true` → undefined, an id naming no
  row → undefined, a prompt row with `{}` fields → undefined; template slot: a row id → `{kind:"template"}` with its
  engine/source, an id naming no row → undefined, inline `{source:"x"}` → engine is core's, inline `{engine:"j"}` (no
  source) → undefined, a string → undefined; layout slot: a row id for the key's variable → `{kind:"layout"}`, a row
  of another variable → undefined, no row → undefined, a non-number → undefined; a layout key with no variable
  recorded → the row whatever its variable; a plain slot: `0`, `false`, `""`, an object → `{kind:"value", value}`.
  Also a small table for `addsOnlyAt` (pure): one address added on an empty layer → true; one address changed beside
  another kept → true; a path-`""` write that replaces a slot held by path (`{ n: { s: { a: 1, b: 2 } } }` → after
  `{ n: { s: 5 } }`, decls with two declarations on `n·s` at paths `a`, `b`) → false; a write that also drops
  another address → false. Use `valuesWith` from `$lib/server/sessions/settingsForm` to make `after`.
- In `pipelines/config/panel/sessionValues.int.test.ts` add **one** case under "the panel and the run resolve the same
  value": a session registration prompt value naming no prompt row (an id that does not exist) → the panel's option
  source is not `session` and its value equals what the run resolves at that prompt (the run pushes nothing at
  session scope there). Use the prompt declaration of `story-respond` (`d.control === "prompts-ref"`). If the panel's
  option value for a prompt is the id and the run's world holds fields, compare what each reads from the layer below
  (e.g. the panel's `source !== "session"`, the run has no session-scope push at that slot). Keep it small.
- Do not edit any other test.

## Files owned

`pipelines/config/world.ts` (only the three closures/loop above), `pipelines/config/panel/read.ts` (`layers()` only),
`pipelines/registrations/values.int.test.ts` (new), `pipelines/config/panel/sessionValues.int.test.ts` (one case).

## Files readable

Everything. `pipelines/registrations/values.ts` (do not edit), `sessions/settingsForm.ts` (do not edit).

## Out of scope

The leftover loop in `world.ts`; the per-field prompt merge in the panel; the fold and the attic (another worker
owns `pipelines/boot/sessionOverrideFold.ts` and `attic/finish.ts` right now: never touch them); any new name beyond
local variables; any user-visible wording.

## Stop and ask when

A `values.ts` signature does not fit; `world.ts` cannot call the rule without changing what it pushes; a test you
did not write fails in a way that looks caused by this change.

## Done means

Another worker runs vitest too, and so does another lane. Always run through the lane lock, which waits for both
(run it in the background with a long timeout if needed; it may wait):

```
cd /home/jody/github/serene-pub && flock plans/ss-2a-fix.lock bash -c 'until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/registrations/values.int.test.ts src/lib/server/pipelines/config/panel/sessionValues.int.test.ts src/lib/server/pipelines/config/worldPipelineLayer.int.test.ts src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts src/lib/server/pipelines/parity/harness.int.test.ts > plans/ss-2a-fix-w1.log 2>&1"'
```

The same lock wraps `tsc` (below).

All green (the two prompt-baseline tests and the parity harness must pass unchanged: identical prompts). Then
`cd /home/jody/github/serene-pub && flock plans/ss-2a-fix.lock bash -c 'NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/ss-2a-fix-w1.tsc.log 2>&1'`
and `grep -E "world\.ts|panel/read\.ts|registrations/values" plans/ss-2a-fix-w1.tsc.log` → nothing. `npx prettier --check` on the files you edited (report, don't fix by `--write`; hand-fix formatting only
in lines you wrote).

## Report

Write to `plans/REPORT-ss-2a-fix-w1-2026-11-16.md`: changed files with line ranges; the exact `world.ts` diff summary;
tests run with pass counts; anything noticed, not done. Under 300 words.
