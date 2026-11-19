# BRIEF — build lane `gs-3a2` — seats grouped by person; the owner seats for anyone; a guest takes a seated card-less member (owner rulings S1, S2, S3, S4 of 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then the block "Rulings page, third round, first answers" in
`plans/PLAN-programme-2026-11-15.md`, `plans/briefs/BRIEF-gs-3.md` (item 3 and its cold review corrections: the
lane this one finishes), `plans/REPORT-gs-3a-2026-11-17.md` (the two switches, the freeze, `sessions:castToTake`,
`writeGuestSeatSwitches`), `plans/REPORT-gs-2b-*.md` and `REPORT-gs-2c-*.md` (what a guest sees in
**Participants**; `isSessionOwner`; `canEditCastMember`), `plans/REPORT-walk-2026-11-17.md` D4 and D8,
`plans/INVENTORY-seats-and-notes-access-2026-11-16.md` Part A (**re-verify every file:line**),
`docs/group-sessions.md`, `docs/sessions.md` (participants), `docs/characters.md`, `STYLE-GUIDE.md` (settings
rows; absent, never disabled; Listbox select pattern; container-query rules: the form must work at 400 px),
`NOMENCLATURE.md` §1, §24 and rows **seat**, **persona**, **cast member**, **card-less**, **guest**,
**session owner**, **benched**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only, never `--write`. **No migration** unless the Stop rule below fires. Inside `db.transaction` only
`tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a2-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.
Comments state the rule, never the history. Views never toast. Two workers at most, **one at a time** when
they share `EditSessionForm.svelte` (server first, then the form).

## Owner (2026-11-17)

S1: "Let's reshape the persona seats (UI). One persona seat group per user. The owner can seat anyone they
want to whoever they want as long as it's something they can see. The guest can seat to themselves when
allowed, with cards they are allowed."
S2: "No: the owner re-assigns only seats holding their own cards or card-less cast members" + "Guest cast
members can still be moved to the ai playable seats by the owner freely, even personas".
S3: say nothing beside a seat no person plays.
S4: "Make it a session permission when guests are invited, exist in the session. Hide otherwise like the rest."
Earlier, still standing: G3 (2026-11-16) "Owners can also assign cast/cards they own to the guests. Guests can
bring their own if enabled. Guests can grab the sessions/lorebooks cast members if also enabled. So two
settings, both on by default. The genre still has to opt in to characters/personas … Guests can't choose
directly from the owners card list"; G4 "any guest may take a card-less cast member's seat"; 2026-11-05 a
character seat's person is "The person who seated it"; Bench is not absence; members never see model plumbing.

## Lead's reading (each ★ in the report)

- **Persona seats are grouped by person.** The participants area shows one group per person in the session
  (the owner, each guest), holding the persona (player) seats that person plays; then the AI-played seats as
  their own group, which belongs to no guest. A person with no seat still has a group (it is where a seat
  for them is added).
- **The owner fills any group.** In any person's group the owner may add a persona seat from anything the
  owner can see: their own cards, cast members of the session's lorebook and notes. (Cards others **shared**
  with the owner are lane `gs-3b`: not here.) The server records that person as the one who plays it.
- **A guest fills their own group only**, with what the two switches allow (their own cards; a cast member
  they may take).
- **Moving a seat (S2).** The owner may move a seat between people only when it holds the owner's own card or
  a card-less member. A seat holding a guest's card is never given to another person. The owner may move
  **any** guest's seat, a persona included, to the AI-played group (the story plays it from then on; say in
  the report what becomes of the guest's `own` over that card's sheet in play, `state/handEdits.ts`
  `seaterOf`, and keep today's rule unless it breaks). The owner may move an AI-played seat holding their own
  card or a card-less member into a person's group.
- **S3.** A seat no person plays carries no "…'s character" line in anyone's list (today it falls back to
  "A player's character", `EditSessionForm.svelte` `seatPlayerWords`). The server tells the list whether a
  person plays each seat (the list cannot tell an owner-played seat from an AI-run one today).
- **S4.** With **take cast members** on, a guest may take a card-less member that is **seated and played by
  no person** (the AI ran it), as well as an unseated one; taking it makes the guest its player; leaving
  hands it back to the story. `sessions:castToTake` lists both. The two guest switches show to the owner
  **only when the session has a guest** (a `session_guests` row; verify what "invited" is in the schema), and
  are absent otherwise (today: whenever the session *can* have guests).

## Build

1. **Server: who plays a seat.** The seat writers already accept another person (`sessions/seats.ts`;
   `seated_by_user_id`, `session_personas.user_id`, `seatActorOf`); no door passes one. Add to the owner's
   seat doors (`sockets/sessions.update.ts`) an optional person: add a persona seat **for** a person; move a
   seat to another person; move a seat to or from the AI-played group. Checks, at the server, each refused in
   words: only the session's owner names another person; the person is the owner or a current guest; S2's
   card rule; the genre's shape has that seat kind (lane `gs-3a`'s opt-in check); a watcher
   (`session_guests.is_player` false) gets a seat only if the code already lets a watcher play (report what
   `is_player` does; add no watcher feature). The freeze from the guest switches never applies to the owner.
2. **Server: played-by fact and the take list.** The session payload the form reads carries, per seat,
   whether a person plays it and who (user id only; names resolve as they do today). `castToTakeOf`
   (`sessions/guestSeats.ts`) lists card-less members that are unseated **or** seated with no person playing
   (benched seats still count as held); the `castMemberIds` door lets a guest take such a seat (it becomes
   theirs; no second seat is made) and leave it (back to no player). Carded members stay refused for a guest.
3. **Client: the participants area** (`EditSessionForm.svelte` and its seat components). Groups per person as
   above; the owner's controls per group (add for this person; move a seat: a Listbox of the session's people
   plus the AI-played group, offering only the moves the server allows); a guest sees every group read-only
   except their own; S3's line; the switches' new condition. Reuse existing components and words wherever they
   fit; every new label and sentence is ★ in the report with one alternative. Works at 400 px (no control
   wider than the panel; lists wrap).
4. **Docs and names:** `docs/group-sessions.md`, `docs/sessions.md`; `NOMENCLATURE.md` (any new term with its
   charter; §25, quoting S1 and S2 with dates).

## Tests

Server: owner adds a persona seat for a guest (own card; a cast member); a guest naming another person is
refused; S2 matrix (owner's card / card-less / guest's card × to another person / to AI-played / from
AI-played) allowed or refused in words, nothing changed on refusal; genre opt-in refusal; the take list and
the take of a seated AI-run card-less member, on and off the switch, and leaving it; a benched seat is not
offered; the played-by fact per seat; a second boot changes nothing. Client DOM: groups per person; the
owner's move Listbox offers only allowed moves; a guest's read-only groups; no line beside an AI-run seat;
switches absent with no guest, present with one. `tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`src/lib/server/sockets/sessions.update.ts` (seat doors), `sockets/sessions.participants.ts`,
`sessions/seats.ts` and `sessions/guestSeats.ts` (only what the doors need), `EditSessionForm.svelte` and its
seat components, `shared/sockets/types.ts` for the new fields, their tests, the docs. Not
`sockets/sessions.overlay.ts`, not the Apply review, not message or prompt-detail code (other lanes, live).

