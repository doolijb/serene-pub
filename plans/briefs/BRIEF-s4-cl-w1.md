# BRIEF s4-cl-w1 — the member gallery table, member-art access, backdrop read, book-copy registry (2026-11-08)

Supervisor: lane `s4-cl` (plans/briefs/BRIEF-s4-cl.md). You are a lane-worker. Repo `/home/jody/github/serene-pub` (SvelteKit 5, TypeScript, Drizzle + PGlite, Vitest 4; tabs, no semicolons). Another worker (w2) is editing `src/lib/server/sprites/index.ts` and `src/lib/server/characters/dowry.ts` at the same time — never touch those. Other lanes are live in this repo: touch ONLY the files listed under Files owned.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build.)

## Background (why)

Owner ruling ★2 (2026-11-08, "as recommended"): a cast member's gallery lives in a **link table `cast_member_files`** (generated migration), and the column `files.cast_member_id` is **retired**. Reason (plan §34.0): `files` is unique on (user, hash) (`schema.ts` `files_user_hash_unique`), so one image can't sit in a card's gallery and two members' galleries through a column on `files`; nothing writes `files.cast_member_id` today and its one reader is `sessions/backdrop.ts`. Owner 2026-11-05: "If a cast's feature in a lorebook/session can't survive without a card, then that feature needs to be copied to the cast member." The lane's writer (another worker, later) copies a card's sprite sets and gallery onto a member; you build the storage, the access rule, the backdrop read and the book-copy registry entries it relies on.

## Files owned (the only files you may edit or create)

- `src/lib/server/db/schema.ts` — ONLY: the new `castMemberFiles` table + its relations, adding `castMemberFiles: many(...)` to existing relations where needed, and removing `files.castMemberId` + its `files_cast_member_idx` index (and the stale doc lines naming it). Nothing else in schema.ts.
- The generated migration: `drizzle/0147_*.sql`, `drizzle/meta/0147_snapshot.json`, the new entry in `drizzle/meta/_journal.json` — via `npm run db:generate -- --name cast_member_files` ONLY (never hand-write or hand-edit SQL). If you must regenerate, delete only YOUR 0147 sql + snapshot + journal entry first. Never touch 0000–0146.
- `src/lib/server/db/castMemberFiles0147.int.test.ts` (new)
- `src/lib/server/db/characterVersions0146.int.test.ts` — ONLY the second `migrate(... real folder ...)` call (~line 98): migrate through `migrationsFolderThrough("0146_character_versions")` instead of the real `drizzle` folder, because 0147 drops `files.cast_member_id` which that test asserts at ~line 131. Add a dispose for the second folder. Nothing else.
- `src/lib/server/media/index.ts`, `src/lib/server/media/access.ts`, new `src/lib/server/media/access.memberArt.int.test.ts`
- `src/lib/server/sessions/backdrop.ts`, `src/lib/server/sessions/backdrop.int.test.ts`
- `src/lib/server/lorebooks/tableRegistry.ts`, `src/lib/server/lorebooks/tableRegistry.test.ts`, `src/lib/server/sockets/lorebooks.duplicate.int.test.ts`, `src/lib/server/utils/lorebookDuplicate.ts` (its header comment only, to name the new copied rows)

Readable: anything. Useful: `src/lib/server/media/paths.ts` (where new bytes land: `data/users/<uid>/lorebooks/<id>/` for a `lorebookId` provenance), `src/lib/server/sprites/index.ts` (read only), `src/lib/server/utils/testDb.ts` (`createTestDb`, `createTestUser`, `migrationsFolderThrough`, `releaseDataDir`), `src/lib/server/media/access.memberFace.int.test.ts` (int-test template: `vi.mock("$lib/server/db", …createTestDb…)`, a per-file `SERENE_PUB_DATA_DIR` temp dir named `serene-pub-vitest-<yours>-…`, 60 s timeouts).

## Tasks

### 1. Schema + generated migration

