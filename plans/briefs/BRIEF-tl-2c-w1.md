# BRIEF — worker `tl-2c-w1` — one answer to "what date does this write of play carry", its callers, and the backstop refusal (app code only)

Supervisor: lane `tl-2c`. Repo: `/home/jody/github/serene-pub` (app). Paths below are under
`src/lib/server/` unless they start with `src/` or `plans/`. Other lanes' uncommitted work is all over the tree:
**re-read each file right before editing it; small targeted edits; never a whole-file rewrite.**

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**You do not run `sdk:build` at all, and you do not touch the SDK.** Never `git checkout / restore / stash` in
either repo. Never `prettier --write` (nor a scratch-copy equivalent). No migration, no schema change. **You write
no new test files** (worker w2 does, after you); you may run existing tests (see Tests).

## Rules your work depends on (quoted)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite
  silently". "Never add a top-level `await` to `src/lib/server/db/index.ts`". "Migrations are generated" (none here).
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not
  done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."
- Owner 2026-11-16: "Genres must respect timelines if they are writing to the lore book. Refuse the … write if
  dated entries don't get a date". "This is what we are enforcing type safety on timelines lorebooks". "1. Go with
  the safest option for existing lorebooks" (existing lorebooks with no date at all are left exactly as they are).
- Lane brief, cold review corrections (these rule):
  1. "A date is not the history entry a write hangs on. The result is
     `{ kind: 'dated', date: <non-null story date>, hangsOn: number | null }`. `hangsOn` (`writeDatingAt`) is null
     before the line's first dated history entry and that stays **legal** … links, knowledge ties, stats and every
     other row that stores only `history_entry_id` keep today's value … **the backstop covers only rows that store
     a date**: a history entry's year, `entry_amendments.year`, `character_versions.year`, a Beginning resolved to
     *began*, clock stamps on lore rows. Never `history_entry_id`; play never creates a history day to hang a write
     on."
  2. "Leave `newEntryTime` alone. The only change for non-history creates is the `date:` input at `host.ts` ~6452:
     story now instead of the reading's moment."
  3. "Messages and scene stamps are outside the backstop and already use story now … list them as verified
     unchanged."
  4. "A lorebook with dated history and no clock is `dated`, on purpose … new writes change (an Item begins at the
     newest history day instead of Perpetual; `update-lore-entry` writes a dated version at that day instead of in
     place) … Rows already written do not change."
- Lane brief item 4: "`undatable` (existing lorebooks with no date at all): unchanged. History refused as today;
  every other write behaves exactly as before the lane." Item 6: "A person's writes are out of scope except where
  they share a helper whose type changes: then keep their behaviour identical and say so."

## Terms

*Story now* = `sessionStoryNowOf` / `storyNowOf` (`state/storyTime.ts` ~267, ~375): the session's clock, else the
line's clock, else the line's newest dated history entry; null with the timeline off or no date at all. *The
reading's moment* = `sessionReadingOf(...).moment` (`state/reading.ts` ~330–400): clock only (session's, else the
line's), null at the head. *Dating* = `writeDatingAt` (`reading.ts` ~511): the history entry a write hangs on.
Today the dated paths read the **moment**, so a lorebook with dated history and no clock writes undated: that is
the gap this closes.

## Build

### 1. The function and the refusal (`state/storyTime.ts`, next to `sessionStoryNowOf`)

Names are fixed by the supervisor (★, awaiting the owner); use exactly these:

```ts
/** What date a write of play carries (lane tl-2c): the one answer every pipeline lore write asks. */
export type LoreWriteDate =
	| { kind: "dated"; date: StoryDate; hangsOn: number | null } // date = dayOnly(story now): year, month|null, day|null
	| { kind: "timeless" } // the session's lorebook keeps no timeline
	| { kind: "undatable" } // a timeline, and no date at all (an existing, never-dated lorebook)

export async function loreWriteDateOf(db: Db, sessionId: number): Promise<LoreWriteDate>

/** ★ copy: why a write of play that must carry the story's date, and arrived without one, is refused. */
export const UNDATED_LORE_WRITE_SENTENCE =
	"This lorebook keeps a timeline, so this write needs the story's date, and it arrived without one. Nothing was written."

/** The backstop: the sentence when the session's write must be dated and `date` is missing; else null. */
export async function undatedLoreWriteRefusal(db: Db, sessionId: number, date: StoryDate | null | undefined): Promise<string | null>
```

