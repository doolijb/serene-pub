# BRIEF s4-cp-w3 — a cast member's own sprite sets and gallery over the existing socket families (server) — 2026-11-08

Supervisor: lane `s4-cp`. Repo: `/home/jody/github/serene-pub`. Report back in your final message (the supervisor reads it); do not write a report file.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (One is up on :5199 — this task needs no `sdk:build`.)

## Goal

Owner ruling ★7 (2026-11-08, as recommended): "Member sprite-set editor + portrait/sprite-fill actions taking an owner (card or member) in S4." Owner 2026-11-05: members carry voice and sprites, "own over card". Lane rule (taken): **whoever may edit the member's book** may write a member's sprites and gallery.

This task builds the **socket half for the manual editor and the gallery**. The generation events (`characters:previewSpriteFill`, `:fillSprites`, `:expressSprite`, `:previewPortrait`, `:generatePortrait`) stay **card-only** in this task — their runs go through the SDK `core:inlet/card-action` / `core:outlet/attach-sprite@1` contracts and the host, which this lane does not own (the supervisor is asking the lead). Don't touch them.

1. **One access module** — new `src/lib/server/cast/memberAccess.ts`:
   - 🚧 `canReadCastMember(db, castMemberId, userId, opts?: { isAdmin?: boolean })` — the member-art read rule as `media/access.ts:79–200` states it for files: whoever may read the member's book (`lorebookAccessFor(lorebookId, userId, { db, isAdmin })`, `utils/ownedBook.ts:92`), **or** is in a session (`checkSessionAccess(sessionId, userId).hasAccess`) that seats the member (`session_characters.cast_member_id` / `session_personas.cast_member_id`, `removed_at` null). Answers the member's `{ id, lorebookId }` or null.
   - 🚧 `canEditCastMember(db, castMemberId, userId)` — the member's book is editable by the user: `findOwnedBook(db, userId, lorebookId)` (`utils/ownedBook.ts:36`; owner, or a session's own notes for its members). Answers `{ id, lorebookId, bookOwnerId }` or null.
   - Move the read half of `mayCopyMember` in `src/lib/server/characters/cardFromMember.ts` onto `canReadCastMember(…, { isAdmin: false })` (same behaviour; its tests `characters/cardFromMember.int.test.ts` must stay green). Only that function changes there.
2. **Sprites** — `src/lib/server/sockets/sprites.ts`: every handler below accepts `{ castMemberId }` **instead of** `{ characterId }` (exactly one of the two; both or neither is refused) and passes the sprites module a `SpriteOwner` (`src/lib/server/sprites/index.ts:53`; its writers and `listSpriteSets` already take `number | SpriteOwner`):
   - `characters:listSprites` (read rule), `characters:createSpriteSet`, `:updateSpriteSet`, `:deleteSpriteSet`, `:uploadSprite`, `:addStandardSprites`, `:updateSprite`, `:deleteSprite`, `:reorderSprites` (edit rule).
   - `characters:testSprite` (read rule) only if it is a plain owner swap; otherwise leave it card-only and say so.
   - Replies and errors carry **`castMemberId`** (and no `characterId`) for the member form; the card form is unchanged. The whole-list reply for a member is `{ castMemberId, sets }`.
   - A member's uploaded sprite file: find how `addSprite`/`placeSpriteFile` store a member's file (s4-cl: "A member's sprite file has its book as provenance"; `createMedia` with `lorebookId`, owned by the book's owner — check what `sprites/index.ts` expects and follow it; don't invent a second path).
3. **Gallery** — `src/lib/server/sockets/characters.ts`, only `characters:listGallery`, `characters:uploadGalleryImage`, `characters:reorderGallery` (and the shared builder they use, ~:2318): the same `{ castMemberId }` form. Read with `clientMediaFor(db, { castMemberId })` (images, the member's own sprite files left out, as the card gallery leaves out the card's sprites — `spriteFileIds(tx, { castMemberId })`); upload with `createMedia` (book provenance, book owner — as the sprite upload in 2) then `addToMemberGallery` (`media/index.ts:674`, the one writer of `cast_member_files`); reorder with `reorderMedia(db, { castMemberId }, ids)`. Read rule for list, edit rule for upload and reorder. Replies carry `castMemberId`. **No delete form** (not asked; the supervisor is proposing it). `characters:deleteGalleryImage` stays card-only.
4. **Types** — the params unions and member-form reply shapes in `src/lib/shared/sockets/types.ts` (**only inside the `Sockets.Characters` namespace**) and the `characters:*` entries in `src/lib/client/sockets/typedSocket.ts` (only `characters:*` entries). One JSDoc sentence per new field (modder rule): e.g. `/** 🚧 The cast member whose own sets these are; absent for a card's. */`.

### The interest scope (read this)

