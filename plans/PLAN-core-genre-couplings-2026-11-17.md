# PLAN — Phase 3: core stops special-casing genres (read-only plan, 2026-11-17; nothing built)

Programme Phase 3 (`PLAN-programme-2026-11-15.md` 194–202), under the owner's "I need them all to be build out"
(2026-11-15). Facts re-verified today against the code; app paths under `src/lib/server/`, `sdk:` =
`../serene-pub-sdk/sdk/src/`, `cat:` = `../serene-pub-sdk/core-catalog/src/`. Lane ids `cpl-<letter>`.

## 1. Short answer

**Buildable now, no owner decision** (no stored data, no published name, shipped genres behave identically):
- **3.6** one fallback genre (Story) everywhere.
- **3.8** (main part) every summarizer found by its action key in the session's registrations, as close out
  already is.
- **3.1** (main part) one core helper names the story channel from the SDK's existing `ChannelDecl.lore`; every
  `main` literal in scenes, summaries, earlier scenes, close out, settle and the turn/round lane reads it. For
  the five shipped genres it returns `main`, so no prompt or test changes.

**Need one line from the owner each:**
- ★3.1-A "May a genre make another channel its story channel instead of `main`? (one story channel per genre)"
- ★3.2 "A ruleset's *round* becomes the session's round (in a group, three rounds = three full rounds, not
  three replies)?"
- ★3.3 "Permission gates declared as a shape property naming their field, the `castFromLorebook` way?"
- ★3.4 "Core listeners become registrations of named core listeners; vectorization and the form re-check
  stay core?"
- ★3.5 "Goals key from the sweep's duty, table slug moved into the SDK, and a boot pass that files old lanes?"
- ★3.7 removes names three of your rulings created, and one is declared by a package outside this repo: remove,
  or deprecate with a warning?
- ★3.8-B "Retire `GenreDecl.summarize.scene` (registration only)?"

**Order:** `cpl-A` (3.6 + 3.8) and `cpl-B1` (3.1, turns and rounds) now, side by side → `cpl-B2` (3.1, scenes;
after `cpl-A` and `wt-1a`) → `cpl-C` (3.2) → `cpl-D` (3.5) → `cpl-E` (3.3, after 2.3) → `cpl-F` (3.4, after
2.6) → `cpl-G` (3.7, in the pre-0.7 breaking batch: "Breaking SDK shapes land together before 0.7",
programme 214).

### What moved since the inventory (2026-11-15)

| Inventory said | Today |
|---|---|
| `characterDetail` host.ts ~6319 | `pipelines/runtime/host.read.sessionCast.ts` 608–623 (host split); `prompt/promptFields.ts` 64, 397 |
| `narratorInterjections` host.ts ~8673 | host.ts 3338 |
| `showDice` host.ts ~2854 | host.ts 785–797 (`diceHiddenFor`); `messages/diceWords.ts` 27, 144 |
| `turnMode` host.ts ~623 | `runtime/host.helpers.ts` 118 |
| goals host.ts ~3108 | host.ts 1091–1098 |
| Narrate / Continue sockets/sessions.ts ~11135 | `sockets/sessions.turns.ts` 189, 232, 401, 716 (split) |
| fallback host.ts ~10184–10327; runTurn ~1605 | host.ts 4849, 4869, 4936, 4992; `runTurn.ts` 1613 |
| earlierScenes ~57; handEdits ~105 | 61; 104–111 |
| vectorization is a `sessionEvents.ts` listener | **wrong**: host.ts 4012 → `host.helpers.ts` 56–72, after a run's live row |
| close out and summarize by fixed keys | close out is already by registration, by key (`sessions/closeOut.ts` 18–31); world / character by the core spec's **exact identity** (`sockets/summarize.ts` 16–29, 207–213); scene summarizer by `GenreDecl.summarize.scene` (`scenes/liveScenes.ts` 1774–1840) |
| lane membership by annex shape | still (`messages/permissions.ts` 119–163), but that map is ⏳ retired since 2026-10-17 and written by nothing (`cat:shared/annexField.ts` 161); core's register replaces it (`channels/lanes.ts` 265 `laneOwner`) |
| three opt-ins "no genre declares them" | true of the five shipped genres; **false for `castFromLorebook`**: a package outside this repo, ported under the owner's ★M3-4, declares `{ field: 'examples' }` |
| `roundWorth` a coupling | it is the published query the owner ruled ("sdk provides an API to grab the setting, if opted in and pipelines can act on it", 2026-11-11): stays |
| not listed | `sessions/rewind.ts` 90 (its own `STORY_LANES`); `cat:shared/sceneBoundaries.ts` 79 (`channel: 'main'`); host.ts 4442, 4512; `scenes/liveScenes.ts` 1278, 1345; `sessions/tableLine.ts` 48; `sessions/annexInspect.ts` 123; `sessionEvents.ts` 737; `registrations/fit.ts` 103; `db/sessionLayoutPanels.ts` 96; three client copies of the fallback |
| gone | nothing listed is gone; `db/schema.ts` 2588 makes `genre_id` NOT NULL default Story, so the Chat fallbacks fire only for a missing row |

