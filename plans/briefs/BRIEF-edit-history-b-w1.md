# BRIEF — `edit-history-b` worker 1 — the record for card and cast versions (server core)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `edit-history-b`. You cannot spawn agents.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane runs no `sdk:build` at all.)

## Owner rulings you build (quoted)

- 2026-11-13: "Perhaps we should keep a change history. Change history that's not a dated change on the timeline (i.e. it's purely an edit and not a timeline evolution) does not persist on copy, export, share, copied from starter, etc."
- 2026-11-13: "Also make a pass on cast history and make sure it behaves similar so it's familiar across the entire lorebook. Lets also add card edit history." · "card edit history should be per version".
- 2026-11-14 "Lets go with all your recommendations": one table for all three subjects, keyed by subject (an entry, or a `character_versions` row), never copied; a session-written cast version taken back by Back / swipe takes its edit history with it; an overwrite import clears it; machine writes are recorded as the entries lane records them (a routine with its run; Apply, Revert, Take back, Restore as the person who pressed); start-up upgrades and imports record nothing.
- Standing: last 50 per subject, and the limit never evicts the newest row a person wrote.
- Lead's decision (★EH-B1, open for the owner): when `editCastVersion` retires a row a descendant session still reads and inserts an edited copy, **the history rows move to the copy** in the same transaction, and the edit is recorded on the copy.
- Lead's decision (★EH-B2, open): Back deletes a turn's cast version and the FK cascade removes its history; Forward (`restoreVersions`) brings the version back **with no history**. Do **not** use `takeBackRedline` / `putBackRedline` for versions; do **not** edit `src/lib/server/state/write.ts`.

## Hard rules for these files

- Migrations are generated only; the one migration `drizzle/0163_redline_versions.sql` already exists (supervisor generated it). Never hand-write or regenerate one; never edit `drizzle/`.
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- `src/lib/server/characters/versions.ts` MUST STAY A LEAF: never statically import `$lib/server/db` or a module that does. `lorebooks/redlines.ts` is a leaf too (it imports only `drizzle-orm`, the schema and `$lib/shared/*`, and loads anything else at call time) — keep it so; `versions.ts` may import it statically.
- Every function takes its handle first and never opens a transaction.
- Comments state the rule, not the story. No `prettier --write` on a directory (single files only).
- It is a session, never a chat. Members never see model plumbing (no model, connection or run id in any wire value).
- Before running tests, check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one is running, wait (another session runs tests too). Run each test as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/edit-history-b-w1-<name>.log 2>&1"` from the repo root, one run at a time; never pipe vitest into `head`; an int test that opens a DB inside an `it` needs a 60 s timeout.
- Never edit `src/lib/server/pipelines/{boot,config,registrations,entities}/**` or `src/lib/server/state/declarations.ts` (another session is editing them).

## What exists (read these first)

- Schema `loreRedlines` (`src/lib/server/db/schema.ts`, search `export const loreRedlines`) now has a nullable `entryId`, a nullable `characterVersionId` (FK `character_versions.id`, cascade), index `lore_redlines_character_version_idx`, and CHECK `lore_redlines_subject_check` (exactly one of the two; `amendment_id` only with `entry_id`). Already done; do not change it.
- `src/lib/server/lorebooks/redlines.ts` (read it whole, 447 lines): `recordRedline` (entry), `keepNewest` (per entry), `recordEntryRedline`, `takeBackRedline`/`putBackRedline` (entries only), `RedlineScope`, `clearRedlines`, `countRedlines`, `redlineSummary`, `clearAllRedlines`. Lane `time-t2` made `redlineKeysOf` / `entryWireValues` count `decayRate` and a Beginning's date parts: keep that and `redlines.beginningDecay.int.test.ts` passing.
- `src/lib/server/characters/versions.ts`: `updateCardVersion` (~542), `newCardVersion` (~503), `updateInPlace` (~1459), `writeCastVersion` (~1661) → `authorWrite` (~1736, in place at ~1771) / `storyWrite` (~1835, coalesced in place at ~1972), `updateCastVersion` (~2069) → `editCastVersion` (~2084; retire-and-copy ~2178–2209; in place ~2211), `retireOrTakeVersions` (~1545), `restoreVersions` (~1580).

## Build

### 1. `redlines.ts` — one writer, three subjects