These replies are in `SCOPED_EVENTS` (`src/lib/shared/sockets/interest.ts:194–231`), scoped on `payload?.characterId`. A member-form payload has no `characterId`, so its scope is null and **only sockets that declared the bare event key receive it** (`server/sockets/interest.ts:115` `socketWants`). `interest.ts` is **not** in this lane's files — do not edit it. The client worker will declare the bare key for a member owner and filter by `castMemberId`. Check every existing client listener of these events (grep `src/lib/client`) to make sure a member-form reply arriving at a bare-key listener can't be mistaken for a card's (e.g. a listener that reads `res.characterId` without checking) — list what you found; fix nothing in client files, report it. Also check whether any conformance test asserts that every emit of a scoped event carries its key (grep `SCOPED_EVENTS` in `*.test.ts`); if one fails, report it rather than weakening it.

## Files owned (edit only these)

- new `src/lib/server/cast/memberAccess.ts` + new `src/lib/server/cast/memberAccess.int.test.ts`
- `src/lib/server/characters/cardFromMember.ts` (only `mayCopyMember`)
- `src/lib/server/sockets/sprites.ts` (the handlers named in 2 and the helpers they share)
- `src/lib/server/sockets/characters.ts` (only the three gallery handlers in 3 and the builder they share)
- `src/lib/server/sprites/index.ts` only if a member path needs a one-line fix there (say why)
- `src/lib/shared/sockets/types.ts` — only inside `namespace Characters` (under `Sockets`)
- `src/lib/client/sockets/typedSocket.ts` — only `"characters:*"` entries
- new test `src/lib/server/sockets/sprites.memberOwner.int.test.ts` (or similar name)

## Files readable

Everything. `sprites/index.ts`, `media/index.ts`, `media/access.ts`, `cast/cardless.ts`, `sockets/sprites.ts` existing `requireOwned`/`canSeeCharacter`/`spriteWrite`, existing tests `sprites/ownerWriters.int.test.ts`, `media/access.memberArt.int.test.ts` (if present), `sockets/characters.softDelete.int.test.ts` (how handlers are driven in int tests).

## Out of scope

Client components (another worker). The generation events. `characters:deleteGalleryImage` member form. `interest.ts`. NOMENCLATURE.md (supervisor queues rows).

## Rules that apply (quoted)

- CLAUDE.md: "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." — see the scope section above; the member form deliberately goes to bare-key listeners until the lead rules on `interest.ts`.
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`."
- CLAUDE.md P2: "A module owns its data and every write to it." — sprite rows only via `sprites/index.ts`; files via `media/index.ts`; `cast_member_files` only via `addToMemberGallery` / `reorderMedia`.
- Modder rule (owner 2026-11-08): "one JSDoc sentence per new field"; "a refusal says what to do instead".
- **Refusal sentences** (supervisor's ★ proposal, build these): a member the asker can't read → `"Cast member not found."` (reuse `CAST_MEMBER_NOT_FOUND` from `characters/cardFromMember.ts`); readable but not editable → `"Only someone who can edit this cast member's lorebook can change its sprites."` (sprites) / `"… can change its pictures."` (gallery); both ids or neither → `"Name a character or a cast member, not both."`.
- Image assets never in tmp: files through `createMedia`.
- It is a **session**, never a chat. Never frame a session as having no lorebook.

## Done means

Tests (DB in `beforeAll`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`, the `vi.mock("$lib/server/db")` + `createTestDb` + `releaseDataDir` pattern from `cast/characterRows.storedNames.int.test.ts`):
- `canReadCastMember` / `canEditCastMember` matrix: book owner (read+edit), share recipient (read only), session guest seating the member (read only), session notes member (read+edit), stranger (neither), admin (read when `isAdmin` not false; never edit).
- sprites: owner of the book creates a set, uploads a sprite, lists — reply carries `castMemberId` and the member's sets only; a reader (share) can list but a write is refused with the sentence; a stranger's list is refused with "Cast member not found."; both ids refused.
- gallery: list/upload/reorder for the member; reader can list, can't upload; reply carries `castMemberId`; the member's sprite files are not in its gallery list.
- `characters/cardFromMember.int.test.ts` and `sprites/ownerWriters.int.test.ts` still green; any existing `sockets/sprites*.test.ts` / gallery tests still green (find them).

Run inside a capped scope, logged (never pipe vitest into `head`):

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-cp-w3-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-cp-w3-tests.log'
```

Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; …'` (baseline 0). **Prettier:** only `--write` the lines you changed; if a file fails only on lines you didn't touch, leave it and say so.

## Stop and ask (in your report, don't decide)

A new socket event, any edit to `interest.ts`, a migration, a user-visible sentence beyond the ones above, a change to a file not listed.

## Report (final message)

Changed files; decisions; client listeners found that could misread a member-form reply; tests with pass/fail counts; tsc before/after; noticed-not-done.
