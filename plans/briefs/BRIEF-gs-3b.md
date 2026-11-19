# BRIEF — build lane `gs-3b` — a guest can play a card someone shared with them: it is copied into the session's lorebook, unlinked (owner ruling G3, last sentence)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then row D61 (G3) in `plans/DISCUSS-LATER.md`,
`plans/INVENTORY-seats-and-notes-access-2026-11-16.md` A3, A4, A7 (**re-verify every file:line**),
`plans/REPORT-gs-3a-2026-11-17.md` (the two switches, the freeze, `sessions:castToTake`),
`plans/REPORT-gs-2c-2026-11-17.md` (a guest has no access to the notes; a guest still manages the card they
brought: `canEditCastMember`), `docs/characters.md` (sharing), `docs/group-sessions.md`, `docs/lorebook-cast.md`,
`NOMENCLATURE.md` §1, §24 and rows **shared**, **cast member**, **card-less**, **seat**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree (no add,
reset, checkout, restore, stash, commit). `npx prettier --check` only, never `--write`. **No migration.** Inside
`db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3b-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.

## Owner

2026-11-16 (G3): "Guests can bring their own if enabled. … Guests can't choose directly from the owners card
list, but can choose from shared cards from other users, shared cards are copied into the lorebook unlinked."
2026-10-12 (Q3): a shared character is "read and copy, never use-as-cast"; "a shared character is copied before
it can join a session". The new sentence refines where the copy goes: into the session's lorebook as a member
with no card, not into the guest's own characters. Quote both in NOMENCLATURE §25.

## What exists (verify)

`character_shares` (`db/schema.ts` ~11858), set by a card's owner (`characters:share`). Shared cards follow the
recipient's own in `characters:list`, marked *From ‹owner›*; the session's card picker strips them
(`withoutShared`). The only copy today is `characters:duplicate` (into the asker's own characters). A card
becomes a lorebook cast member linked (`findOrInsertBinding`, `resolveSeatMember`, `sessions/seats.ts` ~384) or
card-less; `makeMemberCardless(tx, id, {cause})` (`cast/cardless.ts` ~72) copies words, sprites, gallery,
sheets and faces; the nearest precedent for "copied unlinked" is `makeCopyCardless`
(`lorebooks/starterKits.ts` 509–519: link, then make card-less with cause `starter`).
`verifyBindingTargetAccess` (`sockets/lorebooks.ts` 2324–2340) accepts a card shared with the caller and binds
it **linked**, against Q3.

## Build

1. **A guest's picker offers cards shared with them**, in their own group under the cards they own (★ group
   label, e.g. *Shared with you*), each marked *From ‹owner›* as the Characters list marks it; **never the
   session owner's own cards unless the owner shared them with this guest like anyone else**; only when the
   *bring their own* switch is on and the genre's shape has that seat kind. The session's owner gets the same
   group for cards shared with **them** (the rule is about shared cards, not about guests): say so and build it
   if the same door serves both; if it needs a second door, stop after the guest's and report.
2. **Choosing one makes a copy in the session's lorebook, unlinked, and seats the person on it**, in one
   transaction, through one server function owned by the cast module (name by §24, ★): the copy is a
   **card-less cast member of the session's notes** carrying the card's words, sheets, sprites, gallery and
   faces as `makeMemberCardless` copies them (reuse it: link then detach, as `makeCopyCardless` does, or a
   direct path if one is cleaner: say which), with a new cause (★ name, e.g. `shared`), no link back to the
   card and no `character_versions` tie to it; later edits to the original card do not reach the copy and
   edits in the session do not reach the card. The door is the existing seat door (`sessions:update` /
   `addPersona`: find which a card pick uses) with the shared card's id; the server decides it is a shared
   card (the caller does not own it and holds a share) and takes the copy path; a card neither owned nor
   shared is refused as today. The seat kind follows the picker it was chosen from (character seat or player
   seat), under the same checks as a guest's own card (the switch, the genre's opt-in on adds, the freeze).
3. **Who may then edit the copy.** It is a card-less member of the notes, which a guest cannot open
   (lane `gs-2c`). The person who plays it keeps exactly what a player of a card-less seat has today (their
   seat's sheet through `memberOfSeat` / `state:set`; say what that includes) and no more; art (sprites,
   portrait) of a card-less member is the session owner's unless the seat rule already gives the player more:
   report what a guest can and cannot change on the copy, and do not widen `canEditCastMember` for it.
4. **Close the linked path Q3 forbids:** `verifyBindingTargetAccess` must not let a shared card be bound
   **linked** as a cast member (by a guest or by the owner of a lorebook): a shared card enters a lorebook's
   cast only as an unlinked copy. If the lorebook workspace's "add a character to the cast" picker offers
   shared cards today, it takes the same copy path (reuse the function) and says so in one sentence (★);
   if it does not offer them, only the server check changes. Test with a forged request.
5. **What the original's owner sees:** nothing changes for them; the share stays read-and-copy; no
   notification (none exists for `characters:duplicate`: verify and follow).
6. **Removing the seat:** the copy stays in the lorebook's cast as any card-less member does when its seat is
   removed (find today's rule for a card-less member whose seat goes: keep it).
7. **Docs and names:** `docs/characters.md` (what sharing lets the other person do: read, copy, and play a copy
   in a session), `docs/group-sessions.md`, `docs/lorebook-cast.md` (a shared card enters the cast as an
   unlinked copy), `NOMENCLATURE.md` (the function, the cause, the group label; §25 with both rulings).

## Tests

Server: a guest seats a card shared with them → a card-less member exists in the notes with the card's words
and art, no link to the card, and the guest plays it; editing the original afterwards changes nothing in the
copy; a card neither owned nor shared is refused; the switch off and the genre opt-in refuse it like an own
card; the owner's seat doors unchanged; the forged linked binding of a shared card is refused; the picker
read carries no shared card the caller holds no share of. Client DOM: the group, the *From ‹owner›* mark, the
pick sends the card id. `tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`src/lib/server/sockets/sessions.update.ts` and `sessions.participants.ts` (the card-pick doors),
`sessions/seats.ts` (the copy path's call), `cast/` (the copy function), `sockets/lorebooks.ts`
(`verifyBindingTargetAccess` only), the seat pickers in `client/components/sessionForms/`
(`SessionCharacters.svelte`, `SessionPersonas.svelte` and the picker they use), `shared/sockets/types.ts` for
any new field, their tests, the docs.

## Stop and ask when

CLAUDE.md §Decisions applies; a migration is needed (e.g. the cause is an enum column); the copy cannot carry
art without the copier holding access to the original's media; a shared card's sheet uses a ruleset the
session does not run; the owner's own picker needs a second door.

## Report

Final message = the report (lead saves `plans/REPORT-gs-3b-<date>.md`): the picker group; the copy function
(what is copied, the cause, where it lands); who may edit the copy; the linked path closed; tests; labels and
names (★); **Noticed, not done**. Under about 600 words.

## Cold review corrections (2026-11-17) — these rule over the text above

**Not launched: waits on the owner for where the copy lands (rulings page C1 / D68): the session's notes, or
the lorebook under them.** Until ruled, do not build.

1. **A one-shot request, not the id-list door.** `characterIds` / `personaIds` in `sessions:update` compare
   the request against existing **carded** seats (`sockets/sessions.update.ts` 826–849, 1135–1190) and
   card-less seats are compared separately through `castMemberIds` (965–1009): a shared card id never matches a
   seat, so every later save would copy again, the copy would be unseated by line ~1006 in the same request,
   and `isGroup` would count it twice. The persona path also runs two steps keyed on the **card's owner** (the
   sharer): `givePlayerSeatACard` (`sessions/seatName.ts` 328–351) and `markCharacterAsPersona`
   (`sessions.update.ts` ~1189; `sessions.participants.ts` ~203, which writes `is_persona` onto the sharer's
   card), and passes no `userId` (~1183). Build a **one-shot request** that makes the copy and returns the new
   `castMemberId` (a new event, or one field on an existing one: ★ name); the client then holds a card-less
   seat like any other. The copy path branches **before** `checkCharactersOwnership`, `givePlayerSeatACard`
   and `markCharacterAsPersona`; a player seat sets `userId` to the caller. Files owned gain
   `EditSessionForm.svelte` (the save payload, ~1444–1446, ~1757) and `modals/PersonaSelectModal.svelte`
   (strips shared rows at ~75).
