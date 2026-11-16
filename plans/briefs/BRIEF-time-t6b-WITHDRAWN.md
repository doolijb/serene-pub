# BRIEF (PROPOSAL: not ready to build; two owner decisions first) — lane `time-t6b` — a character with its own turn is not shown messages it was not there for

Repo `/home/jody/github/serene-pub`. This is the reader of the fact lane `time-t6a` stores
(`session_messages.firsthand_cast_member_ids`, module `src/lib/server/messages/firsthand.ts`,
`plans/REPORT-time-t6a-2026-11-15.md`). The cold review of `time-t6a` made storing the fact conditional on this
lane following it.

## Why (measured 2026-11-15, `plans/PLAN-entry-time-and-lines-2026-11-14.md` §7)

A secret told in a scene the speaking character was not in, then that character asked about it on its own turn,
three local models, 20 replies each: with the earlier conversation left in the prompt the character revealed it
in 9–16 of 20 replies; with a note saying it was not there and does not know, 8–20 of 20; with the earlier
conversation left out, about 0. Leaving out works; telling does not.

## Owner rulings

- 2026-11-14 ("Lets go with all your recommendations"): ★5 presence per message as a stored fact; §5.4 "Presence
  is per message, never per scene"; ★6 "where one model voices everyone, nothing can be left out; the plan
  offers per-character knowledge only where a character has its own turn"; the read path's step "messages and
  summaries the speaker was not present for are left out (only where a character has its own turn; a narrator
  voicing everyone reads all, and that limit is stated in the docs)"; "Unknown content is left out of the
  prompt; the model is never told what a character does not know."
- CLAUDE.md P1: "A *new* automatic behaviour is **off in core until a genre opts in**, and every automatic
  action shows its cause and how to undo or switch it off."
- 2026-11-15: "proceed with everything in the order you see fit … Any blocking questions, defer for as long as
  they aren't blockers" — this lane's two questions block only this lane.

## The rule proposed

When a pipeline builds the conversation history for a reply spoken by **one cast member on its own turn**, a
message is left out when its firsthand set is recorded and does not contain that member. A message with no
recorded set (everything written before `time-t6a`) is kept. A narrator's turn, an envoy's, and any step that
writes for several characters read everything. The speaker's own lines are always kept. Scene summaries: a
summary is kept for a member who was firsthand for at least one of the scene's messages (when recorded), else
left out; an unrecorded scene's summary is kept.

Shown, not hidden (P1): the run's receipt and the prompt preview say how many messages were left out and why
(*12 messages left out: ‹name› was not there*), and the docs state the narrator limit.

## Decision 1 for the owner — how a genre opts in

The history a pipeline reads is assembled by an SDK-declared step with published parameters. The opt-in must be
one of:

- **A. A parameter on the history step** (recommended): a pipeline author sets it on the reply step of a
  character's own turn (🚧 e.g. `firsthandOnly: true`). One new published SDK name, additive, `@experimental`;
  core's shipped pipelines would set it only where a character has its own turn (which presets: decision 2).
  Fits P5 and "pipelines live where the shape is known". Needs an SDK edit and `sdk:build`.
- **B. A session setting** (*Characters only know what they were there for*): no SDK change, but it is a setting
  (P3: "who changes this, why, and what breaks without it") and a pipeline could not vary it per step.
- **C. Always on in core wherever a character has its own turn**: no setting and no name, but it is a new
  automatic behaviour with no opt-in, against P1.

## Decision 2 for the owner — which shipped presets use it

Proposed: none by default at first (the fact has only just started being recorded, so on every existing session
the filter would do nothing yet), with the docs showing how a preset turns it on; or the multi-character Story
presets where each character replies on its own turn. The Lair and the Dungeon Crawler have a narrator voicing
many: they cannot use it (★6).

## What is known about the code (to verify in the real brief)

- The fact: `firsthandOf(row)` returns `{ recorded: false }` or the member ids (`messages/firsthand.ts`).
- The history window is read by session through `(session_id, id)`; no index on the array is needed.
- Private messages and channel lanes already narrow who sees what per person; this is per cast member and must
  compose with them (a message a person may not see stays hidden whatever its firsthand set).
- The prompt-prefix cost: leaving messages out changes the history a character's prompt starts from compared
  with the narrator's; reuse across speakers in one round drops (owner 2026-11-11: fidelity outranks reuse).

## Not in this lane

Knowledge ties, the *not common knowledge* mark and its list, cast Memory (their own lanes: T6c, T6d); "‹name›
doesn't know this" text in any prompt (ruled out); backfilling presence for old messages.

## Blocked on

Decision 1 (and, for option A, an `sdk:build`, which is held while the owner's own server is up).
