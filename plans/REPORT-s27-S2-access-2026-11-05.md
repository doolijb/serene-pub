# REPORT s27-S2-access (2026-11-05)

Status: **BUILT.** Two Sonnet workers did the typing:
- w1 handled access and the `sockets/sessions.ts` hunks.
- w2 handled branch, import and next chapter.

Their briefs are `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-access-w1.md` and `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-access-w2.md`. I checked both reports against their briefs and read every hunk. I re-ran the whole lane set together, and a scope-reviewer raised no objection on scope (four low notes, below).

No migration, no SDK edit, no `sdk:build`, no new exported name (so no NOMENCLATURE §25 row), no new setting, flag or event. No commit, no stash, no existing test edited.

Relayed status question: none received.

## What switched (file → reader)
- **`utils/sessionAccess.ts` `canViewCharacter`.** A card can be viewed when a seat holds it (as before), **or** when a seat (character or player, in any state, as before) seats a cast member linked to that card (`cast_member_id` → `lorebook_bindings.character_id`). Both new reads go through `handle`, and the JSDoc now says so. `auth/actingPerson.ts` needed no edit: it calls this with `db`.
- **`conversations/store.ts`, person tab.** The prefilter gets a fourth arm (seats' members' linked cards), so it stays a superset of `canViewCharacter`.
- **`media/access.ts` `canViewMedia`.** A new block: the people of a session whose seat seats a member wearing this file as `face_media_id` may see it, wherever that member lives. It sits after the books block and before the account-avatar block, and the `private` early return still comes first.
  - w1 found that a member in the session's own book was already reachable through the books block. The test therefore puts the member in a book the session neither attaches nor owns, and a control shows the grant goes away once the seat is gone.
- **`sessions/backdrop.ts` `inCast`.** "Is this card seated" becomes "is this card seated, or is a member linked to it seated".
- **`sockets/sessions.ts`:**
  - **`sessions:update` character-seat removal (~6475–6520).** `removedName` is now the member as read: the seats about to leave go through one `seatCardsAsRead` call, read over each seat's own card. Who may remove, the where clause, positions and the emitted refs are unchanged. The player-seat `removedName` is unchanged (★pT-1).
  - **Reassign (~7615–7720).** The seat write now comes before the re-point in the same transaction, and the re-pointed lines carry `castMemberId`:
    - character: `seatOf(tx, sessionId, 'character:<newId>')?.castMemberId ?? null`
    - persona: the `castMemberId` that `seatPlayer` returns, because the speaker is that player seat.
    - Only `tx` is used, and the refusal still rolls back and answers in words.
  - **`sessionsAccountVisibilityHandler` (~10970–11060).** This handler is the inverse of `canViewCharacter`, so it keeps matching it. Each list is the old held-card query, then the caller's cards linked through a seat's member, deduped by id. Names are still the card's.
  - The `seatOf` import (~71).
- **`sockets/import.ts` `insertImportedHistory`.**
  - A character line carries `castMemberId` from `seatOf(tx, sessionId, 'character:<card>')`, read once per distinct card with `tx`. It runs after `settleSeats` at both call sites; order confirmed, call sites unchanged.
  - User lines stay null, because the import knows no person's seat for them.
- **`sessions/branch.ts`.** After `settleSeats`, the copied lines are stamped with the branch seat's member, once per speaker card, using `tx` and `seatOf`. A null member is skipped. Card-less player-seat lines and narration are left alone.
  - The block is needed because the copies are inserted before `settleSeats`, when the store's own stamp sees seats with no member yet. w2 checked that the tests fail without it.
- **`sessions/creationModes.ts` `seedNextChapter` step 2.** A `session_cast` value now carries to the new session's seat holding the **same seat member** (`CastMemberLink.seatMemberId`), even when that seat holds another card. Today's same-card match stays as the fallback, since two sessions' own books hold different members. Keys are unchanged: it carries from `session_cast:<oldCard>` to `session_cast:<newCard>`.

## Checked, still reads the card (and why)
- **The create handler (~673–1624):** its reads are the card ownership checks for request card ids. Cards seed cast, and the seat writes are S1's. `checkCharacterOwnership` / `checkPersonaOwnership` (~168–235) stay as they are.
- **The typing persona name (~630–640):** it is a player seat's name, which waits on ★pT-1.
- **`setCastSeatEnabled`:** it takes a card id and checks the seat's card owner, which is the same owner as the active card under `overCards`. Its emitted ref stays `character:`.
- **Envoys (~10542):** envoy seats have no member.
- **`sessionAdmin.ts` ~1308:** it only counts seats and reads no identity.
- **`seatBookCast.ts` ~80–86:** it already skips by member (S1).
- **`creationModes.ts` step 1:** it matches by card owner, which is the same owner for the seat's own card.
- **Branch seat copy and `ownerIdFor`:**
  - Seats are re-resolved from their card inside the branch's book (`deferMember`, then `settleSeats`). For a member in the attached book, that is the same member; a test proves it.
  - `ownerIdFor` keeps `session_cast` ids as card ids, because keys stay.

