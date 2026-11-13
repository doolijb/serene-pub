# BRIEF — lane `s4-cl` (wave 1, started early beside wave 0's s4-bk-lock) — the one card-less writer, member parity homes

Read `plans/briefs/BRIEF-s4-common.md` first, then plan §34.0 (the card-delete/unlink/gallery bullets), §34.2 ("One writer"), §33 (character profiles, ~1396–1430), the inventory `plans/briefs/INVENTORY-s27-S4-member-parity-2026-11-05.md` (written before stage 1 — §34.0 says which items now have a home) and the 2026-11-08 rulings. Owner, 2026-11-05: **"If a cast's feature in a lorebook/session can't survive without a card, then that feature needs to be copied to the cast member."** You are the only lane generating a migration in wave 1.

## Goal

1. **🚧 `makeMemberCardless(tx, memberId, { cause })`** in a new `src/lib/server/cast/cardless.ts`. It orchestrates each module's own writer (P2 — it never writes another module's tables directly) and is idempotent (a second call changes nothing — test it):
   1. `resolveFollows` detach (exists, `characters/versions.ts`) — profile words, face, likeness, timbre, sprite set name, post-history, notes, greetings.
   2. **Sprite sets:** the card's sets (and, for a book copy, the member's own) become `cast_member` sets. Same owner → new `sprite_sets`/`sprites` rows sharing file rows (`releaseSpriteFile` ref-counts, `sprites/index.ts:585`). Different owner → new file rows for the new owner via `readMedia` → `createMedia`, **never through tmp** (image assets live under `data/users/<uid>/…`). `sprites/index.ts` writers take an owner (card or member).
   3. **Gallery → ★2 (ruled): a link table `cast_member_files`** (member id, file id, position/order as the card gallery has; generated migration via `npm run db:generate` — next index after 0146; FK cascade on member delete, SET NULL or cascade on file per existing gallery conventions — match them). Retire `files.cast_member_id` (its one reader `sessions/backdrop.ts` moves to the link table; drop the column in the same generated migration **only if** nothing else reads it — else mark ⏳ and list it). Forward migration only; a boot pass is needed only if existing rows hold `files.cast_member_id` (check; nothing writes it today per §34.0).
   4. **Card-layer stats** copied fill-only (the member's own values win) to `cast_member` owner — reuse `characters/dowry.ts`.
   5. Face and likeness image files re-owned when the owner differs.
   6. Annotations re-keyed `character:<card>` → `cast_member:<id>` (lane s4-ner adds the kind in wave 0 — read its report `plans/REPORT-s4-ner-2026-11-08.md`).
   7. `character_id = null`.
   `media/access.ts` gains a reference rule: a person who can read a member's book can open the files its sprite sets and gallery use (as faces work, `media/access.ts:92-139`).
2. **Callers, all through the one writer:** unlink (`sockets/lorebooks.ts` ~1578, ~1699); **card delete (★3, ruled yes)** — `sockets/characters.ts` ~1174: followers become card-less (writer + detach) instead of staying linked to the soft-deleted card; provided-book uninstall (`plugins/providedBooks.ts` ~1547); the **user-delete cascade** (call the writer before `SET NULL` — find the cascade); book duplicate (`utils/lorebookDuplicate.ts`, `lorebooks/tableRegistry.ts`: the registry gains `sprite_sets`/`sprites` and `cast_member_files`, so a duplicate copies member sprites and gallery; members keep shared cards as ruled). Branches: nothing (they ride the parent's people). Starters are lane st's (wave 5) — expose what it needs and say so.
3. **★7 (ruled), server half:** the portrait and sprite-fill actions accept an owner (card or member). The member sprite-set **editor UI** is lane cp's (wave 5) — expose the socket/writer it will call and list it.
4. NOMENCLATURE: **lane s4-bk-lock still holds `NOMENCLATURE.md` while it runs — don't edit it; queue your rows in your report (the lead merges them).** Rows for 🚧 `makeMemberCardless` (if it needs a canon row), `cast_member_files`, the retired `files.cast_member_id`, "card-less" usage; Docs: `docs/lorebook-cast.md` (what unlink and card delete keep), `docs/images.md` (sprites on cast members).

## Files owned

`src/lib/server/cast/cardless.ts` (new), `src/lib/server/sprites/index.ts` (+ the portrait/sprite-fill action files you find — list them), `src/lib/server/media/{index,access}.ts`, `src/lib/server/characters/dowry.ts`, `src/lib/server/lorebooks/tableRegistry.ts`, `src/lib/server/utils/lorebookDuplicate.ts`, `src/lib/server/sessions/backdrop.ts` (gallery read only), the unlink sites in `sockets/lorebooks.ts`, the delete site in `sockets/characters.ts`, `plugins/providedBooks.ts` (uninstall only), the user-delete cascade file, `src/lib/server/db/schema.ts` (your table/column only), the generated migration, the two docs, tests next to all of these.

## Out of scope

Card-less seats (lane seat), starters (lane st), Copy to my characters (lane cp), the member page/editor UI (cp), any SDK change, any key flip.

## Stop and ask when

Common brief's Decisions apply; the writer would need to write a table another module owns with no writer of its own (P2) — propose the writer; re-owning a file hits the per-user hash dedupe (`files` unique on user+hash, `schema.ts:3613`) in a way that loses an image.

## Done means

- Int tests, per cause (unlink, card delete, provided uninstall, user delete, book duplicate): the member's prompt read, sprite choices, backdrop gallery and stats match its carded self after the writer; a second call is a no-op; same owner shares file rows, another owner gets new rows; a guest who can read the book can open member sprite/gallery files; a stranger can't.
- Migration: generated, index after 0146, applies on a fresh DB and on a copy of a pre-0147 DB; a second boot changes nothing.
- tsc + check: no new errors.

## Report

`plans/REPORT-s4-cl-2026-11-08.md`.
