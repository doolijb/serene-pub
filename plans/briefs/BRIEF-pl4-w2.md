# BRIEF pl4-w2 — clones drop turn ties; Clone with changes ends Forward

Lane **pl4** (supervisor: lane-supervisor). Worker 2. App root `/home/jody/github/serene-pub`. Report in your hand-back message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Vocabulary — read this first
Every session has a lorebook: its **own book** (shown to people as **Session notes**) or an **overlay** on a parent book. The code says "notes" / "own book". **Never write or say "no book" / "no lorebook" / "a session that reads no book"** in comments, test names or your report — say "a session whose lorebook is its own book". A **real book** = a lorebook that is not some session's own book.

## Background (already built by worker 1, in `state/write.ts`)
Every row of the session's own book — its `lorebook` row, its cast members (`cast_member`) and now its places (`location` owners whose entry is in the own book) — is **tied to the turn**: its `attribute_values` / `attribute_configs` rows carry `valid_from_message_id` (the anchor), so Back takes them and Forward restores them. `valid_from_message_id` references `messages.id` **ON DELETE CASCADE**. A real book's rows are never anchored ("author layers are never anchored"). The owner's ruling (2026-11-05): *"Sharing a lorebook doesn't make it useable, but clone able."* → **every clone of a book drops the turn ties on the rows it copies**; Share as a lorebook itself does **not** strip (leave `shareAsLorebook` alone).

The resolver (`state/resolve.ts` `inForce`, ~485): among rows for one owner+slot, the latest anchor wins (null = −1, earliest); on one anchor, the later story date (`history_entry_id`); then the higher `id`. So **dropping anchors must keep the row in force in force**: write the un-anchored rows in order of `(valid_from_message_id ?? -1, id)` ascending, so the formerly-latest gets the highest id. `carryNotesValuesToCopy` in `lorebooks/ownBook.ts` (~997, `inOrder`) already does exactly this — copy its pattern.

## Items

### A. The duplicate path (`src/lib/server/lorebooks/tableRegistry.ts`, `polymorphic(...).copy` ~263 and `attributeRow` ~297)
`duplicateLorebookRows` (`utils/lorebookDuplicate.ts`) copies a book's template-layer attribute rows through the registry; `attributeRow` keeps `validFromMessageId` as is, so a copy of a shared own book (or Clone from one, a starter copy, a "new-world" session copy — all call `duplicateLorebookRows`) carries the original session's anchors (and loses the rows when that session's messages are deleted). Fix: in the attribute copy, set `validFromMessageId: null` on every copied row and insert the copies sorted by `(r.validFromMessageId ?? -1, r.id)`. Keep `sourceSessionId`/`sourceMessageId` as they are (provenance). Update the comment above `attributeRow`/`polymorphic` in one sentence (a copy is a real book: its rows are never tied to a turn; ruling quoted above). Only the attribute tables — `polymorphic` is also used for… check: if `polymorphic` serves tables other than `attributeConfigs`/`attributeValues`, apply the change only through `attributeRow` + a sort that is a no-op for tables without the column. Don't touch anything else in that file (it's dirty at HEAD; additive hunks, no reformat).

### B. Apply to the lorebook drops the ties of what it moves (`src/lib/server/lorebooks/ownBook.ts`, `applyOverlayItems` ~835)
Apply moves own-book entries (keeping their ids) into the attached real book. With places now tied to the turn, an applied place's `location` rows would sit in a real book still anchored. Fix: inside `applyOverlayItems`'s transaction (use only `tx`/`t`), after the entries move, for the `applied` entry ids: select their `attribute_values` and `attribute_configs` rows with `owner_kind = 'location'`, `owner_id IN applied`, `valid_from_message_id IS NOT NULL`; re-insert each as a new row with `validFromMessageId: null` (every other column kept, `id` omitted), in `(valid_from_message_id, id)` order, then delete the originals. (Un-anchored rows stay as they are; they already rank below.) Put it in a **private** helper in `ownBook.ts` (not exported; no new exported name). `cloneWithChanges` calls `applyOverlayItems`, so this covers Clone with changes' moved places too.

### C. Clone with changes ends the session's Forward (`cloneWithChanges` ~1120)
Lead decision (interim until Clone with changes is retired): Clone with changes **ends the session's Forward** the way a new message does. Call `discardForwardStack(t, sessionId)` (from `$lib/server/messages/store`, dynamic `await import(...)` like the rest of this file; it takes the handle you pass and runs on it) as the **first statement inside** `cloneWithChanges`'s `db.transaction` — on `t`, never the outer `db`. One-line comment saying why (a Forward after the clone would restore rows onto owners the clone moved; lead decision 2026-11-05, lane pl4). Add one sentence to `cloneWithChanges`'s doc comment.

## Tests
In `src/lib/server/lorebooks/cloneWithChanges.int.test.ts` (reuse its fixtures — `memberWorld`, `heldPerson`, `write`, `readOf`, `rowsOn`, `ownBookIdOf`, `place`… read them first; look at `src/lib/server/sessions/rewind.int.test.ts` for how a test posts messages and calls `rewindTurn`/`forwardTurn`):
1. **Forward is gone after the clone (C):** a session with a value written and a couple of messages; `rewindTurn` (Back) → ok; `cloneWithChanges` → ok; `forwardTurn` → `{ ok: false }` with the error `REWIND_REFUSALS.noneAhead` (`$lib/shared/sessions/rewind`: "There is nothing ahead to bring back."); and `rewindStateOf(...).forward` equals that same refusal.
2. **An applied place leaves its turn behind (B):** a place in the session's own book (an overlay item) with a value written after a message (so it's anchored — assert that first), then `cloneWithChanges` (or `applyOverlayItems`); the place is now in the copy, its `location` rows all have `validFromMessageId === null`, and the place still reads the latest value. If two values were written at different messages, the later one is still the one in force.
3. **A duplicate drops turn ties (A):** make a book whose rows carry anchors — the simplest honest way: a session whose lorebook is its own book writes a world value (own-book `lorebook` row) and a person's value after messages (anchored), then `shareAsLorebook` (rows keep their anchors — assert that, it's the ruled behaviour), then `duplicateLorebookRows` on the shared book in a transaction (as `sockets/lorebooks.ts` `lorebooks:duplicate` does) → every `attribute_values`/`attribute_configs` row on the copy's owners has `validFromMessageId === null`, and the copy reads the same in-force value as the original (when two values at different anchors exist for one slot, the later-anchored one wins on the copy too). If building this through `shareAsLorebook` is impractical, insert anchored rows directly on a real book's owners and say so.