- `loreWriteDateOf`: `sessionReadingOf(db, sessionId)`; no reading → `sessionTimelineOf` false → `timeless`, else
  `undatable`. `reading.timelineOff` → `timeless`. Else `sessionStoryNowOf(db, sessionId)`: null → `undatable`;
  else `{ kind: "dated", date: dayOnly(now), hangsOn: (await writeDatingAt(db, reading))?.historyEntryId ?? null }`.
  (`dayOnly` is in `$lib/shared/lorebooks/storyDate`; check the import graph: `storyTime.ts` already imports from
  `state/reading.ts`, add `writeDatingAt`.)
- **Implement both exports through one non-exported function** (e.g. `readLoreWriteDate`) that both call, so a
  test that `vi.mock`s `loreWriteDateOf` still leaves the backstop reading the truth. Say so in a one-line comment.
- `undatedLoreWriteRefusal`: `date != null` → null; else read the kind through the internal function; `dated` →
  `UNDATED_LORE_WRITE_SENTENCE`; otherwise null.
- Doc comments in the file's voice: purpose, the three kinds, "callers switch on the kind; no caller reads a
  nullable date and decides for itself", `hangsOn` may be null and is legal (plan A22, 2026-09-30).

### 2. Callers switch on the kind (only these sites)

Re-verify every line; lanes have moved code. In `pipelines/runtime/host.ts`:
- **~6452** (`create-lore-entry@1`, the `newEntryTime` call): `date:` becomes
  `written.kind === "dated" ? written.date : null` with `written = await loreWriteDateOf(db, sessionId)`. Nothing
  else in `newEntryTime` or its callers changes.
- **`holdLoreEntryChange` ~297**: the held amendment's `year/month/day` come from `loreWriteDateOf(tx, sessionId)`
  (`dated` → its date; else null), not `reading.moment`. Keep the `reading` it uses for `entryAt` as it is. Then the
  backstop just before the insert: `const refusal = await undatedLoreWriteRefusal(tx, sessionId, day)`; refusal →
  `throw new HostScopeError(`${nodeKey}: ${refusal}`)`.
- **`lorebookChangeHeld` ~340**: replace the `line.reading.moment != null` block with
  `written.kind === "dated"` → `beginningRefusal(dbx, lorebookId, stored.id, written.date)` → held. The inner
  `timelineOff === true → held` line goes (a `sessionReadingOf` reading never carries a moment with the timeline
  off, `reading.ts` ~368/383; **verify that** for every `line` that reaches here, and report it; if any caller can
  pass a reading with a moment and `timelineOff`, stop and report instead of removing it).
- **`changeLoreEntry` ~474–531**: the dated-version branch condition becomes
  `!a.writeThrough && stored.lorebookId !== ownBook && written.kind === "dated"`, with `date = written.date`
  (drop the `moment`/`dayOnly(moment)`). Then **the backstop** at the in-place write below it: when the entry is
  the attached lorebook's (`!a.writeThrough && stored.lorebookId !== own book id`), call
  `undatedLoreWriteRefusal(at ?? db, a.sessionId, null)` before the write and throw
  `HostScopeError(`${nodeKey}: ${refusal}`)` on a refusal (inside a transaction use the transaction handle you have:
  `at`, or for the self-opened transaction do the check before `db.transaction` opens). Notes entries
  (`stored.lorebookId === own book`) and history days filed through (`writeThrough`) are written in place as today,
  with or without a date: **do not** extend dated versions to notes entries.
