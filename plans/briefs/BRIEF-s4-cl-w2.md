# BRIEF s4-cl-w2 — sprite writers take an owner; card → member copies of sprites and stats (2026-11-08)

Supervisor: lane `s4-cl` (plans/briefs/BRIEF-s4-cl.md). You are a lane-worker. Repo `/home/jody/github/serene-pub` (SvelteKit 5, TypeScript, Drizzle + PGlite, Vitest 4; tabs, no semicolons). Another worker (w1) is editing `db/schema.ts`, `media/index.ts`, `media/access.ts`, `sessions/backdrop.ts`, `lorebooks/tableRegistry.ts` at the same time — never touch those. Other lanes are live in this repo: touch ONLY the files listed under Files owned.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build.)

## Background (why)

Owner 2026-11-05: "If a cast's feature in a lorebook/session can't survive without a card, then that feature needs to be copied to the cast member." Owner ruling ★7 (2026-11-08, as recommended): the portrait and sprite-fill actions and a member sprite-set editor take **an owner (card or member)** — the server writers come first, here. Owner 2026-11-05: members carry sprites, **own over card**: `sprite_sets` rows belong to a card (`character_id`) or a cast member (`cast_member_id`), exactly one (`sprite_sets_one_owner_check`). Today `sprites/index.ts` writers are card-only. The lane's one card-less writer (`makeMemberCardless`, a later worker) will call the two copy functions you add here when a member loses its card (unlink, card delete, provided-book uninstall).

How a member's sprites are read today (`sprites/choices.ts:211-214`): "The member's own sets, when it has any with an image, are the art — no card draws them, and nothing falls back to a card inside them." So a card's sets are seen only while the member owns no set with an image.

How stats are read (`state/owners.ts` resolution chain, `state/resolve.ts` `sheetsForOwners`): values resolve session_cast → cast_member → card; sheets are the union in chain order. A card-less member loses the card layer, so its card-layer rows must be copied onto the member, **fill-only: the member's own values win**.

## Files owned (the only files you may edit or create)

- `src/lib/server/sprites/index.ts`
- new `src/lib/server/sprites/ownerWriters.int.test.ts`
- `src/lib/server/characters/dowry.ts`
- new `src/lib/server/characters/dowry.memberCopy.int.test.ts`

Readable: anything. Useful: `sprites/choices.ts`, `sprites/attach.ts`, `sockets/sprites.ts` (callers — must keep compiling unchanged), `state/declarations.ts` (`setOwnerSheets`, `assertSheetsWriter` — a cast_member owner's writer is someone who may edit its book; pass the book owner's id), `media/paths.ts`, `media/index.ts` (`createMedia`), `media/access.memberFace.int.test.ts` (int-test template: `vi.mock("$lib/server/db", …createTestDb…)`, a per-file `SERENE_PUB_DATA_DIR` temp dir named `serene-pub-vitest-<yours>-…`, 60 s timeouts), `utils/testDb.ts`.

## Tasks

### 1. `sprites/index.ts` — every writer and reader that took a card takes an owner

