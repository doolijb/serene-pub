# BRIEF — `ap-1-w1` (server): one write predicate; Apply and Take back require the session's owner AND it

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `ap-1`. SDK untouched.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: do not run one.)

Also: run no git command that changes the index or the working tree (the lead staged the repo). Never `prettier --write`. No migration. Inside `db.transaction(async (tx) => …)` use only `tx`. Comments state the rule, never the history.

## Goal

Owner ruling A1 (2026-11-17): "Can't apply to a lorebook owned by someone else. … Sharing is for viewing only, not editing. We can add more granular permissions later to allow co-editing/playing, but not in this sprint, just don't block the future permission structure from being able to be implemented in core."

1. **The predicate.** In `src/lib/server/utils/ownedBook.ts` (header: "One lorebook ownership check"; line ~82 "Every WRITE keeps `assertOwnedBook`") add, near `findOwnedBook`, a pure exported function:
   ```ts
   export function canWriteLorebook(userId: number | null | undefined, book: { userId: number }): boolean
   ```
   true iff `userId != null && book.userId === userId`. TSDoc (rule, not history): whether this person may WRITE this lorebook row; today its owner only; the one place a later co-editing permission widens; not read access (`lorebookAccessFor`: a share, the administrator exception and a live provided book read, never write); a session's notes are answered by `ownBookAccessFor` first. No permission table, option or hook.
   Make `findOwnedBook` use it with **identical behaviour**: select the row by id only (drop the `or(userId = …, sessionId is not null)` SQL filter), keep the notes branch (`sessionId != null` → `ownBookAccessFor`) exactly, and otherwise return undefined when `!canWriteLorebook(userId, book)`. Every other caller of `findOwnedBook`/`assertOwnedBook` must behave exactly as before.
2. **The four Apply sites in `src/lib/server/lorebooks/ownBook.ts`** call it (import from `$lib/server/utils/ownedBook`; check for an import cycle — `ownedBook.ts` imports `ownBook` dynamically, so a static import the other way is fine, but verify):
   - `applyOverlayItems` (~2080): `if (!book || !canWriteLorebook(input.userId, book)) throw notOwner` (unchanged sentence), **then** the session's-owner check: add `userId` to the session select (~2063) and `if (session.userId !== input.userId) throw new OwnBookRefusal(APPLY_OVERLAY_REFUSALS.notSessionOwner)`. Order matters: the predicate first, so every refusal existing tests pin keeps its sentence.
   - `takeBackApply` (~2709): the same predicate line, then load the session named by the batch's records (`records[0].sessionId`) and refuse with `notSessionOwner` unless its `userId === input.userId` (a null/missing session refuses too). Both before any write (the function already writes nothing until every check passed; keep that).
   - `applyHeldAutomatically` (~3120): `if (!book || !canWriteLorebook(session.userId, book)) return null`.
   - `overlayAccessOf` (~3340): `mayApply: session.userId === userId && canWriteLorebook(userId, book)`, `appliesItself: canWriteLorebook(session.userId, book) && <write mode full, as today>`. Update its TSDoc: `mayApply` — the reader is the session's owner and may write its lorebook (Apply and Take back are theirs).
   - Add to `APPLY_OVERLAY_REFUSALS` (~1320) one key, provisional (🚧 comment, wording ★ for the owner): `notSessionOwner: "Only the session's owner can apply its changes or take them back."`
   - Update the TSDoc lines on `applyOverlayItems` ("The attached book's owner only") and `takeBackApply` ("The attached lorebook's owner only") to: the session's owner, when `canWriteLorebook` lets them write the attached lorebook.
   Touch nothing else in `ownBook.ts`.
3. **`src/lib/server/sockets/sessions.overlay.ts`:** comments only — the four TSDoc blocks that say "only the lorebook's owner may apply/take back" now say: the session's owner, when they may write the lorebook (`canWriteLorebook`); the check lives in `applyOverlayItems`/`takeBackApply`. No behaviour change in this file (the read handlers already answer the empty shape to anyone but the session's owner, owner ruling G2 2026-11-16 "a guest neither opens nor edits the notes").

## Tests (new file `src/lib/server/lorebooks/applyWritePredicate.int.test.ts`; copy the harness from `src/lib/server/sockets/sessions.applyLists.int.test.ts` lines 1–200 — mocked `$lib/server/db` with `createTestDb`, its own `mkdtemp` dir `serene-pub-vitest-ap1-…` removed in `afterAll`, `socketOf`, `fakeIo`, `world()`; and the provided-book fixture from `src/lib/server/plugins/providedBooksPubWide.int.test.ts` 98–154: a `plugins` row enabled + a lorebook owned by the first admin with `extraJson.provided` mark, `disabled: true` for the disabled case). `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`.

