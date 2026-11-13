# BRIEF m3-core-w1 — a provided book is readable pub-wide (server)

Worker brief from lane supervisor **m3-core**. Work from `/home/jody/github/serene-pub`. Report path:
`plans/briefs/REPORT-m3-core-w1.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Goal (owner ruling ★M3-1, 2026-11-05: "Pub wide")
A lorebook carrying a **live provided mark** — its OWN genuine mark (`markedBook(extraJson, uuid)` non-null), the mark's owner
present (`providedOwnerPresent` / `providedOwnersPresent`: `core` always, a plugin while its `plugins` row exists), NOT disabled
(`isDisabledProvidedBook`), and not a session's own notes (`sessionId IS NULL`) — is, for every signed-in person, readable exactly
as a book **shared** with them is (read and copy, never write). That covers a plugin's provided book AND a primer row (kind
`starter_kit`, `plugin: "core"`). A disabled or ownerless provided book stays invisible to non-owners.

## What to build (decided by the supervisor — build exactly this)
1. **The one decider**, in `src/lib/server/plugins/providedMarks.ts`, placed right after `isNewAttachOfDisabledBook`:
   ```ts
   export async function providedBooksReadableBy(
   	db: Db,
   	userId: number | null | undefined,
   	lorebookIds?: readonly number[]
   ): Promise<ReadonlySet<number>>
   ```
   Doc comment, 🚧 (m3-core, ★M3-1 "Pub wide", owner 2026-11-05): the ids, among `lorebookIds` (every lorebook when absent),
   of the provided books every signed-in person may READ though they are not theirs — own genuine mark, owner present, not
   disabled, never a session's own notes; `userId == null` → empty; an empty `lorebookIds` → empty without a query. Not a
   write permission: every write keeps `assertOwnedBook`; not `isDisabledProvidedBook` / `shownLorebook` (which only hide).
   Takes the `db` (or `tx`) it is handed. One `select({ id, uuid, extraJson })` from `lorebooks` where `sessionId IS NULL`,
   `extra_json->'provided' IS NOT NULL` (sql), `shownLorebook()`, and `inArray(id, lorebookIds)` when given; then filter in JS
   with `markedBook` + `providedOwnersPresent(db, rows)` + `!isDisabledProvidedBook`. No static import of `$lib/server/db`.
2. **Read access** — `src/lib/server/utils/ownedBook.ts` `lorebookAccessFor`: keep the order owner (incl. own-notes) → shared →
   admin; then, only when none applied, `if ((await providedBooksReadableBy(db, userId, [id])).has(id)) return "shared"`, else
   null. (Restructure the last line `return isAdmin ? "admin" : null` minimally.) Static import from `providedMarks` is fine
   (it imports no db). Add one line to the `LorebookAccess` doc: `shared` also = a live provided book (★M3-1). This alone makes
   `lorebooks:get`, every `assertReadableBook` / `canViewLorebook` read (entries:list/types/counts, scenes, graph, story time,
   covers) and `personMay(…, "read", lorebook)` (the applet's `attach-lorebook` in `library/writes.ts`) admit it. Writes keep
   `findOwnedBook` / `assertOwnedBook` — do NOT change `findOwnedBook`.
3. **`lorebooks:list`** — `src/lib/server/sockets/lorebooks.ts` `buildLorebooksList`, `"books"` only: compute
   `providedIds = which === "books" ? [...(await providedBooksReadableBy(db as unknown as Db, userId))] : []` beside `sharedIds`
   and add `inArray(l.id, providedIds)` as a third arm of the `or(…)` (any kind: primer rows are `starter_kit`). The existing
   projection then gives a non-owner the share row (`isSharedWithMe`, `ownerName`, `bookAccess: "shared"`) plus `provided` and,
   for a primer row, `readOnly` — reuse it, invent no second projection. Update the "no one else's kit" comment in one line.
4. **The applet door `library-lorebooks`** — `src/lib/server/sockets/appletLibrary.ts` `runLibraryLorebooks`: the same third arm
   (`providedBooksReadableBy`); `personMay` read/write per row stays (a member's row reads `canEdit: false`).
5. **Attach** — `src/lib/server/sockets/sessions.ts` (SHARED file: additive hunk only, re-read immediately before the edit, never
   reformat) `checkLorebookOwnership` (~230): the first line becomes "not owned AND not a live provided book → false", via
   `providedBooksReadableBy(db as unknown as Db, userId, [lorebookId])`. Everything after stays (`isNewAttachOfDisabledBook`, the
   own-notes and `kind === "book"` checks: a primer row is still started from, never read — PLAN-lorebook-kinds §B; do NOT
   change that). This serves `sessions:create` and `sessions:update`.
6. **`entries:sessionEntries`** — `src/lib/server/sockets/entries.ts` (~1237): the `ownerOnly` answer is for a guest of someone
   else's book; add `&& !(await providedBooksReadableBy(db as unknown as Db, userId, [sessionBookId])).has(sessionBookId)` so a
   member whose session reads a provided book sees its entries.

Nothing else: no client file, no change to `findOwnedBook`, `starterKits.ts`, `jump.ts`, `summarize.ts`, the write mode, the
schema. If you think another door needs it, list it under Noticed.

## Files owned
`src/lib/server/plugins/providedMarks.ts`, `src/lib/server/utils/ownedBook.ts`, `src/lib/server/sockets/lorebooks.ts`,
`src/lib/server/sockets/appletLibrary.ts`, `src/lib/server/sockets/entries.ts`, `src/lib/server/sockets/sessions.ts`
(ONLY the `checkLorebookOwnership` hunk + its import — another worker edits the `sessions:view` hunk at the same time; re-read
right before your edit), new test file `src/lib/server/plugins/providedBooksPubWide.int.test.ts`; existing test files of the
Done list only if an assertion encodes the OLD rule (a non-owner cannot see/read a live provided book or primer row) — change it
to the ruled behaviour and list each old→new in your report. Other programmes edit this tree: re-read every file immediately
before each edit; additive hunks; never reformat (no `prettier --write`).

## Files readable
Everything. Models: `src/lib/server/sockets/lorebooks.readerAccess.int.test.ts` (share reader access over the handlers),
`src/lib/server/plugins/providedBooks.int.test.ts` (seeding a plugin's provided book: `seedPlugin`, `grant`, the sync),
`src/lib/server/plugins/providedPrimers.int.test.ts` (primer rows), `src/lib/server/sockets/appletLibrary.int.test.ts`,
`src/lib/server/library/writes*.test.ts` for `attach-lorebook`.

## Tests — new `src/lib/server/plugins/providedBooksPubWide.int.test.ts`
For a MEMBER (non-admin, not the owner), per door: a live provided book is **listed** (`buildLorebooksList`: present,
`bookAccess: "shared"`, `provided` present), **readable** (`lorebooks:get` handler returns it with `bookAccess: "shared"`;
`entries:list` returns its entries), listed by the **applet door** (`runLibraryLorebooks` or the handler, `canEdit: false`),
**attachable** (`sessions:create` with its `lorebookId` succeeds for the member; `sessions:update` attaching it to the member's
session succeeds; `applyLibraryChange(…, "attach-lorebook", …)` succeeds), **not editable** (`lorebooks:update` and
`entries:create` by the member answer `LOREBOOK_NOT_FOUND` / their refusal), and `entries:sessionEntries` for the member's
session is not `ownerOnly`. A **disabled** provided book and an **ownerless** one (delete its `plugins` row) are: not listed,
`lorebooks:get` → `lorebook: null`, not in the applet door, attach refused. A **primer row** (seed via `syncProvidedPrimers` as
providedPrimers.int does) is listed for the member with `readOnly`, readable via `lorebooks:get`, and its attach at
`sessions:create` is still refused (the kit sentence) — assert the current sentence, do not change it. The member's session
writes follow the book's mode: `sessionLoreWriteMode(db, memberSessionId)` equals `bookLoreWriteMode(db, bookId)`
(`src/lib/server/state/loreWriteMode.ts`). `providedBooksReadableBy` unit cases: null user → empty; `[]` → empty; a copy of a
provided book (uuid differs) → not included.
Int tests that open a DB inside an `it` need a 60 s timeout (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`).

