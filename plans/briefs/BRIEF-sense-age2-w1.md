# BRIEF — lane `sense-age2`, worker 1 — stamp the session's story clock on stat values; the read that returns it

You are a `lane-worker` for the supervisor of lane `sense-age2` in /home/jody/github/serene-pub. Read this whole
brief before touching anything. Use absolute paths. Return your report as your final message.

## Background (already done by the supervisor — do NOT redo)

The owner ruled (2026-11-11): "I think we are okay just tracking stat time relative to the session." So each
`attribute_values` row now has five nullable columns `story_clock_year/month/day/hour/minute` (Drizzle fields
`storyClockYear` … `storyClockMinute`), with the same shape CHECKs as `session_messages` (`storyClockChecks`). The
migration is `drizzle/0154_red_the_watchers.sql` (generated). **Never touch `db/schema.ts`, `drizzle/` or run
`db:generate`.** Old rows read null; there is no backfill and no boot pass.

The stamp means: **the session's story clock at the moment a session writes the value.** A value no session wrote
(starter kit, dowry, plugin's provided book, lorebook/card editor write, import, durable timeline record) carries
none and reads null. Every path that copies a whole value row carries the stamp unchanged.

## Goal

1. **The write** — `src/lib/server/state/write.ts`, `setValue` (about line 2545). Inside the transaction it already
   runs (`db.transaction(async (tx) => …)`), after `nextStateVersion`, read
   `sessionStoryNowOf(tx, ctx.sessionId)` (from `$lib/server/state/storyTime`) and spread
   `clockColumns(now ? clockOfNow(now) : null)` into the inserted values. **Use only `tx` inside the transaction.**
   Pattern to copy: `withStoryClockStamp` in `src/lib/server/messages/store.ts` 87–110 (it uses a dynamic import of
   `storyTime` — do the same if a static import would create an import cycle; check `write.ts`'s existing imports
   first). No try/catch around it (a failed SQL inside a PG transaction poisons it anyway). Change nothing else in
   `setValue`. Do not touch `setOverlaidPlaceValue` (it writes no `attribute_values` row; out of scope).
2. **The branch copy keeps `createdAt`** — `src/lib/server/sessions/branch.ts` ~735: the values loop drops
   `createdAt` (`const { id: _id, createdAt: _createdAt, ...rest } = row`). Keep `createdAt` for **values only**
   (configs unchanged). The stamp already carries through `...rest`. This was part of the owner-approved ★A1.
3. **The read** — `src/lib/server/state/resolve.ts`. Add, exported:
   ```ts
   /** One stored value's write stamp (lane sense-age2): what `writtenAgo` counts from. */
   export interface ValueWriteStamp {
   	/** The writing session's story clock when a session wrote the row; null when no session did, it had no clock, or the row predates stamping. */
   	clock: StoryClock | null
   	/** When the row was written (`created_at`). */
   	writtenAt: Date
   }
   export async function valueStampsOf(
   	db: Db,
   	sessionId: number,
   	owner: StateOwner,
   	slotIds: readonly string[],
   	known: { links?: SessionLinks | null } = {}
   ): Promise<Map<string, ValueWriteStamp | null>>
   ```
   It answers, per slot id, the stamp of **exactly the row `valueOf` would take its value from**, or `null` when no
   stored row answers (the value is a default, a derived slot, or a place value laid in the notes' overlay
   `placeValues`). Implement it by sharing `valueOf`'s logic, not copying it: links (from `known` or
   `sessionLinks`), `chainFor`, `readingForQuery`, ONE `valueRows(db, chain, slotIds, sessionId, reading)` call for
   all slots, then per slot the same layer walk as `fromLayers`. Refactor `fromLayers` into a helper that returns
   the answering row (or the overlay-laid value with no row) and keep `fromLayers` answering exactly what it does
   today. **No change to what is resolved.** `clockOf` is in `state/storyTime.ts`. Pass the owner exactly as given
   (the rulesets moment passes each `OwnerView.owner`, the same owner kinds `stateFor` reads).

## Files owned (edit only these)