## Files owned
`src/lib/server/lorebooks/tableRegistry.ts` (only the attribute-row copy: `attributeRow` and the copy loop in `polymorphic`), `src/lib/server/lorebooks/ownBook.ts` (only `applyOverlayItems`, the new private helper, `cloneWithChanges`), `src/lib/server/lorebooks/cloneWithChanges.int.test.ts`.
## Files readable
Anything. **Don't edit** anything else — other lanes are editing `db/schema.ts`, `drizzle/**`, `sessions/*`, `sockets/*`, `startup/index.ts` right now. `state/write.ts` was just changed by worker 1; don't touch it.
## Out of scope
`shareAsLorebook` (ruled: don't strip), `copyOwnBookToBranch`, the exporter, docs, NOMENCLATURE, `state/**`. No new exported names, settings, migrations. List anything else under "Noticed, not done".

## Rules (CLAUDE.md, quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "Never seed a row at a hardcoded id."
- `ownBook.ts` and `tableRegistry.ts` are dirty at HEAD: **don't reformat** — no `prettier --write`; additive minimal hunks; re-read the region right before each edit.
- Never pipe vitest into `head`/`tail` (SIGPIPE leaks PGlite temp dirs); redirect to `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/pl4-w2-*.log` and read it.
- An int test that opens a DB inside an `it` needs a 60 s timeout under load (follow the file's pattern).
- Never `kill -9` anything.

Verbatim:
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo.

## Stop and ask (in your report, don't decide) when
A new name/setting/migration seems needed; a fix needs a file outside "Files owned"; a test outside these behaviours breaks and the cause isn't obvious.

## Done means
`npx vitest run src/lib/server/lorebooks/cloneWithChanges.int.test.ts src/lib/server/lorebooks/ownBook.int.test.ts src/lib/server/lorebooks/imprints.int.test.ts src/lib/server/lorebooks/castOwnNames.int.test.ts src/lib/server/plugins/providedBooks.int.test.ts src/lib/server/sockets/lorebooks.providedCast.int.test.ts src/lib/server/state/worldScope.int.test.ts src/lib/server/sessions/rewind.int.test.ts` all green (report counts per file), plus any `*.int.test.ts` that greps for `duplicateLorebookRows` or `copyLorebookTables` or `applyOverlayItems`; `npx tsc --noEmit -p .` shows no errors in your files. Report: diff summary per item, test counts, any `/tmp/serene-pub-vitest-*` dirs your runs left (by name), Noticed-not-done.