- `recordRedline`'s input takes a subject: `entryId` (as today) **or** `characterVersionId`. Keep every existing caller compiling unchanged (an `entryId` input works as before). The limit (`keepNewest`) runs per subject: the subject's `REDLINES_KEPT` newest rows plus its newest row a person wrote.
- Add `VERSION_REDLINE_KEYS` (the profile keys a version's edit counts) = `name`, `nickname`, `aliases`, `summary`, `description`, `personality`, `scenario`, `greetings`, `exampleDialogues`, `postHistoryInstructions`, `creatorNotes`, `likeness`, `timbre`, `faceMediaId`. **Not** counted: `strokes`, `spriteSet`, `extensions`, the version `label`, `follows` as such, `nodeState`, `nodeVisibility`, place columns.
- Add `versionWireValues(row, keys)`: a version row's value per key, from `profileOf(row)` (`$lib/shared/characters/profile`); for a key in `row.follows` the value is `{ follow: true }` (a cast version that reads its card's value). Values as JSON keeps them.
- Add `recordVersionRedline(db, { before, after, named, cause, by })`: `before` / `after` are the `character_versions` row read before the write and the row after; `named` the keys the write named (profile field names; others ignored). Compares only the named counted keys; a change of nothing records nothing; returns the row id or null. Uses `recordRedline` with `characterVersionId: after.id`.
- Add `moveVersionRedlines(db, fromVersionId, toVersionId)`: re-keys every row of one version to another (★EH-B1's move). Returns how many.
- `RedlineScope` gains `{ characterVersionId: number }`. `{ lorebookId }` now matches the book's entries **and** `character_version_id IN (select id from character_versions where lorebook_id = X)` (one statement each, subqueries). `clearRedlines` / `countRedlines` follow the scope. `redlineSummary` / `clearAllRedlines` stay pub-wide (they already cover every row).
- Update the module comment (three subjects; who owns which: an entry's and a cast version's rows are the lorebook's, a card version's the card owner's; never travels).

### 2. `versions.ts` — record at the funnels, author passed in

Add an optional argument carrying the author and cause, named `redline?: { by: RedlineAuthor; cause: RedlineCause }` (import the types from `$lib/server/lorebooks/redlines`). **A write given no `redline` records nothing.**

- `updateCardVersion(tx, versionId, changes, opts?: { label?, redline? })`: after the update, `recordVersionRedline(tx, { before: row, after: updated, named: Object.keys(changes) with a defined value, ... })` when `opts.redline` is set. Nothing when `set` was empty.
- `newCardVersion`: records nothing (a new version starts with an empty history). No change needed beyond confirming.
- `updateInPlace(tx, row, changes, applied, redline?)`: records after its update when `redline` is set (`before: row`, `after: updated`, named = the keys of `changes` with a defined value, a `{ follow: true }` change included).
- `writeCastVersion(tx, input)`: `input.redline?` passes through `authorWrite` and `storyWrite` to `updateInPlace` on their in-place branches only. A newly inserted row records nothing (a new version is the timeline's, not an edit). The coalesced story write's retire-and-copy branch (~1983–1988) records nothing and moves nothing.
- `updateCastVersion(tx, versionId, edit, opts?: { redline? })` → `editCastVersion(tx, versionId, edit, redline?)`: the in-place branch records through `updateInPlace`; a place-only edit records nothing. The retire-and-copy branch (~2178–2209): after inserting the copy, `moveVersionRedlines(tx, row.id, copy.id)`, then (when `redline` is set and there were changes) `recordVersionRedline(tx, { before: row, after: copy, named: change keys, ... })`.
- `writeCastVersionTagText`, `followCardGreetingsAfterLift`, `retireOrTakeVersions`, `restoreVersions`, `deleteCastVersion`: no recording (they take no author). `followCardGreetingsAfterLift` keeps calling `updateCastVersion` with no `redline`.
- Do **not** change any caller outside `versions.ts` in this task (worker 3 passes the authors).

### 3. Tests

- `src/lib/server/db/redlineVersions0163.int.test.ts` (copy the shape of `src/lib/server/db/entryDecay0162.int.test.ts`): migrate through `0162_entry_decay`, insert an entry and one entry redline row, migrate to the real folder; the row is kept with `character_version_id` null; `entry_id` is nullable; the CHECK refuses a row with both keys and a row with neither, and a card-version row with an `amendment_id`; a second boot changes nothing (ledger hashes, columns, rows).
- `src/lib/server/characters/versions.redlines.int.test.ts` (shape: `src/lib/server/lorebooks/redlines.callSites.int.test.ts` for the db mock and dirs; build cards with `insertCard` and members with `insertCastMember`): a card version save with `redline` records one row (before/after per key, `cause`, `user_id`); a save that changes nothing records nothing; a save with no `redline` records nothing; `newCardVersion` starts with no rows; a `faceMediaId` change is recorded as that key; `strokes` / `extensions` / `spriteSet` / label are not; a cast version author write in place records; a follow change records `{ follow: true }` as the value; a new dated version records nothing; `updateCastVersion` in place records; the retire-and-copy branch moves the old rows to the copy and records the edit on it (make a session-written version and a descendant session that reads it: see how `versions` tests or `lorebooks.castVersions.int.test.ts` build `branchAncestry`); a routine coalesced story write records `cause: "routine"` with the run (`by: { run: { sessionId, messageId, runId, shownAs } }`); Back (`retireOrTakeVersions` on that row with no descendant) deletes the version and its rows; `restoreVersions` brings it back with none; the limit keeps 50 plus the newest person's row, per version; `clearRedlines({ characterVersionId })`, and `{ lorebookId }` clears and counts a cast version's rows and an entry's together while leaving a card version's rows alone.
- Run your two files plus the existing `src/lib/server/lorebooks/redlines*.test.ts` (all of them) and `src/lib/server/characters/versions*.test.ts` (the existing ones) and `src/lib/server/lorebooks/tableRegistry.test.ts`. Report counts. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — report errors in your files only.

## Files owned (edit only these)

`src/lib/server/lorebooks/redlines.ts`, `src/lib/server/characters/versions.ts`, and the two new test files above.

## Out of scope

Callers outside `versions.ts`; sockets; the client; docs; `NOMENCLATURE.md`; `state/write.ts`; any new cause; any SDK name.

## Stop and ask (in your report, do not decide) when

A new cause seems needed; a change would need a file outside Files owned; the schema seems wrong; a test cannot be written without changing behaviour.

## Report

Your final message: changed files; every exported name added; tests run with pass/fail counts and log paths; anything you could not do; Noticed, not done. Under 500 words.
