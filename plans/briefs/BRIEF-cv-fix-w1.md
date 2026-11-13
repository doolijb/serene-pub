# BRIEF cv-fix-w1 — versions writer fixes, fork timing, NUL strip

Worker for lane **cv-fix** (supervisor: lane-supervisor, Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Context (read these)
- Character versions (S4 stage 1): one table `character_versions`; `src/lib/server/characters/versions.ts` is the ONE writer (a leaf: no static `$lib/server/db` import; callers own the transaction; other modules reached by `await import()`).
- `plans/REPORT-cv-core-2026-11-05.md` — read it whole, especially the **Scope review** section at the end (items 1–5 below are its five fixes).
- Another worker (w2) runs at the same time. It edits `src/lib/server/lorebooks/ownBook.ts` (only `purgeOwnBookOf` and a new sweep near it), `src/lib/server/sockets/sessions.ts`, `sockets/import.ts`, `db/schema.ts`, `drizzle/**`, `startup/index.ts`, `utils/index.ts`, `utils/lorebookExportBuilder.ts`. You touch `ownBook.ts` only inside `loreWriteTargetFor`; **re-read `ownBook.ts` right before you edit it**, and never touch w2's files.

## Files owned (edit only these)
- `src/lib/server/characters/versions.ts`, `versionsLift.ts`, and their tests (`versions.test.ts`, `versions.int.test.ts`, `versions.write.int.test.ts`, `versionsLift.int.test.ts`)
- `src/lib/server/state/write.ts` — only `bookWritePlace`, `setValue`, `configure`, `proposeChange` (the place/fork hunks) and one new helper for re-pointing proposals (below)
- `src/lib/server/state/durable.ts` (`recordToTimeline`'s target/fork)
- `src/lib/server/lorebooks/sessionLine.ts`
- `src/lib/server/lorebooks/ownBook.ts` — only `loreWriteTargetFor` (one option)
- tests: `src/lib/server/lorebooks/sessionLine.int.test.ts`, `src/lib/server/state/durable.int.test.ts`, `src/lib/server/state/write.int.test.ts`, and new test files you create next to these. If an existing test elsewhere breaks **only because** of item 5's refusal (a fixture inserted a member raw and relied on the lazy base), fix that fixture to use `insertCastMember` and list the file in your report.
- **Do not edit `NOMENCLATURE.md`.** Put your proposed §25 rows in your report; the supervisor appends them.

## Items

### 1. The lift note becomes structured data (`versionsLift.ts` ~680–694)
Today the boot lift writes English prose into the member base's `note` (text column). The wording is unruled (★cv-core-1) and a lifted member is never revisited, so the prose would be stored for good. Make it data instead; the wave-3 admin list will word it.
- Keep the `note` text column (no schema change). On a base with `written_by = 'lift'`, `note` holds `JSON.stringify` of a typed, versioned object. Define and export (🚧) in `versionsLift.ts`: `LiftNoteV1 = { v: 1; differences: LiftDifference[]; mixedGreetings?: true }` and `LiftDifference = { branchId: number | null; line: string /* the line's name at lift time */; at: { kind: "date"; date: StoryDate } | { kind: "before-first-change" }; appearance: number | null /* null = every appearance */; fields: string[] }`, plus a pure `parseLiftNote(note: string | null): LiftNoteV1 | null` (returns null for null, non-JSON, or another shape — never throws).
- Map today's cases: the base's unamended difference → `{branchId: null, line: "main", at: {kind:"before-first-change"}, appearance: null}`; a tier's `label` today is `appearance N` / `every appearance` → `appearance: N | null`; `dateLabel(D)` → `{kind:"date", date: D}`. The de-dup check at ~663 compares on the structured fields instead of the label strings.
- `noted` counting and `differences.length || mixedGreetings` → noted, unchanged. No English sentence is written by the lift any more.
- Update `versionsLift.int.test.ts`: assert the parsed structure (e.g. `parseLiftNote(base.note)` → `mixedGreetings: true`, a difference's `fields`, `at.kind`), not substrings of prose. Add a pure test of `parseLiftNote` (bad JSON → null).

### 2. A story write with no anchor is refused (`versions.ts` `storyWrite`)
A story write whose anchor resolves to null (`session.messageId: null`, or no open turn) would coalesce forever. After `anchorFor(...)` in `storyWrite`, if `anchor == null` throw `new Error("A session's change to a cast member needs the turn it belongs to, and this one names none; an author's change uses a place on the member's line instead.")` (🚧 provisional words, list them in your report). Do it before any row is written (the target overlay row is inserted earlier — move the anchor check, or the anchor computation, ahead of the overlay insert if it can be; otherwise the throw rolls the caller's transaction back — say which). Change the test at `versions.write.int.test.ts` ~585–591 that pins null-anchoring: a `messageId: null` story write is now refused, and nothing was written (no version, no overlay row, no forked line).

### 3. The line forks inside the write's transaction, after its checks; a proposal forks at accept
Today `bookWritePlace` (write.ts ~407) calls `ensureSessionLine(db, …)` on the OUTER handle before `setValue` / `configure` / `proposeChange` open their transactions, and `recordToTimeline` (durable.ts ~176) forks through `loreWriteTargetFor(db, …)` before it knows anything will be written. A refused write therefore leaves a forked line behind. Rules (CLAUDE.md Hard rule: inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently):
- **setValue / configure:** compute the place inside the existing transaction, after the checks it runs there (`movedSinceBase`, `validateValue` for setValue), immediately before the insert: `bookWritePlace(tx, ctx, owner)`. Everything that uses `place` must read it there. Keep `anchorFor` where it is unless it must move.
- **proposeChange:** never forks. It computes the place without forking (split `bookWritePlace` into a read part and the fork, or give it an internal `{ fork: false }` option — your choice, say which) and stores the riding line's id as today.
- **Accept** (`decideProposal` → `applyChange` with `ctx.branchId` set → `setValue`): `bookWritePlace` with `ctx.branchId` given must, when the session still rides (`sessions.line_on_first_write` true) and the owner is not the session's own notes (`isOwnBookOwner`), call `ensureSessionLine(tx, …)` and land on the new line when `ctx.branchId` equals the line the session rode (`sessions.lorebook_branch_id` before the fork, null = main); `historyEntryId` stays the proposal's.
- **Pending proposals follow the fork:** when `ensureSessionLine` forks, the session's **pending `value` proposals for a book-layer owner** (`payload.owner.kind` in `lorebook`, `cast_member`, `location`) whose `branch_id` IS NOT DISTINCT FROM the line it rode are moved onto the new line, in the same transaction. Otherwise a second proposal accepted after the first one forked would land on the parent's line. Put the UPDATE in a small exported helper in `state/write.ts` (e.g. 🚧 `moveRidingProposals(tx, sessionId, fromBranchId, toBranchId)`), called from `ensureSessionLine` through `await import("$lib/server/state/write")` (sessionLine.ts must stay free of a static db import). Name it in your report.
- **recordToTimeline:** resolve the target without forking (add `opts.fork?: boolean` to `loreWriteTargetFor`, default true — its other callers `rulesets/ties.ts` and `pipelines/runtime/host.ts` keep today's behaviour, do not touch them), then inside each `record` transaction, when `route === "book"`, after `validateValue`, `const branchId = await ensureSessionLine(tx, sessionId)` and write the rows with that `branchId` (the `common` branchId otherwise). The `delete` reason route is `book` too — same rule.
- Update the comments in `sessionLine.ts` (header) and `bookWritePlace` to say where the fork now happens; drop the ⚠ race paragraph if every caller now passes a transaction handle (check: the versions writer, `bookWritePlace` from inside transactions, `loreWriteTargetFor` — which ties.ts/host.ts still call on the outer `db`; keep the paragraph for those, reworded).
- Tests (put them in `sessionLine.int.test.ts` or a new `src/lib/server/lorebooks/sessionLine.forkTiming.int.test.ts`): a branch session riding its parent's line (`line_on_first_write` true) —
  (a) a `setValue` refused by its base check (`movedSinceBase`) or by `validateValue` forks nothing (flag still set, no new `lorebook_branches` row);
  (b) a refused `configure` forks nothing;
  (c) `proposeChange` forks nothing and stores the riding line; accepting it forks the line and the value lands on the new line;
  (d) two pending proposals: accept the first (forks), the second's `branch_id` is now the new line, and accepting it lands there, not on the parent's line;
  (e) `recordToTimeline` with nothing storable (or every value refused) forks nothing; with a value it forks and files the row on the new line.
  Look at how `sessionLine.int.test.ts` already builds a riding branch session and reuse it.

### 4. NOMENCLATURE (report only)
Draft one §25 row (old | new | why) for the supervisor: _a story-write copy takes a **new** write order; only a restored row (Forward, `restoreVersions`) keeps its own; §32 §1's "a copy inherits its source's" is superseded_ — it fixes the contradiction between the **write order** row (~line 3284, "a copy inherits its source's") and the `writeCastVersion` row (~3294).

### 5. No base is made at runtime (`versions.ts` `ensureMemberBase` ~836)
Today a member with no version at all gets a base written lazily, labelled `lift`, which hides a straggler. Make `ensureMemberBase` refuse in words in both cases with the existing sentence: `` `${member.name} hasn't been moved onto character versions yet; restart the server so the upgrade lifts them.` `` (no new words). Callers: `authorWrite` (~1066) and `storyWrite` (~1290). Update its doc comment and `writeCastVersion`'s ("A member with no version yet gets its base first"). Tests: an author write and a story write on a member inserted raw (no base) are refused with that sentence and write nothing. Then grep the suite for tests that relied on the lazy base (members inserted with `tx.insert(schema.lorebookBindings)` and then written through `writeCastVersion`, `sockets/lorebooks` `updateBinding`, amendments, narrative graph, `characterBindingSync`), run them, and fix only fixtures that broke because of this (use `insertCastMember`). List each.

### 10. Strip U+0000 before the jsonb write (`versions.ts`)
Profile fields are `jsonb`; a string holding U+0000 fails the whole write (PG refuses `\u0000` in jsonb, and in text). Add one private helper in `versions.ts` that deep-strips `\u0000` from every string in a profile value (strings, arrays, nested objects — e.g. `extensions`), and apply it in the three places a profile reaches the table: `insertRows` (covers `insertCharacterVersions`, the lift and every insert), `updateCardVersion`'s `set`, and `updateInPlace`'s `set`. Not in `restoreVersions` (it puts back rows as they were). Test (int): a card version and a cast version written with a NUL in `description` and in a nested `extensions` string store the string without it.

## Rules (quoted from CLAUDE.md and the lane contract)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`"; "no static `$lib/server/db` import in modules tests mock" — `versions.ts` and `sessionLine.ts` stay leaves.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."
- "Every session has a lorebook — never write 'no book'" (comments and messages included).
- Names: any new exported name is 🚧 and goes in your report's proposed §25 rows. Grep a name before using it (NOMENCLATURE §24: "Grep for it first — across `src`, the SDK, and the schema").
- Tests: targeted only, `npx vitest run --maxWorkers=4 <files>`; **never pipe vitest into `head`** (the SIGPIPE leaks PGlite temp dirs); an int test that opens a DB inside an `it` needs a 60 s timeout. List `/tmp/serene-pub-vitest-*` before and after your runs; delete only dirs your runs left, by name.
- Prettier: format only your hunks (most files were not prettier-clean before); new test files must pass `npx prettier --check`.
- `npx tsc --noEmit -p .` must show no error in your files (the old `arrangeCanvas.dom` error is known).

## Stop and ask (put it in your report and carry on with the rest) when
a ★ is unruled, a name is user-visible, you would need a schema change or migration, or a fix needs a file you don't own.

## Done means
All of `versions.test.ts`, `versions.int.test.ts`, `versions.write.int.test.ts`, `versionsLift.int.test.ts`, `sessionLine.int.test.ts` (+ your new fork-timing file), `durable.int.test.ts`, `write.int.test.ts`, `clockProposal.int.test.ts`, `sessionLoreWrites.int.test.ts`, `ownBook.int.test.ts`, `src/lib/server/state/retractCastVersions.int.test.ts`, plus every test file you fixed for item 5, green. `tsc` clean on your files.

## Report (your final message)
Names and signatures first; changed files; tests run with counts; proposed §25 rows (item 4 plus your new names); provisional words; open ★; Noticed, not done.
