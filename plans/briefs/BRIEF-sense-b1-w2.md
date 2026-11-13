# BRIEF — `sense-b1-w2` — the write: a session's change to a lorebook entry is held; a turn owns it

You are a `lane-worker` for lane `sense-b1` (supervisor: the agent that launched you). Repo
`/home/jody/github/serene-pub`. Use absolute paths. Return your report as your final message (no report file).
Another worker (`w3`) is editing reader files at the same time: **never edit a file outside your list below.**

## The lane in one paragraph

Stage B's thin slice: a pipeline's change to an entry of the session's **attached lorebook** is no longer written
into that lorebook. It is stored as a **held amendment** 🚧 — an `entry_amendments` row whose `lorebook_id` is the
session's **own book** (`lorebooks.session_id = the session`; `ownBookFor(db, sessionId)` in
`src/lib/server/lorebooks/ownBook.ts`), whose `entry_id` is the attached lorebook's entry, with
`source_message_id` = the turn's anchor and `base` = the value of each changed field as the session read it when it
wrote. **A held amendment is exactly a row with `base IS NOT NULL`.** Only the session that holds it reads it.
Apply (a later worker) folds it into the lorebook. Owner rulings that bind: **"Only Apply settles." "A turn owns
what it wrote."** It is a session, never a chat; every session has a lorebook.

## Already built (by w1) — read, do not change

- Schema/migration `drizzle/0156_nappy_paladin.sql`: `entry_amendments.source_message_id` (int, no FK),
  `entry_amendments.base` (jsonb `Record<string, {v: unknown} | null>`), `year` nullable with CHECK
  `year IS NOT NULL OR (base IS NOT NULL AND month IS NULL)`; `lore_imprints.origin/batch/cause`.
- `src/lib/shared/lorebooks/amendments.ts` / `lineReading.ts`: `Amendment = LineAmendment | HeldAmendment`
  (`held: { anchor }`), held rows applied last by `amendmentsOnLine`.
- `src/lib/server/state/reading.ts`: `LineReading.holderBookId` set by `sessionReadingOf` for a session with an
  attached lorebook. `src/lib/server/state/entriesOnReading.ts`: `entryOverlaysFor` adds the holder's held rows
  to any reading carrying `holderBookId`. So `entriesAsRead(db, book, await sessionReadingOf(db, s), …)` and
  `entryAt` already show a session its held changes.
- Use `wrap` / `unwrap` / `sameValue` from `src/lib/server/lorebooks/imprints.ts` for `base` values (`{v}` or
  null for absent).

## Goal

