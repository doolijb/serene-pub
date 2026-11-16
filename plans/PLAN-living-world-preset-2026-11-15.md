# PLAN (draft, lead's design; nothing built) — an experimental Story preset: each character knows only what it was there for

Owner, 2026-11-15: "Lets add an experimental preset to Story genre where we can test the concepts out. For the
session ui, I'd like to figure out a good way to show what's most relevant in the story in the primary tab, i.e.
what's relevant to the active persona right now. Keep in mind the session may have guests. Also a way to switch to
tabs that show what other cast members may be up to." Then: "I'll let you run with your own ideas. Think hard and
carefully and test out 20 difficult to handle scenarios to test out your plans. We want efficiency, but also
effective for creating a living world that feels natural and real to play in." And: "don't forget to finish our
sprints for finishing up the lorebook and everything related" (the lorebook lanes stay first).

Earlier the same day (verbatim in `BACKLOG-2026-11-04.md` §3): "Not so much a seperate history, but a per
character filter on what gets put into their context"; the call-in ("A yells for C … C gets pulled into the
seat with additional context filled in for where they were"); "Exits too. But that's tough"; the store example
("C returns home, the LLM whispers to her some things she can overhear"); "The character that departed
temporarily would need to have a seperately tracked scene … History entries become less reliable"; withdrawn:
place types and scenes spanning locations. Standing: Decay never puts text in a prompt; Bench is not absence;
no position / location-detail stat in core; P1–P6.

## 1. What the code already has (inventory 2026-11-15, file:line in the transcript's inventory report)

Fits: runtime **lanes** of the main channel (`main:2`, … no declaration, `messages/channels.ts` ~259); **one open
scene per lane** (`schema.ts` ~4971); a scene cue can open a scene on a chosen lane (`outlets.ts` ~807); turn
entries carry a channel (`sdk/src/turnOrder.ts` ~45); a Messages copy can be pinned to a lane; the composer can
be closed per person with a reason (`set-composer-state@1`); a person can edit a scene's cast (`scenes:update`);
holder-only text in one character's prompt (`earshot: 'holder'` slots); one model call per speaker in Story;
the **reckoning** already makes one JSON call after each round that reads the newest lines.

