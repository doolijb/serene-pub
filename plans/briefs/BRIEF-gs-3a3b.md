# BRIEF — build lane `gs-3a3b` — a seat moves between a person and the AI: one new seat, the old one's lines follow it and keep their kind, the old seat is removed (owner rulings MV1, MV2, S2 of 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then the three "Rulings page, third round" blocks in
`plans/PLAN-programme-2026-11-15.md` (S2, MV1, MV2, PS1, HM1), `plans/briefs/BRIEF-gs-3a3.md` (**its cold
review corrections, item 6 "For `gs-3a3b` later" and objections recorded there: the tools and the traps**),
`plans/REPORT-gs-3a3a-2026-11-17.md` and `plans/REPORT-gs-3a2-2026-11-17.md` (incl. "Scope review fix":
`seatHandovers`, `handOverSeat`, `writeSeatHandovers`, `playerSeatsFor`, `maySpeakAsCard`, `removeGuest`),
`plans/REPORT-walk-2-2026-11-17.md` (the seat form in use), `docs/group-sessions.md`, `docs/sessions.md`,
`NOMENCLATURE.md` §1, §24 and rows **seat**, **seat handover · Played by**, **seat ref** / **seat key**,
**benched**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. Never run
prettier with `--write` or pipe its output into a file. **No migration.** Inside `db.transaction` only `tx`.
Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a3b-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No SDK build, no full run, no
`npm run build`. Comments state the rule, never the history. Views never toast. Workers one at a time.

## Owner (2026-11-17)

S2: "No: the owner re-assigns only seats holding their own cards or card-less cast members" + "Guest cast
members can still be moved to the ai playable seats by the owner freely, even personas".
MV1: "Move the old seat's lines to the new seat, then remove the old seat."
MV2: "Earlier lines move to the new seat and keep their kind" (what a person typed stays a person's line, by
that person, shown under the character's AI-played seat; what the AI wrote stays the AI's; nothing about who
may edit an old line changes; the model reads history as it was written).
Standing: a guest's card is never handed to another **person**; Bench is not absence; a seat that has spoken
can be benched, never removed, **except by this move, which the owner ruled**; one writer per seat table (P2).

## What a move is

The owner moves a seat between a person's Personas group (a **player seat**, `session_personas`) and the
AI-played group (a **character seat**, `session_characters`). Allowed: the owner's own card or a card-less
member, in both directions (toward a person: the owner or a guest who plays); **any guest's seat, a persona
included, toward the AI-played group**; never a guest's card toward another person. Result: one live seat of
the new kind for the same card or member; the old seat is gone; everything that referred to the old seat
refers to the new one; earlier lines stay exactly the lines they were.

## Facts the cold review established (re-verify each)

- The tool that re-points stored seat references is `rekeySessionRefs(tx, sessionId, translator)`
  (`sessions/seatKeys.ts:1632`), inside the caller's transaction, over the 15 stores in `SEAT_KEY_STORES`
  (`seatKeys.ts` 70–86: attribute values, configs, carries, `zone_contents`, `owner_sheets`,
  `state_proposals`, zone towards, the `annex_core` turn order and tally, audiences, speech keys,
  `widget_settings`, `metadata.speaker`, message blocks, `rewind_taken`, imprints). The merge already calls it
  with `memberMoveTranslator` (`lorebooks/foldInParent.ts` 1315–1318). Member form is on
  (`state/memberForm.ts:22`): a player seat's values sit under `player_seat:<seatId>`, a character seat's
  under `seated_member:<memberId>`: a move needs a **seat ↔ member translator** added in `seatKeys.ts`.
- Keyed by **member**, so they do not move: scene cast (`scene_characters.binding_id`), presence
  (`cast_presences.lorebook_binding_id`), knowledge ties, `messages.cast_member_id`.
- `sessions:reassignRemovedParticipant` (`sockets/sessions.participants.ts` 386–426, 493–522) is **not** the
  tool: same-kind only, matches by card id, hard-deletes.
- `unseat` only benches a live seat (`sessions/seats.ts` 1712–1721); removal is a second step that today
  requires `seatHasLines` false (`seats.ts` ~1725).
- Both seat tables are unique on (session, card) and keep removed rows (`db/schema.ts:4053`, `:4194`): moving
  back **revives** the earlier row.
