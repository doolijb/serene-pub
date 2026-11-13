# BRIEF — lane `sense-st3`, worker 2 — the session imprints module, the one retraction rule, the data upgrade

You are a `lane-worker` under the `sense-st3` supervisor. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

## Background (read first)

- `src/lib/server/db/schema.ts`: the new table `sessionImprints` (`session_imprints`) and its comment — read it; it
  is the charter. Columns: `id`, `session_id` (cascade), `message_id` (plain int, nullable), `run_id`,
  `subject_kind` (CHECK `seat-bench` · `ruleset-conversion` · `deck` · `annex`), `subject_key`, `before` / `after`
  (`{ v } | null`), `owner_version`, `audience_before` / `audience_after` (`string[] | null`), `status`
  (`standing` · `settled`), `created_at`. Migration `drizzle/0155_chubby_lockjaw.sql` (generated — **never edit it,
  never run `db:generate`**) creates it, adds the four runtime columns on `sessions` (`turn_order`, `turn_tally`,
  `lane_reads`, `ruleset_decks`) and drops `annex_deltas`.
- `src/lib/server/lorebooks/imprints.ts` — `lore_imprints` and **the one retraction rule** (header lines 16–35,
  `retractImprints` 453–567, `restoreImprints` 576–607). The name is provisional 🚧: the SQL table name appears
  only in `schema.ts`; in TypeScript use `schema.sessionImprints`, never a literal `"session_imprints"` (the data
  upgrade, which by doctrine uses raw SQL, is the one exception).
- Design (the amended design at its end wins): `plans/DESIGN-st3-annex-and-runtime-2026-11-11.md`. Rulings (owner,
  2026-11-11, verbatim): "Move to columns (Recommended)" — "The annex becomes purely the modders' home … Ruleset
  decks follow Back; turn order and read marks do not. Needs a migration and a boot pass." and "Yes, a turn owns
  what it wrote". Amended design, verbatim: "a **sibling table**, with **one retraction function shared** by both
  tables, so the rule exists once." "Session rows take the imprints' **always revert** branch, like a session's own
  notes." "**Draws:** one row per write, not per turn … When two turns draw from one deck and the earlier is taken,
  the earlier turn's cards stay spent: the later card was dealt from the position the earlier draw left."

## Part A — the shared rule (`lorebooks/imprints.ts`; its behaviour must not change)

Export from `imprints.ts`: the `Wrapped` type, `wrap`, `unwrap` (already private there), and one pure function

```ts
/** The one retraction rule, decided for one field imprint (lore or session). */
export function retractionAct(i: {
	after: Wrapped
	/** The oldest LATER imprint of the same field that still stands (or was kept by this same pass); null when none. */
	later: { before: Wrapped } | null
	/** A session's own notes, or a session row: always reverted. */
	alwaysRevert: boolean
	/** The field's value now (ignored when `alwaysRevert`). */
	now: unknown
}): "spliced" | "dropped" | "reverted" | "kept"
```

later present → `sameValue(unwrap(later.before), unwrap(after)) ? "spliced" : "dropped"`; else
`alwaysRevert || sameValue(now, unwrap(after)) ? "reverted" : "kept"`. `retractImprints`' field branch (~496–534)
calls it and acts on the answer exactly as it does today (the `later` query, the `keptNow` set and the made-row
branch unchanged). Update the header comment to say the rule is `retractionAct` and that `session_imprints` uses it
too. **`imprints.int.test.ts` and every existing lore-imprint test must pass unchanged.**

## Part B — `src/lib/server/sessions/sessionImprints.ts` (new; a module of its own)