In `schema.ts`, beside `files` / `sprite_sets`, add (doc comment in the file's style, one 🚧 line saying what it is and what it is not):

```ts
export const castMemberFiles = pgTable(
	"cast_member_files",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		castMemberId: integer("cast_member_id").notNull().references(() => lorebookBindings.id, { onDelete: "cascade" }),
		fileId: integer("file_id").notNull().references((): AnyPgColumn => files.id, { onDelete: "cascade" }),
		position: integer("position").notNull().default(0),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("cast_member_files_member_file_uq").on(t.castMemberId, t.fileId),
		index("cast_member_files_file_idx").on(t.fileId)
	]
)
```

Doc points: 🚧 a cast member's **gallery** — the pictures the member has as its own, one row per (member, file); the file is a **role** (like a sprite's `file_id`), never provenance; ordered by `position` as a card's gallery is by `files.position`; a file deleted takes its rows (no empty gallery slot, unlike an empty sprite); the member deleted takes its rows. Not the card's gallery (`files.character_id`), not lorebook-owned media (`files.lorebook_id`, a book's uploads). Owner ★2, 2026-11-08; plan §34.2. Add relations (`castMemberFilesRelations`: `castMember` → lorebookBindings, `file` → files). Remove `files.castMemberId` and `index("files_cast_member_idx")`.

Then run `npm run db:generate -- --name cast_member_files`. Check: the file is `drizzle/0147_cast_member_files.sql`, it creates the table + FKs + indexes and drops `files.cast_member_id` (its index goes with it), nothing else; the journal entry's `when` is greater than 0146's `1793964915000`. If generate reports a lock (`check-db-lock.js`), stop and report it.

Hard rules: migrations are generated, never hand-written; a new migration's index must exceed the highest applied (0146) or it is silently skipped; never seed a row at a fixed id; never touch 0000–0093. No boot pass: nothing has ever written `files.cast_member_id` (it arrived in 0146 three days ago; grep proves no writer), so the drop loses nothing — say so in the test's header.

### 2. Migration test `db/castMemberFiles0147.int.test.ts`

Model it on `characterVersions0146.int.test.ts` (raw PGlite, `migrationsFolderThrough`, `rawRows`). Through `0146_character_versions`: seed a pre-0147 install (a user, a card, a lorebook, a member, two `files` rows, one with `cast_member_id` null), migrate the real folder, then assert: every pre-existing row survives (counts); `cast_member_files` exists and is empty; `files.cast_member_id` no longer exists; inserting a link works; a second identical (member, file) link is refused by `cast_member_files_member_file_uq`; deleting the file deletes its link; deleting the member deletes its link; a **second migrate** of the real folder changes nothing (row counts and `drizzle.__drizzle_migrations` count identical). Fresh DB is covered by every other int test (`createTestDb` applies the whole chain) — name that in the header.

### 3. `media/index.ts` — the member gallery and re-owning a file

- `MediaParent` gains `{ castMemberId: number }`. `mediaFor(db, { castMemberId })` answers the member's gallery: the `files` rows linked through `cast_member_files`, ordered by link `position`, then link id. (`parentWhere` cannot express a join — give the member case its own query inside `mediaFor`; keep every other parent exactly as today.) `clientMediaFor` then works as is. `reorderMedia(db, { castMemberId }, ids)` sets the LINK positions (not `files.position`).
- 🚧 `addToMemberGallery(db: Db, castMemberId: number, fileIds: readonly number[]): Promise<number>` — appends links after the member's highest position, in the order given, skipping a file already linked (`onConflictDoNothing` on the unique index); answers how many it added. Doc: the one writer of `cast_member_files` (P2: the media module owns it).
- 🚧 `fileForOwner(db: Db, fileId: number, owner: { userId: number; lorebookId: number }): Promise<number>` — the file a new owner wears: the same id when `files.user_id === owner.userId`; otherwise the bytes read with `readMedia` (original) and stored with `createMedia(db, { userId: owner.userId, lorebookId: owner.lorebookId, bytes, filename: file.filename })` — a per-user dedupe hit returns that user's existing row, which is the same picture, so nothing is lost; answers the new id. When the file is gone or its bytes can't be read, answer the original `fileId` (the picture stays shared rather than lost) and `console.warn` once with the ids. Never write bytes through a tmp dir (image assets live under `data/users/<uid>/…`; `createMedia` already does that). Doc both: why (owner 2026-11-05 copy rule; files are one row per user and bytes).

All on the handle passed in (a caller inside `db.transaction(async (tx) => …)` passes `tx`; the outer `db` deadlocks PGlite).

### 4. `media/access.ts` — member art reference rule

Owner rule (brief): "a person who can read a member's book can open the files its sprite sets and gallery use (as faces work, `media/access.ts:92-139`)." In `canViewMedia`, add to the `books` set (the one the face/cover branch already builds, so `canViewLorebook` AND the sessions-reading-that-book loop both apply): the books (`lorebook_bindings.lorebook_id`) of members whose **own sprite sets** hold the file (`sprites.file_id` → `sprite_sets.cast_member_id` → `lorebook_bindings`) and of members whose **gallery** links it (`cast_member_files.file_id`). And mirror the seated-member branch: sessions that seat (either seat table, `session_characters.cast_member_id` / `session_personas.cast_member_id`) a member whose sprite sets or gallery hold the file count, as the face's do. Run the new lookups in the same `Promise.all` style. Update the header/branch comments. Test in new `media/access.memberArt.int.test.ts`: a member (in book B owned by U) with an own sprite set holding file S and a gallery link to file G (both owned by another user O, so the owner shortcut doesn't answer): U's guest with a read share on B can open S and G; a person in a session reading B can open them; a stranger can't; a file in a card's sprite set only (not a member's) is not opened by the book's guest through this rule.

### 5. `sessions/backdrop.ts` — gallery read

`backdropFileFor` stops selecting `files.castMemberId`. With `castImages`, a file linked in `cast_member_files` to a member seated in the session (`memberInCast`, existing) is a cast image. Keep the refusal text. Update the 🚧 comment on `memberInCast`. In `backdrop.int.test.ts`, move the fixtures that inserted `files.castMemberId` (~lines 380–445) onto `cast_member_files` links (insert link rows directly in the test; or `addToMemberGallery`), keeping every assertion's meaning.

