# BRIEF pl3-w2 — The notes' book-layer rows are tied to the turn like session values (owner ruling ★pl2-2, 2026-11-05)

Lane **pl3**, worker **w2**. Supervisor: the pl3 lane-supervisor. Work from `/home/jody/github/serene-pub`. Another worker (w1) is editing `src/lib/server/lorebooks/ownBook.ts` (`cloneWithChanges`) and `src/lib/server/lorebooks/cloneWithChanges.int.test.ts` at the same time; Stage S1 of another programme edits `db/schema.ts`, `drizzle/**`, `sessions/seats.ts`, `sessions/seatMembers.ts`, `sockets/sessions.ts`, `sockets/import.ts`, `sessions/branch.ts`, `sessions/envoys.ts`, `sessions/seatBookCast.ts`, `startup/index.ts`. Never touch any of those.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

The owner ruled (★pl2-2, 2026-11-05): *"tie the notes' rows to the turn like session values"* — a value written to the session's **own book's** book-layer rows (its `lorebook` row, its cast member rows) is anchored to the turn like a session value, so Back/Forward/swipe take and restore it; **the "author layers are never anchored" rule stands for every real book.**

Today `anchorFor` (`src/lib/server/state/write.ts` ~537) returns `null` for every owner that isn't session-scoped (`isSessionScoped`), so a book-layer row (`lorebook`, `cast_member`, `location`) gets `valid_from_message_id = null` and `retractStateAnchoredTo` (which deletes `attribute_values`/`attribute_configs` by `valid_from_message_id`) never takes it. `isOwnBookOwner` (~422, private) already tells an own-book row.

## The change (decided by the supervisor — build exactly this)

In `src/lib/server/state/write.ts` (dirty at HEAD from other lanes — additive hunks, never reformat, re-read right before each edit):

