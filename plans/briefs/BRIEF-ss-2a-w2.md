# BRIEF — worker `ss-2a-w2` — the Pipelines card, the panel and the other readers on the one store

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `ss-2a` (`plans/briefs/BRIEF-ss-2.md`, its last
section rules). You type; the supervisor has made the design decisions below. Paths below are under
`src/lib/server/` unless absolute.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`.)

Also: never `prettier --write`; never `git checkout / restore / stash` in either repo; never `pkill -f` a generic
pattern. Other lanes are editing other files right now (`sockets/pipelines.ts` already carries another lane's
uncommitted edits): make small targeted edits, never whole-file rewrites; re-read a file right before editing it.

## Goal

`registrations.values` is the one store of a session's step values (owner 2026-11-15; P2 "Two writers of one
thing is a bug"). Today the Pipelines card in a session writes `pipeline_node_overrides` while the derived
settings form writes the session's registration values, and the panel layers the override **over** the
registration value while the run takes the registration value **first** — so the card can show a value the run
ignores. After this task the card reads and writes the registration values through the form's own writer, and
the panel resolves in the run's order. A sibling worker (`ss-2a-w1`) is writing the boot pass that folds the old
rows into registrations (`pipelines/boot/sessionOverrideFold.ts`); rows it cannot move (a spec the session does
not register, a `null` value, a shape registrations cannot hold) **stay** in the table, and the run keeps
reading them **under** the session's registration values — call them "⏳ leftover rows" below. Your readers
must keep that order: the session's registration value first, a leftover row only where that is absent.

## Files owned (edit only these)

- `pipelines/config/panel/write.ts` — `writeOption`'s session branch (~480–503) and `clearOption`'s (~548–558).
- `pipelines/config/panel/read.ts` — `layers()` (87–159) and the comment at the resolve (~421–438).
- `pipelines/config/world.ts` — the comment above the override loop (~1065–1072) only; no code change.
- `utils/resolveTaskConfig.ts` — `sessionSamplingPick` (~142–184) and its doc comment.
- `sockets/pipelines.ts` — `pipelinesDeletePrompt` (~928–1010) only.
- `pipelines/routines/sessionRoutines.ts` — `dutyParamsOf` (~54–92) only.
- `pipelines/entities/contextTemplateFit.ts` — the override scan at ~445–456 only.
- Tests: a NEW `pipelines/config/panel/sessionValues.int.test.ts`; and the existing tests below where they
  assert the old store after a panel **session** write (change the assertion to the registration values; never
  weaken what is checked).

Readable: anything. Already written for you by the supervisor (do not change it):
`pipelines/registrations/values.ts` `sessionRegistrationKeys(db, sessionId, specSlug)` — the keys of the
session's registrations in force that run that pipeline, in order; empty when none runs it. The form's writer is
`patchSessionRow(db, sessionId, key, patch, origin)` and `valuesWith(values, address, value | null)` in
`sessions/settingsForm.ts` 489–538 (`null` clears the address; a change row left empty is removed). The form
writes **every** key of the pipeline (A9: "one setting, however many triggers run it"), origin `viewer.isAdmin ?
"admin" : "owner"`, and deletes the override row at that address in the same write (settingsForm.ts 700–728).

## Build

1. **Panel session write / clear** (`write.ts`). In the session branch, instead of the override upsert/delete:
   `keys = await sessionRegistrationKeys(db, target.scopeId, at.slug)`; inside one `db.transaction(async (tx) =>
   …)`: for each key `patchSessionRow(tx as unknown as Db, sessionId, key, (row) => ({ values:
   valuesWith(row.values, address, value) as never }), origin)`, then delete the session override row at that
   address (`specId, scopeKind 'session', scopeId, nodeKey, slot, path`) so no leftover lingers under it. Clear is
   the same with `null`. A write of `null` therefore clears (the form's convention, `clear = value === null`) —
   decision recorded by the supervisor. **Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db`
   deadlocks PGlite silently** (`db/transactionGuard.ts` throws in dev/test); check `writeOption`'s callers
   (`sockets/pipelines.ts` `pipelinesSetOption`, `pipelinesSetOptions` ~436–480, and any other) are not already
   inside a transaction with the global `db`. No keys (the session runs no registration of this pipeline): throw
   `OptionNotWritableError` with this provisional sentence, and mark the line `// ★ wording awaits the owner`:
   `"This session does not run this pipeline through any of its registrations, so it has no setting of its own here. Nothing was saved."`
   Do not touch the config branch, the prompt / template / chain checks above it, or `resetConfig`.
