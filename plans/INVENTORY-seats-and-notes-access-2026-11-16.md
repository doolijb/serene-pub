# INVENTORY — seats (G3, G4) and the notes' access (G2) (D61; read-only, 2026-11-16)

Paths under `src/lib/server/` unless `client/` (`src/lib/client/`) or `sdk:` (`../serene-pub-sdk/`). Builds on
`INVENTORY-guest-and-member-surfaces-2026-11-16.md` §3 (cast verbs, not repeated). Re-verify every file:line.
**In flight:** `EditSessionForm.svelte` (lines already moved ~11 during this read), `sessions.pipelines.ts`,
`sessions.messages.ts`, `sockets/pipelines.ts`, story-time reads (`lorebookStoryTime.ts` rows below).

## Part A — seats

**Short answer:** every seat door stamps the caller as the one who plays it; the owner **cannot** seat a card
for a guest. **Shares exist** (read and copy), and the only copy lands in the recipient's own characters. No
one-call "card → card-less member" exists (the starter copy is the precedent). Genres opt in through
`SessionShape.characters/personas`: the server checks it at create, the client on edit. Both switches fit
`sessions.metadata`, no migration.

### A1. The seat model (`db/schema.ts`)

| Row | Points at | Who plays it |
|---|---|---|
| **character seat** `session_characters` 4130–4231 | `character_id` (card, nullable), `cast_member_id` (member; card-less when `character_id` null), `envoy_slug` (one of card/envoy, CHECK) | `seated_by_user_id` (written only by `sessions/seats.ts`) |
| **player seat** `session_personas` 3993–4070 | `persona_id` (card), `cast_member_id`, `seat_name` (card-less seat) | `user_id`, **null on older rows → the card's owner** |
| `session_guests` 4234–4250 | `is_player` (default true) | Read only by `writeSeatName` (`sessions/seatName.ts` 225–238) and hand edits; **cast adds ignore it** |

Acting rights: `seatActorOf` (`sessions/seats.ts` 2100–2124): the seater or player, else the owner of the member's
active card. Bench: `is_active` on both tables, one writer `setSeatBench` (1764); `unseat` (1658) benches a live
seat; `removeGuest` benches the guest's player seats (`sockets/sessions.ts` 1382–1450).

### A2. Every seat door

| Door | Who | Check | "Plays" stamped |
|---|---|---|---|
| `sessions:update characterIds` (`sessions.update.ts` 651–790) | owner, guest | add: own cards only (673–685); remove: owner or card owner (697–720) | `seatCast` with `seatedBy: userId` |
| `sessions:update castMemberIds` (797–860) | owner, guest | **none on add**; remove: owner or seater (841) | `seatedBy: userId` (831) |
| `sessions:update personaIds` (880–1028) | owner, guest | add: own personas only (899–910); remove: owner or card owner | `seatPlayer` with **no `userId`** (1013) |
| `sessions:update seatName` (1030–) → `writeSeatName` (`seatName.ts` 101–250) | owner any seat's name; guest own; watchers refused | opens a card-less player seat for the caller (`seatNamed` 62, `mintCardless`) | caller |
| `sessions:addPersona` (`sessions.participants.ts` 50–200) | owner, guest | own persona (66–75) | none / card owner |
| `sessions:reassignRemovedParticipant` (230–470) | owner, or the removed card's owner | new card must be the caller's | re-points to the caller's card |
| `sessions:setCastSeatEnabled` (528–700) | owner, card owner or seater | — | — |
| `sessions:setEnvoySeat` (`sessions.ts` 1864) | owner only | — | envoy |
| create / import / branch (`sessions.create.ts` 914, `import.ts` 1369/1530, `sessions/branch.ts` 325) | creator | `bookCastToSeat` skips ownership for castFromLorebook (`sessions/seatBookCast.ts`) | — |

**Owner seats for a guest: impossible today.** `seatCast` takes `seatedBy` and `seatPlayer` takes `userId`
(`seats.ts` 512–540, 893–910), but every door passes the caller or nothing. Client: picker rows come from the
caller's own `characters:list` minus shared rows (`withoutShared`, `EditSessionForm.svelte` 1674); a carded book
member "travels as its card id" (`CharacterSelectModal.svelte` 75–77) and is then refused a guest who doesn't own it.

### A3. Card sharing today

- `character_shares` (`db/schema.ts` 11858), set by the owner (`characters:share`, `sockets/characters.ts` 573–610).
  Ruled **2026-10-12 Q3**: "read and copy, never use-as-cast".
- Seen: shared cards follow the recipient's own in `characters:list`, marked *From ‹owner›* (`characters.ts`
  356–385). `canViewCharacter` (`utils/sessionAccess.ts` 69–118): shared, or seated in a session the asker is in.
- Copy: `characters:duplicate` (`characters.ts` 2947–3078), a card of the asker's with no link back.
- **Visibility tab** = `sessions:accountVisibility` (`sessions.participants.ts` 732): the caller's own cards that the
  seats expose. No library, no public flag.

### A4. Card → lorebook cast member

