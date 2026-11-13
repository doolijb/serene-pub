# BRIEF pl-w1 — the own book's writer is checked before anything makes or touches it; the own book's `lorebook` row is admitted only where the session keeps its values there

Supervisor: lane **pl** (`plans/briefs/BRIEF-pl.md`). You are a `lane-worker`. Work from `/home/jody/github/serene-pub`, absolute paths only.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` in this task. Lane sl may rebuild the SDK dist meanwhile: if a test fails on an `@serene-pub/sdk` dist import, wait a minute and re-run.)

## Goal

Two accepted scope findings from the m3b-V2 review (`plans/REPORT-m3b-V2-2026-11-05.md`).

**A. Writer first (finding 1).** In `src/lib/server/state/worldScope.ts`, `worldOwnerOf` calls `ownBookFor` (which **creates** the own book via `insertOwnBook`, or **updates** its `overlay_of`/ruleset) before the writer is checked:
- line ~58–59, the `session` branch inside `if (await keepsValuesInOwnBook(...))`: `return { kind: "lorebook", id: (await ownBookFor(db, sessionId)).id }` — no writer check at all here (setValue refuses later, after the own book was made/updated);
- `ownBookMemberOf` (~85–99): `ownBookFor` at ~93 runs before the writer check at ~95.

Fix: the writer is checked **before** any `ownBookFor`, reading only. If the own book exists, the writer must be its writer (`assertBookWriter` semantics: the book's owner; a run — `userId` null — is the session's owner, `writerOf`). If it doesn't exist yet, only the session's owner (or a run) may cause it to be made.

Implementation (decided by the supervisor): add to `src/lib/server/state/write.ts`, beside `assertBookWriter` (~1669), one exported helper:

```ts
/**
 * The session's own book's writer (m3b-V2 scope finding 1, ★M3b-W-2), checked
 * before anything makes or touches the own book — read only. The own book is
 * the session owner's: when it exists, its writer (`assertBookWriter`); when it
 * does not yet, only the session's owner, or a run, may cause it to be made.
 */