- `src/lib/server/state/write.ts` (setValue's stamp only)
- `src/lib/server/sessions/branch.ts` (the values loop's `createdAt` only)
- `src/lib/server/state/resolve.ts` (`valueStampsOf`, `ValueWriteStamp`, the `fromLayers` refactor)
- New tests: `src/lib/server/db/valueStoryClock0154.int.test.ts`, `src/lib/server/state/valueStamp.int.test.ts`

## Files readable

Anything. Useful: `messages/store.ts` 87–110; `state/storyTime.ts` (`sessionStoryNowOf` ~358, `clockOf` ~99,
`clockColumns` ~111, `clockOfNow` ~325); `state/write.ts` `retractStateAnchoredTo` ~807 (deletes `.returning()` whole
rows) and `restoreRetractedState` ~1277 (re-inserts them); `sessions/rewind.ts` ~700–770 (Forward);
harnesses: `db/castMemberFiles0147.int.test.ts` (migration boot test with `migrationsFolderThrough`),
`state/sessionStoryClock.int.test.ts`, `state/clockMoves.int.test.ts`, `sessions/branch.clock.int.test.ts`,
`sessions/branch.state.int.test.ts`, `sessions/rewind.int.test.ts`, `state/handEdits.int.test.ts`.

## Tests to write (they must fail before your change where that is meaningful, and pass after)

`valueStoryClock0154.int.test.ts` — modelled on `castMemberFiles0147.int.test.ts`: migrate through
`0153_loving_kingpin`, insert an `attribute_values` row, migrate the whole chain; the row is kept with all five
columns null; the CHECK refuses a minute without an hour; **a second `migrate` changes nothing** (row counts and the
column list identical).

`valueStamp.int.test.ts` —
- `setValue` in a session with a story clock stamps the row with that clock (all five columns); in a session with no
  clock and no present the five are null.
- `valueStampsOf` answers the in-force row's stamp and `writtenAt`; null for a slot never written (default); a
  later `setValue` at a moved clock answers the newer stamp.
- A non-session write reads null: one card/template editor write (`state/cardState.ts`) or place-stat editor write
  (`state/placeStats.ts`) — pick whichever has the easier harness — leaves the five null.
- A branch keeps the stamp and the `createdAt` of a copied value (`sessions/branch.ts` fork; see
  `branch.state.int.test.ts` for how a branch is made).
- Retract then restore (`retractStateAnchoredTo` → `restoreRetractedState`), and Back then Forward
  (`sessions/rewind.ts`), each put the value row back with the same stamp.

Run, in a capped scope, only: your two new files, `src/lib/server/state/resolve.int.test.ts`,
`src/lib/server/sessions/branch.state.int.test.ts`, `src/lib/server/sessions/rewind.int.test.ts`,
`src/lib/server/state/handEdits.int.test.ts`, `src/lib/server/db/migrationJournal.test.ts`.

## Out of scope

Any other table's stamp; the rulesets envelope (another worker); `durable.ts`, `convertRuleset.ts`, any insert site
other than `setValue`; docs; NOMENCLATURE; UI; the SDK. If a test outside your list fails because rows gained five
fields (a whole-row `toEqual`), report it, do not fix it.

## Stop and ask when

Using `tx` for the clock read is impossible (something inside `sessionStoryNowOf` uses the module `db`: the dev/test
`transactionGuard` throws) — report it with the stack, do not work around it with a pre-read outside the
transaction. Any new name beyond `valueStampsOf` / `ValueWriteStamp`. Any change to what `valueOf` resolves.

## Done means

Both new test files pass; the listed existing tests pass (or any failure is shown to predate your change);
`npx prettier --check` clean on each changed file; then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`
shows no error in your files (one known error at `src/lib/client/components/sessionPage/requests/index.ts:380` is
another session's; ignore it, and ignore errors in files you don't own but list them).

## Report (final message)

Changed files; the exact `setValue` lines; how `fromLayers` was refactored; tests run with pass/fail counts;
anything you found but did not fix under **Noticed, not done**.

## Rules (verbatim, binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not need `sdk:build` at all.)
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
- Another session is editing this repo (visual-novel layout: dialogue-box widget, `show-line` request). Do not touch
  its files. Never run `db:generate`.