## 2. Per item

### 3.1 Scenes and summaries follow the story channel
- **(a) Today:** `scenes/boundaryWatcher.ts` 387, 503, 799, 1027, 1357; `scenes/sceneSummaryDue.ts` 94;
  `scenes/earlierScenes.ts` 61; `sessions/closeOut.ts` 45, 61; `sockets/scenes.ts` 2887–2943
  (`fileClosingScenes`); `sessions/settle.ts` 173; `sockets/summarize.ts` 165; `runtime/host.read.summarize.ts`
  239; host.ts 4442, 4512 (scene cue and note default); `liveScenes.ts` 1278, 1345; `cat:shared/sceneBoundaries.ts`
  79; the turn/round lane: `routines/moments.ts` 56–61, 115, 260, 407, `routines/turnTally.ts` 42, 190,
  `routines/evaluate.ts` 371–385, `sessions/rewind.ts` 90, 152, 178, 317, 870–882. The SDK already declares it:
  `ChannelDecl.lore: 'story' | 'aside' | 'never'` (`sdk:descriptors.ts` 1425–1437), `channelLoreRole` (1561),
  `main` refused anything but `story` (1680); the summarize factory checks it (`cat:shared/summarize/summarizeScene.ts`
  150–170).
- **(b) Coupling:** core reads `main` where the genre has already said which channel is its story.
- **(c) Change:** one helper `storyChannelOf(shape)` (`channels/storyChannel.ts`, new file) over
  `channelLoreRole`, lane 1 only; every site above reads it; the scene-boundaries spec drops `channel: 'main'`
  and the host defaults the cue to the story channel (new spec version). With ★3.1-A: the SDK refuses two story
  channels and lets `main` be `aside` / `never` when another channel is `story`.
- **(d) Seen:** nothing for shipped genres. A modder's second `lore: 'story'` channel is refused (★).
- **(e) Data / names:** none stored (scenes stay on `main`); no published name; one validation rule changes (★).
  No boot pass.
- **(f) ★3.1-A** one story channel per genre (★ recommended; one turn order per session cannot hold two round
  pools, as the living-world revision found) vs many (each with scenes and rounds: needs per-lane turn order,
  the "two places live at once" programme).
- **(g) Pins:** `scenes/boundaryWatcher.int.test.ts` 381; `scenes/sceneSummaryDue.int.test.ts` 178;
  `sockets/sessions.closeOut.int.test.ts` 76, 101; `sessions/settle.int.test.ts` 306;
  `routines/turnTally.test.ts` 104; `sessions/rewind.int.test.ts` 967–1072; `pipelines/boot/specHashes.test.ts`.

