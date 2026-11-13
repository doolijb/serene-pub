# BRIEF — worker `s4-rul-a-w1` (2026-11-10) — card files a cast member draws open through the member (★s4-fb-4)

Supervisor: lane `s4-rul-a`. Repo `/home/jody/github/serene-pub`. Use absolute paths.

## Goal

The owner approved ★s4-fb-4 with this note (quote, never reinterpret): *"Permissions cascade through the cast member if the lorebook is shared, or user is a guest."* The recommendation approved: let the media check admit a card's sprite files to anyone who can read a cast member linked to that card; only those images open up.

Today `canViewMedia` (`src/lib/server/media/access.ts`) checks a card's files only through `canViewCharacter(file.characterId, …)` (~line 76). So a reader of a shared lorebook who may read a cast member but not its card sees the card's sprites, the face the member follows, and the likeness image it follows as broken images.

Add **one branch** to `canViewMedia`: a file that a cast member **actually draws from its card** is admitted to a user who may read that member. "May read the member" is **`canReadCastMember(db, memberId, userId)`** (`src/lib/server/cast/memberAccess.ts:51`). It already covers both halves of the owner's note: the member's book is readable (`lorebookAccessFor`, which includes shared books), or the user is in a session that seats the member (live `session_characters` / `session_personas` rows → `checkSessionAccess`). Reuse it; don't write a second reader rule.

A file F is "drawn by member M from its card" when any of these holds:

1. **Card sprite.** F is a `sprites.file_id` in a `sprite_sets` row owned by a card C (`sprite_sets.character_id = C`, not a member's own set), M is linked to C (`lorebook_bindings.character_id = C`) **or** one of M's versions has a parent card version of C (`character_versions` with `cast_member_id = M`, its `parent_version_id` → a card version whose `card_id = C`; that is how `memberAsRead` gets `activeCardId`), **and** M does not draw its own sprites. The existing test for that is `memberDrawsOwnSprites(db, M)` in `src/lib/server/sprites/choices.ts:147`. `choices.ts` imports heavy modules (`sockets/amendments`), so load it with a dynamic `await import(...)` inside the branch, or use the lighter `spriteLabelsForMembers` from `$lib/server/sprites`, the way `memberDrawsOwnSprites` does. Choose one and say which in your report.
2. **Followed face.** Some version V of M (`character_versions.cast_member_id = M`) has `'faceMediaId' = ANY(follows)`, and V's parent card version P (`P.id = V.parent_version_id`) has `P.face_media_id = F`. A member that wears its own face does not follow `faceMediaId`, so it never opens the card's face (see `wornByVersion` at the top of the file for the matching own-face rule).
3. **Followed likeness image.** Some version V of M has `'likeness' = ANY(follows)`, and its parent card version P has `(P.likeness->>'imageMediaId')::int = F`. The likeness shape is `CharacterLikenessInput { imageMediaId?, prompt?, negative? }` (`src/lib/shared/characters/likeness.ts`).

Retired versions count, as they do for `wornByVersion` (that comment gives the reason). Put the branch **after** the existing member-art / seating branches and **before** the account-avatar branch. Skip the branch cheaply when no candidate rows come back. Write a comment above the branch in the file's style: what it admits, why (the owner's note, quoted with its date, 2026-11-10), and what stays out.

**Stays out:**
- `canViewCharacter` (`src/lib/server/utils/sessionAccess.ts`) does not change. That file is readable, not yours.
- A **card gallery picture** (a file whose only tie to the card is `files.character_id`, with no sprite/face/likeness reference) gains nothing from the new branch.
- Nothing else of the card opens up.

## Tests

New file `src/lib/server/media/access.cardCascade.int.test.ts`. Copy the fixture style of `src/lib/server/media/access.memberArt.int.test.ts` and `access.memberFace.int.test.ts`; read them first. Cases:
- A **shared-book reader** (the book is shared with them, the card is not) can load the card's sprite file, the followed face (the card's avatar, as the parent card version's `face_media_id`) and the followed likeness image.
- A **session guest** of a session that seats the member can load the same three files.
- A **stranger** is refused all three.
- A **card gallery picture** is refused for the shared-book reader. For the session guest, check what today's `canViewCharacter` already does for a gallery file whose `character_id` is the card. If it already admits it (it walks sessions seating a member linked to the card), **don't** pin that in the new test and don't change it. Write what you found in your report.
- A member that **owns its own face** (retold face, `faceMediaId` not followed) does not open the card's avatar to the shared-book reader.
- A member that **draws its own sprites** (own set with a picture) does not open the card's sprite file to the shared-book reader.

Also update the one assertion that pinned the old finding: `src/lib/server/sockets/sprites.fromCard.int.test.ts:135-147` ("media finding: that reader cannot load the card's sprite files"). Flip the reader's expectation to `true`, rename the test so it says the reader can now load them (★s4-fb-4), and change nothing else in that file.

Run with a 60 s timeout on any `it`/`test` that opens a DB. Run inside a capped scope, logging to the scratchpad:

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/media/access.cardCascade.int.test.ts src/lib/server/media/access.memberArt.int.test.ts src/lib/server/media/access.memberFace.int.test.ts src/lib/server/media/media.int.test.ts src/lib/server/sockets/sprites.fromCard.int.test.ts src/lib/server/utils/sessionAccess.seatMember.int.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-a-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-a-w1-tests.log'
```

Never pipe vitest into `head` (SIGPIPE leaks PGlite temp dirs).

## Files owned

- `src/lib/server/media/access.ts`
- new `src/lib/server/media/access.cardCascade.int.test.ts`
- `src/lib/server/sockets/sprites.fromCard.int.test.ts`: the one test named above, nothing else

## Files readable

`src/lib/server/utils/sessionAccess.ts`, `src/lib/server/cast/memberAccess.ts`, `src/lib/server/cast/memberAsRead.ts`, `src/lib/server/sprites/choices.ts`, `src/lib/server/sprites/index.ts`, `src/lib/server/characters/versions.ts` (how a card version's `face_media_id` / `likeness` come from `characters.avatar_media_id` / `extensions.serenepub.likeness`, and what a member version follows), `src/lib/server/db/schema.ts` (`characterVersions` ~9420, `spriteSets`, `sprites`, `lorebookBindings`, `files`).

## Out of scope

- Changing `canViewCharacter`, `canReadCastMember` or `sockets/sprites.ts`.
- The amendment-dated active card beyond what a version's parent card gives. If you find a case the parent-version rule misses, report it; don't build it.
- Any new exported name. Local helper names are fine; list them in your report.

## Rules you work under (quoted)

- CLAUDE.md: *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."* `canViewMedia` takes a `db` handle. Pass that handle to every read you add, `canReadCastMember` included. Never use the module `db` inside it.
- CLAUDE.md: *"Never seed a row at a hardcoded id."* In tests, let ids come back from inserts.
- CLAUDE.md: *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."*
- CLAUDE.md Hard rule: *"Never `kill -9` the dev server."* Don't touch the owner's `vite dev` on :5173.
- Prettier: run `npx prettier --check` on the files you changed, but only `--write` the lines you changed. Never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.

## Stop and ask (in your report, don't decide) when

- you would need a new exported name, a migration, or a change outside the owned files;
- the parent-version rule and `memberAsRead`'s reading disagree on which card a member draws.

## Done means

All the test files in the command above pass. Report to your supervisor (your final message) with: the changed files, the branch's queries in a few words, the test results (counts, plus the log path), what you found about gallery + session guest, and Noticed-not-done.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