Header comment: the charter (what it owns: every read and write of `session_imprints`; what it does not: the
columns and rows it writes back belong to their writers — it writes them through `setSeatBench` for seats and by
single-column raw SQL for the rest). ⚠ Must not statically import `$lib/server/db`; every function takes its handle
(`tx` inside a transaction). API (names are the supervisor's decision; keep them):

```ts
export const SESSION_IMPRINT_KINDS = ["seat-bench", "ruleset-conversion", "deck", "annex"] as const
export type SessionImprintKind = (typeof SESSION_IMPRINT_KINDS)[number]
export type SessionImprintRow = typeof schema.sessionImprints.$inferSelect
/** A row as Back keeps it: `id` absent only on a row converted from a record written before ST3. */
export type SessionImprintRecord = Omit<SessionImprintRow, "id"> & { id?: number }
export interface SessionImprintAnchor { sessionId: number; messageId: number | null; runId: string | null }
export const seatBenchKey = (kind: "character" | "player", seatId: number) => `${kind}:${seatId}`
export const annexImprintKey = (owner: string, key: string) => `${owner}/${key}` // split at the LAST "/"

export async function fileSessionImprint(
	tx: Db, anchor: SessionImprintAnchor, at: { kind: SessionImprintKind; key: string },
	before: unknown, after: unknown,
	annex?: { ownerVersion: string | null; audienceBefore: string[] | null; audienceAfter: string[] | null }
): Promise<void>
```
No anchor message (`messageId == null`) files nothing (the write is permanent at once). A write that changed
nothing files nothing (`sameValue(before, after)` and, for `annex`, the same audience). `before`/`after` stored
wrapped (`undefined` → NULL).

```ts
export type TakenSessionImprint =
	| { act: "reverted"; imprint: SessionImprintRecord }
	| { act: "spliced"; imprint: SessionImprintRecord; later: { id: number; before: Wrapped; audienceBefore: string[] | null } }
	| { act: "dropped"; imprint: SessionImprintRecord }

export async function retractSessionImprints(
	tx: Db,
	sel: { sessionId: number; messageIds: readonly number[] },
	opts?: {
		/** A replacement's `keepOnRetell`: true leaves the row as it is — not taken, not listed. */
		keep?: (row: SessionImprintRow) => boolean | Promise<boolean>
		/** Rows with an id above this are taken in full, `keep` or not (a failed re-tell's own writes). */
		above?: number
	}
): Promise<{ taken: TakenSessionImprint[]; seatChanges: SeatChange[]; changed: boolean }>
```
Every `standing` row of the session anchored to one of `messageIds`, **newest first** (id desc). For each row:
skip when `keep` says so (unless `id > above`). `later` = the oldest standing row of the same session, kind and
key with a greater id (rows already taken in this pass are deleted, so they never count). Act by
`retractionAct({ after, later, alwaysRevert: true, now: undefined })`:
- `spliced`: the later row takes this row's `before` (and, for `annex`, `audience_before`); delete this row.
- `dropped`: delete this row.
- `reverted`: write the subject back to `unwrap(before)` (below); delete this row.
Per kind, the subject write:
- `seat-bench` (key `<kind>:<seatId>`): `setSeatBench(tx, { sessionId, kind, seatId, benched: before })` from
  `sessions/seats.ts`, the one writer; its `changes` go into `seatChanges`; a refusal (seat gone or removed) makes
  the act `dropped`, never a throw. `changed` only when a seat moved.
- `ruleset-conversion` (key the ruleset id): `sessions.ruleset_version = <before>` (a string). Before/after are the
  version moved from and to.
- `deck` (key the method key): `ruleset_decks` with that key set to the value, or removed when `undefined`
  (jsonb `||` / `-` on `coalesce(ruleset_decks, '{}'::jsonb)`), raw SQL.
- `annex` (key `<owner>/<key>`): under `lockSessionAnnex` (`sessions/coreAnnex.ts`): `annex[owner][key]` set, or
  removed when `undefined` (the owner's key removed when its document becomes empty); `annex_audiences[owner][key]`
  set to the audience, or removed when null (the owner removed when empty); `annex_versions[owner]` bumped with
  `bumpedAnnexVersionsSql` (`sessions/annexVersions.ts`). Raw SQL (`jsonb_set` / `-`), so no `updated_at` moves.
All raw-SQL writes go through `schema.sessions` / `schema.sessionImprints` identifiers, not literals.

```ts
export async function restoreSessionImprints(tx: Db, taken: readonly TakenSessionImprint[]): Promise<{ seatChanges: SeatChange[]; changed: boolean }>
```
Oldest first (the reverse of `taken`), as `restoreImprints` does: `dropped` → nothing; `spliced` → the later row's
`before` / `audience_before` back, then the row re-inserted; `reverted` → the subject is written to
`unwrap(after)` **only while it still reads `unwrap(before)`** (`sameValue`), then the row re-inserted. Re-insert
with its `id` when present, without when absent. For an `annex` row whose `owner_version` is not null and differs
from `ownerVersionOf(tx, owner)` now (`plugins/annexMigrate.ts`), land
`(await migrateOwnerDocument(tx, owner, sessionId, { [key]: after }, ownerVersion))[key]` instead of `after`.
For `seat-bench`, "reads" is the seat's benched flag (`isActive === false` on `session_characters` /
`session_personas`); for the others the stored value.

Also export:
- `settleSessionImprints(tx, sessionId, line: number)`: every standing row of the session with
  `message_id <= line` → `status = 'settled'`, `before = NULL`, `audience_before = NULL`.
- `sessionImprintsAfter(db, sessionId, forkMessageId)`: the session's standing rows with `message_id >
  forkMessageId`, newest first (a branch folds them backwards).
- `sessionImprintsFromOldRecord(raw: { annexDeltas?: unknown; seatBenches?: unknown; conversions?: unknown },
  sessionId: number): TakenSessionImprint[]` — PURE. Converts what a `rewind_taken` record written before ST3
  carries: `seatBenches` (`{ messageId, kind, seatId, from, to }`) → `reverted` `seat-bench` rows; `conversions`
  (`{ messageId, rulesetId, from, to }`) → `reverted` `ruleset-conversion` rows; `annexDeltas`
  (`{ row: { sessionId, messageId, owner, ownerVersion, before: { document, audiences }, after: {…}, runId,
  createdAt }, reverted, kept? }`, see the `AnnexDeltaSide` interface in schema.ts) → one `annex` row per key whose
  value or audience differs between `before` and `after`, skipping `kept` entries, the `core` owner's
  `CORE_RUNTIME_KEYS` and the legacy owner `core:revision-points`; act `reverted` when the delta's `reverted` was
  true, else `dropped`. No `id` on any converted row; `createdAt` a `Date`; `status` `standing`. Malformed entries
  are skipped. Order: oldest first in the list as the record had it (the record is newest first: keep its order).

Tests (new): `src/lib/server/sessions/sessionImprints.int.test.ts` — on a test DB (copy the pattern of
`sessions/annexChanges.int.test.ts`; 60 s timeouts): file/no-file rules; each kind's revert; splice and drop on two
rows of one key; **two turns drawing from one deck, the earlier taken: the deck stays where the later draw left it,
and taking the later afterwards lands where the deck stood before both**; `keep` and `above`; restore after
retract for each kind (a seat a person set the other way is left); settle; `sessionImprintsAfter`;
`sessionImprintsFromOldRecord` (unit cases, pure). And `retractionAct` unit cases in a new
`lorebooks/imprints.rule.test.ts`.

## Part C — the data upgrade

`src/lib/server/db/dataUpgrades/0155_chubby_lockjaw.ts` and its entry in `dataUpgrades/index.ts` (append, with a
one-line comment like its neighbours). Read the doctrine at the top of `index.ts` (raw SQL through `tx`; no app
modules; `before` runs inside the anchor's transaction BEFORE the migration's SQL, `run` AFTER it). Shape:

- `before(tx)`: `CREATE TEMP TABLE st3_annex_deltas ON COMMIT DROP AS SELECT * FROM annex_deltas` (the migration
  drops `annex_deltas`; the temp table carries its rows across). Check the drop happens in the same transaction
  and the temp table survives to `run`; if it cannot, **stop and report**.
- `run(tx)`, in this order, idempotent in itself:
  1. Each session whose `annex -> 'core'` is an object holding any of the six runtime keys: `turnOrder` →
     `turn_order`, `turnTally` → `turn_tally`, `laneReads` → `lane_reads`, `rulesetDecks` → `ruleset_decks`
     (verbatim, only when the key is present and the column is NULL); `rulesetConversions` entries
     (`{ messageId, rulesetId, from, to }`) → `ruleset-conversion` rows; `seatBenches` entries
     (`{ messageId, kind, seatId, from, to }`) → `seat-bench` rows (key `<kind>:<seatId>`). Each converted row is
     `standing`, or `settled` with `before` NULL when its `messageId` is at or below the session's settle line
     (`sessions.settled_message_id`; mirror `settledLineOf` in `sessions/settle.ts` — read it and copy its rule in
     SQL). An entry whose message is no longer a message of the session is skipped. Then the six keys are removed
     from `annex.core`; a `core` document left empty is removed.
  2. Each `st3_annex_deltas` row (by id) → one `annex` row per key whose value or audience differs between
     `before.document` / `after.document` (and `.audiences`), skipping the `core` owner's six runtime keys and the
     owner `core:revision-points`; `message_id`, `run_id`, `owner_version`, `created_at` carried; `before` /
     `after` wrapped `{ v }` (NULL where absent); `audience_before` / `audience_after` the key's list or NULL.
     Insert in delta-id then key order so ids keep the write order.
  3. Log one line with the counts (sessions moved, columns set, rows by kind), as other upgrades log.
  The diff may be JS over rows read through `tx` (write the small pure diff in this file; do not import app
  modules).
- Test: `src/lib/server/db/dataUpgrades/0155_chubby_lockjaw.int.test.ts`, on a database **built at 0154**:
  `migrationsFolderThrough("0154_red_the_watchers")` (`utils/testDb.ts`) + `migrate`, then seed by raw SQL a
  session with a `core` document holding all six keys plus a declared key (`retake-quietly`) and a plugin owner's
  document, `annex_deltas` rows across several owners (one `core` row whose snapshots include runtime keys, two
  writes of one plugin key, an audience change), a settle line below one bench record, a second session (a
  branch, `branch_of_session_id` set) with its own document; then `runMigrationsWithUpgrades` with the real
  `drizzle` folder (`dataUpgrades/index.ts`; see `db/valueStoryClock0154.int.test.ts` and
  `dataUpgrades/runner.int.test.ts` for the pattern). Assert the columns, the rows (kinds, keys, before/after,
  status, order), the stripped `annex.core`, `annex_deltas` gone; then run `runMigrationsWithUpgrades` again and
  assert `upgradesRun` is empty and **every** table's content is byte-identical (dump `sessions` and
  `session_imprints` before and after). Report the counts the upgrade logged.

## Files owned (edit only these)

`src/lib/server/lorebooks/imprints.ts` (Part A only), `src/lib/server/sessions/sessionImprints.ts` (new),
`src/lib/server/sessions/sessionImprints.int.test.ts` (new), `src/lib/server/lorebooks/imprints.rule.test.ts`
(new), `src/lib/server/db/dataUpgrades/0155_chubby_lockjaw.ts` (new), its test (new), `dataUpgrades/index.ts`
(one entry).

## Files readable

Everything. Another worker is moving the runtime-key readers now (`coreAnnex.ts`, `turnOrder.ts`, `turnTally.ts`,
`attention.ts`, `resolve.ts`, `seatKeys.ts`, `sockets/sessions.ts`, `host.ts`, `annexChanges.ts` line 66 and
others): never edit those. `tsc` will show errors in their files and in `state/write.ts`; only errors in your own
files are yours.

## Out of scope

Calling your module from anywhere (workers 3 and 4 wire it); `state/write.ts`; docs; NOMENCLATURE; the SDK; any
change to what a lore imprint does.

## Stop and ask (in your report) when

The shared rule would change what a lore imprint does; "convert, then drop" cannot be done with `before` + `run`
inside the one generated migration; the upgrade cannot be made a no-op on a second boot; a name beyond those given
here is needed.

## Rules (verbatim; they bind you)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to run `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`. Browser code
  runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a
  *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
- CLAUDE.md Hard rules that touch this work: migrations are generated, never hand-written or renumbered; never seed
  a row at a hardcoded id in app code (tests may); `0000`–`0093` are byte-identical forever; the 0.6 rule — "A
  change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes
  nothing"; never `git commit`; another session is editing this repo (visual-novel layout work) — never touch its
  files.

## Done means

`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` shows no error in your files. In the capped scope,
passing: `lorebooks/imprints.int.test.ts` (unchanged), `lorebooks/imprints.rule.test.ts`,
`sessions/sessionImprints.int.test.ts`, `db/dataUpgrades/0155_chubby_lockjaw.int.test.ts`,
`db/dataUpgrades/runner.int.test.ts`, `db/migrationJournal.test.ts`, `db/migrationSet.test.ts`.

## Report

Return as your final message: the module's exported API as built (signatures), any deviation from this brief and
why, the upgrade's logged counts on the test DB, tests and counts, **Noticed, not done**.