- **~7071** (`update-lore-entry@1`'s `datedVersion`): `inLorebook && !held && written.kind === "dated"`.
- `historyDateOf` (`host.loreWrites.ts` ~504): the non-`countNotes` branch reads `loreWriteDateOf(tx, sessionId)`
  (`dated` → its date, else null) instead of `sessionStoryNowOf`. The `countNotes` branch (`ownBookDaysCounted`)
  stays exactly as it is. `fileOntoHistoryDay`'s existing null refusal (~639–643) stays word for word.

In `characters/versions.ts` `storyWrite` (~1937–1960, only the pipeline's `when`; `storyWrite` is reached only by
`writeCastVersion` with `session`, i.e. `pipelines/runtime/castMember.ts` and `sessions/dcCairns.ts`: confirm and
report): `const written = await loreWriteDateOf(tx, S)`; `when = written.kind === "dated" ? written.date : null`;
`historyEntryId: inAttached ? (written.kind === "dated" ? written.hangsOn : null) : null`. **Check that `hangsOn`
equals today's `dating?.historyEntryId` in every case where `inAttached`** (today `dating` is
`writeDatingAt(sessionReadingOf(S))`; `loreWriteDateOf` reads the same) and report it; keep `branchId`, `atHour`,
`atMinute` exactly as they are. Backstop before `insertRows`: `undatedLoreWriteRefusal(tx, S, when)` → throw
`new Error(refusal)` (the file's style). Note in your report: with the timeline off and a stale session clock, a
cast version on the notes' main was dated by `momentOf(row)` before; now it is undated (`timeless`).

### 3. Verified, not changed (read and report file:line, edit nothing)

`scenes/liveScenes.ts` ~145 (`sessionClock` → story now), `messages/store.ts` ~85–110 (`withStoryClockStamp`),
`state/write.ts` ~460 and ~2611 (stats: `writeDatingAt` for `history_entry_id`, `sessionStoryNowOf` for the stamp),
`sessions/settle.ts` ~168–223 (`history_entry_id` only), `lorebooks/ownBook.ts` Apply ~1528, ~2431 (a held change
with a year is moved as a dated amendment, one without folds in), links (`host.loreWrites.ts` ~274, ~372, ~461,
~792) and `note-entry-knowledge@1` (~1090): `history_entry_id` only, kept as today.

## Files owned (edit only these)

`state/storyTime.ts`, `pipelines/runtime/host.ts` (only the sites above), `pipelines/runtime/host.loreWrites.ts`
(only `historyDateOf`), `characters/versions.ts` (only `storyWrite`'s `when` / `historyEntryId` / backstop).
Readable: anything. Not yours: `state/reading.ts` (no change needed: if you think one is, stop and report),
`lorebooks/entryDefaults.ts`, `lorebooks/entryVersions.ts`, `lorebooks/timeline.ts`, `assemble.ts`, the SDK, tests.

## Stop and report (don't decide) when

A new name beyond the four above is needed; a site behaves differently from this brief's description; any change
would alter what an `undatable` or `timeless` session writes (except the stale-clock cast case above); a migration
or NOT NULL would be needed; a shipped pipeline would be refused in ordinary play.

## Tests (run, don't write)

`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors. Then, one run at a time, exactly:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2c-w1-<n>.log 2>&1"`
with paths `src/lib/server/pipelines/runtime/host.entryDefaults.int.test.ts src/lib/server/pipelines/runtime/host.datedVersion.int.test.ts src/lib/server/pipelines/runtime/host.heldEntryChange.int.test.ts src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts src/lib/server/state/ownNotesLine.int.test.ts src/lib/server/characters/versions.authoring.int.test.ts`.
Check first that no vitest is up: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Never pipe
vitest into `head`. **Do not edit a failing test**: list each failure with its title, the assertion, and whether
it is a lorebook with a date (expected to flip) or with no date at all (a regression you must fix in code).

## Report (final message, under 500 words)

Changed files with the functions touched; each site's before → after; the verifications asked for above with
file:line; tests run (log path, pass/fail counts, each failure as above); `npx prettier --check` result on the
touched files (pre-existing drift is fine, say so); **Noticed, not done**.