Gaps: no per-character filter on history (Story's reply reads every lane, `respond.ts` ~563); the turn pool
cannot be limited to a scene's cast; a scene's cast is proposed from **every active seat** (so today it never
says who is absent); no outlet changes a scene's cast or closes a scene; lanes get no tabs; one reply at a time
per session (generation lock); a preset cannot ship a layout, channels, host state or `writes`; nothing marks a
preset experimental; the scenes routine reads lane 1 only.

## 2. The model (five rules)

1. **A thread is a lane.** Wherever part of the cast is, that is a lane of the main channel with its own open
   scene. The first lane is where the story starts.
2. **A scene's cast is exact.** In this preset a scene's cast is who is there, nothing more. A character is in
   at most one open scene. A seated character in no open scene is **away**: it takes no turns, nothing is
   generated for it, and it costs nothing.
3. **An entrance or an exit begins a new scene on that lane**, at the message where it happened (as stage plays
   number scenes). So a scene's cast holds for the whole scene and no time ranges are stored.
4. **A character's context is the scenes whose cast holds it**, across lanes, in order: conversation, scene
   summaries, and a History day only when it was in every scene compiled into that day (else its own scenes'
   summaries). This is lane `time-t6b`'s filter, read **by cast** here and **by who spoke** in other presets.
5. **Nothing happens unseen.** A lane moves only when someone plays in it. An away character's time off is not
   simulated; when it comes back, one sentence says where it was.

Consequences: the per-message stamp of lane `time-t6a` is not needed (drop it); no location stat, place type or
hearing range is needed (a place is the scene's label); Bench keeps its meaning (silent, present).

## 3. Entrances and exits

**By hand (always):** on a scene's menu, *Bring in…*, *Send away…*, and *Follow ‹name›…* (opens a lane for an
away character, with a place label). A person writing as their persona in a lane's tab is that persona entering
it. A person's persona is never moved by the model.

**By the model, with no extra call:** the reckoning's JSON gains one field per round: for each character in the
scene `here | stepped out | gone`, for each away character `elsewhere | called | here`, plus one sentence of
where an arriving character was. Code decides the rest:

- `stepped out` and `here` change nothing (errands, the porch, asleep, "I should go").
- `gone` is an exit, **unless everyone in the scene is gone** (the group moved on: the existing scene-change
  path, not an exit).
- `called` or `here` for an away character is an entrance; when the lines did not narrate it, a visible stage
  direction is written (*Corin comes down from the loft, rubbing his eyes.*).
- The boundary is placed at the message that caused it, so what was said after an exit is not in the leaver's
  context even though the judgement ran at the end of the round.
- Each move shows its cause and one-tap undo (*Brought in: Aldric called him* · **Not here**; *Left the scene* ·
  **Still here**), and Back or Regenerate of the causing message takes the move back.

**Arriving:** the arriver's context gets the scene's last line before its entrance, marked as overheard (code,
no model). A fuller model-written "what you notice walking in" is a later option, measured first.

## 4. Measured 2026-11-15 (`plans/measurements/m5*.py`, 20 hard lines × 3 seeds × 3 local models)

| Question shape | 12B (a) | 12B (b) | 24B |
|---|---|---|---|
| Two lists, "who left / who arrived" | 36/60, **15 wrong exits** | 49/60, 8 wrong exits | 51/60, 6 wrong exits |
| Per-character status with a *stepped out* bucket, + the group-move guard in code | 54/60, **0 wrong exits** | 57/60, 0 | 54/60, 0 |

The second shape never stranded a character. What is left wrong is on the cheap side: an extra entrance (a
character heard through the ceiling, or sent for but not yet arrived, comes in: one tap undoes it) and, on one
model, a call up the stairs or an exit not noticed (the hand action covers it). The first shape must not be
used. Not yet measured: the same field riding inside the reckoning's larger JSON; the arriving sentence.

## 5. The screen

- The Messages widget gets **a tab per lane** when a session has more than one, labelled by the lane's place and
  the faces in its open scene (*the Store · Corin, Dessa*); the dot for unread lines already exists per tab.
- **Your lane is first and selected**: the lane your active persona is in. When your persona moves, the
  selection follows. Each guest's screen follows their own persona.
- Other lanes are readable by everyone by default (host can hide them: the genre's existing audience rule). You
  write only where your persona is; elsewhere the composer is closed with *‹persona› isn't here.* The host may
  direct any lane.
- An away character shows in the cast strip as away, with *Follow…* and *Bring in…*.
- Later, not first: a single merged "viewpoint" log across lanes (needs a filtered message request).

## 6. Twenty hard scenarios walked against the model

| # | Scenario | What happens | Verdict |
|---|---|---|---|
| 1 | C makes tea and is back within one message | `here` | OK (measured 9/9) |
| 2 | C goes to the kitchen, returns three messages later | `stepped out`: stays, hears the room | OK; slightly generous, by design |
| 3 | B storms out | exit at that message; new scene A, C; B away, no turns | OK (measured, never missed on 2 of 3 models) |
| 4 | A bellows upstairs for C, who is away | `called`: entrance, stage direction, C overhears the call | OK on 2 models; 1 model misses it → *Bring in…* |
| 5 | "I wish C were awake to hear this" | `elsewhere` | OK (9/9) |
| 6 | A shouts for T, who is three days away | `elsewhere`; one model brings T in | Limit: wrong entrance, one tap undoes; the cause line shows why |
| 7 | The whole party walks to the docks | all `gone` → code: group move, same lane, scene change | OK by the code guard (models alone got it wrong 9/9) |
| 8 | B leaves as D walks in | exit + entrance at one message, one new scene | OK; one model missed the exit 2/3 |
| 9 | A person follows C to the store | *Follow…* opens lane 2, scene "· the Store", cast C | OK; nothing was generated for C before this |
| 10 | C meets D there, they talk, D leaves | D enters by narration or *Bring in…*; later exits; both hold that scene | OK; A and B never get it |
| 11 | C comes home | lane 2's scene closes; entrance on lane 1; C overhears the last line; A, B know nothing of the store | OK |
| 12 | Nobody ever follows C | no lane, no calls; on return the reckoning's one sentence says where C was | OK: the default, as cheap as Living |
| 13 | Host at home, a guest's persona at the store, both playing | two lanes move; replies queue (one generation per session) | Limit: threads take turns; fine on one GPU, stated in the docs |
| 14 | The model narrates a person's persona leaving | ignored; a quiet suggestion at most | OK: a person's character is theirs |
| 15 | Back / Regenerate on the message that caused an exit | the move is part of the turn's record and is taken back | **Needs building and a test**: scene moves must be undoable with their message |
| 16 | A narrator (envoy) speaks on lane 2 | it reads its own lane's scenes only, not the other lane | **Needs a rule in the filter**: an envoy is filtered by lane, or it leaks |
| 17 | The reckoning writes lore from the store scene (D's rumour) | the entry could be recalled into A's prompt | **Open**: filter recall by the entry's source scenes, or the *not common knowledge* mark (T6c). Until then the preset's lore writes are reviewed, and the docs say so |
| 18 | C away for forty messages | returns with one overheard line and no summary of home | OK and natural: C can ask what it missed |
| 19 | A day with five short scenes on two lanes is compiled to History | the day mixes both lanes; C gets its own scenes' summaries instead | OK by rule 4; costs more summaries; very short scenes should stay verbatim |
| 20 | The story clock: store played 14:10–14:40, then cut home | the clock is shared and never rewinds on a cut; the other lane is "meanwhile" | Limit: no per-lane time; avoids the clock-moved-back handling |

Found by the walk and folded in above: the list-shaped question (dropped), the group-move guard, the boundary at
the causing message, envoys filtered by lane, undo with the message, lore from a side scene.

## 7. What has to be built, in order (each useful alone; core pieces are opt-in per pipeline)

| Step | What | Where | Depends |
|---|---|---|---|
| 1 | The filter: history and scene summaries by cast or by who spoke, across lanes; envoys by lane | core + SDK (`time-t6b`, brief to revise) | — |
| 2 | Exact scene casts for a genre that asks; an outlet that moves a character in or out (new scene at a message, undoable); open a lane | core + SDK | 1 |
| 3 | Turn pool limited to the lane's scene cast | SDK | 2 |
| 4 | Lane tabs in the Messages widget; your lane first; composer closed elsewhere | widget + layout | 2 |
| 5 | The preset: reply with the filter, the reckoning field, the hand actions, the arriving line | Story genre | 1–4 |
| 6 | History day filter; lore from a side scene | core (lorebook) | 1 |
| — | Drop the `time-t6a` stamp (forward migration) | core | owner's word |

Steps 1–4 by hand first (no model judgement) lets the split be played before the reckoning field is added.

## 8. Open, for the owner (none blocks the lorebook lanes)

- ★LW-1 the preset's name (lead: 🚧 *Ensemble*) and how "experimental" is shown (nothing marks a preset today;
  lead: say it in the preset's description, no new flag).
- ★LW-2 others' lanes readable by guests by default (lead: yes).
- ★LW-3 drop the `time-t6a` stamp (lead: yes).
- ★LW-4 scenario 17: reviewed lore writes for this preset until the knowledge mark exists (lead: yes).
- A preset cannot carry a layout or new capabilities today; the lane tabs are a widget feature every genre gets,
  so no preset-only layout is needed.

---

## 9. REVISION after the cold review (2026-11-15) — this section rules over §2, §3, §5 and §7 above

The review broke three of the five rules against the code. The design is rebuilt smaller.

### What was wrong

- **A second channel lane breaks what Story runs on.** Rounds, the reckoning, the clock tick, the scenes
  routine, earlier scenes and summaries all read `main` lane 1 only (`routines/turnTally.ts` ~21–42,
  `routines/moments.ts` ~402, `scenes/earlierScenes.ts` ~54, `sceneSummaryDue.ts` ~94); a person's line on
  lane 2 would even blind lane 1's reckoning (`core-catalog/src/shared/reckoning.ts` ~365–376). One turn order
  per session cannot hold two pools.
- **"In no open scene = away" deadlocks.** Story's first scene opens a couple of rounds late, branch sessions
  copy no scenes, and Manual / Suggested modes open none: nobody could speak.
- **A new scene per entrance or exit is expensive**: a transaction with two locks, two cast proposals, routine
  moments, held changes applied at each close, and a summary backlog that grows faster than it drains
  (`liveScenes.ts` ~1454–1469, `sceneSummaryDue.ts` ~44).
- "The boundary at the message that caused it" had no source (the reckoning reads plain text, no ids).
- Wrong claims: guests' reading of other lanes cannot be hidden (`channels/lanes.ts` ~62–88); filtering a
  narrator by lane contradicts ★6 (2026-11-14: "where one model voices everyone, nothing can be left out").
- Words: **Ensemble** is retired (§23, 2026-10-19); **overheard** was vetoed 2026-11-10; a bare "lane" is the
  indexing sense: the session sense is **channel lane**.

### The model, rebuilt (four rules)

1. **One channel, played by cuts.** Everything stays on the main channel's first lane. Following C to the store
   is a **cut**: the story's focus moves to C's group; going home is another cut. A cut is a scene change (the
   existing kind). Nothing runs at two places at once, which rule "nothing happens unseen" wanted anyway, and
   which the one-reply-at-a-time lock already forced.
2. **Where each character is, is stored state with history.** A cast-level value (🚧 *whereabouts*: a short place
   label, e.g. `the inn`, `the store`, or empty = with the group in focus) kept by the genre, written by a
   person, by the reckoning, or by a script, and **anchored to the message it changed at** as stat values
   already are (`attribute_values.valid_from_message_id`, read by `state/statTrail.ts`; a swiped or rewound
   message's values are already removed there). Scene casts are not used for presence and are left as they are.
   No scene is opened or closed by an entrance or exit.
3. **A message is witnessed by a character when their whereabouts in force at that message equals the
   speaker's.** That is the per-character filter (lane `time-t6b`'s location half, which the review of that
   brief found readable today). A message whose speaker has no value is witnessed under the scene rule (spoke in
   the scene). Scene summaries: kept for a character that witnessed the scene's last message or more than half
   of its messages (a stated limit: a summary is not cut in two). History days: by the scenes compiled into
   them, as §2 rule 4 (needs a read by witness for compiled scenes: none exists, `earlierScenes.ts` ~55).
4. **The turn pool is the group in focus**: the characters whose whereabouts equals the focus (the newest
   message's speaker's). The others take no turns and cost nothing. A cut changes the focus.

Entrances and exits are then just a change of one character's whereabouts: the reckoning's per-character status
(§4's measured shape) maps `gone` → a new label taken from the lines or *elsewhere*; `called` / `here` → the
focus's label; `stepped out` → no change; everyone `gone` together → the group's label changes (they moved on).
The change is anchored **by code** to the last line of the round in which the character speaks or is named (no
message ids from the model). Undo is the stat path's own: Back and swipes already remove the value. A limit to
state: a regenerated line is not judged again until the next round.

An arriving character's sentence ("where they were") is a visible line in the story; the *private note of what
they notice walking in* is a later, measured option (the word *overheard* is not used: 🚧 *on arriving*).

### The screen, rebuilt

- No channel-lane tabs. The Messages widget gets **views of the one log**: the first, *‹your persona›* (what
  your active persona witnessed: the same filter the model uses), then one per place that has characters
  (*the inn · Aldric, Bren*), then *Everything*. This needs one new filter on the messages request (by witness
  or by place); tabs otherwise exist.
- You write where your persona is. Writing while viewing another place is refused with *‹persona› isn't there.*
- Guests: every member can read every view; there is no way to hide a place today. Said plainly in the docs; a
  secrets-heavy game needs the owner-only channel that already exists.
- An away character shows its whereabouts in the cast strip, with **Cut to…** (move the focus there) and
  **Bring here…** (set its whereabouts to the focus).

### The twenty scenarios, re-walked (only the ones whose answer changed)

| # | Now |
|---|---|
| 3, 8 | An exit is a whereabouts change anchored at the leaver's last line; no new scene |
| 7 | Group move: every focus member's label changes together; one scene change as today |
| 9–11 | *Cut to C* moves the focus (a scene change); D arrives by narration or **Bring here**; cutting home is another scene change; C's value changes back and A, B never witnessed the store |
| 12 | Nobody cuts to C: nothing generated; C returns with one sentence. Unchanged, still as cheap as Living |
| 13 | Host and guest in two places: play alternates by cuts; a person whose persona is not in focus waits or cuts. **A real limit of the first cut**; two live places need per-lane rounds, turn order and reckoning (a later programme) |
| 15 | Undo is the stat path's: built already; test it for this value |
| 16 | A narrator reads everything (★6). Limit stated: with a narrator in the pool, what it narrates at one place can carry what happened at another |
| 19 | No extra scenes, so no summary backlog; summaries follow rule 3 |
| 20 | One channel: the clock just runs; a cut never needs to rewind it |

### Cost per round (to measure when built, performance-plan style)

Model calls: **+0** (one field in the reckoning's existing JSON; tokens: roughly one line per seated character in
the question, one word each in the answer). Statements: the filter reads the whereabouts trail once per reply
(one grouped read, no query per message); a move writes one stat row. Prompt-prefix reuse: each speaker's
history differs from the first message it missed, as any per-character filter must.

### Build order, rebuilt

| Step | What | Where |
|---|---|---|
| 1 | The filter on history and scene summaries: by who spoke (other presets), by whereabouts (this one) | core + SDK: `time-t6b`, brief to revise |
| 2 | A cast-level whereabouts value for Story (declared by the genre, used only when a preset writes it); turn pool by focus | SDK + Story genre |
| 3 | Messages views by witness and by place; **Cut to…**, **Bring here…** | widget + session page |
| 4 | The preset: the reply with the filter, the reckoning field, the arriving sentence | Story genre |
| 5 | History days by witness; lore written at a place others were not at | core (lorebook) |
| later | Two places live at once (per-lane rounds, turn order, reckoning) | programme |

Steps 1–3 by hand first; step 4 adds the model's judgement.

### Open for the owner (replaces §8)

- ★LW-1 the preset's name (not *Ensemble*; lead's proposal 🚧 *Story · Whereabouts*; any distinctive word of his)
  and that "experimental" is said in its description (no flag exists).
- ★LW-3 drop the `time-t6a` per-message stamp (lead: yes; nothing in this design reads it).
- ★LW-4 lore written at a place: reviewed for this preset until the knowledge mark exists (lead: yes).
- ★LW-5 the narrator limit (★6 stands; lead: accept and state it).
- ★LW-6 a whereabouts value is a place label per character. The owner declined a *position / location-detail*
  stat in core on 2026-11-14 ("don't add it for now"); this is the coarser "which place", kept by the Story
  genre, not core, and written only under this preset. Quote both when asking.
