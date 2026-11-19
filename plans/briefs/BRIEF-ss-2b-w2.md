# BRIEF — worker `ss-2b-w2` — tests for the two writers and the guard that keeps them the only writers

Repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/` unless absolute. Supervisor: lane `ss-2b`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to run `sdk:build` in this task: don't.)

Also: never `git checkout` / `restore`; never `prettier --write` (nor a scratch-copy equivalent); no `npm run build`, no full test run, no migration, no SDK change.

## Goal

The owner's principle P2: "A module owns its data and every write to it … Two writers of one thing is a bug."
`sessions/settingsWrite.ts` (the supervisor's; read it, do not edit it) holds the only writers of a session's
`genre_fields` and `rigour` columns: `writeGenreFields(tx, sessionId, change)` and `writeRigour(tx, sessionId,
value)`. Another worker (`ss-2b-w1`) is, at the same time, routing every caller through them
(`sessions/settingsForm.ts`, `sockets/sessions.update.ts`, `sockets/sessions.pipelines.ts`,
`sessions/authorsNote.ts`, `speech/resolveVoice.ts`). You write two test files and nothing else.

## Files owned

`src/lib/server/sessions/settingsWrite.int.test.ts` (new), `src/lib/server/sessions/settingsWrite.guard.test.ts` (new).

## Files readable

Anything. Templates: `sessions/authorsNote.int.test.ts` (`createTestDb()`, seeding a user and a session),
`src/lib/shared/conformance/socketEgress.test.ts` (the repo's source-scanning conformance pattern: `walk`, the
TypeScript compiler API, an allow-list checked in both directions with a reason per entry, header comment).
Copy machinery, don't import from a `.test.ts`.

## 1. `settingsWrite.int.test.ts`

Against a real test DB (`createTestDb()`; `vi.setConfig({ testTimeout: 60_000 })`). Detect "no write" by first
setting the row's `updated_at` to a fixed past time with raw SQL and asserting it did not move (the schema's
`$onUpdate` moves it on every drizzle update). Cases:
- `writeGenreFields` writes `change`'s result, returns `{ written: true, genreFields }`, and `change` received
  what is stored (`{}` when the column is null).
- `change` returns `null` → nothing written, `{ written: false, genreFields: <stored> }`.
- `change` returns an equal object → nothing written.
- a missing session → `change` is not called, `{ written: false, genreFields: {} }`.
- **re-reads inside the transaction**: read the row (stale copy), then write key `b` outside, then
  `db.transaction((tx) => writeGenreFields(tx, id, (cur) => ({ ...cur, a: 1 })))` → both `a` and `b` stored.
- a throw after the write inside the caller's transaction rolls the write back.
- `writeRigour`: writes a different value (returns true), returns false and writes nothing for the same value
  and for a missing session.

## 2. `settingsWrite.guard.test.ts`

A static scan (TypeScript compiler API, as `socketEgress.test.ts`) of every non-test `.ts` file under
`src/lib/server` and `src/routes` (exclude `*.test.ts`, `*.spec.ts`, `.d.ts`). Four forms, each reported as
`<repo-relative file>:<line> <form>`:

- **A `update`**: a call `X.set(arg)` with exactly one argument, where `arg` (searched through spreads,
  conditionals and nested object literals, but not into function bodies) contains an object literal with a
  property (assignment or shorthand) named `genreFields` or `rigour`. Also `onConflictDoUpdate({ set: {...} })`.
  No other table has those column keys, so the table need not be resolved (`seatKeys.ts` writes through
  `const t = schema.sessions`).
- **B `insert`**: `X.values(arg)` with one argument, same property rule (array elements too).
- **C `sql`**: a string or template literal (concatenate the template's literal parts) matching
  `update "?sessions"? set … genre_fields|rigour` or `insert into "?sessions"? ( … genre_fields|rigour …`,
  case-insensitive, across newlines.
- **D `json-helper`**: any call with both a string-literal argument `"sessions"` and a string-literal argument
  `"genre_fields"` or `"rigour"` (the `putJson(tx, "sessions", "genre_fields", …)` form). **Must catch the
  `putJson` form.**

The owner module `sessions/settingsWrite.ts` must show exactly two `update` sites (its own two writes). Every
other hit must be on the allow-list, by file with an exact count per form and a reason; the check runs in both
directions (an entry whose sites have gone, or whose count no longer matches, fails and names itself). Expected
allow-list after both workers finish (verify each by reading the line):

| File | Form × n | Reason |
|---|---|---|
| `sessions/branch.ts` | insert × 1 | a branch is a new row that copies its parent session |
| `sockets/import.ts` | insert × 2 | an imported session is a new row carrying its author's note |
| `sessions/honorModeRetired.ts` | update × 1 | boot pass: maps a retired `honorMode` key in place, once |
| `sessions/seatKeys.ts` | json-helper × 1 | the `seat-keys` boot pass: a key migration, written raw so `updated_at` does not move (`putJson`'s own comment) |
| `utils/testDb.ts` | update × 1 | test fixture helper (`applyLegacyTasks`), never run by the app |
| `db/dataUpgrades/0108_layering_registrations.ts`, `0110_layering_follow_ups.ts`, `0112_lair_rewrite.ts` | sql × 1 each | frozen data upgrades, run once by the migration ledger |

Also a list, by name with reasons, of the inserts the scan cannot see because the row object is built
elsewhere: `sockets/sessions.create.ts` (`.values(sessionData)`: a new session), `attic/etl/sessions.ts` (~100: a
0.5.3 session arriving through the attic), `pipelines/testing/fixtures.ts` (test fixtures); assert each file
still exists.

Plus **self-tests of the scanner** on small inline source strings: each of the four forms is found (including
`await putJson(tx, "sessions", "genre_fields", id, doc, "json")`, a spread-conditional
`.set({ ...(x ? { rigour } : {}) })`, and a multi-line raw `UPDATE sessions SET genre_fields = …`); and
`.select({ genreFields: schema.sessions.genreFields })`, `map.set(key, { rigour: 1 })`, `Object.values(x)` and a
`.set({ presetId })` are not.

Until `ss-2b-w1` finishes, the scan will also hit the callers it is routing (`settingsForm.ts`,
`sessions.update.ts`, `sessions.pipelines.ts`, `authorsNote.ts`, `resolveVoice.ts`): **never allow-list those**.
If they still show when you run the guard, report the remaining hits; the supervisor reruns it after w1. Any
**other** hit not in the table: do not allow-list it; report it with file:line.

Header comment: what the guard holds (P2, one writer each), the four forms, and its limits (a write through an
object built in a variable, or a column name assembled at run time, is not seen). Comments state the rule, not
the story.

## Tests (one run at a time; wait for other lanes first)

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-2b-w2-<n>.log 2>&1"
```
Never pipe vitest into `head`. Paths: your two files. Another lane (`kn-4b`) runs `npm run sdk:build` at times:
if a run fails on imports from `@serene-pub/*`, wait and rerun once before investigating.
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`: 0 errors in your files. `npx prettier --check`.

## Stop and ask (in your report) when

A hit outside the table; anything outside your two files; a new name beyond test-local helpers.

## Report

Your final message: what each file tests, the allow-list as built, the guard's hits on its last run, tests run
with counts and log paths, tsc result, **Noticed, not done**. Under 300 words.
