# BRIEF s4-cl-w3 — the one card-less writer and its callers (2026-11-08)

Supervisor: lane `s4-cl` (plans/briefs/BRIEF-s4-cl.md). You are a lane-worker. Repo `/home/jody/github/serene-pub` (SvelteKit 5, TypeScript, Drizzle + PGlite, Vitest 4; tabs, no semicolons). Other lanes are live in this repo (one is editing `sockets/sessions.ts`, `sockets/amendments.ts`, `library/writes.ts`, `shared/sockets/types.ts`, `NOMENCLATURE.md` — never touch those): touch ONLY the files listed under Files owned.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build.)

## Background (why) — owner rulings, quoted

- 2026-11-05: "If a cast's feature in a lorebook/session can't survive without a card, then that feature needs to be copied to the cast member."
- 2026-11-05: "Everything in session is cast → active card." A member reads its linked card by default; when the card goes, the member must carry what it read.
- ★3 (2026-11-08, as recommended): **card delete makes followers card-less** (the full writer + detach), instead of leaving them linked to the soft-deleted card. Trade-off accepted: it writes into other users' books.
- 2026-11-06: an **unlink from the member page applies from the book's present** — "versions from the present on become card-less keeping the card's words; earlier ones stay on the card" (`reparentFromBookPresent(tx, id, { cardId: null })`, already called by `writeMemberEdit` in `sockets/lorebooks.ts`). The writer must NOT undo that by detaching every version on an unlink.
- Memory rule "There is ALWAYS a lorebook": never frame a session as having no lorebook in comments or strings.

Plan §34.2: "One writer 🚧 `makeMemberCardless(tx, memberId, {cause})` (new `cast/cardless.ts`; orchestrates each module's own writer, P2; idempotent)". P2: "A module owns its data and every write to it; peers use its contract … never its tables or internals." So the writer **calls** each module's writer; the only row it writes itself is `lorebook_bindings.character_id = null` (step 7, assigned to it by the brief).

## The module writers you call (already built, read them)