### 3.2 One definition of a round
- **(a)** The tally's round (R52): ends when every active speaker (the turn order's `candidates` and entry
  speakers, plus each person who spoke) has had a turn (`routines/turnTally.ts` 109–143; `moments.ts` 407). The
  second: a ruleset "round" is one assistant row on `main` (`rulesets/rounds.ts` 20–37), read by
  `rulesets/resolve.ts` 591 and `engine.ts` 2380, 2423 (`startedAt.turn`). NOMENCLATURE flags the R1 collision
  (§4 **session moments**).
- **(b)** Two counters answer "a round"; a ruleset's `unit: 'round'` (`sdk:rulesets.ts` 224) means a reply.
- **(c)** The turn-order pipeline already states who a round waits for (`candidates`). Remove
  `rulesets/rounds.ts`; the handler's `turn` reads the tally's `session.round`; the round lane is `cpl-B1`'s
  helper. New timed pieces store `startedAt.round`; ⏳ an old `startedAt.turn` keeps the reply count until it
  expires.
- **(d)** In group sessions with rulesets, "lasts 3 rounds" lasts three full rounds. One-to-one unchanged.
- **(e)** Timed pieces' `startedAt` in attribute values: read both forms (no rewrite) or a boot pass; no published
  name removed (`unit: 'round'` keeps its word and gains one meaning).
