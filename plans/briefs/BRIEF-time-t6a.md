# BRIEF — build lane `time-t6a` — who was present for each message: store the fact

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §2, §3 (the row "Who was present for a message"), §5 rule 4, §6
(T6), §7 "Measured 2026-11-15" and §8 ★5, ★6, `plans/CHARTER-time-model-2026-11-15.md`,
`plans/NOTES-entry-time-and-lines-2026-11-13.md` (~28–36, ~446–452), the benched-seats work
(`plans/REPORT-*bench*` if present; `docs/sessions.md` on seats, Bench and channels),
`../serene-pub-sdk/INTEGRATING.md` (seats and messages, read only), `NOMENCLATURE.md` §1, §24, §23 and the rows
for *seat*, *benched*, *presence* (⚠ a cast **presence** in a lorebook is a different thing: a dated stay in
the world), *channel*, *scene*.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no GPU.

## Goal

From this lane on, every message a session writes records **which seats were there to witness it**: seated in
the session, not benched, and on the message's channel. Nothing reads it yet. No prompt, ranking or screen
changes. It is stored now because it cannot be worked out later: seats keep no join or bench history
(`session_characters`, `session_personas`: `isActive`, `removedAt` only), and a bench change lives only in the
per-turn record, which loses its earlier value when the story settles.

The lane that uses it (leaving out, for a character with its own turn, the messages it was not present for) is
`time-t6b`, justified by the measurement of 2026-11-15 (a secret leaks in 8–20 of 20 replies when the earlier
conversation is left in, about 0 when it is left out).

## Owner rulings (quote them in worker briefs)

- 2026-11-14, "Lets go with all your recommendations", which rules ★5: "**Presence per message needs a new
  stored fact** (who was seated and not benched when a message was written). Without it attendance is per scene,
  which the abuse walk broke (a scene that never closes)"; §5.4 "Presence is per message, never per scene"; ★6
  "where one model voices everyone, nothing can be left out; the plan offers per-character knowledge only where
  a character has its own turn".
- 2026-11-11 (benched seats): one Benched section; core never benches by itself; a genre opts in to writing
  seats.
- 2026-11-15: "Go ahead and proceed with everything in the order you see fit." — the go.
- Standing: "0.6 is in users' hands": a forward migration and a test that a second boot changes nothing; P2: one
  module owns the fact and every write to it.

## Build

### A. Inventory first (supervisor, read-only) — report with file:line

1. Every place a session message row is created (`src/lib/server/messages/` store and writers; pipeline replies,
   a person's line, narrator lines, system or event lines, imports, branch copies, greeting messages, swipes /
   alternates, regenerated replies): which are new utterances in the story and which are copies or bookkeeping.
2. What "seated, not benched, on this channel" is at write time: the seat tables and their columns
   (`session_characters`, `session_personas`, the bench flag from the benched-seats lane, channel lanes and
   private messages: who is on a channel), and the one function that already answers "who is in the scene now"
   if there is one (the turn order's or the prompt's cast list).
3. How a seat is identified durably (a seat row id; a card id; a cast member id; a persona): what stays valid
   after a seat is removed and re-added, after a card is replaced, and across a session branch (branch copies
   messages: must copy this fact with them, with ids remapped as the branch remaps seats).
4. What Back, swipe, regenerate, delete and Forward do to a message row, so the fact travels with the row (a
   cascade) and needs no undo of its own.
5. Size: a session of 5,000 messages with 6 seats; choose the shape with the smallest cost that still answers
   "was seat S present for message M" and "which messages was S absent from" by index.

### B. The stored fact

- One generated migration (index 0165; the highest today is `0164_imprint_versions`; check the journal `when`).
  Lead's proposal, to confirm or replace from the inventory: a table keyed by (message, seat), one row per seat
  present, cascading with the message and with the seat; or, if the inventory shows it is smaller and as
  queryable, the **absent** seats only. State the choice and why. Name it by NOMENCLATURE §24: it must not be
  called *presence* alone (R1: a cast presence is a lorebook thing); proposal 🚧 `message_witnesses` /
  *witness*: "a seat that was there for a message".
- One writer module owns it (P2). It is called from the one place a new utterance row is stored, in the same
  transaction (inside `db.transaction` only `tx`).
- Copies carry it: a session branch, a "next chapter" carry-over if it copies messages, an import that restores
  a session with this fact. A swipe or regenerated alternate records the witnesses at the time **it** is
  written.
- Existing messages get nothing: no backfill (it cannot be known). A message with no rows means "not recorded",
  never "nobody was there": say so in the module's header, and give readers one function that returns
  `recorded: false` for such a message so no later lane mistakes it.
- No socket event, no wire field, no UI, no prompt or ranking change.

### C. Docs and names

