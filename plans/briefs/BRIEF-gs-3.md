# BRIEF — build lane `gs-3a` — seats in a shared session: two owner switches, the owner seats for a guest, a cast list a guest can choose from (owner rulings G3, G4)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then row D61 in `plans/DISCUSS-LATER.md` (ruled), the "Rulings page, second
round" block in `plans/PLAN-programme-2026-11-15.md`, `plans/INVENTORY-seats-and-notes-access-2026-11-16.md`
Part A and §7, §9 of Part B (**re-verify every file:line**),
`plans/INVENTORY-guest-and-member-surfaces-2026-11-16.md` §3, `plans/REPORT-gs-2a-*.md` if it exists,
`docs/group-sessions.md`, `docs/characters.md`, `docs/lorebook-cast.md`, `STYLE-GUIDE.md` (settings rows:
one sentence of purpose; read-only in words; absent, never disabled), `NOMENCLATURE.md` §1, §24 and rows
**seat**, **persona**, **cast member**, **guest**, **session owner**, **benched**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash / checkout / restore`; `npx prettier --check` only, never `--write`. Never commit. **No
migration** (the switches are `sessions.metadata` keys; a missing key reads as on). Inside `db.transaction`
only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.

## Owner (2026-11-16, rulings page, second round)

G3: "On by default; off freezes guests' seats as they are" and "Owners can also assign cast/cards they own to
the guests. Guests can bring their own if enabled. Guests can grab the sessions/lorebooks cast members if also
enabled. So two settings, both on by default. The genre still has to opt in to characters/personas since we
still have to support the user as a speaker and envoys etc. Guests can't choose directly from the owners card
list, but can choose from shared cards from other users, shared cards are copied into the lorebook unlinked."
G4: "Keep: any guest may take a card-less cast member's seat" + "See G3". Earlier: "Guests can only see the
session detail view, and manage cast/cards they own."; P3 (a setting answers who changes it, why, what breaks
without it); Bench is not absence; members never see model plumbing.

**Not this lane (`gs-3b`, briefed after this one): shared cards** ("can choose from shared cards from other
users, shared cards are copied into the lorebook unlinked"; it refines 2026-10-12 Q3 "a shared character is
copied before it can join a session"). Here the guest's own-card picker keeps stripping shared cards as today.

## Lead's reading of the words (each is ★ in the report so the owner sees it)

- **Two switches, per session, the owner's, both on by default:** 🚧 *Guests can bring their own characters*
  (a guest adds, swaps and removes seats for character cards and personas **they own**) and 🚧 *Guests can
  take cast members* (a guest takes or leaves the seat of a member of the session's cast). Names and one
  sentence of purpose each are ★.
- **Off freezes that kind of seat for guests:** a guest keeps the seats they hold and can neither add, swap,
  remove nor leave a seat of that kind; nothing is unseated when a switch goes off. The owner is never frozen.
- **"The session's / lorebook's cast members" a guest may take** = members of the cast of the lorebook the
  session plays on (its notes and the lorebook under them) that no one is playing, **card-less or carded**
  (the owner put them in the cast; that is not "the owner's card list", which is the owner's whole character
  library and is never offered to a guest).
- **The owner assigns:** the owner can seat any card they own, or any cast member, **for a named guest to
  play**, and can hand a seat from one person to another; this works whatever the switches say.
- **The genre's opt-in stands above all of it:** a genre whose shape has no characters or no personas offers
  none of the corresponding controls, and the server refuses the seat (today only the client enforces it after
  creation).

## Build

1. **The switches.** Two keys in `sessions.metadata` with one writer, in the manner of `playerLabel` (find it);
   only the session's owner writes them (`sessions:*` event of the Edit session form; scoped reply carrying
   `sessionId`); a missing key reads as on; they travel to the client with the session so every member's UI
   follows. Shown to the owner in Edit session, in the participants area, only when the session can have guests
   (accounts on and the genre's `members: 'group'`: find how the form already knows) and only the switch whose
   seat kind the genre's shape has. Each with its one sentence. No run reads them (they gate people's seat
   actions, not pipelines).
2. **The freeze, at the server.** In every seat door a non-owner can use (`sockets/sessions.update.ts`: the
   three diffs ~763 / ~831 / ~1013, adds and removals; seat naming; `addPersona`; reassign; bench: verify the
   list), a guest's action on a seat kind whose switch is off is refused in words (one sentence per switch, ★,
   e.g. *The session's owner has switched off bringing your own characters.*), nothing changes, and the reply
   reaches the asker. Today a removal of someone else's seat is silently skipped: keep that. Client: with a
   switch off, a guest's controls for that kind are absent and one line of words says why and who can change it.
3. **The owner seats for a guest.** The seat writers already accept another person
   (`sessions/seats.ts`; `seated_by_user_id`, `session_personas.user_id`, `seatActorOf` ~2100) and no door
   passes one. Add to the owner's doors an optional "who plays this" (a guest of the session, or the owner):
   seating a card the owner owns or a cast member **for** that person, and re-assigning an existing seat from
   one person to another (find whether `reassign` already does this and for whom). Checked at the server: only
   the owner may name another person; the person must be the owner or a current guest; a watcher
   (`session_guests.is_player` false) can be given a seat only if the code already lets a watcher play (report
   what `is_player` does today; do not add a watcher feature). The participants list shows who plays each seat
   (it already does: verify) and gives the owner the control (★ label, e.g. **Played by**), a Listbox of the
   session's people per the project's select pattern.
4. **A cast list a guest can choose from, scoped to the session.** Today the list comes from
   `lorebooks:bindingList` on the notes (`EditSessionForm.svelte` 865–880 → `sockets/lorebooks.ts:2011`
   `assertReadableBook`), which a guest cannot read for an attached lorebook and which lane `gs-2c` will close
   for the notes. Add one `sessions:*` read (name by §24, ★) that any member of the session may call: the
   members of the session's cast that are free to take, with only what choosing needs (member id, shown name,
   avatar, card-less or not; **no sheet text, no card fields**), from both the notes and the lorebook under
   them, respecting the lorebook's line the session reads. The form uses it for a guest (and may use it for the
   owner). Taking a seat goes through the existing seat door (`castMemberIds`), which now checks at the server
   that the member belongs to this session's cast and is free (today a guest can seat any carded member id
   with no check: close that), and that the *take cast members* switch is on for a guest.
5. **The genre's opt-in at the server.** `SessionShape.characters` / `personas` is checked only at create
   (`shapeViolations`); the seat doors refuse a seat kind the session's genre shape does not have, with the
   existing sentence for that violation.
6. **Docs and names:** `docs/group-sessions.md` (the two switches, what off does, the owner seating for a
   guest, what a guest may take), `docs/sessions.md` (the participants area), `docs/characters.md` if a
   sentence becomes false; `NOMENCLATURE.md` (the two switches with charters, the session cast read, **Played
   by**; §25).

## Tests

Server: each door × (owner | guest) × each switch (on | off): allowed / refused with the sentence, nothing
changed; the owner seats their card for a guest, a cast member for a guest, re-assigns; a non-owner naming
another person is refused; the cast read as a guest on a notes-only session and on a session over an attached
lorebook (free members only; no sheet text in the serialised reply); a guest seating a member id from another
lorebook or an already-played one is refused; the genre opt-in refusals; a second boot changes nothing
(missing keys read as on; nothing is written). Client DOM: the owner's switches (shown only when the session
can have guests); a guest's absent controls and the words; **Played by**. `tsc` 0; `npm run check` 0 errors
in lane files.

## Files owned

`src/lib/server/sockets/sessions.update.ts` (seat doors), `sockets/sessions.participants.ts`,
`sessions/seats.ts` (only what the doors need), the new session cast read, the metadata writer,
`EditSessionForm.svelte` and its seat components (`SessionCharacters`, `SessionPersonas`,
`SessionBenchedSeats`, `SeatBenchButton`, the participants area), `shared/sockets/types.ts` for the new
fields, their tests, the docs. Lane `gs-2a` edited three `isAdmin` conditions in `EditSessionForm.svelte` and
is expected to have landed: re-read first. Lane `gs-2b` (Edit session for a guest) follows this lane.

## Stop and ask when

CLAUDE.md §Decisions applies; a seat door cannot tell a guest's own-card seat from a cast-member seat; the
owner seating for a guest needs a schema change; a watcher would have to become a player; the freeze would
unseat anyone; the session cast read would have to expose sheet text for choosing to work.

## Report

Final message = the report (lead saves `plans/REPORT-gs-3a-<date>.md`): the switches (names, sentences, where
stored, who sees them); the doors and what each refuses; the owner's assignment; the cast read (shape, who may
call); the opt-in check; the five readings above as ★ with what was built for each; **Noticed, not done**.
Under about 650 words.

## Cold review corrections (2026-11-16) — these rule over the text above

**The lane is cut in two. This brief builds `gs-3a`: the two switches, the freeze, the server checks on taking
a cast member's seat, the genre opt-in on adds, and the session cast read. Item 3 (the owner seats for a guest,
"Played by") is `gs-3a2` and waits for the owner (rulings page S1, S2): do not build it.** Launch after lane
`gs-2a` has landed (both edit `EditSessionForm.svelte`).

1. **A guest takes card-less cast members only** (owner: "any guest may take a card-**less** cast member's
   seat"; "Guests can't choose directly from the owners card list"; honour mode 2026-11-05: a player has "cards
   the player owns + their card-less seat; the world, NPCs and places are the session owner's"). Taking a
   carded member's seat would give the guest "own" over the owner's card through `seaterOf`
   (`state/handEdits.ts` 443–449). So: the session cast read lists **card-less** free members; the
   `castMemberIds` door **refuses a carded member for a guest** (today `seatCast` takes that member's card and
   seats it, `sessions/seats.ts:572`), in words (★). The owner is not restricted. Members from another lorebook
   are already refused (`checkSeatMember`, `seats.ts` 491–499): add only "free", the switch and the card-less
   rule. "Carded too" is listed in the report as the alternative.
2. **"Free" means not in `seatedMemberIds`; a benched seat still counts as held** (Bench is not absence,
   2026-11-15). Read names through `membersAsRead` with `{ sessionId }`.
3. **Card-less named seats and the freeze.** Some genres let a guest take a seat by naming it
   (`docs/group-sessions.md:12`, the Lair), and the Dungeon Crawler's planner seats guests through
   `writeSeatName` (`pipelines/runtime/host.ts:4502`). A named card-less seat belongs to the **bring their
   own** switch (★ in the report); check it **once inside `writeSeatName`** so the socket door and a run obey
   the same rule (a run seating a guest while the switch is off is refused in the run's existing manner for a
   refused write; say what the player then sees). Strike "No run reads them" for this one function.
4. **What "off" means for leaving:** a guest cannot leave a frozen seat, and guests cannot leave a session
   themselves (`removeGuest` is owner-only, `sockets/sessions.ts:1392`): every refusal sentence names the
   session's owner as the person to ask.
5. **The genre opt-in refuses adds only.** `shapeViolations` checks counts against min and max and counts
   card-less speaker seats (`pipelines/entities/sessionGenres.ts` 342–361, 397–405): re-validating on every
   save would refuse removals in the Lair and every save of an older session already outside its shape. Build:
   a seat door refuses **adding a carded seat of a kind the session's genre shape does not have**; it never
   re-checks existing seats, card-less speaker seats or envoys. Test: a session already outside its shape still
   saves removals.
6. Item 4's claim "today a guest can seat any carded member id with no check" stands only for members of this
   session's lorebook (correction 1 closes it).
