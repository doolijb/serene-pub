# DESIGN — E-scenes: scenes handled by the genre, several messages late

Status: **draft, 2026-11-12. Not built; the owner's picks (★) come first, then a challenger round on the brief.**
Parent: `plans/PLAN-sensible-engine-2026-11-11.md` §5.8 row "E3, again" and §5.9 ("E-scenes moves ahead of the flip").

## The ruling (owner, 2026-11-11)

"These will be genre/preset responsibilities, not magic core behavior. I think scenes should be closed/created
after several messages once the contextual/time/location/presence boundaries are clear. Not right on the latest
round of messages. Compile scenes after several replies, not immediately, that gives time for changes to be made
and helps make sure compilations are available by the time the messages are most likely to exit the context
window." Earlier the same day: scenes are "Automatic unless off in the session or settings elsewhere. The minimal
story preset is probably the only example where we will not automatically handle scenes as it's intended for as few
llm calls as possible."

## What is true today (inventory 2026-11-12, every line cited by the inventory)

- **Core acts by default.** `DEFAULT_SCENE_SETTINGS` (`../serene-pub-sdk/sdk/src/sceneSettings.ts:157-168`) is
  Suggested with day crossed, time action and place changed on, summaries on request. Any genre that does not say
  `writes.scenes: false` is watched. No core genre declares a mode.
- **Suggested means a person.** The watcher (`src/lib/server/scenes/boundaryWatcher.ts`) runs on every landed line,
  writes a `scene_cues` row and shows a chip; a person answers. Under Automatic it calls `openScene` at once.
- **No lag.** A boundary goes at the newest landed line (`boundaryWatcher.ts:757`). The one exception is the Story
  sweep's model-judged check, which waits for six lines and places its boundary at a past line
  (`judgedSceneCheckOf` ~1176, `proposeJudgedSceneCue` ~1315).
- **Presence is not a trigger.** Time (day crossed, time action) and place are; a scene's cast is recorded but
  never read as a boundary.
- **A summary never finishes without a person.** On close or on request it runs to `review`; only a person's Apply
  makes it `done` (`sockets/scenes.ts:724`). At least three model calls per scene.
- **A preset cannot set scenes.** The cascade is session over genre over default
  (`resolveSceneSettings`, `sceneSettings.ts:359`); `sessionSceneContext` never reads the preset.
- **A scene's summary is not read by the reply.** The prompt reads the last messages within its budget; a summary
  reaches the model only after a person compiles it into a history entry. Messages that leave the window with no
  compile are gone from the prompt (`pipelines/runtime/bindings.ts:2470-2530`, `:2781`).
- **Automatic Apply runs when a scene closes** (`sense-b2`), so in default play held lorebook changes wait for a
  person to accept a boundary. That is why this lane comes before the Stage B flip.

## The design

1. **Core's default is nothing.** `DEFAULT_SCENE_SETTINGS` becomes Manual with no trigger on and summaries on
   request. A genre (or a preset, item 4) that wants scenes handled declares it. ★E1 (a published default moves).
2. **A boundary waits until it is clear.** New declared setting, proposed name `settle: { lines }` 🚧: a trigger
   that fires leaves its cue `pending` at the line where it fired. When the lane is `lines` lines past it, and the
   line still stands, the boundary is placed **at the original line** (the judged check's past-line path, reused).
   A swipe, a regenerate, Back or a delete of that line takes the cue with it, so nothing is placed for a turn
   that was replaced. A second trigger inside the wait does not stack: the earliest pending cue on a lane wins and
   later ones inside its wait are dropped. Under Suggested the chip is offered only once the wait has passed.
   ★E2 (how many lines).
3. **The shipped genres declare Automatic.** Story, the Lair and the Dungeon Crawler declare
   `mode: 'automatic'` with their triggers and the wait. A session's own setting still wins (Manual, Suggested).
4. **A preset may differ.** A preset gains a `scenes` layer in the cascade (session over preset over genre over
   default). Story's Minimal preset declares Manual and no summaries. ★E1 covers the new published field.
5. **Summaries run late, declared by the genre.** New summary mode, proposed `afterClose: { replies }` 🚧: a closed
   scene is summarised in the background once `replies` replies have landed after its close, never while a newer
   line of that scene could still be swiped away. What happens to the result is ★E3.
6. **Shown, with its cause (P1).** The divider of an automatically placed boundary says which trigger placed it
   (it already carries the cue's reason) and offers **Not a scene** (undo: removes the boundary, as the divider's
   existing action does). The session's scene settings say, in one sentence, that this genre begins scenes by
   itself and where to switch it off.
7. **Presence** is not added as a trigger in this lane. ★E4.

## What this does not do

- It does not put scene summaries into the reply's prompt. Today they reach the model only through a compiled
  history entry. That gap is real and is the second half of the owner's sentence ("available by the time the
  messages are most likely to exit the context window"); it belongs with the lorebook's automatic history compile
  (Stage B D13/D14) or a prompt lane of its own. ★E5 asks which.
- It does not change what a scene is, the cue chip, Mark as scene, or Close out.
- No new table. `scene_cues.state` is text, so a waiting cue needs no migration.

## Stored data and upgrades

- Existing sessions with no stored scene override start following their genre: Story, Lair and Dungeon Crawler
  sessions become Automatic with the wait. A session that stored a mode keeps it.
- Cues already offered under Suggested stay offered.
- A plugin genre that declared nothing and relied on core's Suggested default gets Manual. Release note; the
  validation pass warns a genre that writes scenes and declares no mode.

## The owner's picks

- **★E1** Core's default becomes "nothing unless declared", and presets gain a scenes layer. Both move published
  SDK behaviour. Recommended: yes, as ruled.
- **★E2** The wait. Recommended: **4 lines** past the boundary.
- **★E3** A late summary's result. Recommended: **saved by itself** (it becomes the scene's summary, marked as
  written automatically, with Edit and Redo), in Story's Living and Rule Based presets, the Lair and the Dungeon
  Crawler; never in Minimal. Alternative: held for review as today (then held lorebook changes for that scene wait
  on the person, by the 2026-11-12 ruling). Cost either way: at least three model calls per scene.
