# BRIEF — worker `ss-2a-w1` — the boot fold of session-scope overrides, and the attic's two writes

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `ss-2a` (`plans/briefs/BRIEF-ss-2.md`, its last
section rules). You type; the supervisor has made the design decisions below. Paths below are under
`src/lib/server/` unless absolute.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`.)

Also: never `prettier --write`; never `git checkout / restore / stash` in either repo; never `pkill -f` a generic
pattern. Other lanes are editing other files right now: make small targeted edits, never whole-file rewrites;
re-read a file right before editing it.

## Goal

`registrations.values` becomes the one store of a session's step values (owner 2026-11-15; P2 "Two writers of
one thing is a bug"). Session-scope rows in `pipeline_node_overrides` are folded into it by a per-boot,
idempotent pass, and the 0.5.3 attic stops writing that table. 0.6 is in users' hands: "a change to stored data
ships with a boot pass and a test that a second boot changes nothing."

## Files owned (edit only these)

- NEW `pipelines/boot/sessionOverrideFold.ts` and NEW `pipelines/boot/sessionOverrideFold.int.test.ts`
- `pipelines/boot/bootstrap.ts` — only: register the pass (one block), and add it to the comment list of steps
  between the specs and the docs map's readers (~lines 452–465) saying which tables it writes.
- `pipelines/boot/bootstrap.queries.int.test.ts` / `bootstrap.int.test.ts` — only if the new pass breaks an
  order/statement-count assertion there; say so in your report.
- `attic/finish.ts` — only `carryChatSampling`, `switchOffIgnoredRetrieval`, `textSamplingSlots` and the module
  doc comment's two bullets about them.
- `attic/upgrade.int.test.ts`, `attic/upgrade.faithful.int.test.ts`, `attic/testFixture.ts` — only the
  assertions / snapshot reads about the attic's session sampling picks and search-by-meaning switches.

Readable: anything. Already written for you by the supervisor (do not change it):
`pipelines/registrations/values.ts` `sessionRegistrationKeys(db, sessionId, specSlug)` — the keys of the
session's registrations in force that run that pipeline, in order; empty when none runs it.

## How the run reads a session's step values today (verify in `pipelines/config/world.ts` 963–1114)

- `registrationValueLayers(db, { specSlug, specId, sessionId, registrationKey })` (`registrations/values.ts`
  58–100) picks the run's registration: the one with `registrationKey` that runs the spec, else the first in
  force that runs it (72–75). Its `session` layer = the session's rows with that key, not dropped (80–82).
- `resolvedLayer` = `addressedValues(layer, allDecls)` then `shippedConfigValues(db, spec.id, spec.slug,
  allDecls, stated)` (a seed reference resolved to its row id) — world.ts 1007–1018.
- `pushValues("session", …)` (970–1005) pushes those first; it **skips** a value that is `null`/`undefined`
  (977), a prompt-slot value that is not a number or digit string (982), a prompt id whose row has no fields
  (`resolvePromptFields` returns `{}`), a template value that does not dereference (`derefTemplate` →
  undefined: not an inline `{source}` object and not a number naming a `pipeline_context_templates` row), a
  variable-slot value whose layout does not dereference (`derefLeftover`: not a number naming a
  `variable_templates` row of the address's variable — `resolveVariableTemplate`, world.ts 831–869).
- Then the session-scope override rows of that spec and session are pushed (1066–1114), **except** rows at a
  connection slot (`d.matrixSlot === "connection"`, 815–819, 1075): never read.
- First push at a scope wins per (nodeKey, slot, path). So today a registration value the run can use beats the
  override at the same address; where the registration value is unusable (above) or absent, the override wins.

`allDecls` / `variableKeys` come from `declarationsAndVariableKeys(db, spec.activeVersionId)`
(`pipelines/config/panel/declarations.ts` 817) — use the same function.

## The fold — `foldSessionOverrides(db: Db): Promise<SessionOverrideFoldReport>` (🚧, new)

Rule (from the brief's cold review, exact):
- Per (registration key, address): move the override's value into that key's session layer **only where that
  layer has no usable value** (usable = what `pushValues` would push something for, list above). Each run reads
  its own registration key, else the first — so the targets are **every** key `sessionRegistrationKeys` returns
  for the session and the spec. Dropped registrations do not count (they are not in force).
- **Connection rows at session scope are never read: delete them, do not move them.**
- A session has a registration layer only when its effective registrations run that pipeline. An override for a
  spec with **no session-effective registration** (also: its session row no longer exists; its spec has no
  active version): **leave the row, count it** ("do not invent a layer, do not delete the row").
- Build it from `registrationValueLayers` and `addressedValues`.

Steps per session-scope override row (`scope_kind = 'session'`):
1. Connection slot → delete.
2. Session gone / spec inactive / no keys → leave, count (three counts).
3. For each key, compute the key's resolved session layer exactly as world does (`registrationValueLayers` with
   that `registrationKey`, then `addressedValues` + `shippedConfigValues`). Keys whose layer has a **usable**
   value at the row's address need nothing; the others need the value.
4. No key needs it → delete the row (shadowed: the run never read it).
5. Some keys need it, but the value cannot be held in registration values without changing what the run reads →
   leave the row, count it as unmappable. Unmappable when: the value is `null` (registration values cannot hold
   `null`: `valuesWith` deletes, `pushValues` skips — while the run pushes a `null` override); the address
   (nodeKey, slot) is not declared by the spec's active version; or the value does not round-trip:
   `addressedValues(valuesWith(null, address, value), allDecls)` must give back exactly one entry, at the same
   `nodeKey\u0000slot\u0000path` key, deep-equal to the value (this catches a per-field prompt override and a
   whole-slot object at path `''` of a many-field slot).
6. Otherwise write it onto each needing key with the form's own writer — `patchSessionRow(tx, sessionId, key,
   (row) => ({ values: valuesWith(row.values, address, value) as never }), "upgrade")` from
   `sessions/settingsForm.ts` (489–538; origin `"upgrade"` is the boot passes' origin, see
   `sessions/summariesToRoutine.ts` 68–76) — then delete the row.

One `db.transaction(async (tx) => …)` per session. **Inside `db.transaction(async (tx) => …)` use only `tx` —
the outer `db` deadlocks PGlite silently** (`db/transactionGuard.ts` throws in dev/test). Pass `tx as unknown as
Db` to every helper (`registrationValueLayers`, `declarationsAndVariableKeys`, `shippedConfigValues`,
`patchSessionRow`, the deref lookups). Call `invalidateRegistrations()` (`registrations/resolve.ts`) after a
session that wrote anything.

Cheap when there is nothing: one `select` of session-scope override rows, return a zero report if none (boot
statement counts are watched). A second boot changes nothing: leftover rows are re-judged and left again.

Report shape: `{ moved, shadowed, connections, leftNoSession, leftNoRegistration, leftUnmappable }` (rows). Log
one `console.log` line when anything moved or was deleted, and one `console.warn` line when anything was left
(counts, and that they stay where they are). Module doc comment: what it folds, the rule, where it runs, that it
is idempotent, and "⏳ delete this module once the session scope of `pipeline_node_overrides` is retired" —
pattern `pipelines/boot/replyTickDrop.ts` 1–31. Comments state the rule, not the story.

## Registration in `bootstrap.ts`

Right after the registrations block (`projectRegistrations` + `refitRegistrations`, ~476–491), before
`reconcilePresetBindings`; a short comment saying why there (it needs the projection and the refit, which
decide what is in force). Put its report on `report.sessionOverrideFold` (add the field to `BootstrapReport`).

## The attic (`attic/finish.ts`)

The attic runs after `bootstrapPipelines` (`startup/index.ts` 240–255), so the fold has already run when it
writes. It must write the surviving store directly:
- `carryChatSampling`: for each text sampling slot (`textSamplingSlots` — make it also return the spec's
  `slug`), for each key of `sessionRegistrationKeys(db, session.id, slug)`: set the sampling id at
  `(nodeKey, slot, "")` on that key's session layer **only where that key's own session rows hold no value
  there** ("a row already at that address stays", as `onConflictDoNothing` did), via `patchSessionRow(…,
  "upgrade")` + `valuesWith`. A slot whose spec the session does not run gets nothing (decision: the store has
  no layer for it; name this in the report). Count the session as before when it got at least one value.
- `switchOffIgnoredRetrieval`: the same, at `(nodeKey, "params", "searchByMeaning")`, value
  `SEARCH_BY_MEANING_OFF`; keep its note exactly as worded.
- Update the doc comments of both and the module's two bullets so they name the session's registration values.

## Tests (Done means)

`pipelines/boot/sessionOverrideFold.int.test.ts` (follow `replyTickDrop.int.test.ts` for the test DB set-up).
Cases, each asserting with `buildWorld(db, { sessionId, specId: <slug>, registrationKey })` that **for each
session and key, the session-scope values the run's world resolves are the same before and after the fold**
(compare: from `world.overrides` filtered to `scopeKind === "session"`, the first value per
`nodeKey·slot·path`):
1. old override only (a params value; a prompt id) → moved onto every key's session row; override row gone;
2. session value only → nothing changes;
3. both, registration value usable → override row deleted, registration value kept;
4. both, registration value unusable (`null` is not storable by `valuesWith`, so write the row's `values` json
   directly with a non-number prompt value) → override value moved over it;
5. a spec registered twice in the session (two keys) where one key has its own value → only the other gets it;
6. a connection-slot row → deleted;
7. a row for a spec the session does not register, and a row whose session is gone → left, counted;
8. an unmappable row (value `null`) → left, counted;
9. second run of the pass changes nothing (row counts, registrations values, report all-zero except the left
   counts which repeat).
Plus in `attic/upgrade.int.test.ts` and `attic/upgrade.faithful.int.test.ts`: the attic's sampling pick and
search-by-meaning switch land on the session's registration values (no `pipeline_node_overrides` rows), on the
session's own reply pipeline's steps; a re-run of the wiring changes nothing (the existing idempotency checks).

Run tests only in this capped form, strictly one run at a time, and wait for other lanes' vitest first:

```
cd /home/jody/github/serene-pub; until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-2a-w1-<n>.log 2>&1"; sed 's/\x1b\[[0-9;]*m//g' plans/ss-2a-w1-<n>.log | grep -E "✓|×|FAIL|Error|Test Files|Tests " | tail -40
```

Never pipe vitest itself into `head`. Run: your new test, `pipelines/boot/bootstrap.queries.int.test.ts`,
`pipelines/boot/replyTickDrop.int.test.ts`, `attic/upgrade.int.test.ts`, `attic/upgrade.faithful.int.test.ts`.
Typecheck your files: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E
"sessionOverrideFold|attic/finish|bootstrap" ` (other lanes' errors are not yours; report them only).

## Stop and ask (in your report, do not decide)

A stored shape the fold cannot preserve beyond the list above; a test that only passes by changing what a run
reads; any need to edit a file outside Files owned; any new user-visible wording; a migration.

## Report

Write it to `plans/REPORT-ss-2a-w1-2026-11-16.md`: changed files; the fold's rules as built; every new name;
tests run with results (counts); anything you assumed; Noticed, not done.