`NOMENCLATURE.md`: a row for the new term with its charter (it owns: which seats were there for a message; it
does not own: what a character knows, which is lane `time-t6b`'s filter and the knowledge ties; a cast presence;
a scene's cast) and a §25 line per name. `docs/`: nothing user-facing changes; one line in the developer-facing
part of `docs/sessions.md` only if that page documents stored facts. No other product's name.

## Files owned

`src/lib/server/db/schema.ts` (the one table), `drizzle/0165_*.sql` + meta (generated), one new module under
`src/lib/server/messages/` or `src/lib/server/sessions/`, the message store's write path and the branch copy
(only to call the module), `src/lib/server/lorebooks/tableRegistry.ts` or the session table registry if one
requires a new table to be registered, tests beside each, `NOMENCLATURE.md`.

## Out of scope

Reading the fact anywhere; leaving messages out of a prompt; knowledge ties; the not-common-knowledge mark; cast
Memory; scene cast; an SDK surface; backfilling.

## Stop and ask when

CLAUDE.md §Decisions applies; a seat cannot be identified durably across a branch; the write path has more than
one place that stores a new utterance and they cannot share one call; a second migration, a setting or a
published name seems needed; recording would add a query per message that the performance work of 2026-11-13
(`plans/PLAN-performance-2026-11-13.md`: statement counts per turn) would regress — measure the added
statements per turn and report them.

## Done means

- The migration is generated, index 0165, only the new table; a second-boot test.
- Tests (targeted, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t6a-<name>.log 2>&1"`,
  one at a time, checking for a running vitest first): a reply, a person's line and a narrator line record the
  seated, unbenched seats on their channel; a benched seat and a seat on another channel are not recorded; a
  seat removed later stays recorded for the messages it saw; a swipe records its own witnesses; Back removes the
  rows with the message and Forward brings them back; a branch carries them with remapped seats; an old message
  reads `recorded: false`; the statements added per turn.
- The wider regression: `src/lib/server/messages`, `src/lib/server/sockets/sessions.*`,
  `src/lib/server/sessions`, `src/lib/server/pipelines/runtime/host.*`, `npm run test:budgets` if it counts
  statements.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t6a-<date>.md`): the inventory with
file:line, the shape chosen and why, statements added per turn, changed files, tests with results, names, open
★, **Noticed, not done**. Under about 700 words.

## Corrections after the cold review (2026-11-15) — these rule over the text above

On the rulings, no question for the owner: on 2026-11-11 he deferred "exposure-gated knowledge (participant
knows / mentioned has heard / … scene as the unit …). Build nothing toward it now"; on 2026-11-14 "Lets go with
all your recommendations" ruled ★5, "Presence per message needs a new stored fact", which picks the deferred
idea up in a new form (per message, not per scene), and on 2026-11-15 "proceed with everything" is the go. ★5
replaces the deferral. Storing first is not "for later" because the fact can only exist from the day it starts
being written; **the condition is that lane `time-t6b` (the reader) follows straight after**. Scene cast is
ruled out by ★5 and the bench records lose their earlier value on settle, so nothing stored answers it today.

1. **No channel.** ★5 says "who was seated and not benched when a message was written". Core has no seat-to-
   channel model and was ruled not to grow one (2026-10-12: "Participants of a lane live wherever the genre
   wants … Do not propose a core lanes table"; `channel_lanes` is per person, `schema.ts` ~4062–4103). Record the
   seated, unbenched seats for **every** message; a channel's audience stays the genre's, applied by whoever
   reads the fact. Drop the channel clause and its test.
2. **Which seats are recorded:** every seated, unbenched **character seat** (a cast member that can have its own
   turn) and every **persona seat** (a person's character: it was there). Envoy seats (narrators, `envoySlug`,
   `schema.ts` ~4181) are not characters and are not recorded. Say so in the module's header.
3. **Keyed by cast member, never by seat row, and never cascading from a seat.** Reassign re-stamps a seat's
   lines and hard-deletes the old seat row (`sockets/sessions.ts` ~8693–8694, ~8792–8793); the branch copies no
   removed seats (`sessions/branch.ts` ~245–247); seats live in two tables with separate id sequences. The
   durable key is the one the message already carries for its speaker: `session_messages.cast_member_id`
   (`schema.ts` ~2988), which is also the end knowledge ties use. Added to Files owned, only to carry the fact
   with the lines: Reassign's two handlers and `repointSpeakerStamps` (`messages/store.ts` ~441).
4. **A column on the message row, not a table.** One nullable `integer[]` of the present cast members, stamped
   inside the existing INSERT as the story clock stamp is (`withStoryClockStamp`, `messages/store.ts` ~95–110,
   applied ~470): no added statement per message, and it travels with the row through Back (`rewindOrdinal`),
   Forward, delete and the branch copy for free. NULL means "not recorded" (every message that exists today),
   never "nobody was there": readers get one function that says `recorded: false`. An index for "which messages
   was this member absent from" (GIN on the array) only if the inventory shows `time-t6b`'s query needs it;
   otherwise none (say which). **The absent-only shape is dropped** (with no join history it cannot tell "joined
   later" from "was there"). Report the reads added per insert (the seat lookup), against the performance work.
   Every new row already goes through `insertLegacy` / `insertLegacyMany` (`messages/store.ts` ~464, ~483): that
   is the one place.
5. **One set per row.** Swipes and regenerated replies are not rows (`metadata.swipes`; regenerate re-drives the
   row, `schema.ts` ~3038–3048, ~3103): a re-drive **rewrites** the row's set to the seats present when it is
   re-driven. Test that; drop "a swipe records its own witnesses".
6. **The name.** *witness* is taken (NOMENCLATURE §25, 2026-09-17: the session page's `witnessMessage`), and
   §14 Knowledge already has **firsthand**, "Was there.": read §14 (from ~948) first and name the column from it
   (lead's proposal 🚧 `firsthand_cast_member_ids`, *firsthand*: "the cast members who were there for the
   message"); record it in §25 and note that *attendance* is taken too.
