# INVENTORY — what core assumes of a session and of actions, events, routines (read-only sweep, 2026-11-15)

Facts from an Explore sweep; re-verify file:line in each brief. app/ = `src/lib/server/`, sdk/ =
`../serene-pub-sdk/sdk/src/`, cat/ = `../serene-pub-sdk/core-catalog/src/`. Five shipped genres: Story, Chat,
Guide, Lair, Dungeon Crawler (DC).

## 1. Genre keys and slugs core reads by name

| Key / slug | What core does | Where |
|---|---|---|
| `autoAdvance` | undeclared means `next`, not off | app/sessions/autoAdvance.ts ~196–204 |
| `characterDetail`, `authorsNote` | prompt cast filter; note stored and rendered by core | host.ts ~6319, ~6345; sessions/authorsNote.ts ~131 |
| `narratorInterjections` | host stamps `turnCause: unprompted` | host.ts ~8673 |
| `showDice` (Lair) | core strips numbers from every prompt | host.ts ~2854; messages/diceWords.ts ~26 |
| `keepEveryTurn` (DC) | refuses deleting the latest turn | messages/verbs.ts ~790 |
| `owner/playerSheetLatitude`, `owner/playerItemMoves` (DC) | hand-edit gate | state/handEdits.ts ~105–110 |
| `roundWorth` (Story, Lair) | the round tick's clock step | pipelines/runtime/roundWorth.ts ~29 |
| `tools` + `family === 'assistant'` (Chat, Guide) | tool gating | runtime/tools/webTools.ts ~231; writeTools.ts ~173 |
| `readAloud` | core's read-aloud listener | speech/onMessageSettled.ts ~197 |
| `turnMode` | turn-order path | host.ts ~623 |
| annex key `story-goals` | goal-reached announcement (host listener) | sessions/goalsReached.ts ~24; host.ts ~3108 |
| channel slug `"table"` (DC) | hand-edit and goal lines go there | sessions/tableLine.ts ~20 |
| lane membership | inferred from an annex shape modelled on DC's | messages/permissions.ts ~120–135 |
| `core:genre/story` / `core:genre/chat` | fallback genre, inconsistently | sessionGenres.ts ~70; resolve.ts ~382; annexViews.ts ~55; runTurn.ts ~1605; host.ts ~10184–10327 |
| unused opt-ins | `turnSeatChanges`, `castFromLorebook`, `forms.modelAnswers`: no genre declares them | — |

## 2. `main` hard-coded

- Scene boundaries, the judged cue, the scenes routine: `main` only (scenes/boundaryWatcher.ts ~387, ~503, ~799).
- Scene summary due, earlier scenes, close-out stretch, settle's history entry: `main` only
  (sceneSummaryDue.ts ~94; earlierScenes.ts ~57; sessions/closeOut.ts ~45; settle.ts ~173).
- Turn and round cadences: the story lane only (`STORY_LANES = ['main','main:1']`, routines/moments.ts ~56;
  turnTally.ts ~42).
- **A second definition of a round**: rulesets/rounds.ts ~20 (an assistant row on the default channel) beside
  the turn tally's.
- Narrate and Continue with no channel mean `main` (sockets/sessions.ts ~11135–11178); the action list push is
  built for `main` (sessions/actionsPush.ts ~111); Summarize "all" reads `main` (sockets/summarize.ts ~165).

## 3. Events

- Host-only: message-completed / -settled / -stopped, cast-changed, session-updated, turn-ended, round-ended,
  scene-opened / -closed, session-archived, scene-summary-applied, history-settled (sdk/events.ts ~380+).
- `turn-order-changed` cannot be bound by a genre. No session-deleted, unarchived or closed-out event.
- Core listeners with no off switch (pipelines/runtime/sessionEvents.ts ~230–370, ~560–600): annex view push;
  open-form re-check; scene boundary hook and scene cast refresh; vectorization; turn tally; read-aloud;
  turn-order push + auto-advance (cap 12 per send) + your-move notice; routine cadence evaluation; goals reached.

## 4. Actions

- Every press runs under the session generation lock; a session-level press is refused while a person's line is
  being answered (sockets/sessions.ts ~3163–3239).
- Core code, not pipelines: Continue / Pick / Narrator turn, Retake, Back / Forward, Stop, Compile.
- Close out and summarize-world / -character / -history are found by fixed core action keys
  (sessions/closeOut.ts ~15; sockets/summarize.ts ~17).
- `ACTION_CARRIES = ['session','actor','speaker']` (sdk/entities.ts ~111).

## 5. Routines

- Queue: in memory, per session, one at a time, behind any action or event run (pipelines/routines/queue.ts).
- Caps = min(system, user, registration); a fixed 5-minute tick; after a restart, resumed only on interaction.
- A routine runs as the owner, takes no turns, never wakes a routine.
- Shared registrations every genre gets unless a preset drops them (cat/genres/defaults.ts ~132–210).

## 6. Lifecycle

Create is a replaceable pipeline (core seeds greetings itself if it fails); archive, branch and delete are core
only; delete has no event.

## 7. Once per session (columns on `sessions`)

`turn_order` (one document; entries may name a channel), the story clock, `settled_message_id`, backdrop,
`annex`, rigour and ruleset, `genre_fields`, the generation lock, the event chain, the routine queue, the
auto-advance counter. Per lane: `turn_tally` (only `main` has a round), composer states, lane reads, open scenes.

## 8. A plugin cannot

Place the five built-in write outlets; write characters or lorebooks; fire a turn from a listener or emit core
events; run Compile; bind `turn-order-changed`.