## Stop and ask when

CLAUDE.md §Decisions applies; recording who plays a seat needs a schema change; a move would unseat or
duplicate a seat; moving a guest's persona to the AI-played group would hand the guest's card's `own` to the
owner; a watcher would have to become a player; the per-person layout cannot fit at 400 px without dropping a
control.

## Report

Final message = the report (lead saves `plans/REPORT-gs-3a2-<date>.md`), under about 650 words: the doors and
what each refuses; the S2 matrix as built; the take rule; the played-by fact; the layout (what a group shows,
owner vs guest); every new label and sentence as ★; the readings above as ★; **Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

1. **"Played by a person", in stored terms.** A **player seat** (`session_personas`) is played by its
   `user_id`. A **character seat** (`session_characters`) is AI-voiced and its person is its seater
   (`seated_by_user_id`, `db/schema.ts` 4150–4157, owner 2026-11-05 "The person who seated it"; `seatCast`
   refuses a seat with no seater, `sessions/seats.ts:561`). "No person plays it" = **a character seat seated
   by the session's owner**. A guest's take of such a card-less member rewrites `seated_by_user_id` to the
   guest **in place**, inside `seats.ts`; leaving rewrites it to the session's owner. No null seater, no
   second seat. S3's line: the walk's D4 comes from `SessionCharacters.svelte` 158–159 passing the **card's
   owner** to `seatPlayerWords`; the seater already reaches the client (`SessionBenchedSeats.svelte:217`,
   `saved.seatedByUserId`): pass the seater, and show no line when the seater is the session's owner. **No
   new payload fact** unless a list truly lacks the seater (say which).
2. **Groups.** One group per person holds that person's **player seats** only. Character seats stay one
   AI-played group; a character seat seated by a guest (their own card brought under *bring their own*, or a
   member they took) shows there with the existing "‹name›'s character" line (★ alternative: inside the
   guest's group).
3. **This lane builds same-kind moves only.** Player seat → another person: rewrite `user_id` (S2: only when
   it holds the owner's own card or a card-less member). Character seat → another person as its seater:
   rewrite `seated_by_user_id` (same S2 rule; a guest's own card keeps the guest as seater always: honour mode
   2026-11-05 "cards the player owns + their card-less seat", `state/handEdits.ts` 433–455; Q3 2026-10-12
   "read and copy, never use-as-cast", quoted beside S2 in §25). **Cross-kind moves (a person's player seat ↔
   the AI-played group) are NOT built**: the two kinds are two tables with separate ids and refs
   (`player-seat:<id>` vs `seated-member:<memberId>`, `seats.ts:1556`), and a seat that has spoken cannot be
   removed, only benched (`seats.ts:1725`), so a move would leave a benched twin. It is asked on the rulings
   page (MV1). Strike those rows from the S2 matrix and the Stop rule about `own`.
4. **Layout rules.** Benched seats stay in the one **Benched** section (2026-11-11 ruling), each labelled with
   its person. Player-seat order stays the one session-wide `position` (`schema.ts:4016`): groups are a
   grouping of that order, reordering inside a group keeps the other groups' relative order (say how), and
   dragging between groups is not offered (the move control is the Listbox). An empty group shows only where
   the genre lets that person add a persona (the Lair's owner "never takes a seat",
   `docs/group-sessions.md:12`; Dungeon Crawler's Planner seats guests, `:14`): take the rule from the genre
   shape the form already reads. The guest switches show when the session has a guest **saved or pending in
   the form** ("Ready to add"), so a first guest needs one Save.
5. **Scope.** The owner seating a card that someone shared **with the owner** is in no lane (`BRIEF-gs-3b.md`
   item 3 leaves it a ★): list it under Noticed. Lane `ap-1` is live and also edits
   `shared/sockets/types.ts`, `docs/sessions.md` and `NOMENCLATURE.md` §25: re-read each right before every
   edit, add only your own fields and your own §25 entry.
