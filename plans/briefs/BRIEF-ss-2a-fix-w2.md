# BRIEF — worker `ss-2a-fix-w2` — the boot fold and the attic call the one rule; the fold never changes another address

Repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/`. Supervisor: lane `ss-2a-fix`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to run `sdk:build` in this task: no SDK change.)

Also: never `prettier --write` (nor on a scratch copy); never `git checkout / restore / stash`; no migration; no `npm run build`; no full `npm test`. Inside `db.transaction(async (tx) => …)` use only `tx` (the fold's loop already uses `t`/`tx`: every call you add inside it takes `t`, never `db`; `db/transactionGuard.ts` throws in tests otherwise). Never pipe vitest into `head`.

## Background (rules this depends on)

- Owner (2026-11-15): "lets focus on just cleaning up the mess". P2: "Two writers of one thing is a bug."
- 0.6 is in users' hands: a change to stored data ships with a boot pass and **a test that a second boot changes
  nothing**.
- The supervisor has added the shared rule to `pipelines/registrations/values.ts` (read it: `valueKindsOf`,
  `readStoredValue` — **the one "would the run use this value?" rule** —, `sessionLayerAt`, `addsOnlyAt`). Do not
  change those signatures; if one is wrong, stop and report. Another worker is editing `config/world.ts` and
  `config/panel/read.ts` right now: never touch them.

## Goal

### 1. `pipelines/boot/sessionOverrideFold.ts`

- Delete the local copy of the run's skip rules: the `promptSlots` / `templateSlots` / `variableSlots` /
  `variableAt` sets (~163–177) and `usable` (~181–208), and the `resolvePromptFields` / `resolveContextTemplate` /
  `resolveVariableTemplate` imports if unused after. Build `const kinds = valueKindsOf(decls, variableKeys)` per row.
- Per key: `const { values, reading } = await sessionLayerAt(t, { specId: spec.id, specSlug: spec.slug, sessionId,
  key, decls, kinds, at: address })`. `reading` undefined → the key needs the row's value (keep `values` with it).
  Else, for the prompt case: the row's own prompt fields come from
  `readStoredValue(t, kinds, address, row.value)` when `address.path === ""` (`kind === "prompt"` → its field names,
  else none); `partial` when the key's `reading.kind === "prompt"` lacks one of them (as today).
- `declared` is checked **per address**, as the header says: `decls.some(d => d.nodeKey === row.nodeKey && d.slot ===
  row.slot && d.path === (row.path ?? ""))` **or** `kinds.layoutVariables.has(addressKey)`.
- **The fold never changes another address.** Before writing, for **each** needing key:
  `addsOnlyAt(values, valuesWith(values, address, row.value), decls, address, row.value)` must be true; if any key
  fails, leave the row and count it `leftUnmappable` (write nothing for any key). This replaces the old
  `back = addressedValues(valuesWith(null, …))` read-back (on an empty layer it is the same check); keep the explicit
  `row.value == null` → unmappable. A path-`""` row on a slot where the key holds values by path is therefore left.
- Update the header comment's rule list to match (the rule is `readStoredValue` in `values.ts`; "declared" per
  address; the merged read-back per key). Comments state the rule, not the story.

### 2. `attic/finish.ts` — `sessionLayerHolds` only (and the one call to it)

- `sessionLayerHolds` answers by the same rule: load the spec's active version (`schema.pipelineSpecs` by
  `spec.specId`), its `declarationsAndVariableKeys` (`config/panel/declarations`), `valueKindsOf`, then
  `sessionLayerAt`. It returns true ("leave it") when `reading` is defined **or** when writing `value` would change
  another address: `!addsOnlyAt(values, valuesWith(values, at, value), decls, at, value)`. So it takes `value` as a new
  last parameter; pass it from `setSessionValue` (its one call, ~270). Update its doc comment to say both. No other
  change in `finish.ts`.

### 3. Tests — `pipelines/boot/sessionOverrideFold.int.test.ts`

- Existing cases unchanged and green.
- **New:** a path-`""` row over by-path values is left and counted, and a second boot changes nothing (report equal
  to the first run's left counts, `moved`/`shadowed` 0, override rows and registration rows byte-equal). To make the
  merged check (not the `declared` check) be what leaves it: find, in `story-respond`'s declarations (or another core
  spec's), a `(nodeKey, slot)` with a declaration at path `""` **and** the key's session layer able to hold other
  paths there (e.g. a slot with several declarations, one at `""`; or a variables slot). Seed the key's session row
  with values by path at that slot (through `patchSessionRow` + `valuesWith`, as the existing tests do), then an
  override row at path `""`. If no declared path-`""` address with by-path siblings exists in any core spec, say so in
  your report and make the case with an undeclared-sibling layout that still exercises `addsOnlyAt`, or fall back to
  asserting it is left by the `declared` check — state which.
- **New:** a registration value naming no prompt row (a dangling id) counts as unusable: the override's prompt moves
  over it, and the run's world reads the same before and after (use the file's `worlds()` helper).
- Attic: `attic/upgrade.int.test.ts` and `attic/upgrade.faithful.int.test.ts` unchanged and green.

## Files owned

`pipelines/boot/sessionOverrideFold.ts`, `pipelines/boot/sessionOverrideFold.int.test.ts`, `attic/finish.ts`
(`sessionLayerHolds` and its one call only).

## Files readable

Everything. `pipelines/registrations/values.ts`, `sessions/settingsForm.ts` (`patchSessionRow`, `valuesWith`): read,
never edit.

## Out of scope

`world.ts`, `panel/read.ts`, the panel's prompt merge, any other part of `finish.ts`, any new exported name, any
user-visible wording, the fold's log lines.

## Stop and ask when

A `values.ts` signature does not fit; an existing fold or attic test fails in a way that looks caused by this change
and the fix is not obvious; a case would need a migration or new data shape.

## Done means

Another worker runs vitest too, and so does another lane. Always run through the lane lock, which waits for both
(run it in the background with a long timeout if needed; it may wait):

```
cd /home/jody/github/serene-pub && flock plans/ss-2a-fix.lock bash -c 'until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/boot/sessionOverrideFold.int.test.ts src/lib/server/attic/upgrade.int.test.ts src/lib/server/attic/upgrade.faithful.int.test.ts src/lib/server/pipelines/boot/replyTickDrop.int.test.ts > plans/ss-2a-fix-w2.log 2>&1"'
```

All green. Then `cd /home/jody/github/serene-pub && flock plans/ss-2a-fix.lock bash -c 'NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/ss-2a-fix-w2.tsc.log 2>&1'`
and `grep -E "sessionOverrideFold|attic/finish|registrations/values" plans/ss-2a-fix-w2.tsc.log` → nothing.
`npx prettier --check` on the files you edited (report; hand-fix only lines you wrote).

## Report

Write to `plans/REPORT-ss-2a-fix-w2-2026-11-16.md`: changed files with line ranges; which slot the path-`""` test
uses and whether the merged check or the declared check leaves it; tests run with pass counts; anything noticed, not
done. Under 300 words.
