# BRIEF cv-core-w4 — the session write: `writeCastVersion`, `ensureSessionLine`, the story-write anchor

Worker (Sonnet) for lane **cv-core**; the supervisor is the cv-core lane-supervisor. App `/home/jody/github/serene-pub`. Report as your final message (no report file), starting `# REPORT cv-core-w4 (2026-11-05)`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal
Plan §32 §4, §5a, §33.2: the cast-version write a session (or an author) makes, coalesced per turn; a branch's first write to its attached book forks the branch a book line; and the anchor rule for real-book cast members' story writes. Nothing in the app calls `writeCastVersion` yet (wave 2 moves the writers onto it); `ensureSessionLine` is wired into the two existing book-write paths now.

Another worker is building the boot pass (`characters/versionsLift.ts`, `startup/index.ts`) at the same time. Don't touch those.

## Files owned (edit only these)
- `src/lib/server/characters/versions.ts` — append the session write at the marked comment `// ── The session write (writeCastVersion) — next brief ──`; you may also extract the base-insert part of `insertCastMember` into a private helper you reuse. Don't change the existing exports' behaviour.
- `src/lib/server/characters/versions.write.int.test.ts` (new)
- `src/lib/server/lorebooks/sessionLine.ts` (new), `src/lib/server/lorebooks/sessionLine.int.test.ts` (new)
- `src/lib/server/state/write.ts` — ONLY: `bookWritePlace` (~403–422), `anchorFor` (~601–627), and `lockStateVersion` (~1819: add `export`).
- `src/lib/server/lorebooks/ownBook.ts` — ONLY `loreWriteTargetFor` (~378–415).

Not `NOMENCLATURE.md`, `profile.ts`, `memberAsRead.ts`, `reading.ts`. Nothing else.