- Linked: `findOrInsertBinding` (`utils/characterBindingSync.ts` 369), reached via `resolveSeatMember`
  (`seats.ts` 384) and `lorebooks:createBinding` (`sockets/lorebooks.ts` 2394; target check
  `verifyBindingTargetAccess` 2324–2340 **accepts a card shared with the caller**).
- Card-less: `insertBackgroundBinding` (2348, empty member); `makeMemberCardless(tx, id, {cause})` (`cast/cardless.ts`
  72), which copies words, sprites, gallery, sheets (`characters/dowry.ts` `copyCardStatsToMember`) and faces through
  `fileForOwner`. Unlink = `writeMemberEdit {unlink}` (`lorebooks.ts` 1759, 2850–2866) then cause `unlink`.
- **Nearest precedent for "copied unlinked":** `makeCopyCardless` (`lorebooks/starterKits.ts` 509–519): link, then
  `makeMemberCardless(…, "starter")`, which detaches every version. No one-call card → card-less member exists.

### A5. Genre opt-in

`SessionShape.characters {min,max,hint}` / `personas {min,max,preselectDefault}` (`sdk:sdk/src/descriptors.ts`
996–1024; absent or `max: 0` for personas: "the user is prose"); `members: 'solo'|'group'` (`sdk:sdk/src/genres.ts` 235);
`playerLabel` (339); envoys (603–). Server: create only (`shapeViolations`, `sessions.create.ts` 308–362);
**`sessions:update` checks no shape**. Client: `showCharactersSection` / `showPersonasSection`
(`EditSessionForm.svelte` 324–331), caps 1889–1899, start form `createSession.svelte.ts` 141–155.

### A6. Where two switches live

`sessions.metadata` (`db/schema.ts` 2648, core keys `playerLabel`, `scenes`): one key each, its own `jsonb_set`
writer like `writePlayerLabel` (`sessions/playerLabel.ts`), a shared key constant and read helper
(`shared/sessions/playerLabel.ts` 17); key absent = on, so existing sessions are on with no boot pass.
`sessions:update` already drops a non-owner's session fields (137). The pipeline run needs neither; only the doors do.
**"Off freezes" means a non-owner refusal in:** the three `sessions:update` diffs (add **and** remove),
`seatName` opening a seat, `addPersona`, `reassignRemovedParticipant`, `setCastSeatEnabled`.
`SessionSettingsV1` is derived per run and stores nothing.

### A7. Open questions (cheap options)

1. **"The session's / lorebook's cast members"**: card-less only (today's picker), or carded members too?
   ★ card-less only; carded members carry the owner's cards ("can't choose from the owner's card list").
2. **Attached book:** a guest can't list its members today (`buildLorebookBindingList` → `assertReadableBook`,
   `lorebooks.ts` 2003–2011). Only notes-only sessions let a guest grab, and G2 closes those. A
   session-scoped cast list is needed (a new event under `checkSessionAccess`, or a field on `sessions:get`).
3. **Watchers** (`is_player` false): ★ both switches apply to players; refuse watchers in every add door, as `seatName` does.
4. **What freezes:** adds only, or removals, bench and renames too? Does the owner still change guests' seats? ★ all
   guest seat verbs; the owner keeps every verb.
5. **Owner assigns:** player seat with `user_id` = guest, or character seat with `seated_by` = guest? Both writers
   take it; UI "Who plays this" on the seat row (★ needs a name).
6. **Shared-card copy:** into which book (owner's attached book or the notes; a guest writes neither after G2, so
   the server copies on their behalf)? Dated or undated (undated-default ruling)? Who owns the copied files (the book owner)?
7. **A guest's card deleted:** today the member goes card-less (`cast/deletedCardMembers.ts` 79) and the seat stays
   with `seated_by`. An old player seat with `user_id` null loses its actor. ★ keep; backfill `user_id` at seat time.
8. **Two rulings to reconcile (ask, quote both):** 2026-10-12 Q3 "a shared character is copied before it can join a
   session" (to the recipient's characters) vs 2026-11-16 "shared cards are copied into the lorebook unlinked".

### A8. Tests pinning today

`sockets/sessions.participantRemoval.int.test.ts` :108, :137, :167, :278, :300, :369 ·
`sessions.seatEvents.int.test.ts` :252, :316, :531 · `sessions.benchedSeats.int.test.ts` :289, :530 ·
`sessions.seatCast.int.test.ts` :727 · `sessions/seatName.mint.int.test.ts` :71 · `sockets/shares.int.test.ts` :60 ·
`client/…/editSessionCastMembers.dom.test.svelte.ts` :232 · `editSessionPlayerSeats.dom.test.svelte.ts` :153.
No test pins the "only cards you own" refusals.

## Part B — the notes' access (G2)