2. **Always a new member; never "link then detach".** `findOrInsertBinding` returns the card's **existing**
   member in the book (`utils/characterBindingSync.ts` 378–383; one member per card per book:
   `lorebook_bindings_character_unique`): if the sharer already has that card seated in this session,
   detaching would cut **their** member off their card. And `seatCast` with a `cardId` writes the shared card
   into `session_characters.character_id`: use-as-cast, against Q3. So: make a **new** card-less member by a
   direct copy path, seat it by `castMemberId` only, and name it inside the transaction (as `seats.ts` ~1519
   does). Test: the sharer's own card is already seated in the same session; both members exist afterwards and
   the sharer's stays linked.
3. **For guests only.** The owner's sentence is about guests; the session owner's pickers strip shared rows
   today (`EditSessionForm.svelte:1757`, `StartSessionForm.svelte:275`) and `docs/characters.md:324` says
   "they copy first": leave the owner's pickers as they are; the owner's group is a ★ in the report.
4. **The linked path, all four callers.** `verifyBindingTargetAccess` is called at `sockets/lorebooks.ts` 2407
   and 2647, `sockets/entries.ts:1037` (a summarize save) and `sockets/amendments.ts:933`; it lets a card
   through via `canViewCharacter`, which passes a share **and** a card seated in a session the caller is in
   (`utils/sessionAccess.ts` 69–118). The rule becomes: bind linked only a card the caller **owns**, or one
   they can see **through a session's seat**, never one seen through a share alone. Existing linked rows are
   re-checked only when `characterId` is sent again: nothing breaks after the fact, no boot pass. Files owned
   gain `entries.ts` and `amendments.ts` for that check; a forged-request test per caller. The lorebook
   workspace already strips shared cards (`CastWorkspace.svelte:1690`): only the server changes.
