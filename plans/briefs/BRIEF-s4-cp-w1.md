# BRIEF s4-cp-w1 — Copy to my characters from a cast member (server) — 2026-11-08

Supervisor: lane `s4-cp`. Repo: `/home/jody/github/serene-pub`. Report back in your final message (the supervisor reads it); do not write a report file.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (One is up on :5199 — this task needs no `sdk:build`.)

## Goal

`characters:duplicate` gains a `{ castMemberId }` form — **Copy to my characters** from a cast member (owner ruling 2026-11-05: "If a user wants a cast member as a card, they can export the cast member as a card to their account"; plan §34.2). One verb, one handler (NOMENCLATURE §25: the verb on screen is _Copy_, the event _duplicate_). **No link back** from the copy to the member (no `lorebookId`, no binding, nothing pointing at the member).

What the copy holds:
1. **Words**: the member's version in force at its book's present ("the most recently active"), with `follows` resolved — i.e. the profile as `membersAsRead(tx, [castMemberId])` reads it by default (`src/lib/server/cast/memberAsRead.ts:617`, `MemberAsRead` at :65: name, nickname, aliases, summary, description, personality, scenario, greetings, exampleDialogues, postHistoryInstructions, creatorNotes, strokes, likeness, timbre, extensions…). Card made with `insertCard` (`src/lib/server/characters/versions.ts:435`) → v1; the v1's **label is null** (owner/plan: "insertCard v1, version label null"). `insertCard`'s first version defaults the label to "1.0" — set it to null afterwards with `updateCardVersion(tx, version.id, {...}, { label: null })` (`versions.ts:527`). **Do not edit `versions.ts`** (worker w2 owns it right now). Look at the existing card-copy path in the same handler (`src/lib/server/sockets/characters.ts:2681–2795`: `insertCardFromColumns`, `cardColumnsOfProfile` in `characters/cardIO.ts:531`) and reuse what fits.
2. **Face and likeness image**: new files owned by the asker (a revoked share or deleted member must not take the copy's face). Read bytes with `readMedia` and store with `createMedia({ userId: asker, characterId: newCardId, bytes, filename })` (`src/lib/server/media/index.ts:311`; it dedupes on (user, hash): a hit returns the asker's existing row — accept it and say so in the report). The copy's `faceMediaId` and `likeness.imageMediaId` point at the new rows.
3. **Sprite sets**: the member's own sprite sets (`sprite_sets.cast_member_id`), else — when the member has none holding an image — the sets it cascades to from its active card (`MemberAsRead.spriteSetsFrom`). Copied onto the new card with their sprites; each sprite file copied for the asker as in 2. The sprites module owns those rows (P2): `src/lib/server/sprites/index.ts` has `copySpriteSetsToMember(tx, cardId, castMemberId, fileFor)` (:877) and `SpriteOwner` (:53). **You may generalise it** into one 🚧 copier from any `SpriteOwner` to any `SpriteOwner` (keep `copySpriteSetsToMember` working for its callers, `cast/cardless.ts` and tests — run `src/lib/server/sprites/ownerWriters.int.test.ts` after). Don't write `sprite_sets`/`sprites` rows from anywhere else.
4. **Gallery**: the member's own gallery (`mediaFor(tx, { castMemberId })`, images only), else its active card's gallery when the asker may read that card (images, sprites excluded — as `cast/cardless.ts:121–127` does). Each picture copied for the asker as in 2, with `characterId` = the new card (a card's gallery is `files.character_id`).
5. **Stats (★8, ruled 2026-11-08):** "Copy to my characters copies the member's sheets/configs with **current values as the card's defaults**" — trade-off accepted: "a story's earned stats become the card's starting stats". Never session values (`session_id` not null rows are ignored). Read what the member carries at its book's present: its own template-layer sheets (`owner_sheets` owner_kind `cast_member`), configs and values (`attribute_configs` / `attribute_values` owner_kind `cast_member`, `session_id` null), else the active card's card-layer rows for slots the member has none for. Find the state module's existing reader for that (look in `src/lib/server/state/lorebookState.ts`, `state/owners.ts` `resolutionChain`, `state/resolve.ts`); don't hand-roll line/date resolution if a reader exists. Write onto the new card **through the existing writers**: sheets with `setOwnerSheets(tx, { kind: "card", id }, sheetIds, { userId })` (`state/declarations.ts`), configs and values through `applyCardChanges` (`state/cardState.ts:269`) or, if that can't run on your `tx`, the same insert shape it uses — say which in the report. A value the card layer refuses (a slot a card may not carry) is skipped and counted, never fails the copy.
6. **Tags**: only from the member's active card, and only when the asker may read that card (owner, or `canViewCharacter`); re-made as the asker's (`processCharacterTags`, as the card path does).
7. `isPersona` false; no folder, favourite, default-persona claim or share rows; embedding queued like the card path (`autoEnqueueCharacter`).

**Who may copy:** anyone who can **read the member's book** — `lorebookAccessFor(lorebookId, userId, { db, isAdmin: false })` (`src/lib/server/utils/ownedBook.ts:92`; owner · shared · live provided book · a session's own notes for its members; pass `isAdmin: false`: no administrator exception for copying someone else's member — name this in the report) — **or** anyone in a session that seats the member (`session_characters.cast_member_id` / `session_personas.cast_member_id` = the member, and `checkSessionAccess(sessionId, userId).hasAccess`, `utils/sessionAccess.ts`) — that is the guest who sees the member's read-only sheet (`SeatMemberSheet.svelte`, `lorebooks:memberOfSeat`). Everyone else is refused.

**Refusal sentence (★ proposed by the supervisor, build it):** `"Cast member not found."` — same shape as the card path's `"Character not found."`, never confirming the member exists. The error payload carries `castMemberId` (the `refusable` 4th argument, as the card form echoes `characterId`).

Put the copy itself in a new module **`src/lib/server/characters/cardFromMember.ts`** exporting 🚧 `cardFromMember(tx, { castMemberId, userId })` (reads + writes on the caller's `tx`, one transaction for the whole copy) and the access check (🚧 `mayCopyMember(db, castMemberId, userId)` or similar — your call, name it in the report). The socket handler parses the union, calls them, then does what the card path does after commit (`characters:list` lazy emit, reply `Sockets.Characters.Create.Response`, `characters:duplicate` emit).

## Files owned (edit only these)

- `src/lib/server/sockets/characters.ts` — only `charactersDuplicate` (and its doc comment).
- new `src/lib/server/characters/cardFromMember.ts` + new `src/lib/server/characters/cardFromMember.int.test.ts`.
- `src/lib/server/sprites/index.ts` — only the copier generalisation in 3.
- `src/lib/client/sockets/typedSocket.ts` — only the `"characters:duplicate"` entry's params (`{ characterId: number } | { castMemberId: number }`).
- `src/lib/shared/sockets/types.ts` — only inside the `Sockets.Characters` namespace, if you need a type there.

## Files readable

Everything. Especially `cast/memberAsRead.ts`, `cast/cardless.ts`, `media/index.ts`, `media/access.ts` (the member-art read rule at :79–200 is the same "who" as above), `characters/dowry.ts` `copyCardStatsToMember` (:477, the inverse direction — mirror its shape), `state/cardState.ts`, `state/declarations.ts`, `utils/ownedBook.ts`, existing tests `cast/cardless.int.test.ts`, `characters/dowry.memberCopy.int.test.ts`, `sprites/ownerWriters.int.test.ts`, `sockets/characters.softDelete.int.test.ts` (for how socket handlers are driven in int tests).

## Out of scope

Client buttons (another worker). Seating, starters, the Characters view. Sprite/portrait generation. Anything in `versions.ts`, `characterBindingSync.ts`, `cast/cardless.ts` (worker w2). NOMENCLATURE.md (the supervisor queues rows).

## Rules that apply (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test." Helpers you call inside the copy must get `tx`.
- CLAUDE.md P2: "A module owns its data and every write to it; peers use its contract … never its tables or internals. Two writers of one thing is a bug." — sprite rows via the sprites module, files via the media module, card + versions via `versions.ts`/`insertCard`, card stats via `cardState`/`declarations`.
- CLAUDE.md: "Never seed a row at a hardcoded id."
- Common brief: an event in `SCOPED_EVENTS` must carry its scope key. `characters:duplicate` is not scoped today; keep it so.
- Memory rule "There is ALWAYS a lorebook": never write copy or comments framing a session as having no lorebook.
- It is a **session**, never a chat.
- Image assets never in tmp: files go through `createMedia` under `data/users/<uid>/…`, never through a temp dir.
- Name new exported helpers with 🚧 in their JSDoc; one JSDoc sentence each.

## Done means

Tests in `src/lib/server/characters/cardFromMember.int.test.ts` (DB opened in `beforeAll` with `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`; follow `cast/characterRows.storedNames.int.test.ts` for the `vi.mock("$lib/server/db")` + `createTestDb` + `releaseDataDir` pattern):
1. copy from a **card-less** member (all words own) → a card owned by the asker with those words, v1 label null, no `lorebookId`;
2. copy from a member **with retold fields** (own description over its card's) → the copy has the member's description and the card's other fields;
3. copy from a member **behind its card** (card has a newer version; member follows the older one) → the copy has the older version's words;
4. **face is a new file for the asker** (another user's book; the copy's `faceMediaId` is a file row with `user_id` = asker, `character_id` = the copy);
5. **stats copied as defaults** (a member value on the template layer becomes a card-layer value; a session-layer value is not copied);
6. sprite sets: own sets copied; with none, the card's;
7. **a non-reader is refused** with "Cast member not found." and nothing is written;
8. **a guest in a session seating the member is allowed** (no book access, has session access);
9. tags only when the asker may read the active card.

Plus: `sprites/ownerWriters.int.test.ts` still green if you touched `sprites/index.ts`.

Run tests only inside a capped scope, logged (never pipe vitest into `head`):

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-cp-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-cp-w1-tests.log'
```

Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; …'` (baseline: 0 errors). **Prettier:** `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file you didn't otherwise edit; if a file fails only on lines you didn't touch, leave it and say so.

## Stop and ask (put it in your report, don't decide)

A new socket event, a new user-visible sentence beyond "Cast member not found.", a migration, a change to a file not listed above, or a rule above that the code makes impossible.

## Report (final message)

Changed files; each decision you made (names, the stats reader you used, how dedupe hits behave); tests run with pass/fail counts; tsc before/after; anything noticed but not done.