### 6. Book copy registry — member sprites and gallery travel with a duplicate

In `lorebooks/tableRegistry.ts`:
- `IdMaps` gains `spriteSets: IdMap`; `copyLorebookTables` initialises it.
- Three new specs after `castPresences`, all `scope: "binding"`, `lineScoped: false`:
  - `sprite_sets` (member sets only: `cast_member_id` in the book's members; a card's sets are the card's, never the book's), `countAs: "spriteSets"`: copy name, isDefault, position with the mapped `castMemberId`; fill `maps.spriteSets`.
  - `sprites` (through their member's set), `countAs: "sprites"`: copy label, position, source with the mapped `spriteSetId`; `fileId` = `fileForOwner(tx, fileId, { userId: <copy book's user_id>, lorebookId: to })` when not null (same owner → the same file row is shared; another owner → their own row). Null stays null (an empty sprite).
  - `cast_member_files`, `countAs: "memberGallery"`: copy position with the mapped member and the `fileForOwner` file.
  - Each with `purge` (delete the book's rows: sprites through sets of the book's members, then sets — registry order sets → sprites → gallery so the reverse purge takes sprites before sets) and `count`. Purge never deletes files (a kept file is recoverable by the cleanup tool; the face and cover rows behave the same) — say so in a comment.
- Read `characters.ts`-style FK notes: `sprite_sets.cast_member_id` cascades with the member anyway; the purge is still explicit (the registry's rule: one deletion rule, counted).
- `lorebooks/tableRegistry.test.ts`: remove `sprite_sets` from `NOT_THE_BOOKS` (it is registered now); `cast_member_files` is registered so it needs no entry.
- `sockets/lorebooks.duplicate.int.test.ts`: the fixture `seedRichBook` must hold a row in every registered table (the equality test asserts `from > 0`): give one member an own sprite set with one sprite (a stored file) and one gallery link. The delete test's per-scope branch needs a `"binding"` case (rows whose member is one of the book's members; sprites through sets — or assert through `spec.count` after delete). Add one test: a duplicate **by the owner** shares the sprite's and gallery's file rows; a duplicate **by a guest with a read share** gets new file rows owned by the guest, with the same bytes (compare `files.hash`), and the copy's member reads the same sprite labels (`spriteLabelsForMembers`) as the source's.
- `utils/lorebookDuplicate.ts`: header list names member sprite sets and gallery; nothing else.

Keep `remapEntityKey` as is (lane st owns the `cast_member:` remap).

## Rules your work depends on (quoted)

- CLAUDE.md Hard rules: "Migrations are **generated** (`db:generate`). A new migration's index must exceed the highest applied or it is *silently skipped*. Never seed a row at a hardcoded id." · "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." · "Never add a top-level `await` to `src/lib/server/db/index.ts`."
- CLAUDE.md "0.6 is in users' hands": "A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."
- P2: "A module owns its data and every write to it; peers use its contract … never its tables or internals. Two writers of one thing is a bug." → `addToMemberGallery` is the only app writer of `cast_member_files` (the registry copy and tests aside).
- Memory rule: image assets never in tmp — cache/bytes live under `data/users/<uid>/…`.
- NOMENCLATURE R3: qualify, never the bare noun (e.g. `memberGallery`, never `gallery` alone as a type/count name).
- New exported names you add are exactly: `castMemberFiles`, `castMemberFilesRelations`, `addToMemberGallery`, `fileForOwner`, the `{ castMemberId }` MediaParent variant, `IdMaps.spriteSets`, count names `spriteSets` / `sprites` / `memberGallery`. Any other new exported name: stop and report instead.

## Tests (only these, capped, logged)

Run the targeted files inside a capped scope, logging to your scratch dir `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/` with files prefixed `s4-cl-w1-`:

`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > <scratch>/s4-cl-w1-tests.log 2>&1; echo test-exit=$? >> <scratch>/s4-cl-w1-tests.log'`

Files: `src/lib/server/db/castMemberFiles0147.int.test.ts src/lib/server/db/characterVersions0146.int.test.ts src/lib/server/media/access.memberArt.int.test.ts src/lib/server/media/access.memberFace.int.test.ts src/lib/server/media/media.int.test.ts src/lib/server/sessions/backdrop.int.test.ts src/lib/server/lorebooks/tableRegistry.test.ts src/lib/server/lorebooks/tableRegistry.versions.int.test.ts src/lib/server/sockets/lorebooks.duplicate.int.test.ts`. Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.

Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet` with `NODE_OPTIONS=--max-old-space-size=8192`, logged to `s4-cl-w1-tsc.log`. Baseline is 0 errors; errors in `sprites/index.ts` / `dowry.ts` are w2's work in flight — report them, don't fix them.

Prettier: run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.

## Stop and report (don't decide) when

A new name beyond the list above; a change needed in a file not owned; the generated SQL contains anything beyond the table/indexes/FKs and the column drop; a test proves something else reads `files.cast_member_id`.

## Report

Your final message: changed files; the exact generated migration file name and its SQL; tests run with pass/fail counts; tsc result; anything you decided (one line each); anything noticed and not done.