**Short answer:** 72 direct calls in 15 socket files, plus `sockets/entryKnowledge.ts` (via
`lorebooks/entryKnowledge.ts`, 6) and 10 outside sockets; helpers fan out to ~111. Roughly **47 W, 22 R-workspace,
4 R-play**. Pipeline writes pass the **session owner's** id (`host.loreWrites.ts` 1048, 1103; `scenes.ts` 3010),
so G2 does not touch runs. The one R-play read that breaks is **seat choosing** (`lorebooks:bindingList`).
`lorebooks:memberOfSeat`, media and member reads already fall back to "a session that seats it". The session page
asks the notes' cast only for the owner (`sessionPageInbox.svelte.ts` 188–194).

| File | Events (calls) | Class |
|---|---|---|
| `amendments.ts` | `list` (`buildAmendmentsList`, relisted by 12 writes) | R-ws |
| | `create`, `update` (+`entries:restoreRedline`), `delete`, `fork`, `renameBranch`, `deleteBranch`, `moveDownTheTree`, `place`, `unplace` (9) | W |
| `entries.ts` | `types`, `counts`, `recentDecisions`, `earmark` (4) | R-ws |
| | `list` (`buildEntriesList`; also the composer's Lore pane, `pageAsks.ts` 368–383) | **R ambiguous** |
| | `copyFromLibrary`, `create`, `updatePositions`, `lorebooks:settleImprint` (4) | W |
| `lorebooks.ts` | `get`, `library`, `listMemberFaces`, `duplicate` (4) | R-ws |
| | `bindingList` (`buildLorebookBindingList` 2011; 3 askers) | **R-play** |
| | `memberOfSeat` (2249) | R-play, **no change**: a guest already gets the sheet (`opensInBook` false) |
| | `share`, `update` ×2, `createBinding`, `updateBinding`, `updateMemberToCardVersion`, `uploadMemberFace`, `resolveOrCreateBindingByName`, `importResolve` (9) | W |
| `lorebookStoryTime.ts` (in flight) | `storyTime` (R-ws), `lines` (**R ambiguous**, Lore pane), `checkCalendar`, `setCalendar`, `setClock` (W) | |
| `lorebookState.ts` | `get` R-ws · `set` W (one helper `scoped` 63) | |
| `narrativeGraph*.ts` | `list`, `checkNodeMergeReferences`, `listMergeLogs`, `duplicateCandidates` (4) | R-ws |
| | `deleteNode`, `dismissDuplicate`, relationships ×5, merge ×2, `build`, `applyProposal` (11) | W |
| `redlines.ts` | `entries:redlines`, `entries:redlineCount`, `characterVersions:redlines` (3) | R-ws |
| | `entries:restoreRedline`, `entries:clearRedlines`, `characterVersions:restoreRedline` / `clearRedlines` (4) | W |
| `scenes.ts` | `listByLorebook` | R-ws |
| | `create`, `update`, `delete`, `process` (2 calls) | W (`startRoutineSceneSummary` uses the owner: n/a) |
| `entryKnowledge.ts` | `list` R-ws · `setCommonKnowledge`, `setTie` W | |
| `bindingSuggestions.ts` | `list` R-ws (its mutators already join on `lorebooks.user_id`: guests refused) | |
| `starterKits.ts` | `saveFromBook` | R-ws (copy out) |
| `sessions.shared.ts` | `runLorebookBindingCheck` 1455 owner (n/a); 1475 relist to the caller | R-play push, harmless |
| `sessions.create.ts`, `checkLorebookOwnership` | creator's attach | n/a |
| `media/access.ts` 144 | `canViewMedia` | R-play; falls back to seated members (153–), so seated faces keep working; unseated notes members' pictures close |
| `cast/memberAccess.ts` 60 | `canReadCastMember` (portrait, sprites, duplicate) | R-play; seated fallback (66–86) |
| `auth/actingPerson.ts` 142 | `personMay` lorebook read/write | **ambiguous**: applet doors acting as a guest (`appletSessions.ts` 77, `appletLibrary.ts` 329) |
| `conversations/gate.ts` 110, `store.ts` 1412 | attaching or reading the notes in a private conversation | R-ws |
| `seatBookCast.ts` 72, `creationModes.ts` 72, `foldInParent.ts` 1712 | create / attached book | n/a |

**If closed for guests, the guest's session page loses:** card-less members of the notes in **Add a character**
(G4 cannot be met in a notes-only session, see A7.2); pictures of unseated notes members; the composer Lore pane's
history list and lines, if a guest sees that pane (unverified). A guest's own sheet edits are unaffected:
`state:set` uses its own session check (`sockets/state.ts` 146).

**Pinned:** `entries.earmark.int.test.ts` :361 (guest answers on the notes) · `lorebooks.memberOfSeat.int.test.ts` :231,
:242 · `lorebooks/ownBook.int.test.ts` :388 · `state/worldScope.int.test.ts` :516 ·
`client/…/editSessionGuestOwnNotesReading.dom.test.svelte.ts` :173 · `cast/memberAccess.int.test.ts` :95 ·
`media/access.cardCascade.int.test.ts` :172.

**Noticed, not done:** `castMemberIds` lets a guest seat a **carded** member of any of the session's books (no
ownership check; only the client offers card-less). `verifyBindingTargetAccess` binds a shared card **linked**,
against Q3's "never use-as-cast".