5. Copied files go to the lorebook's owner (`cast/cardless.ts` 93, 124); `characters:duplicate` sends no
   notification: none here either.

## Owner's answer (2026-11-17, C1) — rules over the text above

The copy of a shared card lands in **the session's notes** (not the lorebook under them). Launch after lane
`gs-3a2` (same form; its per-person seat groups are where the picker lives; the owner may also seat a card
shared with **them** for any person, by the same copy). Re-verify every file:line against `gs-3a2`'s report.

## Launch note (2026-11-17, after `gs-3a2` and its fix landed)

- Build the **guest's side only**: a guest, with *bring their own* on, picks a card someone shared with them;
  it is copied into **the session's notes** as a cast member without a card (C1) and the guest is seated as
  it, in their own group of the Personas card (or as the seat kind this brief's corrections settled: re-read
  them against `plans/REPORT-gs-3a2-2026-11-17.md`, incl. its "Scope review fix" section and its **Stop**:
  a card-less member as a player seat is "nobody" without `seat_name`, `isCardlessPlayerSeat`; a named seat
  for someone goes through `writeSeatName`, `sessions/seatName.ts`).
- **The owner seating a card for someone else** (their own card or one shared with them) is **not built**: it
  waits for the owner (rulings page PS1). The owner seating a shared card **for themselves** follows the same
  copy path as a guest if this brief's corrections already cover it; otherwise leave it and report.
- `seatHandovers`, `handOverSeat`, `writeSeatHandovers`, `castToTakeOf`, the per-person groups and **Played
  by** exist now: reuse, do not duplicate. A removed guest's seats return to the owner (`removeGuest`): say
  what happens to a copied shared card's member when its guest is removed (it is a card-less member in the
  notes: it should follow the same rule; test it).
- Never run prettier with `--write` or pipe its output into a file.