1. **`changeLoreEntry`** (`src/lib/server/pipelines/runtime/host.ts` ~2003). When the stored entry is **not in
   the session's own book** (`stored.lorebookId !== ownBook.id` — it is the attached lorebook's), it:
   - builds the change exactly as today (`data` = the typed patch plus `name` / `content`, the wire shape an
     amendment overlays: `name`, `content`, declared fields flat); if `data` is empty, returns false;
   - reads the entry **as the session reads it now**: `sessionReadingOf(h, sessionId)` (carries the holder, so an
     earlier held change of this session is part of what it read), `entryOverlaysFor(h, stored.lorebookId,
     reading, [stored.id])`, `entryAt(<the stored row's wire form, as the retrieval read builds it with
     toEntryRow>, overlays, reading)`;
   - keeps only the keys of `data` whose value differs from what the session read (`sameValue`); none → false;
   - refuses with a `HostScopeError` when a kept key is in `NEVER_AMENDED`
     (`src/lib/shared/lorebooks/amendments.ts`; a history entry's date parts, bookkeeping columns): an amendment
     never sets those, so the change would vanish. 🚧 provisional sentence: `${nodeKey}: '<entry title>' keeps its
     date in the lorebook, and a session's change cannot move it — change it in the lorebook.` List the sentence
     in your report;
   - inserts ONE held amendment: `lorebookId: ownBook.id`, `entryId: stored.id`, `branchId: null`, `fields` = the
     kept keys, `base` = `{ key: wrap(read value) }` for each kept key, `sourceMessageId` = `turnAnchorOf(h,
     sessionId, <the run's turn message: turnMessageId ?? turnMessageOf(scope.runId)>)`, and a date: the
     reading's `moment` at day grain (`dayOnly`) when it has one, else `year/month/day` null;
   - takes the advisory lock on the **own book's** id (inside `at` when given — the caller's transaction — else its
     own `db.transaction`, using only `tx` inside it);
   - touches nothing in the attached lorebook: **no update, no `lore_imprints` row, no vector delete, no line
     fork, and no line refusal** (the "written on another line of the book … change it in the lorebook" refusal and
     `pendingLineFork` do not apply to a held change) — **whatever the lore write mode is** (Full included);
   - returns true.
   A change to an **own-book** entry is unchanged (today's update, imprint and vector delete).
   **`fileOntoHistoryDay`** keeps today's write-through: give `changeLoreEntry` an internal option the history path
   passes (history days are a later Stage B lane's), and say so in a one-line comment.
2. **`core:outlet/update-lore-entry`** (~11489): stop refusing a change to an attached-lorebook entry on "not
   this session's book" grounds. Resolve `p.entry` over **what the session reads**: when the session has an
   attached lorebook, its attached book on `sessionReadingOf` then its own book (`sessionEntriesAsRead` in
   `ownBook.ts` is that union, with one name rule over both, so a tie across them refuses); otherwise as today.
   Keep every existing refusal sentence word for word (unseen, none, tie). `resolveLoreLinkEnd`'s **link** purpose
   must not change. Then `changeLoreEntry` decides held or not by the stored row's book. **The published ports and
   result shape do not change**: `{ id, entryId, lorebookId, route, notes? }` — for a held change `lorebookId` is
   the entry's lorebook and `route` is `"own-book"` (where the write landed). The `writes.lore` refusal
   (`loreWriteRefusal`) stays first. The `sources` / settle path and the history re-date checks stay as they are
   (the settle triggers are out of scope); the re-date checks run only for a write that is not held.
3. **`create-lore-entry`'s `match` path** (~11275–11340): a match that finds an attached-lorebook entry becomes a
   held change through `changeLoreEntry`, and **must not fork the session's line**: today `forkedLoreLine` runs
   before the match. Fork only when the outlet will insert a row or file a history day; match against the
   pre-fork reading (`target.line.reading`, which is what the session reads). Inserts and history filing behave
   exactly as today.
4. **The retrieval read** (~4380–4470): confirm the session reading handed to `readBook` for the attached book
   carries `holderBookId` (it should, from `sessionReadingOf`); change nothing else there. The rule-fed overlay
   stays.
5. **The names vocabulary** (`src/lib/server/annotations/index.ts`): `amendedNamesOf(db, lorebookId,
   holderBookId?)` reads `(lorebook_id = lorebookId AND base IS NULL)` plus, when `holderBookId` is given and
   differs, `(lorebook_id = holderBookId AND base IS NOT NULL)`; `loadVocabulary(db, lorebookId, opts?: {
   holderBookId?: number | null })` passes it through. Every existing caller keeps its behaviour (no held names).
   In `host.ts`, the three session-scoped callers (~6528 vocabulary, ~6763 links, ~6894 entity) pass the session's
   holder (`(await sessionReadingOf(db, sessionId))?.holderBookId`, or the own book's id when the session has an
   attached lorebook). Report (do not edit) any other session-scoped caller you find (for example
   `annotations/queue.ts`).
6. **A turn owns it** (`src/lib/server/state/write.ts`): `retractLoreAnchoredTo` also deletes (returning the rows)
   the held amendments in the session's own book whose `source_message_id` is in `messageIds`; they ride the lore
   result and a new optional `RetractedState.heldAmendments` (the rows as they were), count in `changed`, are
   revived by `reviveRetractedState` (timestamps back to `Date`, as the other rows), and are re-inserted — ids and
   all — by `restoreRetractedState` (Forward, and a failed re-tell). Held rows are whole rows: no splice. Do **not**
   add a key to `takenSummaryOf` (it rides a published port). Check that every path the brief names reaches it:
   swipe and regenerate (`retractStateAnchoredTo(…, "replaced")`, `retakeTurn.ts`), Back and Forward (rewind),
   delete (`messages/store.ts` `retractLoreOf`); report each path and how it reaches the held rows.

## Files owned

- `src/lib/server/pipelines/runtime/host.ts` — `changeLoreEntry`, `fileOntoHistoryDay`'s call, the
  `update-lore-entry` case, the `create-lore-entry` match/fork ordering, the three vocabulary call sites. Nothing
  else in this file.
- `src/lib/server/state/write.ts` — `retractLoreAnchoredTo`, `RetractedState`, `reviveRetractedState`,
  `restoreRetractedState` only.
- `src/lib/server/annotations/index.ts` — `amendedNamesOf`, `loadVocabulary` only.
- Tests: new `src/lib/server/pipelines/runtime/host.heldEntryChange.int.test.ts` (the write and the names
  vocabulary), new `src/lib/server/state/heldAmendments.undo.int.test.ts` (the turn cases), and **existing test
  files that break because a change to an attached entry is now held** — rewrite those cases to the new behaviour
  without weakening what they test (where a case tested the imprint rule on a real lorebook through
  `update-lore-entry`, keep the rule tested by another route, e.g. writing the imprint directly, and say how).
  Likely: `src/lib/server/lorebooks/imprints.int.test.ts`, `src/lib/server/sockets/sessions.retraction.int.test.ts`,
  `src/lib/server/sockets/sessions.lairWalk.int.test.ts`, `src/lib/server/sessions/rewind.int.test.ts`,
  `src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts`. List every test file you changed and why.

## Files readable

Anything. Useful: `src/lib/server/lorebooks/ownBook.ts` (`ownBookFor`, `turnAnchorOf`, `sessionEntriesAsRead`,
`lorebooksReadBy`), `src/lib/server/lorebooks/imprints.ts`, `src/lib/server/state/entriesOnReading.ts`,
`src/lib/server/utils/testDb.ts`, existing host int tests for how a test drives an outlet, `src/lib/server/state/
oneUndoRule.int.test.ts` and `src/lib/server/sessions/oneUndoRule.int.test.ts` for the turn cases.

## Out of scope

Apply, the "This session only" list, take-back, branch copy, any other reader, settle, docs, NOMENCLATURE, the
SDK, sockets, links, new entries, members, values, scenes, removing the lore write mode or any routing function,
`ensureSessionLine`.

## Stop and ask (in your report, then stop) when

- a published SDK name, port or the outlet's result shape would change other than as stated above;
- resolving an attached entry from `update-lore-entry` needs a signature change outside your files;
- a held change would become visible to another session or to the lorebook's own reading;
- you need a new exported name (name it and why; internal helpers inside your files are fine — list them);
- an existing test fails for a reason you did not cause (report it verbatim; do not fix other people's code).

## Done means

- `host.heldEntryChange.int.test.ts`: a session on an attached lorebook runs `update-lore-entry` on an attached
  entry **in each lore write mode (Full, Review, Off — whatever the code calls them)**: the lorebook row,
  its `lore_imprints`, its vectors and the session's line are untouched; one held row exists in the session's own
  book with `fields`, `base`, `source_message_id` and the right date (dated when the session reads at a moment,
  undated otherwise); the session's reading (`entriesAsRead` on `sessionReadingOf`) shows the change; another
  session of the same lorebook and the lorebook's own reading do not. Two changes to the same field in two turns:
  the second's `base` is the first's value. A change to an own-book entry is written as before. A change that
  changes nothing writes nothing. A held change via `create-lore-entry`'s match does not fork the line. A
  `NEVER_AMENDED` key is refused with the sentence. A member's session on someone else's lorebook holds its change
  the same way. The result shape is unchanged. The names vocabulary: `loadVocabulary(db, book, { holderBookId })`
  for session A holds A's held name; for B and with no holder it does not.
- `heldAmendments.undo.int.test.ts`: swipe, regenerate, Back and delete of the turn remove its held row (and only
  its row); Forward puts it back (same id); a failed re-tell puts it back; a held row of an earlier turn survives.
- Existing tests you touched pass. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean for your
  files (report others' errors verbatim without fixing them).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not need `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never
  `kill -9` anything. Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite
  silently (`db/transactionGuard.ts` throws in tests). It is a **session**, never a *chat*. Every session has a
  lorebook: never write "no lorebook".
- No migration in this task. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- **No reference to any other project or product** in code, comments, tests or docs.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Never run the
  whole suite. `npx prettier --check <file>` on each file you changed (the repo is not prettier-clean to start
  with: report only what your edits introduced). Do not start a dev server.
- Other sessions are editing this repo (a visual-novel layout lane, speech). Do not touch their files and do not
  "fix" failures that are theirs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Re-read the cited lines before changing anything; line numbers have drifted.
- NOMENCLATURE R3: "held amendment", never bare "held" in a name. ⚠ "held" is already used elsewhere (a ruleset's
  *held entry*, a change *held for review*); never reuse those names. Every user-visible sentence you add is
  provisional 🚧 copy: list each one.

## Report (your final message)

Changed files; every internal name you added; each undo path and how it reaches held rows; the existing tests you
rewrote and what each now proves; tests run with pass/fail counts; provisional sentences; anything that stopped
you; **Noticed, not done**.