## Changed files
- Edited, in the named hunks only:
  - `/home/jody/github/serene-pub/src/lib/server/utils/sessionAccess.ts`
  - `/home/jody/github/serene-pub/src/lib/server/conversations/store.ts`
  - `/home/jody/github/serene-pub/src/lib/server/media/access.ts`
  - `/home/jody/github/serene-pub/src/lib/server/sessions/backdrop.ts`
  - `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.ts`
  - `/home/jody/github/serene-pub/src/lib/server/sessions/branch.ts`
  - `/home/jody/github/serene-pub/src/lib/server/sockets/import.ts`
  - `/home/jody/github/serene-pub/src/lib/server/sessions/creationModes.ts`
- New:
  - `/home/jody/github/serene-pub/src/lib/server/utils/sessionAccess.seatMember.int.test.ts` (5 tests)
  - `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.seatMemberEdits.int.test.ts` (3)
  - `/home/jody/github/serene-pub/src/lib/server/sessions/branch.seatMembers.int.test.ts` (2)
  - `/home/jody/github/serene-pub/src/lib/server/sockets/import.seatMembers.int.test.ts` (2)
  - `/home/jody/github/serene-pub/src/lib/server/sessions/creationModes.seatMember.int.test.ts` (3)
- Prettier was run only on the new files, and they pass `--check`. Existing files were hand-edited and never reformatted.

## Tests
- **My grouped run: 31 files, 437 tests, all passing.**
  - The first pass ran 31 files together. 28 passed; 3 failed only on a 60 s `beforeAll` hook timeout under the shared load: `seatSites.int`, `branch.seatMembers.int` and `import.seatMembers.int`. Re-run alone, they gave 3 files and 12/12.
  - The set covered the 5 new files plus these, unchanged: `sessions.accountVisibility.int`, `sessions.participantRemoval.int`, `sessions.seatCast.int`, `backdrop.int`, `media/media.int`, `sockets/media.int`, `conversations/store.int`, `conversations/gate`, `actingPerson.int`, `sessions.interestGate`, `sessions.characterOwnershipToggleVisibility.int`, `shares.int`, `seatSites.int`, `branch.{state,clock,revision}.int`, `sessions.creationModes.int`, `import.sillyTavern{Tree,Finish,Caps}.int`, `import.mapperParity.int`, `imports.hardening.int`, `ownBook.int`, `sessions.castBindings.int`, `sessions.castFromLorebook.int`, `lorebooks/retold.int`.
- **The new tests prove:**
  - A guest sees a seated member's linked card B (the seat holds A); a stranger does not; a player seat's member counts too.
  - A seated member's own face can be viewed, and another book's member's face cannot.
  - The backdrop accepts B's image.
  - The person tab lists B.
  - `removed_name` is the member's own name ("Captain Maren"), or the card's nickname when the member has none.
  - Reassigned lines carry the new seat's member, for both a character and a persona.
  - Account visibility lists B once.
  - A branch keeps its seats' members (two character seats and a persona seat), and its copied lines carry them; narration stays null.
  - Two seats on one member: each copied line carries its own seat's member.
  - Imported solo and group character lines carry their seat's member; user lines are null.
  - The next chapter carries by member across a card change, keeps the card fallback, and carries nothing when neither matches.