export async function assertOwnBookWriter(db: Db, sessionId: number, userId: number | null | undefined): Promise<void>
```
— `ownBookOf(db, sessionId)` (read-only, `lorebooks/ownBook.ts`); exists → `await assertBookWriter(db, sessionId, own.id, userId)`; else `writerOf(db, sessionId, userId)` must equal the session's `userId` (`writerOf(db, sessionId, null)`), else `throw new StateRefusal(\`${NOT_YOUR_BOOK}; change this session's instead.\`)` (the same sentence `assertBookWriter` gives, so the existing "not your lorebook" assertions hold). Add `ownBookOf` to the existing static import at write.ts line 170 (`import { lorebooksReadBy } from "$lib/server/lorebooks/ownBook"`).

Then in `worldScope.ts`:
- `session` branch: `await assertOwnBookWriter(db, sessionId, userId)` then `ownBookFor`.
- `ownBookMemberOf`: keep `await assertSessionOwner(db, sessionId, owner)` (the seated check, read-only) first; then `await assertOwnBookWriter(db, sessionId, userId)`; then `ownBookFor`; then `resolveOrCreateBindingRow`. **Remove** the post-`ownBookFor` `assertSessionOwner(db, sessionId, { kind: "lorebook", id: own.id }, userId)` call — it is replaced by the helper, and after change B it would wrongly refuse the m3b-W path at line ~74 (an owner's own-book session where the attached book doesn't hold the character).
- Update the header/comments only where they now say something false (one or two lines; e.g. the `ownBookMemberOf` doc). No other edits.

**B. The `lorebook` branch narrowed (finding 3).** `assertSessionOwner` in `write.ts` (~1446): the `lorebook` branch admits `(await lorebooksReadBy(db, sessionId)).ids` — the attached book **and** the own book — in every session. Admit the own book's row only when `keepsValuesInOwnBook(db, sessionId)` is true (a session that reads no book, or a book its owner does not own); the attached book's row as before. Read `keepsValuesInOwnBook` only when `owner.id` is the own book's id (no extra read for the common case). Same refusal sentence: `"that lorebook is not this session's lorebook."`. Add `keepsValuesInOwnBook` to the same line-170 import. Leave the `cast_member` branch and everything else unchanged.

## Tests — extend `src/lib/server/state/worldScope.int.test.ts` (append a new `describe` at the end; reuse the file's helpers: `world`, `memberOnProvidedBook`, `seatPersona`, `card`, `worldOwner`, `applyOne`, `ownBookIdOf`, `bindingsOf`, `valuesOf`, `socketOf`, `read`)

Read the helpers first (lines ~158–383 and ~400–440). Test sessions are inserted directly, so the own book may not exist until something calls `ownBookFor`; when a test needs "no own book", delete the row: `testDb.delete(schema.lorebooks).where(eq(schema.lorebooks.sessionId, sessionId))` and assert `ownBookIdOf` is undefined/null first.

1. **A guest's refused world write leaves no own book.** A member's session on a provided book with no own book (deleted as above); a guest of that session (see the existing "a guest's refused write creates nothing" test for how a guest and their persona seat are made). `worldOwner(session, { kind: "session", id }, guest.id)` rejects `"not your lorebook"` and afterwards there is **no** own book row. Same for `{ kind: "session_cast", id: guestPersona.id }` and for the socket `stateSet.handler(socketOf(guest.id), …)` with a world slot (`SHOP_SHUT` on `session`, `AGE` on the persona). Then a run (`userId` null) on the same session does make the own book (and files the value there) — the session's owner/run may cause it.
2. **A refused write leaves an existing own book untouched.** A member's session whose own book exists (call `ownBookFor` once), then set its `overlay_of` to something stale (e.g. `null` while the session is attached) directly in the DB; a guest's refused write (`session` and `session_cast`) — `overlay_of` is still the stale value afterwards (proves `ownBookFor` never ran).
3. **The owner's own book: the own book's `lorebook` row is refused.** `world()` (the owner's own book at Full); make the own book (`ownBookFor`); `stateSet.handler(socketOf(w.user.id), { sessionId, owner: { kind: "lorebook", id: ownId }, slotId: SHOP_SHUT, value: true })` rejects `"not this session's lorebook"`, and `assertSessionOwner(db, sessionId, { kind: "lorebook", id: ownId }, w.user.id)` rejects the same; no value row on the own book. The attached book's row still passes `assertSessionOwner`. In a member's session on a provided book (`memberOnProvidedBook`) the own book's row passes `assertSessionOwner` for the session's owner.
4. Keep every existing test in the file green (the m3b-V2 and m3b-W ones especially: the owner's own-book session under Review where a seated character the book doesn't hold lands on the own book's row must still pass — that is the path B would have broken without removing the post-`ownBookFor` check).

## Files owned
`src/lib/server/state/worldScope.ts`, `src/lib/server/state/write.ts` (only the hunks named above: the line-170 import, the new helper beside `assertBookWriter`, the `lorebook` branch of `assertSessionOwner`), `src/lib/server/state/worldScope.int.test.ts` (append).

## Files readable
Anything. Key: `src/lib/server/lorebooks/ownBook.ts` (`ownBookOf`, `ownBookFor`, `keepsValuesInOwnBook`, `lorebooksReadBy`), `src/lib/server/sockets/state.ts` (~1423, the `state:set` call into `worldOwnerOf`), `src/lib/server/pipelines/runtime/bindings.state.ts` (~641).

## Out of scope
Places (`session_location` / `location` landing) — not this brief. No SDK edit, no migration, no docs, no NOMENCLATURE. Don't touch `sockets/state.ts`, `ownBook.ts` or any other file. Don't reformat: these files are dirty at HEAD and hand-formatted; never run prettier `--write` on them; additive hunks only. Re-read a file right before each edit (lane ed and others work in this tree).

## Rules (from CLAUDE.md, quoted)
- "Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report." "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "Propose and wait … on anything a user sees or that outlives the change: behaviour, layout, copy, a new name / setting / flag / abstraction / event / table / migration" — the one new helper `assertOwnBookWriter` is decided by the supervisor; add no other export, name or sentence. No new user-facing words: reuse the existing refusal sentences.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`."
- NOMENCLATURE R1 one word, one meaning; it is a **session**, never a *chat*.
- Tests: "An int test that opens a DB inside an `it` needs a 60 s timeout under load" (the file sets `vi.setConfig({ testTimeout: 60_000 })` already). "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs." Run only targeted files.

## Done means
Run, from `/home/jody/github/serene-pub` (one at a time, output to a file under the scratchpad or `> /tmp/pl-w1-<name>.log 2>&1`, then read the tail with `tail -n 60`):
- `npx vitest run src/lib/server/state/worldScope.int.test.ts`
- `npx vitest run src/lib/server/state/write.int.test.ts src/lib/server/state/sessionLoreWrites.int.test.ts src/lib/server/sockets/state.ownerScope.int.test.ts src/lib/server/state/declarations.int.test.ts src/lib/server/state/resolve.int.test.ts`
- `npx vitest run src/lib/server/plugins/providedBooksPubWide.int.test.ts src/lib/server/sockets/sessions.ownBookCreate.int.test.ts src/lib/server/state/owners.test.ts`
- `npx tsc --noEmit -p . 2>&1 | grep -E "state/(worldScope|write)" ` → nothing.
Report a failure you believe pre-existing with evidence (does it fail the same way without your hunks? — reason from the code; never stash or checkout to check).

## Report
In your final message (not a file): changed files with the hunks (line ranges), tests run with pass/fail counts per file, anything decided, Noticed-not-done.
