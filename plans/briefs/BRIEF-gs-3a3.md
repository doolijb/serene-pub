# BRIEF — build lane `gs-3a3` — the owner seats their own card for a guest, linked; only the card's owner changes its sheet; a seat moves between a person and the AI (owner rulings PS1, HM1, MV1 of 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then the block "Rulings page, third round, second answers" in
`plans/PLAN-programme-2026-11-15.md`, `plans/REPORT-gs-3a2-2026-11-17.md` (all of it: **Stop**, the S2 matrix,
"Scope review fix"), `plans/REPORT-gs-3b-2026-11-17.md` (shared cards copy card-less into the notes),
`plans/briefs/BRIEF-gs-3a2.md` (its cold review corrections: what a player seat and a character seat are in
stored terms; the layout rules), `docs/group-sessions.md`, `docs/sessions.md`, `STYLE-GUIDE.md`,
`NOMENCLATURE.md` §1, §24 and rows **seat**, **persona**, **seat handover · Played by**, **honour mode**,
**benched**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only; never `--write`, never pipe prettier's output into a file. **No migration.** Inside
`db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a3-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.
Comments state the rule, never the history. Views never toast. Workers one at a time (server, then the form).

## Owner (2026-11-17)

PS1 (the note rules over the option picked): "If the card owner is the session owner, seat the card as a cast
member, keep the card connected. There's no reason to make it cardless just because a guest is using it.
You're over thinking it."
HM1: "Session owner via their own card or cast in the lorebook. Granular permissions later to allow co-editin"
MV1: "Move the old seat's lines to the new seat, then remove the old seat."
Standing (same day): S1 "One persona seat group per user. The owner can seat anyone they want to whoever they
want as long as it's something they can see. The guest can seat to themselves when allowed, with cards they
are allowed."; S2 a guest's card is never handed to another person, "Guest cast members can still be moved to
the ai playable seats by the owner freely, even personas"; C1 a card that is **not** the session owner's
(shared) is copied card-less into the notes. Earlier: honour mode 2026-11-05 "Whose: cards the player owns +
their card-less seat"; a character seat's person is "The person who seated it" (2026-11-05); Bench is not
absence; a session keeps its lorebook.

## Lead's reading (each ★ in the report)

- **PS1.** The session's owner may put **their own card** into any person's Personas group; the card stays
  linked (the seat holds the card, the cast member stays connected to it). **Whoever holds the seat speaks as
  it**: the three readers that ask "who owns the card" for a player seat ask "who holds the seat" when the
  card's owner is the session's owner and the seat's person is someone else. A guest's own card in the
  guest's own seat is unchanged. A card owned by anyone else never takes this path (shared → the copy of
  lane `gs-3b`; a guest's card → only that guest).
- **HM1.** For a seat whose card belongs to the session's owner and whose person is a guest (a persona given
  under PS1, or an AI-played character handed over with **Played by**), **only the card's owner changes its
  sheet**, in play and outside it; the guest takes its turns and speaks as it. This reverses what lane
  `gs-3a2` left as built (the guest got `own` through `seaterOf`). A card-less seat a guest plays is still
  the guest's ("their card-less seat"). One function answers "may this person change this seat's sheet", so
  a later permission widens one place.
- **MV1.** The owner moves a seat between a person's Personas group and the AI-played group: a new seat of
  the other kind is made for the same card or card-less member, **the old seat's lines are re-pointed to
  it, and the old seat is removed** (not benched). Allowed for: the owner's own cards and card-less members
  in both directions; **a guest's seat, a persona included, toward the AI-played group** (S2); never a
  guest's card toward another person.

## Build

1. **Who speaks as a carded player seat.** Find every reader the `gs-3a2` Stop named and any other:
   `sockets/sessions.messages.ts:324` (`checkPersonaOwnership`), `shared/sessions/playerSeat.ts:45`
   (`isOwnPlayerSeat`), `state/resolve.ts:2477` (`personaOf`); grep for more (sending, editing own lines,
   turn "is it my turn", the composer's "speak as", widgets' viewer seat). One shared rule: the person of a
   player seat is `session_personas.user_id`. Where a reader used the card's owner as a stand-in for that,
   it reads the seat's person. A guest must not gain anything over the card itself (its editor, its library
   row, other sessions): list each reader, before → after, and what the guest can and cannot do.
2. **The owner adds a persona for someone** (server door + the form): in any person's Personas group the
   owner picks one of **their own cards** (the existing own-card picker), seated linked with that person as
   `user_id`; and a card-less cast member or a named seat for that person (the `gs-3a2` Stop: a card-less
   member as a player seat needs `seat_name`, `isCardlessPlayerSeat`; a named seat goes through
   `writeSeatName`, `sessions/seatName.ts`: reuse those writers; this lane owns the call, not a second
   writer). Other people's groups show when empty **for the owner** now that an add control exists; the
   genre rule for empty groups stays (`BRIEF-gs-3a2.md` corrections, item 4). `seatHandovers` already hands
   a card-less named player seat between people: extend it to a **carded persona whose card is the session
   owner's** (today refused: "‹name› is a persona with a card, so its seat stays with the card's owner.":
   that refusal stays for a guest's card).
3. **HM1: the sheet.** `state/handEdits.ts` (`seaterOf` 245–246, 444–450 and the honour-mode "whose"
   decision): a seat whose card belongs to someone other than its person is the **card owner's** to change;
   the seat's person keeps turns and speech. Card-less seats: unchanged. Put the decision in one named
   function; `canEditCastMember` (`cast/memberAccess.ts` 107–150) already asks the card's owner outside play:
   leave it, and say so. Tests for every combination (owner's card / guest's card / card-less × person is
   owner / guest × player seat / character seat × honour mode on / off).
4. **MV1: the cross-kind move.** One server operation, in one transaction, through the existing writers
   (`seatCast` / the player-seat writer, `handOverSeat`, and the step that re-points a removed participant's
   lines: `sessions:reassignRemovedParticipant`, `sockets/sessions.participants.ts:264`: find its core
   function and call it inside the transaction, do not go through the socket): create the new seat, re-point
   every reference the old seat has (message authorship, turn order position, bench state, seat refs
   `player-seat:<id>` ↔ `seated-member:<memberId>` in stored state: `seats.ts:1556` `reseatOnto` documents
   them; history days, scene cast rows, knowledge ties, presence facts: list every reference kind and how
   each moves), then remove the old seat. A second boot changes nothing. If any reference kind cannot be
   re-pointed without a migration, stop on MV1 and report exactly which. The form offers the move in
   **Played by** (the AI-played group as a choice on a persona row; a person as a choice on an AI-played row
   for the owner's cards and card-less members), with a confirmation built into the page saying what moves
   (★ words). After the move `removeGuest`, `castToTakeOf` and the take / hand-back rules of `gs-3a2` hold
   for the new seat (test).
5. **Docs and names:** `docs/group-sessions.md`, `docs/sessions.md`; NOMENCLATURE rows (seat handover ·
   Played by; the sheet rule's function; the move) and §25 quoting PS1, HM1, MV1 with the 2026-11-05
   rulings they refine.

## Tests

Server: the owner adds their own card as a persona for a guest → the guest sends as it, edits their own
lines, takes its turn; the guest cannot open or edit the card, and in another session the card is unchanged;
the owner's card handed back; a guest naming another person refused; a guest's card toward another person
refused. HM1 matrix. MV1: persona → AI and AI → persona for the owner's card and a card-less member, and a
guest's persona → AI: lines re-pointed (authors read the new seat), old seat gone, turn order and bench
state sane, a second run of the same move refused, nothing left pointing at the old seat (query each
reference kind). Client DOM: the owner's add control in another person's group; **Played by** offering the
cross-kind choices only where allowed; the confirmation. Existing `gs-3a2` / `gs-3b` tests stay green (list
any whose expectation changes because of HM1 or PS1, with the ruling). `tsc` 0; `npm run check` 0 errors in
lane files.

## Files owned

`sockets/sessions.update.ts` (seat doors), `sockets/sessions.participants.ts`, `sessions/seats.ts`,
`sessions/guestSeats.ts`, `sessions/seatName.ts` (calls only, unless the writer must accept a person: say
so), `sockets/sessions.messages.ts` (`checkPersonaOwnership` only), `shared/sessions/playerSeat.ts`,
`state/resolve.ts` (`personaOf` only), `state/handEdits.ts` (the "whose" decision), the seat components and
`EditSessionForm.svelte`, `shared/sockets/types.ts` (own fields), tests, the docs, NOMENCLATURE. Live lanes,
not yours: `dg-2` (`messages/debugMeta.ts`, the token-count and error paths of `sockets/sessions.messages.ts`,
`pipelines/runtime/liveRow.ts`, `utils/runReply.ts`, `utils/generationStatus.ts`), `wt-1a`
(`scenes/liveScenes.ts`, `utils/sceneCast*.ts`, `sockets/scenes.ts`), `ap-2a` (`plugins/providedMarks.ts`,
`sockets/lorebooks.ts`, `utils/ownedBook.ts`, `lorebooks/ownBook.ts`, `state/durable.ts`).

## Stop and ask when

CLAUDE.md §Decisions applies; a reader in step 1 would give the guest reach over the card outside this
session; a reference kind in MV1 needs a migration; a move would lose a line's author; the lane grows past
two workers' work (then cut: PS1 + HM1 first, MV1 second, and say so before starting MV1).

## Report

Final message = the report (lead saves `plans/REPORT-gs-3a3-<date>.md`), under about 700 words: the readers
(before → after); the add-for-someone door; the HM1 function and matrix; MV1's reference kinds and how each
moves; every new label and sentence as ★ with one alternative; tests changed; **Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

**The lane is cut. This brief builds `gs-3a3a`: PS1, and the part of HM1 both readings agree on. MV1 (the
cross-kind move) is `gs-3a3b` and waits for the owner (rulings page MV2: what happens to the kind of earlier
lines): build nothing of Build 4. The card-less half of HM1 waits for the owner too (HM2).**

1. **PS1: every reader that takes the card's owner to be the seat's person** (before → after in the report):
   - `sockets/sessions.messages.ts` ~326: the **call** of `checkPersonaOwnership` at the send door. Change
     this call site (the seat's person may send as it), **not** the shared function
     (`sockets/sessions.shared.ts:63`), which is also the gate at `sessions.participants.ts:88` (addPersona)
     and `:483` (reassign): those two keep checking card ownership, or a guest could add the owner's card as
     their own persona.
   - `pipelines/runtime/host.ts` 1495–1503 `personLineOf`: turns `player-seat:<id>` back into the card and
     checks `characters.userId === scope.userId`: the guest would still be refused at the save. Only this
     function in `host.ts`.
   - `pipelines/runtime/bindings.turnOrder.ts` 301–303: a turn entry's `ownerUserId` is `cp.persona.userId`
     ahead of the seat's person.
   - `shared/sessions/playerSeat.ts:45` `isOwnPlayerSeat`; `state/resolve.ts:2477` `personaOf`.
   - Client: `client/components/sessionPage/sessionPageData.svelte.ts` 603–605 (`userPersonasInSession`, the
     composer's speak-as list); `sessionPageProjections.ts:275` (`canControlMessageAs`);
     `projections/attendance.ts:56` (`personaOwnersOf`, Who's here).
   - Already by the seat, leave: `messages/permissions.ts` 79–98, `sockets/sessions.turns.ts` 328–332
     (`seatActorOf`), `seatName.ts:153`, `contentProcessors.ts:380`, `playerSeat.ts:129`.
   One rule everywhere: **the person of a player seat is `session_personas.user_id`**. The stored row for
   PS1 is `{persona_id: the owner's card, cast_member_id: its member, user_id: the guest}`
   (`seatPlayer({castMemberId})` already sets `persona_id` to the member's linked card, `seats.ts` ~944–955).
   Files owned gains: `host.ts` (`personLineOf` only), `bindings.turnOrder.ts` (those lines), the three client
   files; `sockets/sessions.shared.ts` is **not** changed.
2. **HM1, the half that is ruled:** a seat whose **card belongs to the session's owner** and whose person is
   a guest (a persona under PS1; an AI-played character handed over with **Played by**): only the card's
   owner changes its sheet; the guest speaks as it and takes its turns. This reverses, for that case, the
   player-seat rule at `state/handEdits.ts` 431–435 ("a live seat's character is its player's, whoever owns
   the card", scope review 2026-11-05) and what `gs-3a2` left as built through `seaterOf`: name both in
   NOMENCLATURE §25 with the owner's HM1 words. **Not changed here:** a card-less seat a guest plays (their
   own named seat, a card-less member they took or were handed, a shared-card copy) keeps today's rule; it is
   asked on the rulings page (HM2). One named function holds the decision.
3. **Build 2 stands** (the owner adds their own card, a card-less member or a named seat as a persona for a
   person; `seatHandovers` accepts a carded persona whose card is the session owner's), with the checks: only
   the session's owner; the person is the owner or a current guest who may play; the card is the session
   owner's (a guest's card and a shared card never take this path).
4. Tests drop the MV1 cases; add: the guest sends as the owner's card through the real save path
   (`offerMessage` → `personLineOf`), appears with it in the composer's speak-as list, gets its turn in turn
   order (`ownerUserId`), can edit and swipe their own lines; a guest cannot `addPersona` or `reassign` the
   owner's card to themselves (the shared gate still refuses).
5. Live lanes, not yours: `wt-1a` (`scenes/liveScenes.ts`, `utils/sceneCast*.ts`, `sockets/scenes.ts`),
   `ap-2a` (`plugins/providedMarks.ts`, `sockets/lorebooks.ts`, `utils/ownedBook.ts`, `lorebooks/ownBook.ts`,
   `state/durable.ts`). `sockets/sessions.messages.ts`: only the call at ~326.
6. **For `gs-3a3b` later (recorded, not built):** the tool for a cross-kind move is
   `rekeySessionRefs(tx, sessionId, translator)` (`sessions/seatKeys.ts:1632`; the 15 stores in
   `SEAT_KEY_STORES`, 70–86; the fold uses it with `memberMoveTranslator`, `lorebooks/foldInParent.ts`
   1315–1318) with a new seat ↔ member translator; scene cast, presence, knowledge ties and
   `messages.cast_member_id` are keyed by member and do not move; `unseat` benches a live seat and removal is
   a second step once `seatHasLines` is false; both seat tables are unique on (session, card) and keep removed
   rows, so moving back revives the old row; a guest's persona moved to the AI group keeps the guest as
   `seated_by`; a line's `role` / `user_id` / `persona_id` ↔ `character_id` would have to be rewritten
   (`messages/store.ts:537` `updateLegacyWhere`; 37 `role === "user"` readers).
