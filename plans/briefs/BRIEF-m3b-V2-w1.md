# BRIEF m3b-V2-w1 — server code: world-scope values land in the session's own notes when the session can't write its book; writer checked first; own notes exempt from the write mode

You are a `lane-worker` (Sonnet) for lane **m3b-V2**. Supervisor: the m3b-V2 lane-supervisor. Work from `/home/jody/github/serene-pub`. Write your report to `plans/briefs/REPORT-m3b-V2-w1.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: no SDK edit in this lane.)

## Goal — the owner's rulings (2026-11-05), quoted

- **★M3b-W-1 → yes, with the landing condition:** attribute values land in the session's own notes **only when the session can't write its book** — the attached book is not the session owner's (a member's session on a pub-wide/provided or shared book), or there is no attached book. On the owner's own book, values land on the book as today, under its Full/Review/Off mode, and world-scope values keep being shared between the owner's sessions. Reads: where the notes hold a value for that owner/slot it wins; else the book's.
- **★M3b-W-2 → check the writer first, then create** the own-book row (no empty cast rows from refused writes).
- **★M3b-W-3 → the session's own notes are exempt from the write mode** (as lore writes already are via `loreWriteRoute`).
- The provided book still gains **no** binding or value row for anyone (§23).

"Own book" (code) = "Session notes" (screen) = the `lorebooks` row with `session_id` set (`src/lib/server/lorebooks/ownBook.ts`). Read that file's header (lines 1–60) and `loreWriteRoute` (~342–353) first.

## Files owned (edit ONLY these, and only the hunks named)

1. `src/lib/server/lorebooks/ownBook.ts` — **additive**: one new exported function after `loreWriteBookIdOf` (~423–447).
2. `src/lib/server/state/worldScope.ts` — rewrite of `worldOwnerOf` + its header (this lane's file).
3. `src/lib/server/state/write.ts` — **three tight hunks + one private helper** (lane `ed` edits this file after you: touch nothing else, never reformat, list your hunks with line numbers in the report).
4. `src/lib/server/state/resolve.ts` — `SessionLinks` (one optional field), `CastMemberLink.ownBookMemberId` doc comment, `sessionLinks` (~644–656 + the return object), `chainFor` (~957–963).
5. `src/lib/server/state/owners.ts` — `resolutionChain` (~77–110).
6. `src/lib/server/state/owners.test.ts` — add unit cases.
7. `src/lib/server/sockets/state.ts` — **only** the `worldOwnerOf` call (~1423). Lane `ed` follows you in this file.
8. `src/lib/server/pipelines/runtime/bindings.state.ts` — **only** the `worldOwnerOf` call (~641–643).

**Re-read each file's region immediately before every edit** (other lanes edit this tree: s22-L in `sockets/sessions.ts`/`summarize.ts`/sessionForms, pb in `plugins/providedBooks.ts`). Additive hunks; never reformat a file (several are dirty at HEAD; `prettier --check` already fails on `worldScope.ts`; do not run prettier `--write` on any file).

## Files readable
Anything. Especially `state/write.ts` `assertSessionOwner` (~1404–1470), `writerOf`/`assertBookWriter` (~1617–1645), `assertBookWritesOn` (~424–432), `applyAutomatic` (~2198–2211); `lorebooks/ownBook.ts` `ownBookOf`, `ownBookFor`, `attachedOrOwnBookOf`, `lorebooksReadBy` (its `ownBookId`), `loreWriteRoute`, `loreWriteTargetFor`; `utils/characterBindingSync.ts` `resolveOrCreateBindingRow`; `plans/REPORT-m3b-W-2026-11-05.md` (what last night built).

## The build, item by item

### A. `ownBook.ts` — the landing condition (one new export, additive)
```ts
/**
 * 🚧 (m3b-V2, ★M3b-W-1, owner 2026-11-05) Whether a session keeps its
 * world-scope attribute values in its own notes: it reads no book, or a book
 * its owner does not own (a member's session on a pub-wide/provided or shared
 * book). `loreWriteRoute`'s ownership rule with the write mode set aside — the
 * mode never moves values (the owner's own book keeps them under its mode).
 */