2. **Panel read** (`read.ts layers()`): the `preset` map takes the declared defaults and the `instance`,
   `genre`, `preset` registration layers only (as now, highest last). The **session** map (only when
   `viewer.sessionId != null`) is the session registration layer, resolved the same way (`addressedValues` then
   `shippedConfigValues`), values that are `null`/`undefined` skipped; then each ⏳ leftover override row of that
   session added **only at an address the session layer does not state**. Keep `layerOf` setting `"session"` for
   the session layer's keys. The resolve at ~425–438 stays `session → preset → author`, so it is now the run's
   order; rewrite its comment to say so in one or two lines (comments state the rule, not the story). Check every
   other reader of `chain.session` / `chain.preset` in `read.ts` (e.g. `overriddenHere` ~704, `changed` ~727,
   `readingOf`'s `configured` ~742) still means what its comment says now that the session's own values are in
   `session` and no longer in `preset`; report anything that changes meaning.
3. **World** (`world.ts` ~1065–1072): comment only — session-scope override rows are ⏳ leftovers the boot fold
   (`pipelines/boot/sessionOverrideFold.ts`) could not move; read after the session's registration values, so a
   registration value wins at its address. Keep the existing "connection rows are never read" line.
4. **Task sampling** (`resolveTaskConfig.ts sessionSamplingPick`): read the session's registration value first —
   `registrationValueLayers(db, { specSlug: pipeline.specSlug, specId: pipeline.specId, sessionId })`, then
   `addressedValues(layers.session, [{ nodeKey: oracle, slot: "sampling", path: "", control: "sampling-ref" }])`
   at `oracle\u0000sampling\u0000` — and only when that is absent, the ⏳ leftover override row as today. Same
   whole-id rule for both. Fix the doc comment.
5. **Prompt delete** (`sockets/pipelines.ts pipelinesDeletePrompt`): inside a session, "your own selection" is
   also the session's registration value: collect `registrationValueRefs(db, [slot])` with `scopeKind ===
   "session"`, `scopeRef === String(viewer.sessionId)`, `value === row.id`, and `key` among
   `sessionRegistrationKeys(db, viewer.sessionId, params.slug)`; pass them to `deletePrompt` in
   `ignoreRegistrationRefs` (merged with the existing `ownRefs`); **after** the delete succeeds, clear each with
   `patchSessionRow(db, viewer.sessionId, ref.key, (r) => ({ values: valuesWith(r.values, ref, null) as never }),
   origin)` (a refused delete must leave the selection — see the comment there). Keep the override path for
   leftovers. Update the comment "Your own selection has two homes".
6. **Duties** (`sessionRoutines.ts dutyParamsOf`): today the override is applied **over** the registration
   values — the opposite of the run. Make it the run's order: a ⏳ leftover override path applies only where the
   session's own registration layer for `reg.key` does not state it (`registrationValueLayers(db, { specSlug:
   reg.pipeline, sessionId, registrationKey: reg.key }).session?.[at.node]?.params`). Fix the doc comment.
7. **Context-template fit scan** (`contextTemplateFit.ts` ~445–456): beside the override scan, also note the
   session-scope registration values of this spec at `(d.nodeKey, d.slot)` (numbers), the same way
   (`registrationValueRefs(db, [d.slot])`, `scopeKind === "session"`, the row's pipeline being this spec — read a
   row's pipeline as `config/library.ts` ~420–430 does: `specSlug ?? slugOfKey.get(baseKeyOf(key))`). Read the
   refs once per spec, not per declaration.

No new exported names beyond what is listed. No new user-visible wording except the ★ sentence in 1.

## Tests (Done means)

NEW `pipelines/config/panel/sessionValues.int.test.ts` (set-up: copy from `panel/index.int.test.ts` /
`config/worldPipelineLayer.int.test.ts`):
- **the panel and the run resolve the same value** for an address in each case: session registration value
  only; ⏳ leftover override row only; both (registration value wins in both readers). Panel: `namespaceView(db,
  secret, slug, viewer-with-sessionId)` option `value`; run: `buildWorld(db, { sessionId, specId: slug })`, first
  `scopeKind === "session"` entry for the address in `world.overrides`.
- **the Pipelines card's session write lands in registrations and a run uses it**: `writeOption` at session
  scope → no override row, the session's registration rows for every key hold it, `buildWorld` resolves it;
  `clearOption` removes it; a write over a leftover row deletes that row.
- **task sampling keeps the session's pick**: a registration sampling value → `sessionSamplingPick`'s result
  (through `resolveTaskConfig`, as `db/sessionSamplingMigration.int.test.ts` ~259 does); both present →
  registration wins.
- **prompt delete**: a session owner deletes a prompt they selected in that session (a registration value) →
  succeeds, their selection is cleared; a selection held elsewhere still refuses (follow
  `sockets/pipelines.scoping.int.test.ts` ~797–1030).

Existing, run and keep green: `sockets/pipelines.scoping.int.test.ts`,
`sockets/sessions.samplingAdminOnly.int.test.ts`, `pipelines/config/panel/index.int.test.ts`,
`pipelines/config/panel/loadoutRow.int.test.ts`, `pipelines/config/worldPipelineLayer.int.test.ts`,
`pipelines/config/sessionConnection.int.test.ts`, `pipelines/entities/prompts.int.test.ts`,
`pipelines/entities/contextTemplateFit.int.test.ts`, `sessions/settingsForm.int.test.ts`,
`sessions/stepSettings.int.test.ts`, `sockets/sessions.taskReckoning.int.test.ts`,
`db/sessionSamplingMigration.int.test.ts`.

Run tests only in this capped form, strictly one run at a time, and wait for other lanes' vitest first:

```
cd /home/jody/github/serene-pub; until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-2a-w2-<n>.log 2>&1"; sed 's/\x1b\[[0-9;]*m//g' plans/ss-2a-w2-<n>.log | grep -E "✓|×|FAIL|Error|Test Files|Tests " | tail -40
```

Never pipe vitest itself into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout under load.
Typecheck your files: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E
"panel/(read|write)|resolveTaskConfig|sockets/pipelines|sessionRoutines|contextTemplateFit|sessionValues"`
(other lanes' errors are not yours; report them only).

## Stop and ask (in your report, do not decide)

A reader that cannot keep the run's order without changing what a run reads; a caller of `writeOption` inside a
transaction; any need to edit a file outside Files owned; any new user-visible wording beyond the ★ sentence.

## Report

Write it to `plans/REPORT-ss-2a-w2-2026-11-16.md`: changed files; what each reader does now; every new name;
tests run with results (counts); what changed meaning in `read.ts` (step 2); anything you assumed; Noticed, not
done.