- **Changes to existing tests from the intended change:** none. No existing test in this lane covers an own-book member's name or face.
- **`npx tsc --noEmit -p .`:** nothing in lane files. The only matches the grep produced were 4 TS7053 errors in `src/lib/server/pipelines/runtime/turnSeats.seatMembers.int.test.ts:235–243`, which belongs to another lane (s27-S2-turns).
- **`/tmp`:** my named dirs were released. One unnamed dir, `/tmp/serene-pub-vitest-pqtUXo`, appeared during my run (possibly left by a hook timeout, possibly another lane's). I did not delete it.

## Not done, and why
- **"A `seated-member:` ref in update/reassign resolves" (lane item 6).** Neither handler takes a ref: `sessions:update` takes `characterIds` / `personaIds` as card numbers, and reassign takes `type`, `oldId` and `newId`. Accepting a ref would need a new param name on the socket types. ★ below; not built.
- **The persona message stamp (~7890).** This handler writes no row. It passes `speaker` to `offerMessage`, and the save outlet writes the row (`pipelines/runtime/host.ts` ~7439–7670, or `attachments/send.ts` ~142). The turns lane's message store now stamps the speaker on insert (`withSpeakerStamp` / `speakerRefOfValues` in `messages/store.ts`), so this line is covered there. Nothing to do in this hunk.

## Open ★ for the lead
1. **★acc-1 (scope review, finding 1) — the access widening reaches more than viewing.** `canViewCharacter` also gates:
   - `characters:duplicate` (`sockets/characters.ts:2242`), so the user can *copy* the card
   - the gallery (`characters.ts:1880`)
   - card details (`characters.ts:304`)
   - `sockets/sprites.ts:55`
   - `conversations/gate.ts:107`
   - media (`media/access.ts:63`)

   So a session's guest can now read **and duplicate** card B, the linked card of a seated member that the session never seated directly. Today's data only differs when a seat holds a card other than its member's linked card (a dated card).
   - Rec: keep it. It is the brief's "access seat→member→card", and "Copy to my characters" is where S4 goes.
   - Trade-off: copying is wider than "view".
2. **★acc-2 — which seat a persona line's member comes from.**
   - Reassign stamps a persona line with the **player seat's** member (what `seatPlayer` returns).
   - The store's automatic stamp, and my branch block (`coalesce(personaId, characterId)` then `seatOf('character:<card>')`), resolve through `seatOf`, which prefers a **character** seat on the same card.
   - Both give the same member for today's data, because one card is one member per book.
   - Rec: one rule, the store's. Drop the explicit persona stamp in reassign and the explicit import stamp, and leave them to the store. Or keep them, and the store keeps a caller-supplied value. Lead's pick.
3. **★acc-3 — refs on update/reassign.** Rec: no new param in S2. Refs on these sockets come with S3's names.
4. **Branch speaker order (scope review, finding 2).** w2 matched copied rows by `coalesce(personaId, characterId)`, persona first, where w2's brief said "persona only when `characterId` is null". It is the store's own speaker rule (`speakerRefOfValues`) and differs only on a row with both ids set. I accepted it; overrule if wanted.

## Behaviour changes, named
- The access widening (★acc-1).
- `removed_name` from the member as read: a member's own name becomes the departed seat's kept name.
- The next chapter carries across a card change when the seat member is the same.
- Message stamps on import, branch and reassign: data only, nothing a user sees yet.

## What S4 must do for own-book members in a branch (lane item 3)
`copyOwnBookToBranch` (`lorebooks/ownBook.ts` ~620–712) copies entries only. It sets `anchorBindingId: null` (~702) and inserts no `lorebook_bindings` rows. So a seat whose member lives in the source's own book gets no member in the branch: `settleSeats` only finds (★S1-3), and the copied lines' stamp is null. S4 must:
- **Copy or mint into the branch's own book:**
  - every source own-book `lorebook_bindings` row that a source seat, or a copied line's `cast_member_id`, points at;
  - its dependents: `cast_presences` (by `lorebook_binding_id`) and the member-keyed overlays and relationships;
  - the book's `next_binding_number` (cast tags are unique per book).
- **Remap old member id → new member id** in:
  - `session_characters.cast_member_id` and `session_personas.cast_member_id`: feed the map to `settleSeats`, or write it directly;
  - the copied lines' `session_messages.cast_member_id` and `messages.cast_member_id`: the new stamp block in `branch.ts` ~419–446 is where it goes;
  - `lorebook_bindings.overlay_of` on the copies: keep the attached-book target;
  - `attribute_values` / configs / carries with `cast_member` (or other member-keyed) owners. `copyStateRows` copies these with `ownerIdFor`'s final `return id` (~617), which leaves the source's own-book member ids stale;
  - `sprite_sets.cast_member_id`;
  - the `cast_member` reads in `state/durable.ts` ~307–349.

## Noticed, not done
- `seatSites.int.test.ts` still says "a session with no book" in its header (~8–9) and in a branch test name. This joins the S4 wording sweep.
- `canViewMedia`'s older branches call `checkSessionAccess` without `db`. They were left alone; the new block passes `db`.
- Cast amendments' dated cards other than a seat's own card are not made viewable by `canViewCharacter` or `inCast`. Only the member's **linked** card is.
- **S4 rekey items met:**
  - `session_cast` keys in the next-chapter carry and in branch `ownerIdFor`;
  - the `cast-changed` / member-event refs emitted by `sessions:update` and `setCastSeatEnabled` (`character:<cardId>`);
  - reassign still deletes the old seat row, so a `merged_into` that points at it becomes null (already noted in S1's report).

## Lead dispositions (2026-11-05)
- ★acc-1 viewing (and so duplicating, gallery, details, sprites, media) widened to a seated member's **linked** card → **kept** (the brief's "access seat→member→card"; today's data differs only for a seat holding a dated card; Copy to my characters is S4). Listed for the owner's S2 summary.
- ★acc-2 one stamp rule → **kept as built**: the store's stamp is the rule; the explicit stamps in reassign, import and branch agree with it for today's data (one card, one member per book) and the store keeps a caller's value. S4's backfill uses the same `seatOf` rule. A persona line resolving through `character:<personaId>` (prefers a character seat on the same card) → noted for S4 with `player_seat:` keys.
- ★acc-3 no new ref param on `sessions:update` / reassign in S2 → agreed; S3.
- Branch speaker order `coalesce(personaId, characterId)` → accepted (the store's own rule).
- The own-book-members-in-a-branch list → S4 (copied into the plan).
- Lead's `tsc` after wave 2's server lanes: only the old `arrangeCanvas.dom` error.