- `resolveFollows(tx, { castMemberId }, { detach: true })` — `characters/versions.ts`: copies followed profile fields into the member's versions and clears `parent_version_id` (words, face id, likeness, timbre, sprite set name, post-history, notes, greetings).
- `copySpriteSetsToMember(tx, cardId, castMemberId, fileFor)` — `sprites/index.ts`: the card's sets become the member's (nothing when the member already owns a set with an image; second call a no-op).
- `spriteFileIds(tx, cardId)` — `sprites/index.ts`: a card's sprite files that are not its avatar (what the card gallery leaves out).
- `mediaFor(tx, { characterId })` — `media/index.ts`: the card's files in gallery order (the card gallery is these minus `spriteFileIds`; see `listCharacterGallery` in `utils/index.ts`).
- `addToMemberGallery(tx, castMemberId, fileIds)` — `media/index.ts`: the one writer of `cast_member_files` (appends; skips a file already linked).
- `fileForOwner(tx, fileId, { userId, lorebookId })` — `media/index.ts`: same owner → the same file row (shared); another owner → a row of their own with the same bytes (never through tmp); unreadable → the original id.
- `copyCardStatsToMember(tx, cardId, castMemberId, { userId })` — `characters/dowry.ts`: card-layer sheets/configs/values onto the member, fill-only (the member's own win); `userId` is the member's book owner.

## Files owned (the only files you may edit or create)

- new `src/lib/server/cast/cardless.ts`
- new `src/lib/server/cast/cardless.int.test.ts`
- `src/lib/server/sockets/lorebooks.ts` — ONLY `updateLorebookBindingHandler`'s transaction (the unlink call) and one import line.
- `src/lib/server/sockets/characters.ts` — ONLY `charactersDelete` and one import line.
- `src/lib/server/plugins/providedBooks.ts` — ONLY `deleteProvidedBooks` and one import line.
- Existing test files that assert the OLD card-delete / uninstall / unlink behaviour (members left linked to the soft-deleted card), e.g. `sockets/characters.softDelete.int.test.ts`, `sockets/castMemberLifecycle.int.test.ts`, `plugins/providedBooks.int.test.ts` — only the assertions the new behaviour changes, each with a one-line comment giving the ruling (★3, 2026-11-08). If an existing test fails for any other reason, report it; don't "fix" it.

## Task 1 — `cast/cardless.ts`

```ts
/** Why a member is losing its card. */
export type CardlessCause = "unlink" | "card-delete" | "provided-uninstall"

export interface CardlessOutcome {
	lorebookId: number
	/** The card let go; null when the member had none (nothing was copied). */
	cardId: number | null
	detached: number
	spriteSets: number
	sprites: number
	galleryFiles: number
	sheets: number
	configs: number
	values: number
}

export async function makeMemberCardless(
	tx: Db,
	memberId: number,
	opts: { cause: CardlessCause; card?: number }
): Promise<CardlessOutcome>
```

Header doc: 🚧 the one way a cast member becomes card-less (plan §34.2; owner 2026-11-05 copy rule; ★3); what it copies and from which module's writer; idempotent; runs on the caller's `tx` (the outer `db` inside a transaction deadlocks PGlite silently — `db/transactionGuard.ts` throws in dev/test); not for starters yet (lane st adds `"starter"` with its caller); it never writes annotations — the member's entity key becomes `cast_member:<id>` through the annotation vocabulary hash (lane s4-ner: "linking or unlinking moves the key and the vocabulary hash, and the book re-annotates by itself"), and the annotations module owns those rows (P2). One JSDoc sentence on each field of `CardlessOutcome` and on `opts.card` ("the card being let go; defaults to the member's linked card — pass it when the caller already nulled `character_id` in this transaction").

Steps, in order:
0. Read the member (`lorebook_bindings` row; missing → throw `Error("That cast member no longer exists.")`) and its book's owner (`lorebooks.user_id`). `card = opts.card ?? member.characterId`.
1. **Detach** — `cause !== "unlink"`: `resolveFollows(tx, { castMemberId: memberId }, { detach: true })` (always, even with no card: idempotent). `cause === "unlink"`: skipped, with a comment quoting the 2026-11-06 ruling — the caller's `reparentFromBookPresent` already applied it.
2. If `card == null` → step 7 and return zeros (a card-less member has nothing to copy; this is also what makes a repeat call a no-op).
3. **Sprites** — `copySpriteSetsToMember(tx, card, memberId, (id) => fileForOwner(tx, id, { userId: bookOwner, lorebookId: member.lorebookId }))`.
4. **Gallery** — the card gallery (`mediaFor(tx, { characterId: card })` minus `spriteFileIds(tx, card)`, kind `image` only — a gallery is pictures), each mapped through `fileForOwner` (same owner shares, another owner gets their own row), then `addToMemberGallery(tx, memberId, ids)` in that order.
5. **Stats** — `copyCardStatsToMember(tx, card, memberId, { userId: bookOwner })`.
6. (Face/likeness file re-owning is NOT built here: it needs a writer in `characters/versions.ts`, which this lane doesn't own. Put a one-line comment `// Faces and likeness images keep their file rows: see the lane report, ★s4-cl-1.` and nothing else.)
7. `UPDATE lorebook_bindings SET character_id = NULL WHERE id = memberId AND character_id IS NOT NULL`.

Check `spriteFileIds` / `cardsNow` behaviour on a **soft-deleted** card (`characters.is_deleted`): if `cardsNow` hides deleted cards, the avatar exception just doesn't apply — say which in your report; don't change `sprites/index.ts`.

## Task 2 — the callers (each inside its existing transaction, on `tx`)

1. **Unlink** — `updateLorebookBindingHandler` (`sockets/lorebooks.ts` ~2284; its transaction ~2483–2600): right after `writeMemberEdit(...)` returns, `if (unlinking) await makeMemberCardless(tx, existingBinding.id, { cause: "unlink", card: existingBinding.characterId! })`. (The row's `character_id` was already nulled by the update above it in the same transaction — that is why `card` is passed.) Nothing else in the handler.
2. **Card delete** — `charactersDelete` (`sockets/characters.ts` ~1135): inside the existing transaction, for each deleted card: keep `resolveFollows(tx, { cardId: id })` (it resolves dated versions of OTHER members that follow this card too), then for every member with `lorebook_bindings.character_id = id` (any book, any owner), `makeMemberCardless(tx, m.id, { cause: "card-delete" })`. Collect `{ lorebookId, memberId }`. After the transaction commits, for each: `await tellMemberSessions(socket.io, db, lorebookId, memberId)` (`sessions/memberSessions.ts`, the existing member push; it catches its own errors). Rewrite the comment block above (it says the versions keep their parent and the binding keeps pointing at the card — no longer true) to state ★3 and what the writer copies.
3. **Provided-book uninstall** — `deleteProvidedBooks` (`plugins/providedBooks.ts` ~1515): inside its card transaction, after `resolveFollows` for each id and before the soft delete, every member linked to one of `ids` (members of the plugin's own books were purged above; these are members in other books) → `makeMemberCardless(tx, m.id, { cause: "provided-uninstall" })`. No socket here — no push. Update the comment.

No user-delete cascade exists (`users:delete` soft-deletes and says so: "soft-deleted accounts never fire the FK cascade"); don't add one — the supervisor reports it.

## Task 3 — `cast/cardless.int.test.ts` (Done means)

Template: `src/lib/server/media/access.memberFace.int.test.ts` (`vi.mock("$lib/server/db", …createTestDb…)`, `vi.mock("$lib/server/sockets/utils/userPush", …)`, per-file `SERENE_PUB_DATA_DIR` temp dir named `serene-pub-vitest-cardless-…`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`, `releaseDataDir` in `afterAll`). Socket handlers are called as `handler.handler(fakeSocket(userId), params, emitToUser)` — copy `fakeSocket`/`noopEmit` from `sockets/lorebooks.duplicate.int.test.ts` (add `io` with `to: () => ({ emit() {} })` if a push needs it). Create cards with `insertCard` and members with `insertCastMember` (`characters/versions.ts`; the one-writer guard forbids raw `character_versions` inserts). Store real image bytes with `createMedia` (a tiny valid PNG buffer — grep an existing test for one).

A fixture: card C (owner O) with an avatar, a description, greetings, two gallery images (one of them also a sprite), a default sprite set with two labels + one empty sprite, a card-layer sheet and value (`declareSheet` over `core:slot/hp@1`, as `characters/dowry.memberCopy.int.test.ts` does); book K with member M linked to C (follows the card's words); a session (owner = K's owner) reading K and seating M on a character seat (`session_characters` with `cast_member_id` M, `character_id` C).

Per cause — **unlink** (through `updateLorebookBindingHandler` with `characterId: null`), **card delete** (through `charactersDelete`), **provided uninstall** (through `deleteProvidedBooks` with C marked `extensions.serenepub.provided = { plugin, slug, uuid: C.uuid }`) — assert after vs before:
- the member's prompt read matches its carded self: `memberAsRead(db, M.id)` description, greetings and face id (or its re-owned twin's bytes) as before;
- sprite choices: `spriteLabelsForMembers(db, [M.id])` equals `spriteLabelsFor(db, [C.id])` taken before;
- backdrop gallery: `backdropFileFor(db, ref, { sessionId, userId: <session owner>, castImages: true })` accepts each member gallery file (it accepted the card's before); the sprite-only file is not in the member gallery;
- stats: the member now holds the card-layer value and sheet (`attribute_values` / `owner_sheets` with `owner_kind 'cast_member'`);
- `lorebook_bindings.character_id` is null;
- a **second call** of `makeMemberCardless` changes nothing (row counts of `sprite_sets`, `sprites`, `cast_member_files`, `attribute_values`, `attribute_configs`, `owner_sheets`, `files`, `character_versions` identical);
- **same owner** (K owned by O): member sprite/gallery file ids equal the card's; **another owner** (K owned by B ≠ O): new file rows with `user_id` B, `lorebook_id` K, the same `hash`;
- `canViewMedia` (`media/access.ts`): a guest with a read share on K (`lorebook_shares`, as the duplicate test does) can open the member's sprite and gallery files; a stranger can't.

Not every assertion needs every cause × owner pair: run all bullets for unlink with both owner variants, and for card delete and provided uninstall with the other-owner variant (the case ★3 is about) — plus "a member of another user's book linked to a deleted card is card-less and its book's sessions get a push" (spy or mock `tellMemberSessions`). A card-less member passed again (`card` omitted) is a no-op.

## Tests to run (capped, logged)

Scratch dir `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, files prefixed `s4-cl-w3-`:

`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > <scratch>/s4-cl-w3-tests.log 2>&1; echo test-exit=$? >> <scratch>/s4-cl-w3-tests.log'`

Files: `src/lib/server/cast/cardless.int.test.ts src/lib/server/sockets/characters.softDelete.int.test.ts src/lib/server/sockets/castMemberLifecycle.int.test.ts src/lib/server/plugins/providedBooks.int.test.ts src/lib/server/sockets/gallery.responseIds.int.test.ts src/lib/server/sockets/sprites.int.test.ts` plus every `src/lib/server/sockets/lorebooks*.int.test.ts` that exercises `updateBinding` or unlink (`grep -l "updateLorebookBindingHandler\|characterId: null" src/lib/server/sockets/lorebooks*.int.test.ts src/lib/server/**/*.int.test.ts` — run the ones that call the handler) and `src/lib/server/annotations/castMemberVocabulary.int.test.ts`. Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.

Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet` with `NODE_OPTIONS=--max-old-space-size=8192`, logged to `s4-cl-w3-tsc.log`. Baseline 0 errors.

Prettier: run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit (these socket files are large and other lanes own other parts). If a file fails the check only on lines you didn't touch, leave it and say so.

## Rules (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." (`tellMemberSessions` uses the module `db` — call it only AFTER the transaction.)
- CLAUDE.md: "It is a **session**, never a *chat*."
- New exported names you add are exactly `makeMemberCardless`, `CardlessCause`, `CardlessOutcome`. Anything else: stop and report.

## Stop and report (don't decide) when

A caller needs a change outside its named function; a module writer above doesn't do what this brief says; an existing test proves a live flow depends on members staying linked to a deleted card.

## Report

Your final message: changed files (with the function touched in each shared file); tests run with pass/fail counts; tsc; existing tests changed and why; anything decided (one line each); anything noticed and not done.