## Done means (run each with `npx vitest run <files>`; never pipe vitest into `head`)
New `plugins/providedBooksPubWide.int.test.ts` + `plugins/providedBooks.int`, `plugins/providedPrimers.int`,
`plugins/primerRowReadOnly.int`, `sockets/appletLibrary.int`, `sockets/lorebooks.readerAccess.int`,
`sockets/lorebooks.bookSettings.int`, `sockets/lorebooks.mutationScoping.int`, `sockets/content.interestGate.test.ts`
(it pins read counts: if one moves because of the new query, update the pin and say why), `sockets/sessions.ownBookCreate.int`,
`sockets/sessions.creationModes.int`, `lorebooks/starterKits.int`, `library/writes*.test.ts`, `auth/actingPerson*.test.ts` if
present — green, or a failure shown to fail identically before your change (say how you showed it). `npx tsc --noEmit -p .`
clean on your files (filter the output to your paths). `npx prettier --check` your files (report, don't fix pre-existing warnings).

## Rules (quoted from CLAUDE.md, NOMENCLATURE, the guides — they bind you)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- Default-db trap: a static import chain from `db/defaults.ts` to an access reader made int tests bind the REAL db before the
  mock (m2e-F-D item 0). Keep `providedMarks.ts` free of any `$lib/server/db` import; pass `db` in.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing
  'for later': no option, hook or extension point nobody asked for."
- NOMENCLATURE R1 one word, one meaning · R3 qualify, never the bare noun · R6 mark 🚧 provisional vocabulary. The only new name
  you add is `providedBooksReadableBy` (the supervisor grepped it: unused). Any other new exported name → stop and report it.
- One refusal for a book that is missing or not readable: `LOREBOOK_NOT_FOUND` ("Lorebook not found.") — never a sentence that
  confirms the id exists.
- It is a **session**, never a *chat*.
- Sockets: views never toast; you change no socket event or payload shape.
- An int test that opens a DB inside an `it` needs a 60 s timeout under load.

## Stop and report (don't decide) when
A new name / setting / migration / event seems needed; an existing test encodes a ruling other than ★M3-1; a door you were told
to change turns out to also serve writes.

## Report (`plans/briefs/REPORT-m3-core-w1.md`)
Changed files (with the hunks' purpose), tests run with pass/fail counts, any pin moved (old→new and why), Noticed, not done.