- Add 🚧 `export type SpriteOwner = { characterId: number } | { castMemberId: number }` with a JSDoc sentence ("whose sprite sets: a card's, or a cast member's own — exactly one, `sprite_sets_one_owner_check`").
- Every exported function whose first owner parameter is `characterId: number` (`listSpriteSets`, `ensureDefaultSpriteSet`, `findSpriteSetByName`, `requireSpriteSet`, `createSpriteSet`, `renameSpriteSet`, `setDefaultSpriteSet`, `deleteSpriteSet`, `addEmptySprites`, `relabelSprite`, `moveSprite`, `reorderSpriteVariants`, `deleteSprite`, `spriteFileIds`, `importSprites`) takes `owner: number | SpriteOwner` instead — **a bare number is a card id, so every existing caller compiles and behaves unchanged** (say so in one doc line near `SpriteOwner`). One private helper normalises it and gives the owner column condition (`eq(characterId, …)` or `eq(castMemberId, …)`). The partial unique indexes already exist for both owners (`sprite_sets_one_default_idx` on character_id, `sprite_sets_cast_member_one_default_idx` on cast_member_id; names unique per owner), so the default/race logic works per owner. `requireSprite` checks the sprite's set belongs to that owner.
- `AddSpriteInput`: keep `characterId` working for today's callers and allow a member instead — make it `({ characterId: number } | { castMemberId: number }) & { userId; setId?; label; bytes; filename?; source }`. For a member, `createMedia` provenance is the member's **book** (`lorebookId` = `lorebook_bindings.lorebook_id`; bytes land under `data/users/<uid>/lorebooks/<id>/`), never a card. `importSprites` likewise (its `characterId` param → `owner`), and its log line says which owner.
- `spriteFileIds(owner)` for a member: the member's sprite files (no avatar exception: a member's face lives on its versions, not here — leave the card branch's avatar exception exactly as is).
- `releaseSpriteFile`: a file also keeps when a **member's gallery** links it — `schema.castMemberFiles` (`fileId` column; table `cast_member_files`, being added by w1 right now in `schema.ts`). Do this step LAST: if `schema.castMemberFiles` isn't in `src/lib/server/db/schema.ts` yet when you get there, skip it and say so in your report (the supervisor finishes it).
- Leave `spriteLabelsFor` / `spriteLabelsForMembers` / `placeSpriteFile` / `SPRITE_IMPORT_LIMITS` as they are.
- Update the file header: point 1 ("Exactly one default set per character") becomes per owner; point 2 notes a member's sprite file is the member's book's file; mention `copySpriteSetsToMember`.

### 2. 🚧 `copySpriteSetsToMember(tx, cardId, castMemberId, fileFor)` in `sprites/index.ts`

```ts
export async function copySpriteSetsToMember(
	tx: Db,
	cardId: number,
	castMemberId: number,
	fileFor: (fileId: number) => Promise<number>
): Promise<{ sets: number; sprites: number }>
```