## Files readable
- `src/lib/server/characters/versions.ts` (its header's **leaf rule**, `insertCharacterVersions`, `nextWriteOrder`, `insertCastMember`, `memberProfileOf`, `ensureCardVersion`).
- `src/lib/shared/characters/profile.ts` (`CharacterProfileV1`, `CHARACTER_PROFILE_FIELDS`, `CharacterProfileField`, `isCharacterProfileField`, `profileOf`).
- `src/lib/server/cast/memberAsRead.ts` `castVersionsInForce(db, memberIds, { sessionId })` → `Map<memberId, { version, overlayDepth }>` — **the row a session reads, which is the row a write copies** (same pick as `membersAsRead`).
- `src/lib/server/state/reading.ts`: `sessionReadingOf` (its `line` carries `sessionCuts`), `writeDatingAt`, `sessionCutsOf(db, sessionId)`, `overlayChainOf`, `lineOfBook`, `readingOf`.
- `src/lib/shared/lorebooks/lineReading.ts` `rowPassesSessionCut(row, line)` (the cut + retire rule), `versionInForce`.
- `src/lib/server/lorebooks/ownBook.ts` `loreWriteRoute`, `loreWriteTargetFor`, `ownBookFor`, `ownBookOf`; `src/lib/server/utils/lorebookBindingToken.ts` `deriveNextBindingToken(lorebookId, tx)`.
- `src/lib/server/state/write.ts`: `anchorFor`, `notesTurnOwnerOf` (~530–575), `turnOwnerOf` (~478), `lockStateVersion` (~1805–1823), `WriteContext` (~1761), `bookWritePlace` (~395–422), `isOwnBookOwner`.
- `src/lib/server/state/storyTime.ts` `lockBookCalendar(tx, lorebookId)` (the book's write lock); `src/lib/server/sockets/amendments.ts` ~1070–1140 (how a line is forked today: `lorebook_branches` insert, `assertBranchName`, name clash per book).
- `src/lib/server/db/schema.ts`: `characterVersions` ~9345–9570, `sessions` (`lorebookBranchId`, `storyClockYear/Month/Day/Hour/Minute`, `name`, `branchAncestry`, `lineOnFirstWrite` ~2770–2795), `lorebookBranches` ~8996–9050 (`name` unique per book, `forkedFromBranchId`, `forkYear/Month/Day`), `lorebookBindings` (`overlayOf`).
- Plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` lines ~1226–1280 (§32 §4–§5) and ~1396–1409 (§33).

## Rules you work under (quoted)
- Plan §32 §4: "**Lock.** The versions writer opens with `pg_advisory_xact_lock('stateVersion', sessionId)` (`lockStateVersion`, state/write.ts:1819), exported for it." `lockStateVersion`'s doc: "⚠ **The first statement of a write's transaction**".
- §32 §4: "**Anchor.** `anchorFor` … returns null for real-book `cast_member` rows. It gains a story-write case in V-core that uses the **world** turn owner (`isAnchorOpen`, sdk/src/turnLock.ts:121)." The world's turn owner is `{ kind: "session", id: sessionId }` (`turnOwnerOf`).
- §32 §4: "**Key.** (target, branch, S, anchor, date, at_hour, at_minute, life point). If the in-force row matches the key and its anchor is open, the write updates it in place … Otherwise it inserts a complete copy, keeping the life point." §32 §3: "★CV-15 for story writes: a story write keeps the life point of the version it copies."
- §31 §3 (still in force): "**Target (★CV-8).** M itself, when `loreWriteRoute` says `book` … or M is in S's own book. Otherwise S's overlay row O, made on demand. That covers Review, Off, a book someone else owns, and a parent session's own book." "**Date.** The session clock's day, else the line's present (`sessionReadingOf`), else the date `writeDatingAt` gives, else undated. `history_entry_id` comes from `writeDatingAt`." "**Change shape.** `{ field: value | { follow: true } }`. A follow is refused in words for a card-less member."
- §33.2: "Back, swipe, delete or an in-place change of a row some descendant reads (its cut passes it) marks the row retired (`retired_order` = the next write order) instead of deleting it; an in-place change then inserts the new row." "Index on `sessions.branch_ancestry` for 'who reads this source'" (`branch_ancestry @> '[{"sessionId": S}]'`, GIN index `sessions_branch_ancestry_idx`).
- §32 §5a: "On the session's first write to the attached book (a version, an entry or a value), it forks a `lorebook_branches` row from the current line at the session's day, named after the session (deduped), moves the session onto it, and clears the flag. The line is the book's. It outlives the session, and other sessions may ride it. Callers: the versions writer, `bookWritePlace` … and `loreWriteTargetFor`." Owner: "Branch on first write. Data wise, the session is a patron of the lorebook and branch, it doesn't own it."
- `versions.ts` **stays a leaf** (its header): static imports only `drizzle-orm`, the schema, `rawRows`, `lorebooks/retold`, `$lib/shared/*`. Reach `write.ts`, `ownBook.ts`, `reading.ts`, `memberAsRead.ts`, `sessionLine.ts`, `lorebookBindingToken.ts` with `await import(…)` inside `writeCastVersion`. `sessionLine.ts` must not statically import `$lib/server/db` either (take the handle first).
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`". `writeCastVersion` takes `tx` and never opens its own transaction.
- Every new `lorebook_branches` row goes through the book's write lock (`lockBookCalendar(tx, lorebookId)`), as `amendments:fork` does.
- Int tests that open a DB inside a test: **60 s timeout**; never pipe vitest into `head`; targeted tests only; `tsc` clean and prettier clean on your new files (on the existing files only your hunks).
- Names: use exactly the names in this brief. Private helpers are fine; any other export → stop and say so.

## What to build

### 1. `state/write.ts`
- `export` `lockStateVersion` (doc: "exported for the versions writer, plan §32 §4").
- `anchorFor(db, ctx, owner, messages?, opts?: { storyWrite?: boolean })`: when `opts.storyWrite` and `owner.kind === "cast_member"` and the row is not the session's own notes' (`notesTurnOwnerOf` gives null), the turn owner is the **world** (`{ kind: "session", id: ctx.sessionId }`) and the rest of the function runs as for any turn owner (`ctx.messageId === null` still answers null). Without `storyWrite`, nothing changes for anyone. Update the doc paragraph ("Author layers are never locked …") with one sentence for the story-write case.
- `bookWritePlace`: when it reads the session's own line (`ctx.branchId === undefined`), first `ensureSessionLine(db, ctx.sessionId)` — but only for an owner whose row is in the **attached** book (not the session's own notes: `isOwnBookOwner`). Keep the common case cheap: `ensureSessionLine` answers from one indexed read when the flag is off; order the checks so a session without the flag pays at most one extra query.

### 2. `lorebooks/ownBook.ts` `loreWriteTargetFor`
When the route is `book`, call `ensureSessionLine(db, sessionId)` before returning. Nothing else changes.

### 3. 🚧 `lorebooks/sessionLine.ts` — `ensureSessionLine(tx, sessionId): Promise<number | null>`
Answers the session's line in its attached book after the call (null = main). Does nothing (answers the current `lorebook_branch_id`) unless `sessions.line_on_first_write` is true and the session has an attached book. Otherwise, under `lockBookCalendar(tx, bookId)`: re-read the flag (another writer may have forked it), then insert a `lorebook_branches` row: `forkedFromBranchId` = the session's current line; the fork date = the session's day (`sessionReadingOf(tx, sessionId).moment`, day grain; null = a fork at now, which stores no date); `name` = the session's name (trimmed, else `Session <id>`), deduped in the book with ` (2)`, ` (3)`… (never `main`, at most 60 characters — cut the base to fit the suffix); then set the session's `lorebook_branch_id` to it and `line_on_first_write = false`. Header: the rules quoted above (the line is the book's; it outlives the session). It must work when called with a handle that is not inside a transaction (the advisory lock then lasts one statement; say so in the doc — the callers in a write transaction get the full guarantee).

### 4. `versions.ts` — 🚧 `writeCastVersion(tx, input)` and 🚧 `CastVersionChanges`
```ts
export type CastVersionChanges = {
	[K in CharacterProfileField]?: CharacterProfileV1[K] | { follow: true }
} & { nodeState?: NodeState; nodeVisibility?: NodeVisibility }

export async function writeCastVersion(tx: Db, input: {
	/** The cast member as the caller names it (a `lorebook_bindings` id). */
	member: number
	changes: CastVersionChanges
	/** `user:<id>` · `run:<id>` · `script:<id>` · `plugin:<id>`. */
	writtenBy: string
	note?: string | null
	/** A story write (a session's). */
	session?: { id: number; messageId?: number | null; ownAnchor?: boolean }
	/** An author's write with no session: where on the member's line it lands. */
	at?: { branchId: number | null; date: StoryDate | null; historyEntryId?: number | null; personalPosition: number | null }
}): Promise<{ version: typeof schema.characterVersions.$inferSelect; coalesced: boolean }>
```
Refuse (sentences) an empty `changes`; a key that is not a profile field or node state/visibility; `{ follow: true }` on a field when the version would have no parent ("<name> has no card to follow, so <field> stays their own."); `session` and `at` both given or both missing; an unknown member.

**Change application** (both paths): start from the copied row's own profile columns, `follows`, `parentVersionId`, `nodeState`, `nodeVisibility`; a value → that own column, removed from `follows`; `{ follow: true }` → added to `follows`; node state/visibility set. Insert through `insertCharacterVersions`.

**A member with no version at all** (not lifted yet): when it has no `cast_amendments` row, insert its base first (the same base `insertCastMember` writes — share a private helper) and go on; when it has amendments, refuse: "<name> hasn't been moved onto character versions yet; restart the server so the upgrade lifts them." (🚧 copy).

**Author path (`at`)** — target = the member. If a version of the member exists with exactly (branch, date, personal position) and no source and no retire mark → update it in place (`coalesced: true`). Else insert a complete copy of the version in force for (the member's book, the line of `at.branchId` via `lineOfBook`, `at.date`, appearance `at.personalPosition`) — use `castVersionsInForce(tx, [member], { reading: { branchId, moment: date, forkedAt: null, line }, appearance })` — with the changes, at that key (no source, `historyEntryId` as given).

**Story path (`session`)** — S = `session.id`:
1. `lockStateVersion(tx, S)` — the first statement.
2. The member M (its row). **Target**: M's book is the session's attached book → `loreWriteTargetFor(tx, S)`; route `book` → target M (that call already ran `ensureSessionLine`); route `own-book` → the overlay. M's book is S's own book → target M. Else (an ancestor's own book) → the overlay. **The overlay** = the `lorebook_bindings` row in S's own book (`ownBookFor`) with `overlay_of = M`, else a new one through `insertCastMember(tx, { lorebookId: ownBook, binding: await deriveNextBindingToken(ownBook, tx), characterId: null, name: M.name, overlayOf: M.id })` (no card link on an overlay row, so it is never found as a card's member; no base).
3. **Where**: a target in the attached book → `branchId` = the session's line after `ensureSessionLine` (re-read `sessionReadingOf` after it), `historyEntryId` = `writeDatingAt(reading)?.historyEntryId ?? null`; a target in an own book → `branchId` null. **Date** (both) = `reading.moment` (the session clock's day, else the line's present), else `writeDatingAt`'s date, else null. `atHour` / `atMinute` = the session's `story_clock_hour` / `story_clock_minute` (null when unset).
4. **Anchor** = `anchorFor(tx, { sessionId: S, updatedBy: <any valid StateWriter for writtenBy>, messageId: session.messageId, ownAnchor: session.ownAnchor }, { kind: "cast_member", id: target }, undefined, { storyWrite: true })`. Look up the `StateWriter` shape in write.ts and pick the honest value; say which in your report. `source_session_id` = S, `source_message_id` = `valid_from_message_id` = the anchor.
5. **R** = `castVersionsInForce(tx, [M.id], { sessionId: S }).get(M.id)?.version` (the row S reads). None → the base rule above, then re-read.
6. **Coalesce** when R belongs to the target and R's (branch, source session, anchor, date, at_hour, at_minute) equal this write's and R has no retire mark → in place. **But first**, if a descendant reads R — a session D with `branch_ancestry @> '[{"sessionId": S}]'` whose `sessionCutsOf(tx, D)` line passes R (`rowPassesSessionCut(R, { ...MAIN_LINE, sessionCuts })`) — set R's `retired_order = nextWriteOrder(tx)` and insert the changed copy instead (§33.2) (`coalesced: false`).
7. **Else** insert a complete copy of R with the changes on the target: `lorebookId` = the target's book, the where/date/anchor above, **`personalPosition` = R's** (★CV-15), `writtenBy`, `note`.

## Tests
- `sessionLine.int.test.ts`: no flag → nothing, answers the line; flag + attached book → a line forked from the current line at the session's day, named after the session, the session moved, the flag cleared; a second call → nothing new; a name clash → ` (2)`; a session named `main`/blank; no attached book → nothing; `bookWritePlace` (through a real state write of a book-layer value) and `loreWriteTargetFor` (route `book`) each fork it once; an own-book write does not.
- `versions.write.int.test.ts` (each test 60 s): author path in place vs copy (a later date copies the in-force row, keeping follows); story path: first write on a branch with the flag forks the line and lands there; two writes in one turn coalesce in place; a new turn (a later message) inserts a new row; a clock move inserts a new row; the copy keeps the in-force row's personal position; Review / Off / a book someone else owns → an overlay row in the session's own book (no card link, no base) that the session then reads (`membersAsRead(…, { sessionId })`) and the book does not; an own-book person (member in the session's own book) is written in place of an overlay; an ancestor's own-book person → an overlay in the branch's own book; **retire on in-place**: a descendant D (insert `branch_ancestry` and a copied `session_messages` line with origins) reads R, the parent's second write in the same turn retires R and inserts the new row — D still reads R, the parent reads the new row; follow on a card-less member refused; the not-lifted refusal; `lockStateVersion` is taken (spy, or two concurrent writers serialise).
- Existing: every test file matching `grep -rln "bookWritePlace\|loreWriteTargetFor\|anchorFor" src --include=*.test.ts` plus `src/lib/server/state/sessionLoreWrites.int.test.ts` and `src/lib/server/characters/versions.int.test.ts` stay green.

## Out of scope
Callers of `writeCastVersion` (wave 2), Back/Forward/delete of versions (wave 2, V-time), `branch.ts` (writing ancestry and the flag — wave 2), the reader, the boot pass, NOMENCLATURE, docs.

## Stop and ask (in your report) when
An export beyond this brief seems needed; a rule conflicts with the code (e.g. `bookWritePlace`'s callers are not inside a transaction); an existing test's expectation must change (say which and why); anything needs a file you don't own.

## Done means
```
cd /home/jody/github/serene-pub && npx vitest run src/lib/server/characters/versions.write.int.test.ts src/lib/server/characters/versions.int.test.ts src/lib/server/lorebooks/sessionLine.int.test.ts <the existing test files you found>
```
green (never pipe into `head`); `npx tsc --noEmit -p . 2>&1 | grep -E "characters/versions|sessionLine|state/write|lorebooks/ownBook"` empty; prettier clean on your new files. Before and after the run, `ls -d /tmp/serene-pub-vitest-* 2>/dev/null` — delete by name only dirs that appeared from your runs.

Report: names and signatures, changed files, test results (counts per file), anything you disagreed with, Noticed-not-done.