- **★E4** Presence as a trigger. Recommended: later, as a genre-declared trigger, once the wait exists; a cast
  member stepping out for one line is the noisy case the wait is meant to absorb, and it needs its own tests.
- **★E5** Scene summaries in the prompt for scenes whose messages left the window. Recommended: a lane of its own
  right after this one (it is a comprehension fix, the owner's first priority), reading `done` summaries where the
  messages no longer fit, before any compiled history exists.

## The owner's answers (2026-11-12)

- **★E1** "Core does nothing unless declared" — accepted. "Existing sessions follow their genre" — accepted.
- **★E3** "Saved by itself, editable (Recommended)".
- **★E4** "Presence as a trigger, later" — accepted.
- **★E5** "Yes, as its own lane next (Recommended)".
- **★E2** not ruled: the owner asked "How long from where?" and then "Define cut"; both were answered in words
  (the wait counts messages landing after the message that crossed the boundary; when it is over the old scene
  ends at the line before, a divider shows, the scene can be summarised, its held lorebook changes apply and the
  story settles through the newest applied change). **Working value: 4 messages**, one declared number per genre,
  to be changed if the owner names another or asks for rounds.

- **★E2 ruled (owner, 2026-11-12): "Have core genres detect 2 rounds".** The scene wait is counted in **rounds**,
  and the core genres declare 2. The setting is therefore `settle: { rounds }` 🚧 (a round as the turn order
  already counts it: every seat in play has had its turn; in a one-to-one session that is two messages). Lead's
  assumption, said to the owner: the summary's own wait uses the same unit and the same value (2 rounds after the
  scene ended) unless the owner names another.

- **The compile's depth (owner, 2026-11-12): "Core genres should trigger the scene/history compilation maybe 6
  rounds deep?"** This replaces the lead's assumption of 2 rounds for the summary's wait: core genres start a
  scene's compilation about **6 rounds** after the scene ended (the owner's "maybe": a working value, one declared
  number). It names "scene/history" together, so the later build lane treats the scene's summary and the history
  compile it feeds as one declared step to design, not two.

## Split (lead, 2026-11-12, after the challenger round and the owner's "You're over complicating it")

- **Build lane `sense-scn` (launched):** design items 1–4, 6, 7 only: core's default is nothing; the wait of 2
  rounds with a re-check when it ends; a turn owns its waiting cue; presets carry scenes inside their existing
  settings; the three genres declare Automatic, Story Minimal declares Manual. **No summaries.**
- **A later build lane, scene and history compilation:** item 5, at 6 rounds deep, saved by itself and editable.
  Still to settle with the owner before it is built: what an unreviewed save does with the model's scene name,
  the cast and any new characters it suggests (lead's lean: the summary only, known cast only, no new characters);
  whether a self-saved summary may settle the story with no person involved ("Only Apply settles"); whether held
  lorebook changes wait for a compilation that is scheduled but not started (today they apply at the close).
  It pairs with ★E5 (summaries in the reply's prompt).

## Built, and three more rulings (2026-11-12)

`sense-scn` is BUILT, reviewed and verified: `plans/REPORT-sense-scn-2026-11-12.md` (boundary detection is the
routine *Find where scenes begin*, every 2 rounds, reading lines at least 2 rounds old).

- **What a self-run compilation saves (owner):** "Summary, name, known cast. Keep the new characters as a toggle
  in the pipeline that's off by default."
- **A purpose sentence on a routine that calls no model (owner):** "Yes allow it".
- **Side channels (owner):** "Accept it, but keep in mind that genres should be able to track seperately scenes for
  side channels OR include them. It's up to the genre/pipelines to decide how the story is organized and tracked.
  I.e. a text conversation or 2 people in one place and 2 people in another place at the same moment." So: main
  only is accepted for the core genres now; the routine's channel handling must stay a genre's declaration (which
  channels it reads, together or apart), never a rule core fixes. Nothing built for it yet.
- **Lead's decisions for the compilation routine, from standing rulings:** a self-saved compilation does not move
  the settled point by itself ("Only Apply settles"); held lorebook changes apply when the scene ends and do not
  wait for a compilation that has not started ("At scene close, unless a summary waits").
