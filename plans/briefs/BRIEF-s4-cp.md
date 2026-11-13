# BRIEF — lane `s4-cp` (wave 5, may start beside wave 4's s4-seat) — Copy to my characters, member parity UI, faces re-owned, stored names kept true

Read `plans/briefs/BRIEF-s4-common.md`, plan §34.2 ("Copy to my characters"), the 2026-11-08 rulings (★7, ★8, ★10), and the reports `plans/REPORT-s4-cl-2026-11-08.md` (★s4-cl-1, ★7 socket half — the writers you call are ready), `plans/REPORT-s4-chr-read-2026-11-08.md` (★chr-read-1), `plans/REPORT-s4-on-2026-11-08.md`. Owner rulings: plugin books are starters — "If a user wants a cast member as a card, they can export the cast member as a card to their account" (2026-11-05; memory `feedback_plugin_books_are_starters.md`); no link back from a copied card to the member.

## Goal

1. **Copy to my characters** = `characters:duplicate` gains a `{ castMemberId }` form (one verb, one handler — NOMENCLATURE §25 "Copy" / `duplicate`). Who: anyone who can read the member's book, or a guest seeing that member's read-only sheet in a session. Copies: the member's version in force at the book's present ("the most recently active") with `follows` resolved; `insertCard` v1, version label null; new face and likeness files owned by the asker (`fileForOwner`); the member's own sprite sets, else the sets it cascades to from its card; its gallery; **★8 (ruled): its sheets and configs with current values as the card's defaults** (not session values); tags only from the member's active card when the asker can read it. No link back. Doors: the member page and the session's member sheet (the Characters view's row door is chr-view's, wave 6).
2. **★s4-cl-1 (rec, implementation): 🚧 `repointCastVersionFiles(tx, castMemberId, files: Map<old,new>)`** in `characters/versions.ts` (in-place rewrite of `face_media_id` and `likeness.imageMediaId` on every version of that member, no retire; same shape as `repointVersionHistory`); `makeMemberCardless` step 5 (placeholder in `cast/cardless.ts`) calls it with `fileForOwner`'s map. Test: a member made card-less in another user's book keeps its face after the card owner deletes that gallery picture.
3. **★7 socket half (ruled):** `castMemberId` on `characters:previewSpriteFill`, `characters:fillSprites`, `characters:previewPortrait`, `characters:generatePortrait`, plus a member gallery list (`mediaFor/clientMediaFor/reorderMedia({castMemberId})`, `addToMemberGallery`). Rule (lane rec, take it): **whoever may edit the member's book** may run them on a member. **★7 UI:** the member sprite-set editor on the member page (reuse the card's Sprites tab component with an owner prop — don't fork it).
4. **★10 (ruled):** the member page gets the card editor's controls for post-history instructions, creator notes, likeness and voice (reuse the card editor's field components with an owner; P5 — derive, don't hand-build a second editor). The Backdrop picker can pick a card-less member's gallery pictures.
5. **★chr-read-1 (lead: accepted):** one writer keeps `lorebook_bindings.name` = the member's shown name at its book's present — `syncLorebookBindingsForCharacter` writes the as-read name for a member behind its card version; a dated Main cast version writes the new name back. Flip the two `test.fails` in `src/lib/server/cast/characterRows.storedNames.int.test.ts` to passing tests.
6. Docs: `docs/characters.md` (Copy to my characters), `docs/lorebook-cast.md` (member page controls, sprites, gallery), `docs/images.md` (portrait / sprite fill on a cast member).

## Files owned

`src/lib/server/sockets/characters.ts`, `src/lib/server/characters/versions.ts`, `src/lib/server/utils/characterBindingSync.ts`, `src/lib/server/cast/cardless.ts` (step 5 only), the sprite/portrait action files s4-cl listed (find them in its report), **in `src/lib/shared/sockets/types.ts` only the `Sockets.Characters` namespace** and in `src/lib/client/sockets/typedSocket.ts` only `characters:*` entries (lane s4-seat owns the rest of both), the member page + member sheet components and the card editor field components you reuse (find them; list them), the Sprites tab component (owner prop), the Backdrop picker, the docs above, tests next to all of these.

## Out of scope

Seating (seat), starters (st), the Characters view (chr-view), fold (bk-fold). NOMENCLATURE: queue rows.

## Stop and ask when

Common brief's Decisions apply; a reused component can't take an owner without a redesign; anything user-visible §34 doesn't word (button labels beyond **Copy to my characters**, refusal sentences — propose them as ★ with a recommendation, build the recommendation).

## Done means

Tests: copy from a card-less member, from a member with retold fields, from a member behind its card; face is a new file for the asker; stats copied as defaults; a non-reader refused; a guest on a seated member's sheet allowed; `repointCastVersionFiles` keeps the face after the card owner's delete; the four sprite/portrait events with `castMemberId` honour the edit rule; stored-names tests pass; DOM tests for the member page controls and Sprites tab with a member owner. tsc + check no new errors. Report `plans/REPORT-s4-cp-2026-11-08.md`.
