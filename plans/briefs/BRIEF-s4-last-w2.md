# BRIEF s4-last-w2 — a branch reads its parent's people on the parent's line (★s4-fold2-1, built as recommended) — 2026-11-08

Supervisor: lane `s4-last`. You are a lane-worker; you edit only the files below.

## The gap

A session on its own notes alone (`sessions.lorebook_id` null) reads them on its line (`lorebook_branch_id`, a line of its own book) — owner ruling ★bk-fold-1 (2026-11-08): *"a session on its own notes reads them on its own line and moment, like any book"*. A **branch** of such a session (`sessions/branch.ts` `branchSession`) gets its own copy of the notes and of the line (`lorebooks/ownBook.ts` `copyOwnBookToBranch`), but it **rides the parent's people** — ★CV-14 (plan §32 §5d): *a branch's seat points at the member the parent's seat holds — the parent's own-book people included — never a new one.* The members live in the parent's notes, an ancestor's own book in the branch's **overlay chain** (`state/reading.ts` `overlayChainOf`: own book, then each ancestor's own book, nearest first).

`cast/memberAsRead.ts` `pickVersions` (~515–619) reads every chain book **other than the reading's own** at that book's **main** (`onBookMain`, ~528–564). So a cast version the parent reads on its line (e.g. "Anna by night", dated on the parent notes' Night line) is not what the branch reads. Pinned by the `test.fails` "a branch reads the people its parent reads on the line" in `src/lib/server/lorebooks/foldInParent.int.test.ts` (~1525).

## The fix (lead's recommendation, built as written)

1. **Store the ancestor's line at the fork.** Each `sessions.branch_ancestry` entry is `{ sessionId, mark }`. Add an optional `lineId` to the **parent's** entry that `branchSession` writes (~136–139 of `branch.ts`): the parent's line in its own notes at the fork — `original.lorebookBranchId` **only when** the parent reads its notes alone (`original.lorebookId == null`) and that is non-null; otherwise omit the field. Grandparent entries are spread from `original.branchAncestry` unchanged (they keep their own `lineId`). **A missing `lineId` reads main — today's behaviour. No boot pass, no migration.**
   - The schema's `$type` (`db/schema.ts` ~2850) is not yours: don't edit it (the supervisor queues it). Build the ancestry into a local variable typed with the optional field (e.g. `const ancestry: { sessionId: number; mark: number; lineId?: number }[] = [...]`) and assign that, so no excess-property error and no cast. In `state/reading.ts`, widen the private `BranchAncestry` type (~235) with `lineId?: number | null`.
2. **Read each chain book along its ancestor's line.** In `memberAsRead.ts`: alongside the chain, find for each chain book that is an ancestor's own book whose ancestry entry has a `lineId`, that book's `Line` — `lineOfBook(db, bookId, lineId)` (`state/reading.ts`, exported), with the reading's `sessionCuts` copied onto it (`{ ...line, sessionCuts: reading.line.sessionCuts }`). A `BranchRefusal` (a deleted or foreign line) → leave that book out (reads main, as `sessionReadingOf` treats a stale line). Keep this helper **private** to `memberAsRead.ts` (no new exported name). The book ↔ ancestor match is `lorebooks.session_id` (as `overlayChainOf` does).
   - SQL (~555–567): rows of such a book read `onLineAtSql(cv.branchId, dateCols, bookLine, reading.moment)` instead of `onBookMain`; every other row exactly as today.
   - Pick (~587–617): today the own-line book's rows are picked alone (`versionInForce` with `overlayDepth: null`, on the reading's line) and beat the rest on a date tie. Generalise to groups: the own-line book (as today), **each chain book with a line** (picked alone: its rows with `overlayDepth: null`, `versionInForce(rows, bookLine, reading.moment, appearance)`), and the rest (as today). Combine the group winners: the later date wins (undated lowest — the same `dateOf` / `compareDates` the code uses); on a date tie the **nearer holder** wins (lower chain index; the own book is chain index 0; a non-chain, i.e. attached-book, row is lowest). Return each winner with its real `overlayDepth` (as `mineAs` does today).
   - `versionInForce` lives in `shared/lorebooks/lineReading.ts` — **not yours; don't edit it.**
   - **With no `lineId` anywhere, the result must be identical to today's** (same SQL predicate shape for those rows, same pick). Keep the existing comments' meaning; update the "A row in an own book of the chain reads at that book's main" comment to say: except an ancestor's own book whose ancestry entry names its line at the fork, which reads along that line.