- A guest's persona moved to the AI group: the new character seat's `seated_by_user_id` stays **the guest**
  (the card's owner), so `seatActorOf` (`seats.ts:2164`) never gives the session's owner acting rights over
  the guest's card; `removeGuest` leaves the guest's own-card seats alone (`sockets/sessions.ts` ~1478).

## MV2 in stored terms (the design to build; ★ in the report)

**No line's row is rewritten.** A person's line is `role 'user'`, `user_id` the person, `persona_id` the
card (or a `metadata.speaker` `player-seat:<id>` for a card-less seat); an AI line is an assistant row with
`character_id` (or `cast_member_id` / `metadata.speaker`). "Keep their kind" means those columns stay; "move
to the new seat" means the lines are **found and shown under the new seat**. Determine, by reading the code,
what makes a line "belong to" a seat today for each purpose: `seatHasLines` and the removal refusal;
the transcript / prompt speaker name; who may edit or delete a line (`messages/permissions.ts` 79–98,
`seatActorOf`); turn rotation's "last spoke" (`speakerRotation.ts`, `bindings.turnOrder.ts`); the scene-cast
speaker (`scenes/liveScenes.ts` `lineSpeakersOf`: by card, member, `metadata.speaker`); the conversation
widget's avatar and name. For lines keyed by **card or member** nothing needs re-pointing (the card / member
is the same before and after). For lines keyed by **seat id** (`metadata.speaker` `player-seat:<id>`, message
blocks) `rekeySessionRefs` re-points them to the new seat's ref (that is a reference change, not a kind
change: `role`, `user_id` stay). Then the old seat has no lines **by seat ref**, and can be removed: decide
how removal passes the `seatHasLines` guard (the guard counts lines by card for carded seats: those lines now
belong to the new seat by card: the guard must ask "does another live seat hold this card / member in this
session" and allow removal then): state the exact rule you built and test that a normal remove of a seat
that has spoken is still refused.
Consequences to state in the report: after a persona → AI move, the person's earlier typed lines are still
theirs to edit by today's author rule; after AI → persona, earlier generated lines stay the AI's (the new
player cannot edit them as their own unless today's rule already lets the seat's person: say what
`messages/permissions.ts` does and whether it is by author or by seat; if by seat, the earlier AI lines
would become the person's to edit: MV2 says "nothing about who may edit an old line changes": make that true
and say how).

## Build

1. `seatKeys.ts`: the seat ↔ member translator (player seat ref ↔ seated-member ref for the same member /
   card), with tests over each of the 15 stores (a table-driven test that puts one reference of each store
   kind under the old ref, moves, and finds it under the new ref; nothing left under the old).
2. One server operation `moveSeatKind` in `sessions/seats.ts` (the one writer; name by §24, ★), in one
   transaction: check (the S2 rule above; only the session's owner; the target person is the owner or a
   guest who plays; the genre's shape has the target seat kind: lane `gs-3a`'s opt-in check; not while a
   counted run is in flight for that seat: reuse the existing in-flight refusal from programme 2.7 if seats
   have one, else report); create or **revive** the new-kind seat for the same card / member (person: the
   chosen person; AI: `seated_by` = the card's owner for a guest's card, else the session's owner); copy
   bench state and position sensibly (say what); `rekeySessionRefs` with the translator; remove the old seat
   (soft removal as the tables do it: `removed_at`), passing the guard as designed above. Guarded write (the
   row is as the check saw it: pattern of `writeSeatHandovers`); the whole thing rolls back on any refusal.
   A second boot changes nothing. The door: `sessions:update` gains the move (a new optional field beside
   `seatHandovers` / `playerSeatsFor`; ★ name), scoped reply as the others.
3. After a move: `castToTakeOf`, take / hand back, `removeGuest`, `maySpeakAsCard`, `seatSheetHolder`, turn
   order and the scene-cast rule all behave for the new seat as for any seat of its kind (tests: a guest's
   persona moved to AI → the guest can no longer send as it, the AI is offered its turn, the guest's earlier
   lines still show under the character and are still the guest's to edit; an AI character moved to a guest
   → the guest sends as it, earlier AI lines unchanged and not the guest's to edit; move there and back →
   the first row is revived, nothing duplicated, references intact).
4. Client (`EditSessionForm.svelte` and the seat components): **Played by** on a persona row offers the
   AI-played group (★ the choice's words: reuse **No one**, which the AI-played rows already use for "the
   story plays it", if it reads right on a persona row; else one new label with one alternative); on an
   AI-played row for the owner's card or a card-less member it offers people (it already does for same-kind
   handover: make the choice a move when the kinds differ); a confirmation built into the page, saying in one
   sentence what happens (★). Works at 400 px.
5. Docs (`docs/group-sessions.md`, `docs/sessions.md`); NOMENCLATURE (the move; the translator; §25 quoting
   S2, MV1, MV2).

## Tests

As listed in Build 1–3, plus: S2 matrix (owner's card / card-less / guest's card × to a person / to AI /
from AI) allowed or refused in words with nothing changed on refusal; a move during an in-flight run
refused; the genre opt-in refusal; references in every store after a move (query each store for the old
ref: none); scene cast and presence untouched; both prompt baselines unchanged (they move no seat);
statements per reply not higher; client DOM for the choices and the confirmation. Existing seat tests stay
green (list any whose expectation changes, with the ruling). `tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`sessions/seatKeys.ts` (the translator), `sessions/seats.ts` (`moveSeatKind`, the removal guard),
`sessions/guestSeats.ts` (checks), `sockets/sessions.update.ts` (the door), `sockets/sessions.participants.ts`
only if the removal guard lives there, the seat components and `EditSessionForm.svelte`,
`shared/sockets/types.ts` (own field), tests, the docs, NOMENCLATURE. `messages/store.ts`,
`messages/permissions.ts`: **read**, and edit only if "nothing about who may edit an old line changes"
cannot hold otherwise (say so first in the report's design section). Live lanes, not yours: `el-1a`
(`db/schema.ts`, a migration, entry / scene write paths in `pipelines/runtime/host*.ts`, `lorebooks/*`,
`scenes/liveScenes.ts`, entry and scene sockets and pages, `sessions/seatName.ts` and
`cast/sharedCardCopy.ts` for a creator column: re-read `seatName.ts` before touching it). Shared files
(`shared/sockets/types.ts`, `docs/*`, `NOMENCLATURE.md`): re-read right before each edit.

## Stop and ask when

CLAUDE.md §Decisions applies; a reference kind cannot be re-pointed without a migration; "keep their kind"
cannot hold without rewriting message rows; who may edit an old line would change; a move would give the
session's owner acting rights over a guest's card; the lane grows past two workers' work.

## Report

Final message = the report (lead saves `plans/REPORT-gs-3a3b-<date>.md`), under about 700 words: the design
as built (what a line belongs to, per purpose; what was re-pointed; the removal rule); the S2 matrix; move
and move back; the stores table; every new label and sentence as ★ with one alternative; tests changed;
**Noticed, not done**.

## Cold review corrections (2026-11-17 night) — these rule over the text above

**Cut in two. `gs-3a3b-1` (this launch): server only, the move **person → AI** (the case S2 names), with the
permissions change and tests. `gs-3a3b-2` (later): AI → person and the client. Build nothing of Build 4, and
no AI → person move.**

1. **A line keeps the stamp of the seat it was spoken from. `message_speakers` is NOT rekeyed.** Since member
   form, every line carries its seat's ref in `metadata.speaker` (`messages/store.ts` 263–289
   `withSpeakerStamp`), and readers trust it to name a seat of the line's own kind: the client
   (`client/components/sessionPage/projections/seatIdentity.ts` 187–214 `seatOfMessage`;
   `client/utils/messageSpeaker.ts` 128–166) and the prompt (`pipelines/ranking/ragQuery.ts` 43–55;
   `pipelines/prompt/contentProcessors.ts` ~271–301, 356–372). Re-pointing the stamp would erase names and
   faces and rename lines in the prompt. The old seat survives as a soft-removed row and every reader already
   resolves removed rows (`store.ts` 221–224; the prompt's `removedSession*`). So: keep the `message_speakers`
   store (and message blocks that name the speaking seat: verify which stores carry "who spoke" versus live
   state) **out of the move's rekey**; "the lines move to the new seat" means they show under the same card
   or member, which the new seat holds (★ in the report: the reading of MV1 that keeps MV2 true). The other
   stores (values, configs, carries, zones, owner sheets, proposals, turn order and tally, audiences, speech
   keys, widget settings, rewind, imprints) are rekeyed.
2. **Who may edit a line is decided by its seat today, not its author** (`messages/permissions.ts` 79–99,
   197–227 `ownsSeatedCard` → `seatOf` → `seatActorOf`; the author rule covers only lines with no persona and
   no seat stamp, 243–244). MV2 ("nothing about who may edit an old line changes") therefore needs a change:
   **a line's seat is resolved only within the line's own kind**: a person's line against player seats
   (`player-seat:` pinned by id, else `persona_id`), an AI line against character seats, **departed (removed)
   seats included** (today `seatOf` prefers a live seat in either table, `sessions/seats.ts` 1977–1990,
   2104–2125). Mirror it on the client in `canControlMessageAs`
   (`client/components/sessionPage/sessionPageProjections.ts` 254–300). `messages/permissions.ts` and that
   client function join Files owned. Tests: after a guest's persona moves to the AI group the guest still
   edits their own earlier typed lines and the session's owner does not gain them; the AI seat's new lines
   follow the AI seat's actor; nothing changes for a session where no seat moved (existing permission tests
   green untouched).
3. **The removal guard in `unseat` is not changed** (`seats.ts` 1720–1730). `moveSeatKind` soft-removes the
   old row itself, after its own checks, in the same transaction. Test: an ordinary removal of a seat that
   has spoken is still refused, including when the same card also sits in a seat of the other kind (★K-2: a
   card can hold a player seat and a character seat at once; `permissions.ts` 85–88, `store.ts` 168–171).
4. **Turn order and tally carry a kind beside each ref** (`seatKeys.ts` 725–741 rewrites only `ref` of a
   candidate whose `kind` is "persona" or "character"; `pipelines/routines/turnTally.ts` 17–18, 125–129
   `persons`; rekeyed blind at `seatKeys.ts` 757–758). After the rekey, **drop the moved seat from `order`,
   `candidates` and `persons` and let the turn order recompute as it does when a seat is added** (find that
   path; do not hand-build an order). **Refuse the move while a counted run is in progress in the session**
   (lane 2.7's session-wide refusal, `plans/REPORT-ss-7-2026-11-16.md` 32–35: reuse as it is) **and while the
   moved seat holds the turn** (in words; ★). Test a move asked while that seat is owed a turn.
5. **After the move the guest no longer speaks as that card in this session.** `maySpeakAsCard`
   (`seats.ts` 2232–2250) hands a card back to its owner once its player seat is removed ("the owner is never
   locked out of their own card"), so the guest could still send as it and the line would be stamped with the
   character seat (`store.ts` 236–246). Rule (★): **a card that a live character seat holds in this session,
   with no live player seat, is spoken by no person here**. Check it against ★K-2 (a card with both a live
   player seat and a live character seat: the player seat's person still speaks). Tests.
6. **Refusals:** a live seat of the target kind already holds the card or member (★K-2): refuse, never merge
   two seats (the tables are unique on session + card, `db/schema.ts:4066`, `:4207`; give the translator a
   `survivor` rule that favours the moved seat for the revive case, `seatKeys.ts` ~366–372); a player seat
   with **no member and no card** (`session_personas.cast_member_id` null, schema 4021–4028) cannot become a
   character seat: refuse in words (S2 says "Guest cast members"). Revive (`seatCast`, `seats.ts` 703–728)
   does not reset the seat name or portrait and keeps the position unless one is given: say what the revived
   AI seat shows.
7. **Who seated the new AI seat:** a guest's card → the guest (the card's owner); the owner's card or a
   card-less member → the session's owner.
8. **Files owned (`gs-3a3b-1`):** `sessions/seatKeys.ts`, `sessions/seats.ts` (`moveSeatKind`,
   `maySpeakAsCard`), `sessions/guestSeats.ts` (checks), `sockets/sessions.update.ts` (the door: a new
   optional field; no client uses it yet), `messages/permissions.ts`, the client's `canControlMessageAs`,
   `shared/sockets/types.ts` (own field), tests, NOMENCLATURE §25. **Not** `scenes/liveScenes.ts`,
   `sessions/seatName.ts`, the seat form components. Live lane `el-1a` holds `db/schema.ts`, a migration,
   `pipelines/runtime/host*.ts`, `lorebooks/*`, `scenes/liveScenes.ts`, entry / scene sockets and pages, and
   may write a creator column in `sessions/seatName.ts`, `cast/sharedCardCopy.ts` and **possibly
   `sessions/seats.ts` where a member is created**: re-read `seats.ts` right before each edit and change only
   your own functions.

## `gs-3a3b-2` — launch note (2026-11-17 night) — rules over everything above where it differs

`gs-3a3b-1` and its fix landed (`plans/REPORT-gs-3a3b-1-2026-11-17.md`, incl. "Scope review fix"): the move
person → AI on the server (`moveSeatKind`, `seatMoveTranslator`, `seatMoves` on `sessions:update`), the
own-kind rule for who may edit a line, `maySpeakAsCard`'s narrowed rule, and the door's payload rule (send the
move in `seatMoves`; the moved card may stay in or leave `personaIds`; `characterIds` may list it or not; to
bring a player seat back for a card the AI plays, use `sessions:addPersona`). Logs `plans/gs-3a3b-2-<n>.log`;
report `REPORT-gs-3a3b-2-<date>.md`.

Build:

**A. The move AI → person** on the server (the owner's own card or a card-less member, toward the owner or a
guest who plays; never a guest's card toward another person; a guest's card that the guest seated as an AI
character may go back to **that guest's** Personas group). The mirror of `moveSeatKind`, through the same
function where possible (one writer): create or revive the player seat for the same card or member with the
chosen person; drop the AI seat from the turn order's `order` / `candidates` and let it recompute (the
person joins the tally's `persons` as when a persona is added); rekey the 13 stores from the member's ref
to the new player seat's ref (`message_speakers`, `message_blocks` left: lines keep the stamp of the seat
they were spoken from); soft-remove the character seat (the removal guard in `unseat` unchanged). The
cold review judged this direction riskier: **every reader that resolves an old AI line through whichever
seat is live** must keep giving it its own-kind seat: `messages/permissions.ts` is done (own-kind rule);
check and fix the others the review named: `state/write.ts:763`, `lorebooks/entryKnowledge.ts:342`,
`pipelines/runtime/bindings.outlets.ts:644` (each: what it resolves, what it would do with an old AI line
after the move, the fix or why none is needed). After the move: the person sends as the character; earlier
AI lines stay the AI's (the person cannot edit them as their own; the session's owner keeps what the owner
had); the prompt reads earlier lines as the model's. Refusals as in `gs-3a3b-1` (owner only; a run in
progress; the seat holds the turn; the card already has a live player seat: ★K-2: refuse, never merge; the
genre has no personas: the existing seat-kind refusal). `maySpeakAsCard`: with a live player seat the
person speaks (already so).
**B. Unanswered forms** (★ in the report with what you built): a form block addressed to the moved seat that
nobody has answered: after person → AI it passes to the session's owner today
(`pipelines/runtime/portrayals.ts` 225–241; `fireAction.ts` 713–720). Leave that as it is unless
re-addressing a never-answered block is a one-place change through the existing rekey with the block still
unanswered; if it is not, change nothing and report.
**C. The client** (`EditSessionForm.svelte`, `SessionPersonas.svelte`, `SessionCharacters.svelte`,
`seatGroups.ts`): **Played by** offers the cross-kind choices where the server allows them: on a persona row,
the AI-played group (words ★: reuse **No one** if it reads right on a persona row, since AI-played rows
already use it for "the story plays it"; else one new label with one alternative); on an AI-played row for
the owner's card or a card-less member, the session's people (it already does for same-kind handover: the
choice becomes a move when the kinds differ). A confirmation built into the page (no `confirm()`), one
sentence saying what happens to the seat and that earlier lines stay as they are (★). The form sends the
payload by the door's rule. Works at 400 px; accessible names include the seat. The drag rules of the seat
groups are unchanged (a drop into another group is still refused: the move is by **Played by**).
**D. Docs and names:** `docs/group-sessions.md`, `docs/sessions.md`; NOMENCLATURE §9 row (both halves built)
and §25 quoting S2, MV1, MV2.

Tests: the mirror of `sessions.seatMove.int` for AI → person; move there and back in both orders (rows
revived, nothing duplicated, references intact, lines keep name, face and editor); the three readers above;
both prompt baselines unchanged; client DOM for the choices, the confirmation and the payload. `tsc` 0;
`npm run check` 0 errors in lane files.

Files owned: `sessions/seats.ts`, `sessions/seatKeys.ts`, `sessions/guestSeats.ts`,
`sockets/sessions.update.ts`, the three readers' lines, the seat components and `EditSessionForm.svelte`,
`shared/sockets/types.ts` (own field), tests, docs, NOMENCLATURE. A lane about change history of a scene's
cast (`sc-1`) may start in `db/schema.ts` (`lore_redlines`), `lorebooks/redlines.ts`, `scenes/liveScenes.ts`,
`sockets/scenes.ts`, `sockets/narrativeGraph*.ts`, the scene form; a diagnostics task may edit
`pipelines/routines/log.ts`, `sockets/routines.ts`, `sessions/offerMessage.ts`, `messages/deletion.ts`,
`pipelines/runtime/dispatch.ts`: not yours. Never run prettier with `--write` or pipe its output into a file;
no `npm run build`; no SDK build; no migration. In tests remove only your own temp directories by exact
path.