export async function keepsValuesInOwnBook(db: Db, sessionId: number): Promise<boolean>
```
Read the session (`userId`, `lorebookId`) and the attached book's `userId` exactly as `loreWriteBookIdOf` does, and return `loreWriteRoute({ attachedId, bookOwnerId, sessionOwnerId, mode: "full" }) === "own-book"`. A missing session → `false`. Do NOT import `utils/ownedBook` (it statically imports `$lib/server/db`, which binds the real db before tests' `vi.mock`). Do not change `loreWriteRoute` or any other function in the file.

### B. `worldScope.ts` — `worldOwnerOf(db, sessionId, owner, userId: number | null)`
New 4th parameter **required**: `userId: number | null` — the person writing; `null` for a run (the writer then falls back to the session's owner, as `write.ts writerOf` does).
1. `player_seat` → the persona (`session_cast`), unchanged (card-less seat keeps its refusal word for word).
2. **If `keepsValuesInOwnBook(db, sessionId)`** (the landing rule):
   - `owner.kind === "session"` → `{ kind: "lorebook", id: (await ownBookFor(db, sessionId)).id }` — the own book's `lorebook` row.
   - `owner.kind === "session_cast"` → that character's member row in the own book via the shared helper below (whether or not the attached book holds them — "one of the book's own people" lands in the notes too).
   - every other kind → returned unchanged (a `session_location` keeps today's mapping: return what the existing code would; simplest is to fall through to the existing path for kinds other than `session`/`session_cast`).
3. **Else** (the owner's own book): today's logic unchanged, except the "character the book does not hold" branch uses the same shared helper (so the writer is checked there too).
4. Shared helper (module-private), in this order — **★M3b-W-2, the writer first, then create:**
   ```ts
   async function ownBookMemberOf(db, sessionId, owner /* session_cast */, userId): Promise<StateOwner> {
     await assertSessionOwner(db, sessionId, owner)            // seated, else "that character is not in this session's cast." — nothing made
     const own = await ownBookFor(db, sessionId)
     await assertSessionOwner(db, sessionId, { kind: "lorebook", id: own.id }, userId)  // the writer may write the notes (assertBookWriter inside); a refusal makes nothing
     const row = await resolveOrCreateBindingRow({ lorebookId: own.id, characterId: owner.id }, db)
     if (!row) throw new StateRefusal(NO_CAST_SENTENCE)
     return { kind: "cast_member", id: row.id }
   }
   ```
   (The second `assertSessionOwner` call works only after hunk C3 below admits the own book's `lorebook` row.)
5. Update the file header to say the landing rule in two or three sentences (the notes keep the values when the session can't write its book; the owner's own book keeps them on the book under its mode; the writer is checked before any row is made). Keep 🚧.

### C. `write.ts` — three hunks + one private helper (nothing else)
- **C0 helper** (private, place it just above `assertBookWritesOn`):
  ```ts
  /**
   * 🚧 (m3b-V2, ★M3b-W-3, owner 2026-11-05) Whether a book-layer owner is a row
   * of the session's own notes — its `lorebook` row, a member of it, or a place
   * in it. The notes are exempt from the lore write mode, as lore written there
   * is (`loreWriteRoute`): they are the session's own, never the book's.
   */
  async function isOwnBookOwner(db: Db, sessionId: number, owner: StateOwner): Promise<boolean>
  ```
  Use `(await lorebooksReadBy(db, sessionId)).ownBookId` (already imported; no new import line). `lorebook` → `owner.id === own`; `cast_member` → `lorebook_bindings.lorebookId === own` for `owner.id`; `location` → `lorebook_entries.lorebookId === own` for `owner.id`; else false.
- **C1 `assertBookWritesOn`**: when the mode is `off`, refuse only if `!(await isOwnBookOwner(db, sessionId, owner))` (ask the mode first, so the extra read happens only under Off).
- **C2 `applyAutomatic`**: the `isValueChange(change) && isBookLayer(change.owner.kind)` gate also requires `!(await isOwnBookOwner(db, ctx.sessionId, change.owner))` — an own-book value applies directly under Review and Off; the attached book keeps the mode.
- **C3 `assertSessionOwner`'s `lorebook` branch** (~1413–1418): admit the own book's `lorebook` row as well as the attached book — use `(await lorebooksReadBy(db, sessionId)).ids` instead of `sessionLorebookIds(db, sessionId)` (exactly as the `cast_member` branch below it already does). `assertBookWriter` stays. Leave the `sessionLorebookIds` import alone (other code uses it — check with grep; if it becomes unused in write.ts, leave the import anyway and say so; do not reorder imports).

### D. Reads — `owners.ts` `resolutionChain`
Extend the `links` parameter with two optional keys whose meanings match their names elsewhere (R1): `ownBookMemberId?: number | null` (the character's member in the session's own book) and `ownBookId?: number | null` (the session's own book). When given, each is read **before** its attached-book twin:
- `session_cast`: `[owner, cast_member(ownBookMemberId)?, cast_member(castMemberId)?, card(owner.id)]` (skip a falsy one; never the same id twice);
- `session`: `[owner, lorebook(ownBookId)?, lorebook(lorebookId)?]` (never the same id twice).
Everything else unchanged. Update the doc comment (one sentence: the caller passes the own book's links only where the session keeps its values in its notes, `chainFor`).

### E. Reads — `resolve.ts`
- `SessionLinks`: one new optional field
  ```ts
  /**
   * 🚧 (m3b-V2, ★M3b-W-1) The session's own book, when the session keeps its
   * world-scope values there (`keepsValuesInOwnBook`: it reads no book, or one
   * its owner does not own) — read before the attached book. Absent otherwise.
   */
  valuesOwnBookId?: number | null
  ```
- `sessionLinks`: compute `keeps = await keepsValuesInOwnBook(db, sessionId)` (import from `$lib/server/lorebooks/ownBook`, add it to the existing `ownBookOf` import line). **Always** fill `ownBookMemberId` for every cast member the own book has a member for (not only those with `castMemberId == null`) when an own book exists and differs from `lorebookId`; return `valuesOwnBookId: keeps ? ownBook.id : null` (null when no own book). Avoid a second `ownBookOf` read: the function already reads it once in the block and once for `readBookId` — reuse one read.
- `CastMemberLink.ownBookMemberId` doc comment: "🚧 This character's cast member in the session's own book, when it has one — where a world-scope value of theirs is kept when the session can't write its book, or the attached book holds no member for them (`worldOwnerOf`). ⚠ Not `castMemberId` (the attached book's)."
- `chainFor`: when `links?.valuesOwnBookId != null` pass `castMemberId: member?.castMemberId ?? null`, `ownBookMemberId: member?.ownBookMemberId ?? null`, `ownBookId: links.valuesOwnBookId`; otherwise exactly today's `castMemberId: member?.castMemberId ?? member?.ownBookMemberId ?? null` and no own-book keys (an owner's own-book session reads as today).
- Do not touch `worldAttributesFor`, `sockets/state.ts`'s `chainOf`, or any other reader; list them in the report if you think they need it.

### F. Callers
- `sockets/state.ts` ~1423: `worldOwnerOf(db, sessionId, target, socket.user!.id)`.
- `pipelines/runtime/bindings.state.ts` ~643: `worldOwnerOf(db, sessionId, owner, null)`.
- Existing test calls with three arguments (`state/worldScope.int.test.ts`) are worker w2's file — do not edit it; w2 adds the 4th argument.

### G. Unit tests — `owners.test.ts`
Add: a `session_cast` with both `ownBookMemberId` and `castMemberId` → own member, attached member, card; `session` with `ownBookId` and `lorebookId` → session, own, attached; without the own-book keys → today's chains.

## Rules (quoted from CLAUDE.md / NOMENCLATURE — your work depends on them)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."
- "Say each assumption when you make it."
- NOMENCLATURE R1 "One word, one meaning" — `castMemberId` keeps meaning the attached book's member; `ownBookMemberId` the own book's. R3 qualify, never the bare noun. R6 mark provisional names 🚧. §23: never reintroduce a retired word (notably **phantom** for the own book — say "own book" in code, "Session notes" on screen; **chat** for a session).
- The only new names you may introduce are exactly: `keepsValuesInOwnBook`, `isOwnBookOwner`, `ownBookMemberOf` (private), `valuesOwnBookId`, and the `resolutionChain` link keys `ownBookMemberId`/`ownBookId`. Any other new name, setting, event, column or migration: stop and put it in your report as a question.
- No SDK edit, no migration, no new socket event, no copy shown to a person (refusal sentences stay word for word).
- "Never pipe vitest into `head`" (SIGPIPE leaks PGlite temp dirs). Int tests need 60 s timeouts.

## Done means
- `npx tsc --noEmit -p .` shows no error in the 8 files above (other lanes' errors may exist; list them, don't fix them). Filter like `npx tsc --noEmit -p . 2>&1 | grep -E "state/(worldScope|write|resolve|owners)|lorebooks/ownBook|sockets/state|bindings.state"`.
- `npx vitest run src/lib/server/state/owners.test.ts` green.
- `npx vitest run src/lib/server/state/write.int.test.ts src/lib/server/state/resolve.int.test.ts src/lib/server/state/durable.int.test.ts` green (run in one invocation; do not pipe into head; capture to a file under `/tmp/claude-1000/` named `m3b-V2-w1-*.log` if you want to grep).
- Do NOT run `worldScope.int.test.ts` until worker w2 says it is updated — it will fail on the 3-argument calls; w2 owns it.

## Stop and ask when
CLAUDE.md §Decisions applies, a name beyond the list above is needed, a behaviour seems to need changing outside these hunks, or a migration seems needed. Put the question in the report and finish everything else.

## Report (`plans/briefs/REPORT-m3b-V2-w1.md`)
Changed files with the exact hunks in `write.ts` and `sockets/state.ts` (function name + line range after your edit), assumptions, tests run with pass/fail counts, Noticed-not-done.