Doc: the card's sets become the member's own (owner 2026-11-05 copy rule); `fileFor` answers the file the member wears for a card file (the caller passes the media module's re-owning helper — same owner shares the file row, another owner gets its own row; this module never decides that). Rules:
- The member already owns a set **with an image** → copy nothing and answer `{ sets: 0, sprites: 0 }`: those sets are already its art and the card's were never shown (`choices.ts:211-214`). This also makes a second call a no-op.
- Otherwise, for each card set (default first, then position): if the member has a set of the same name (an empty one), the card set's sprites go into it; else a new member set with the same `name`, `position`; the member's default becomes the set carrying the card's default set's name (move the flag inside `tx`, respecting the one-default index: clear first, then set).
- Each card sprite → `placeSpriteFile(tx, memberSetId, label, await fileFor(fileId), source)` for one with a file (the placement rule dedupes the same file under the same label); an **empty sprite** (null file) → an empty member sprite under that label if the set has no row under it (as `addEmptySprites`). Keep the card's label order and variant order (position).
- Everything on `tx` (the outer `db` deadlocks PGlite inside a transaction). Never delete or change the card's rows.

### 3. 🚧 `copyCardStatsToMember(tx, cardId, castMemberId, by)` in `characters/dowry.ts`

```ts
export async function copyCardStatsToMember(
	tx: Db,
	cardId: number,
	castMemberId: number,
	by: { userId: number }
): Promise<{ sheets: number; configs: number; values: number }>
```

Doc: a card's template stats onto a cast member that is losing the card, **fill-only — the member's own win** (owner 2026-11-05 copy rule); the card layer is what `buildCardDowry` reads (`owner_kind 'card'`, `session_id` null, `branch_id` null). `by.userId` is the member's book owner (the sheets writer check). Rules:
- Sheets: the member's template-layer sheets (`owner_kind 'cast_member'`, `session_id` null) in their order, then the card's sheets the member lacks, in the card's order → `setOwnerSheets(tx, { kind: "cast_member", id: castMemberId }, union, { userId: by.userId })` — only when the card adds at least one; answer how many were added.
- Configs (`attribute_configs`) and values (`attribute_values`): each card-layer row whose `slot_id` the member holds **no row for at all** (any `cast_member` / this id / that slot row with `session_id` null — on any line or date) is inserted for the member: `owner_kind 'cast_member'`, `owner_id castMemberId`, same `slot_id`, `config` / `value`, `updated_by`, `note`; `session_id`, `branch_id`, `history_entry_id`, `valid_from_message_id`, `scene_id` null. Answer counts. (Read both tables' columns in `db/schema.ts` and copy only those that exist.)
- A second call adds nothing (the member now holds every slot and sheet). Everything on `tx`. Never change the card's rows.

### 4. Tests

- `sprites/ownerWriters.int.test.ts`: member-owner writers (create set → first is default, rename, set default, add sprite stores the file with `lorebook_id` = the member's book and `character_id` null, add empty sprites, relabel, move, reorder, delete sprite, delete set refuses the default while others exist), a card-owner call by bare number still works; `requireSpriteSet` refuses another owner's set; `copySpriteSetsToMember`: sets/default/labels/variants copied (`spriteLabelsForMembers(member)` equals `spriteLabelsFor(card)` before), empty sprites copied, `fileFor` called per filed sprite and its answer used, a member with its own image set gets nothing, a second call is a no-op, the card's rows unchanged; `releaseSpriteFile` keeps a file a member gallery links (only if you did that step).
- `characters/dowry.memberCopy.int.test.ts`: a card with two sheets, configs and values; a member with one own value on a shared slot and one own sheet → after the copy, the member's own value is untouched, the others are copied with null session/branch/date, sheets are the member's then the card's missing ones, counts right; a second call answers zeros; the card's rows unchanged. Use declared sheets/slots the way existing dowry or state int tests do (grep `declareSheet(` / `declareSlot(` in `*.int.test.ts`).
- The existing sprite tests must still pass.

Run, capped and logged (scratch dir `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, files prefixed `s4-cl-w2-`):

`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > <scratch>/s4-cl-w2-tests.log 2>&1; echo test-exit=$? >> <scratch>/s4-cl-w2-tests.log'`

Files: `src/lib/server/sprites/ownerWriters.int.test.ts src/lib/server/characters/dowry.memberCopy.int.test.ts src/lib/server/sprites/memberSprites.int.test.ts src/lib/server/sprites/charx.int.test.ts src/lib/server/sprites/choices.castMember.int.test.ts src/lib/server/sprites/spriteFill.int.test.ts src/lib/server/sprites/reexpress.int.test.ts src/lib/server/sockets/sprites.memberSets.int.test.ts` plus every existing `*dowry*` test file (`ls src/lib/server/**/*dowry*`) and `src/lib/server/sockets/sprites*.int.test.ts`. Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.

Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet` with `NODE_OPTIONS=--max-old-space-size=8192`, logged to `s4-cl-w2-tsc.log`. Baseline 0 errors. Errors in w1's files are its work in flight — report, don't fix.

Prettier: run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.

## Rules your work depends on (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- P2: "A module owns its data and every write to it … Two writers of one thing is a bug." The sprites module writes `sprite_sets`/`sprites`; dowry already writes card-layer `attribute_configs`/`attribute_values` and uses `setOwnerSheets` for sheets — follow exactly that pattern.
- P1: "Same inputs, same result." Deterministic order everywhere (ORDER BY position, id).
- Memory rule: image assets never in tmp (bytes under `data/users/<uid>/…`).
- New exported names you add are exactly: `SpriteOwner`, `copySpriteSetsToMember`, `copyCardStatsToMember`. Any other new exported name: stop and report instead.

## Stop and report (don't decide) when

A caller outside your files would need changing; a new exported name beyond the list; the stats copy would need a write path other than direct inserts + `setOwnerSheets`.

## Report

Your final message: changed files; signatures as built; tests run with pass/fail counts; tsc result; anything decided (one line each); anything noticed and not done.