3. **Flip the pin.** In `foldInParent.int.test.ts` change that one `test.fails(` to `test(`, delete the `// ★ (supervisor): …` comment above it, and fix the now-false parenthetical "(A seat with no card or envoy, Bruno's, is not copied by a branch: only the first seat is compared.)" — since w1 (2026-11-08) a branch **does** copy a live card-less seat. Either compare all members (if they read equal) or reword to say why only the first is compared. Nothing else in that file.

## Rules you work under (quoted by the supervisor)

- ★bk-fold-1 and ★CV-14 above. Owner 2026-11-05: *"Data wise, the session is a patron of the lorebook and branch, it doesn't own it."* — a branch never writes the ancestor's book.
- 0.6 is in users' hands: any change to stored data ships with a forward migration or boot pass and a test that a second boot changes nothing. **This change adds an optional JSON field with no boot pass, on purpose (missing = main = today's reading)** — so the test that existing ancestry reads exactly as before is mandatory.
- Inside `db.transaction(async (tx) => …)` use only `tx`. `memberAsRead.ts` must not statically import `$lib/server/db` (its header says so): every function takes its handle.
- Never write copy or comments framing a session as having no lorebook — say own notes / own book / overlay. It is a **session**, never a chat.
- Decide implementation; name each choice in your report. No new exported names, settings, events.

## Files owned

- `src/lib/server/cast/memberAsRead.ts` (`readingAndChainOf`, `pickVersions`, a new private helper)
- `src/lib/server/state/reading.ts` (the `BranchAncestry` type only, unless the helper truly needs more — then say why)
- `src/lib/server/sessions/branch.ts` (the `branchAncestry` value in the `sessions` insert, ~132–139, only)
- `src/lib/server/lorebooks/foldInParent.int.test.ts` (the flip, item 3, only)
- New test `src/lib/server/cast/memberAsRead.ancestryLine.int.test.ts`

Readable: `shared/lorebooks/lineReading.ts`, `state/lineSql.ts`, `lorebooks/ownBook.ts` (`copyOwnBookToBranch`, `copyParentLineChain`), `memberAsRead.versions.int.test.ts`, `foldInParent.int.test.ts` (fixtures `world`, `foldedOnNight`, `personRead`, `reads`), `characters/versions.ts` (`insertCastMember`, `insertCharacterVersions` — the only writers of members/versions; tests use them).

Another lane-worker (w3) is editing `lorebooks/ownBook.ts` `copyOwnBookToBranch` at the same time — don't touch `ownBook.ts`.

## Tests (Done means)

New `memberAsRead.ancestryLine.int.test.ts` (vi.mock block, data dir prefix `serene-pub-vitest-member-ancestry-line-`, `releaseDataDir`, 60 s timeouts — model on `memberAsRead.versions.int.test.ts` or `branch.seatMembers.int.test.ts`): a parent session on its own notes alone with a member that has a main version and a later-dated version on a notes line; a child session whose `branch_ancestry` names the parent (a) **without** `lineId` → `membersAsRead(db, [m], { sessionId: child })` reads the main version, exactly what it read before this change (assert the whole read, not one field); (b) **with** `lineId` = that line → reads the line's version; (c) with a `lineId` naming a deleted/foreign line → reads main. Plus the flipped fold test passing.

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/cast/memberAsRead.ancestryLine.int.test.ts src/lib/server/lorebooks/foldInParent.int.test.ts src/lib/server/cast/memberAsRead.int.test.ts src/lib/server/cast/memberAsRead.test.ts src/lib/server/cast/memberAsRead.versions.int.test.ts src/lib/server/sessions/branch.ancestry.int.test.ts src/lib/server/sessions/branch.cardlessSeats.int.test.ts src/lib/server/state/ownNotesReading.int.test.ts src/lib/server/state/ownNotesLine.int.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-last-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-last-w2-tests.log'
```

Never pipe vitest into `head`. Then `npx tsc --noEmit -p .` filtered to your files (`2>&1 | grep -E "memberAsRead|state/reading|sessions/branch|foldInParent"` — run tsc to a log file under a scope: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npx tsc --noEmit -p . > <scratchpad>/s4-last-w2-tsc.log 2>&1'`), and `npx prettier --check` on your files.

## Stop and ask when

The pick can't stay identical without `lineId`; you need to edit any other file (e.g. `lineReading.ts`, `schema.ts`); another reader of members turns out to read chain books at main and breaks the flipped test (name it, don't fix it); a new name/setting/event. Report and stop.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.

## Report

In your final message (not a file): changed files with line ranges, each implementation choice, tests run with pass/fail counts (from the log), tsc result for your files, prettier result, Noticed-not-done.