1. A **private** helper (name it e.g. `notesTurnOwnerOf`) `(db, sessionId, owner) => Promise<TurnOwner | null>`: the own book is `(await lorebooksReadBy(db, sessionId)).ownBookId` (null → null).
   - `owner.kind === 'lorebook'` and `owner.id === ownBookId` → `{ kind: 'session', id: sessionId }` (the world's turn: it moves every turn).
   - `owner.kind === 'cast_member'` whose `lorebook_bindings` row's `lorebookId === ownBookId` → `{ kind: 'session_cast', id: <that row's characterId> }` — the character's own turn, as a session value of a cast member is (R9: "A change to a cast member anchors to that character's latest message"; a `session_cast` owner's id IS the character id — see `worldOwnerOf` in `state/worldScope.ts`). A row with no `characterId` → the world's turn.
   - Everything else → `null`, **including an own-book `location`** (the ruling names the `lorebook` row and the cast member rows; a notes place's rows move into a real book on _Apply to the lorebook_ with their ids, where an anchor would make the book's row go with a Back).
   Put a doc comment on it: `🚧 (★pl2-2, owner 2026-11-05) …`.
2. `anchorFor`: when `!isSessionScoped(owner.kind)`:
   - not `isBookLayer(owner.kind)` → `null` (as now);
   - `ctx.messageId === null` → `null` (a caller naming no turn — a recording's accept — keeps today's behaviour);
   - `notesTurnOwnerOf(...)` null → `null` (a real book: never anchored);
   - else run the **same** three cases as a session owner, with that turn owner: `ctx.messageId === undefined` → open anchor (for a `session_cast` turn owner via `notBehindOwnRows`, as now); `ctx.ownAnchor && ctx.messageId !== null` → `ctx.messageId`; open → it; sealed → the same `StateRefusal` with `sealerName`. Restructure minimally (compute the turn owner, then share the existing tail) — don't duplicate the tail.
   - Update `anchorFor`'s doc comment and the file-header paragraph *"Author-layer edits (`card`, `cast_member`, `lorebook`) are **not** locked. Authoring is not play."* with one dated sentence each: the session's own notes' `lorebook` row and cast members are the exception (★pl2-2, 2026-11-05); every real book's rows are still never anchored.
3. `notBehindOwnRows`: it filters the owner's rows by `session_id = sessionId`; own-book rows carry `session_id` NULL. Filter by session only when `isSessionScoped(owner.kind)` (an own-book member's rows are that session's alone). Nothing else changes there.
4. Confirm (read, don't change unless it's broken) that `retractStateAnchoredTo` / `restoreRetractedState` (and `keepLaterState` in `sessions/rewind.ts`, which you may not edit) take and restore these rows: they match `valid_from_message_id` only. Say what you found.
5. `configure` also calls `anchorFor`, so an own-book config is anchored too (as a session config is). Keep that; say so in your report.
6. Nothing else: no change to `isOwnBookOwner`, `assertBookWritesOn`, `applyAutomatic`, `proposeChange`, `setValue`'s row shape (`session_id` stays NULL for book layers), `bookWritePlace` (dating stays). No new exported name.

## Tests — `src/lib/server/state/worldScope.int.test.ts` (yours; 60 s timeouts already set)

Use the file's fixtures (member's session on a provided book; the owner's own book; the existing *"Back takes the value with its message and Forward brings it back"* test at ~798 is the pattern — it uses the real Back/Forward or `retractStateAnchoredTo`/`restoreRetractedState`; prefer `rewindTurn`/`forwardTurn` from `$lib/server/sessions/rewind` if the fixtures make it straightforward, else the retract/restore pair, and say which). Add a `describe` for ★pl2-2:
1. *A member's session: a world value in the notes goes with Back and comes back with Forward* — write A, add a message, write B (row anchored: `valid_from_message_id` = that message), Back → reads A, Forward → reads B.
2. *The same for a person's value in the notes* (a seated character → own-book member; anchored to that character's latest message — make the newest message theirs, or use a run's write with `ownAnchor`/`messageId`; say which).
3. *A real book's author-layer write is still never anchored* — the owner's own book: a world value lands on the attached book's `lorebook` row with `valid_from_message_id` NULL, and Back leaves it.
4. *A notes place's value (an own-book `location` entry) is not anchored* — only if cheap; else skip and say so.

Run only (never pipe vitest into `head` — the SIGPIPE leaks PGlite temp dirs): `npx vitest run src/lib/server/state/worldScope.int.test.ts src/lib/server/state/write.int.test.ts src/lib/server/state/handEdits.int.test.ts src/lib/server/lorebooks/imprints.int.test.ts src/lib/server/sessions/rewind.int.test.ts`. A failure in a test that asserted the old "own-book rows are never anchored" behaviour: report it with file:line and what it asserted — **don't change another test's expectation without saying so**; an expectation that the ruling moves may be updated with a dated comment. Then `npx tsc --noEmit -p . 2>&1 | grep -E "state/write|worldScope"` must print nothing.

## Rules you work under (quoted from CLAUDE.md / NOMENCLATURE)

- *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."*
- *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."*
- *"Propose and wait — one recommendation and its trade-off, marked ★ — on anything a user sees or that outlives the change: … a new name / setting / flag / abstraction / event / table / migration."* No new exported name; a private helper is fine. No migration, no schema edit, no SDK edit.
- *"P1 Deterministic, never hidden. Code decides what code can; … every automatic action shows its cause and how to undo or switch it off."*
- NOMENCLATURE R1 one word, one meaning · R3 qualify, never the bare noun · R6 mark 🚧 provisional vocabulary. It is a **session**, never a *chat*.

## Stop and ask (in your report, don't decide) when
An ★ is unruled, a name is new and exported, a migration seems needed, or the change needs a file outside `src/lib/server/state/write.ts` and `src/lib/server/state/worldScope.int.test.ts` (plus a dated expectation change in another `src/lib/server/state/*.int.test.ts` the ruling moves — report each).

## Files readable
Anything. Especially `state/write.ts` (`anchorFor`, `turnOwnerOf`, `notBehindOwnRows`, `sealerName`, `isOwnBookOwner`, `retractStateAnchoredTo`, `restoreRetractedState`, `setValue`, `configure`, `decideProposal`), `lorebooks/ownBook.ts` (`lorebooksReadBy`), `state/worldScope.ts`, `sessions/rewind.ts`, the SDK's `openAnchorFor`/`isAnchorOpen` (`../serene-pub-sdk`, read only).

## Done means
The new tests and the listed files pass (or each failure explained); tsc clean on the two files.

## Report
Write `plans/briefs/REPORT-pl3-w2.md`: changed files with line ranges, tests run with pass counts, decisions you made (name each), what item 4 found, anything you couldn't do, Noticed-not-done.