- **(f) ★3.2** as above (★ recommended) vs rename the ruleset count (a published unit: owner's call). Not now:
  an explicit "round waits for" field on the turn order; if 2.3 changes what `candidates` means, it rides 2.3's
  SDK change.
- **(g)** `rulesets/handlerWave3.test.ts` 91, 423; `rulesets/resolve.int.test.ts` 389–397;
  `messages/rewindMirror.int.test.ts`; `routines/turnTally.test.ts` 27–92.

### 3.3 Genre settings core acts on by name
- **(a)** Prompt-shaping: `characterDetail` (`host.read.sessionCast.ts` 608–623), `showDice` (host.ts 785–797),
  `authorsNote` (`prompt/templateContext.ts` 309–314; offered by declaration, `sessions/authorsNote.ts` 70–74).
  Turn-shaping: `narratorInterjections` (host.ts 3338 stamps `turnCause`). Gates: `keepEveryTurn`
  (`messages/verbs.ts` 663–790, `sessions/settings.ts` 355–369), owner / player sheet latitude and item moves
  (`state/handEdits.ts` 104–111), `tools` + family `assistant` (`runtime/tools/webTools.ts` 211–232,
  `writeTools.ts` 166–179). The field declarations live in `cat:registry/genres.ts` 77–463.
- **(b)** Core knows the catalogue's field keys.
- **(c)** Owner, 2026-11-15: "if one configuration setting is good for one genre, and not for the other, then it
  belongs as an explicitly written node, not a helper function"; 2026-09-30: "No magic in core". Prompt-shaping:
  each becomes a param of the step that already reads (cast read `detail`, history read outcomes in words,
  assemble's note), wired by the genre from its own published field, so `genre_fields` keys stay. Turn-shaping:
  the voices step's entry carries `every`; the write takes it from the entry. Gates: ★3.3.
- **(d)** Nothing for players. A modder sees the wiring in the spec.
- **(e)** No stored data moves. Spec versions bump (Story, Chat, Lair, Dungeon Crawler); new shape properties (★).
  `autoAdvance` and `turnMode` are 2.3's (S1, 2026-11-15: "Core's silent Auto-advance default … goes"; the
  model's option becomes a registered entry, 2026-11-15 night). `roundWorth` stays by ruling. `readAloud` is 3.4.
- **(f) ★3.3** gates: (a) a shape property naming the field, as `castFromLorebook: { field }`
  (`sdk:descriptors.ts` 1058) ★ recommended; (b) a marker on the `FieldDecl`; (c) keep the keys and publish
  them from the SDK.
- **(g)** `messages/diceWords.test.ts` 40; `state/handEdits.int.test.ts` 325, 343;
  `sockets/sessions.dungeonCrawlerFixTurn.int.test.ts`; `sockets/sessions.taskVoices.int.test.ts`;
  `sockets/sessions.chatMemory.int.test.ts`; `runtime/tools/webTools.test.ts` 8; Story and Lair prompt
  baselines (Chat and Dungeon Crawler have none: add a first-turn pin).

### 3.4 Core listeners become registrations
- **(a)** `pipelines/runtime/sessionEvents.ts`: form re-check 253–268, scene hook 270–296, read aloud 298–312
  (gate `speech/onMessageSettled.ts` 194–197; three genres spread `SPEECH_FIELDS`, `cat:registry/genres.ts` 657,
  967, 1405); goals host.ts 1091–1098; vectorization host.ts 4012. Staying core (the S10 charter, 2026-11-15:
  "Turn order and continue determine how the session responds to a user sending a message"): annex views
  237–251, turn tally 317–343, turn-order push / Auto-advance / your move 545–595, routine evaluation 636–654.
- **(b)** A genre or preset cannot drop them.
- **(c)** SDK: named core listeners (`core:listener/<slug>`, the event map's existing id form, NOMENCLATURE §25
  "event map") that `register()` accepts; `effectiveRegistrations` merges them; a preset `drop`s one. The host runs
  one only while its registration is in force. Shipped genres register the ones they use in `cat:genres/defaults.ts`.
- **(d)** None for shipped genres. A preset can drop read aloud or the goals note. A plugin genre gets only what it
  registers (owner, 2026-11-16: "no one has shipped a plugin, and we can still freely edit our core catelogue").
- **(e)** Genre rows re-project at boot; no pass. A new `RegistrationDecl` arm: published shape.
- **(f) ★3.4** (a) listener handles ★ recommended; (b) each becomes a real pipeline (bigger: host-internal
  outlets); (c) a shape switch (a preset cannot drop it). Keep vectorization (the administrator's pub switch, P3)
  and the form re-check (notification hygiene, P2) in core: recommended.
- **(g)** `speech/onMessageSettled.int.test.ts` 253; `notifications/openForm.int.test.ts` 137, 166;
  `scenes/boundaryWatcher.int.test.ts`; `sockets/sessions.taskSweep.int.test.ts`;
  `runtime/sessionEvents.emit.int.test.ts`.

### 3.5 Genre-specific names leave core
- **(a)** `story-goals`: `sessions/goalsReached.ts` 24, read on any `core` annex write (host.ts 1094). `table`:
  `sessions/tableLine.ts` 20, 40, 60 (anchor on `main` 48), the slug `cat:shared/ui/conversation/tableChannel.ts`
  15. Lanes: `messages/permissions.ts` 119–163, called at 236.
- **(b)** Core knows Story's annex key, the table channel's slug and Dungeon Crawler's retired map shape.
- **(c)** The goals key becomes a param of the sweep's `goal-reached` duty (Story wires `story-goals`), read with
  `dutyParamsOf` (`routines/sessionRoutines.ts` 62–175). `TABLE_CHANNEL` / `TABLE_CHANNEL_DECL` move into the
  SDK (the catalogue re-exports them). `laneMemberOf` reads `laneOwner`.
- **(d)** None.
- **(e)** Keys and slugs unchanged on disk. Pre-register Dungeon Crawler lanes exist only in the ⏳ map: a forward
  pass files them into `channel_lanes` (second boot changes nothing).
- **(f) ★3.5** all three as stated ★ recommended. Alternative for goals: merge with 3.4 (a goals listener reads its
  key from its registration).
- **(g)** `sockets/sessionMessages.laneEnvoySwipe.int.test.ts` 42; `sessions/goalsReached.test.ts` 9, 15;
  `sockets/sessions.taskSweep.int.test.ts`; no test names `sayOnTable` (add one).

### 3.6 One fallback genre
- **(a)** Story: `entities/sessionGenres.ts` 70 `STANDARD_GENRE_ID`, `db/schema.ts` 2588. Chat (the assistant
  since 2026-10-19): `sessions/annexViews.ts` 55, 100, `annexInspect.ts` 123, `runTurn.ts` 1613, host.ts 4849,
  4869, 4936, 4992. Literals: `registrations/resolve.ts` 382, `fit.ts` 103, `sessionEvents.ts` 737,
  `db/sessionLayoutPanels.ts` 96, `sockets/sessions.layout.ts` 60; client copies
  `createSession.svelte.ts` 33, `editSessionForm.ts` 46, `sessionPageData.svelte.ts` 296.
- **(b)** Two fallbacks, one of them the assistant.
- **(c)** One export in `$lib/shared` (client and server); every site imports it. Decided, inside scope.
- **(d)** None. **(e)** None. **(f)** None.
- **(g)** None pins the Chat fallbacks; `db/layoutPresets.int.test.ts` pins Story's.

### 3.7 The three opt-in flags
- **(a)** `SessionShape.forms.modelAnswers`, `castFromLorebook`, `turnSeatChanges` (`sdk:descriptors.ts` 1002,
  1058, 1067; `sdk:genres.ts` 1125–1148; `sdk:events.ts` 1452–1468; `sdk:cadences.ts` 1496). Read at
  `runtime/runTurn.ts` 1567–1577, `fireAction.ts` 722, 1409; `sockets/sessions.create.ts` 316–495,
  `sessions/seatBookCast.ts`, `StartSessionForm.svelte`; `routines/moments.ts` 137–142, 410–427,
  `evaluate.ts` 116–118.
- **(b)** Core keeps paths no shipped genre uses.
- **(c)** Remove declarations, readers, tests and docs; an upgrade note in `INTEGRATING.md` §6.
- **(d)** A modder loses three opt-ins; the package outside this repo stops seating its book's people.
- **(e)** Published names, owner's call. No stored data.
- **(f) ★3.7 (ask first: reverses rulings):** `turnSeatChanges` "Yes, a read genres opt into" (2026-11-09);
  `castFromLorebook` ★M3-4 "The book seats its cast, genre-declared" (2026-11-05); `modelAnswers` (2026-11-04,
  playtest item 21). Options: remove all three; ★ recommended: remove `turnSeatChanges` and `modelAnswers`,
  keep `castFromLorebook` (it has a user).
- **(g)** `runtime/formsModelAnswers.test.ts` 5, 13; `sockets/sessions.castFromLorebook.int.test.ts` 333, 349;
  `routines/seatChangesOfTurn.int.test.ts` 239, 306; `sockets/sessions.forms.int.test.ts`.

### 3.8 Close out and summarize found by registration
- **(a)** See §1's table.
- **(b)** A genre's own world or character summarizer (another spec slug) is never found; the scene summarizer
  ignores the registration genres already make (`cat:genres/defaults.ts` 187–194).
- **(c)** One helper `summarizerOf(db, sessionId, kind)`: the effective action registration whose key is
  `summarize-<kind>` or `close-out`, mode not off. `sockets/summarize.ts`, `closeOut.ts` and
  `resolveSummarizeSceneSpec` read it; the scene path falls back to the declaration, then core's spec.
- **(d)** None (each shipped genre declares and registers the same spec). **(e)** None now. ★3.8-B: retire `GenreDecl.summarize.scene` (published: owner's call; ★ recommended, ⏳ read for
  one release).
- **(g)** `sockets/summarize.registrations.int.test.ts` 98, 114, 126; `sockets/scenes.live.int.test.ts` 659–690;
  `sockets/sessions.closeOut.int.test.ts` 233.

## 3. Overlaps and order
- **Turn controls (2.3):** owns `autoAdvance`, `turnMode`, `cat:factories/turnOrder.ts`, `genres/*/turnOrder.ts`,
  the set-turn-order outlet. 3.3's voices half and 3.2 follow it. 3.2 only reads `candidates`.
- **Routine groups (2.6):** shares `sdk:registrations.ts`, `cat:genres/defaults.ts`, `routines/evaluate.ts`.
  `cpl-B1` finishes before 2.6 starts; `cpl-F` (3.4) comes after 2.6 and lands in the same pre-0.7 SDK batch.
- **wt-1a (who a scene lists, D57, D70):** owns `scenes/liveScenes.ts`, `utils/sceneCastProposal.ts`,
  `utils/sceneCast.ts`. `cpl-A` and `cpl-B2` edit `liveScenes.ts`: before or after wt-1a, never during.
- **Phase 4:** needs `storyChannelOf` and moments that name their lane (turn-ended has `lane`; round-ended
  gains it there).
- **Shared within Phase 3:** host.ts (A, B2, E, F); `closeOut.ts` and `summarize.ts` (A, B2); `tableLine.ts` and
  `goalsReached.ts` (B2, D, F); `moments.ts` / `turnTally.ts` (B1, C, G); `sdk:descriptors.ts` (B2, E, G).

## 4. Lanes (one supervisor, two workers; at most two live)

| Lane | Items | Files | Stop if | Prompt baseline |
|---|---|---|---|---|
| `cpl-A` | 3.6, 3.8 | `$lib/shared` fallback (new), the 3.6 sites, `closeOut.ts`, `sockets/summarize.ts`, `liveScenes.ts` 1774–1890 | any spec hash moves; any genre resolves another spec | unchanged |
| `cpl-B1` | 3.1 turns/rounds | `channels/storyChannel.ts` (new), `moments.ts`, `turnTally.ts`, `evaluate.ts`, `rewind.ts` | a tally or Back test changes | unchanged |
| `cpl-B2` | 3.1 scenes | boundaryWatcher, sceneSummaryDue, earlierScenes, settle, closeOut stretch, `sockets/scenes.ts`, `summarize.ts` 165, host.read.summarize, host.ts 4442/4512, `liveScenes.ts` 1278/1345, tableLine 48, `cat:shared/sceneBoundaries.ts`, `sdk:descriptors.ts` (★3.1-A) | a hash beyond scene-boundaries moves | unchanged |
| `cpl-C` | 3.2 | `rulesets/rounds.ts`, `resolve.ts`, `engine.ts`, `turnTally.ts` | a one-to-one ruleset test changes | unchanged |
| `cpl-D` | 3.5 | goalsReached, tableLine, permissions, boot pass (new), `cat:` table channel, sweep duty, `sdk:` export | a second boot writes rows | unchanged |
| `cpl-E` | 3.3 | §2 3.3 files, `sdk:descriptors.ts`, `cat:registry/genres.ts`, genre specs | Story or Lair sha moves | must stay byte-identical |
| `cpl-F` | 3.4 | `sdk:registrations.ts`, `cat:genres/defaults.ts`, `registrations/*`, `sessionEvents.ts`, host.ts 1091/4012, `speech/onMessageSettled.ts` | a shipped session drops a listener | unchanged |
| `cpl-G` | 3.7 | §2 3.7 files, docs, INTEGRATING §6 | a shipped genre declares one | unchanged |

Every lane: lane tests only; one grouped full run at the end; NOMENCLATURE §25 in the same change.

## 5. Not in this phase
- Narrate / Continue / Pick defaults to `main` (`sockets/sessions.turns.ts` 189–716, `sessions/actionsPush.ts` 111,
  `retakeTurn.ts` 65, `revision.ts` 257, `unplayedTalk.ts` 60–175, `turnYield.ts` 328–407): one-line follow-ups
  once `storyChannelOf` exists.
- Channel lanes ≥ 2 as story; per-lane rounds and turn order (Phase 4's "later").
- The reckoning reads `main` lines (`cat:shared/reckoning.ts` 374); `summarizeScene({ channels.story })`
  repeats the declaration.
- Inventory §4–§8 (generation lock, core verbs, routine queue and caps, lifecycle events, plugin limits).