1. `canWriteLorebook` table: owner → true; a user the book is shared with (`lorebook_shares` row; see `utils/shares`) → false; a member on a live provided book (owned by the admin) → false; an administrator who is not the owner → false; a guest of a session on the book → false; `null`/`undefined` user → false.
2. **Live provided lorebook**, session owned by a member M (with notes overlaying it and ≥1 held entry, as `world()` makes): `sessionsOverlayItems` to M → items listed, `mayApply: false`, `appliesItself: false`; M's `sessionsApplyOverlayHandler` is refused with `APPLY_OVERLAY_REFUSALS.notOwner` and the provided book's entries are unchanged (row count and content); `applyHeldAutomatically` returns null; M's `foldInParent(db, { sessionId, userId: M })` (`lorebooks/foldInParent.ts`) succeeds and the provided book's rows are unchanged after it.
3. **Provided lorebook disabled after the session started** (create session on the live book, then set the mark's `disabled: true`): same Apply refusal and payload as 2; `foldInParent` for M rejects with `"Lorebook not found."` (`LOREBOOK_NOT_FOUND`). Name the test so it reads as the observation it is (read access is not changed by this lane).
4. **The lorebook's owner who is not the session's owner** (book owned by O, session owned by M; get one applied batch first by applying while O owns the session, then `update sessions set userId = M`): O as a **guest** (sessionGuests row) and O as a **non-member** each call Apply (handler) → refused with `notSessionOwner`, and Take back (handler) → `refused: notSessionOwner`; the book's entries, the notes' entries and `lore_imprints` for the batch are unchanged.
5. **Pin AP1 (do not change behaviour):** the enabling administrator's own session on their provided lorebook: Apply moves the held entry **into the provided book** (today's behaviour). Name it exactly `"AP1 (open): the enabling administrator's own session applies into the provided lorebook — flips if AP1 rules plugin books never take Apply"`.
6. Apply on an owned lorebook unchanged: covered by the existing files below, which must stay green **untouched**.

Run, one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, always with paths:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ap-1-w1-<n>.log 2>&1"`
- run 1: the new file.
- run 2: `src/lib/server/sockets/sessions.applyLists.int.test.ts src/lib/server/sockets/sessions.applyOverlayLinks.int.test.ts src/lib/server/lorebooks/applyTakeBack.int.test.ts src/lib/server/lorebooks/applyTakeBack.otherSessionLink.int.test.ts src/lib/server/lorebooks/heldApply.int.test.ts src/lib/server/lorebooks/autoApply.int.test.ts src/lib/server/lorebooks/autoApply.settle.int.test.ts src/lib/server/lorebooks/applyKnowledgeTies.int.test.ts src/lib/server/lorebooks/applyOwnBookLinksDays.int.test.ts`
- run 3: `src/lib/server/lorebooks/applyForksLine.int.test.ts src/lib/server/lorebooks/heldApply.versionChecks.int.test.ts src/lib/server/lorebooks/redlines.apply.int.test.ts src/lib/server/lorebooks/ownBook.int.test.ts src/lib/server/scenes/liveScenes.autoApply.int.test.ts src/lib/server/sessions/branch.heldAmendments.int.test.ts src/lib/server/sockets/ownBooks.fold.int.test.ts` plus every `*.test.ts` that imports `utils/ownedBook` (find them with grep; cap at ~12 files per run, more runs if needed).
Never pipe vitest into `head`. If an existing test fails, **stop and report it** (file, test, expected vs got) — do not edit an existing test. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` must be 0 (report any error outside your files without fixing). `npx prettier --check` your files.

## Files owned
`src/lib/server/utils/ownedBook.ts`; in `src/lib/server/lorebooks/ownBook.ts` only `APPLY_OVERLAY_REFUSALS`, `applyOverlayItems`'s session select + checks + TSDoc, `takeBackApply`'s checks + TSDoc, `applyHeldAutomatically`'s book check, `overlayAccessOf`, and the import; `src/lib/server/sockets/sessions.overlay.ts` (comments); the new test file.

## Files readable
Anything. Not yours, never edit: `sockets/sessions.update.ts`, `sockets/sessions.participants.ts`, `sessions/seats.ts`, `sessions/guestSeats.ts`, `shared/sockets/types.ts`, every client file, docs, NOMENCLATURE.

## Out of scope
Any copy/clone verb, re-pointing a session's lorebook, id mapping, read-access changes (`providedBooksReadableBy`, `lorebookAccessFor`), a permission table/option/hook, the client.

## Stop and ask when
An existing test fails; the change would alter Apply on a lorebook the session's owner owns; a name beyond `canWriteLorebook` / `notSessionOwner` seems needed; a migration seems needed.

## Report
Final message: changed files with line ranges, the predicate's final text, each site's before → after (one line each), tests run with pass counts and log paths, tsc result, anything noticed but not done.
