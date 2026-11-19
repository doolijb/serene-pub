# INVENTORY — cast Memory, distances, small repairs (programme 1.5, 1.6, 2.9; read-only, 2026-11-17)

Paths under `src/lib/server/` unless `client/` (`src/lib/client/`) or `sdk:` (`../serene-pub-sdk/`). Plans:
`ET` = `PLAN-entry-time-and-lines-2026-11-14.md`, `NT` = `NOTES-entry-time-and-lines-2026-11-13.md`, `SS` =
`PLAN-session-settings-cleanup-2026-11-15.md`. Re-verify every file:line in the brief.

**Short answer:** none of 1.5 and almost none of 1.6 exists. **Memory** is not a list of what a member saw. It
is a stored reading on a cast version, and it needs a migration, a fold and a host read. A *has been there* tie
can be written today, but only by a pipeline that places the outlet, and no shipped one does. No walk over ways
exists beyond one hop. In 2.9 the docs drift is fixed. How strict is still unnarrowed on the two mid-session
server doors. On revision's on-screen description is still old. One dead setting is truly dead (world
attributes and picks, column plus table). Save-at-once is untouched.

## 1. Cast Memory (1.5)

**What it is (owner's words):**
- Owner, 2026-11-13: "That works, make it an advanced fold on the cast member. Also provide a vertical time
  view like i suggested for other entries" (`NT` 392–394; *per character; core's recall honours it*).
- Owner, 2026-11-13: "I think we need to simplify that to one mechanism though we can display it in different
  ways. How-ever relation to entries, i.e. (I've been there) is an exception" (`NT` 406–407).
- Design, ruled 2026-11-14 ("Lets go with all your recommendations", ★1 and ★13): "a cast version's
  **Memory** is a reading (line and date) plus one optional date, *nothing before*, that applies to events.
  Time travel, a mind in a younger body, a time loop and amnesia are these two values" (`ET` 62–64, 221–223).
  It is stored on the `character_versions` row and is **new** (migration) (`ET` 86). Read path, step 1:
  "the session's, or the speaking character's own Memory" (`ET` 100). Rule 7: a Memory naming a deleted line
  falls back to its parent line, "and says so" (`ET` 125).
- Owner, 2026-11-15: Living world's next steps come "after cast Memory and distances: 'Yes'" (`ET` 334–335).

**What exists today:**

| Piece | State |
|---|---|
| Member page tabs | Member, Lore, **Knows** (owner only, kn-4a2), Relationships, Timeline, Sprites, Gallery (`client/lorebooks/CastWorkspace.svelte` 922–951; Knows 930–940) |
| Scenes a member was in | Already shown: the **Timeline** tab, from `scene_characters` through the workspace's rows, no server read (`client/lorebooks/cast/memberScenes.ts` 1–60; `CastWorkspace.svelte` 908–919, 2680; `docs/lorebook-cast.md:45`) |
| Per-speaker filters in a run | `knownToSpeaker` (`state/reading.ts` 942–951) and `speakerInCast`, on 11 reads, default on (wt-1b-fix2; `sessions/speakerInCast.ts` 275, 337). Both read the **session's** reading. |
| Reading a line at a date | `readingOf` (`state/reading.ts:217`) and `sessionReadingOf` (331): the session's only |
| Memory storage | **None.** `character_versions` holds the version's own date and line, not a memory (`db/schema.ts` 9700–9790). Nothing in the app or the SDK names one. |
| Advanced fold pattern | `showsAdvancedControls` (`client/advancedControls.ts:2`), used by `client/lorebooks/BookSettings.svelte` 4, 159. `CastWorkspace` does not use it yet. |
| NOMENCLATURE | No **Memory** row. |

**What is missing:**
1. A migration: a line, date parts and *nothing before* date parts on `character_versions`.
2. The cast version save door carrying them.
3. The fold on the version zone of the Member tab, behind Show advanced controls.
4. The host read: for a speaker whose version in force has a Memory, read that speaker's lore at
   `readingOf(line, date)`, and leave out history days and scenes before *nothing before*. A narrator turn
   reads the session's reading, as both filters already do.
5. The deleted-line fallback and its sentence.

So this is a server read and a view, not only a view.

**Can be built now, no owner decision:** the read plumbing behind a pure helper (pick the speaker's reading,
apply *nothing before*), with tests. The design is ruled (`ET` 221) and the programme made it a go
(2026-11-15).

**Open questions for the owner:**
- **M1. Column names, fold label and copy (★).** Recommendation: *Memory* with *Remembers as of ‹line, date›*
  and *Nothing before ‹date›*.
- **M2. Do the reads take a toggle for it?** Options:
  - (a) a third per-speaker param on the same reads, default on. This matches the 2026-11-15 night ruling
    "a toggle that's on by default … in the query markup".
  - (b) always honoured.

  Recommendation: (a), so it behaves like `knownToSpeaker` and `speakerInCast`.
- **M3. Scope of each value.** Options:
  - The reading covers every lorebook read, and *nothing before* covers history days, scene summaries and
    earlier scenes only (the plan's "applies to events").
  - Both cover everything.

  Recommendation: the first.
- **M4. A Memory dated after the story's now (foreknowledge, `NT` 360–366).** Recommendation: allowed. It
  reads its own line at that date.

**Tests that pin today:** `client/lorebooks/cast/memberScenes.test.ts` 27, 36, 47; `memberKnows.dom.test.ts`
195, 213; `castVersionRead.test.ts` 92, 105; `pipelines/runtime/speakerInCast.reply.int.test.ts:526`;
`sessions/speakerInCast.test.ts` 36, 52.

## 2. Distances (1.6)

**Owner's words:**
- 2026-11-13: "Measuring how close an entry has been to the character, and measuring how distant an entry is
  to them currently. The character has been in the parent location. The character's location is 10 nodes
  away now" (`NT` 415–417).
- 2026-11-13: "The x2 distance tracking is cheap, we can derive a time stamp too if we ever need to add a time
  delta to the context. Items seen would be important too, in inventory, on another character are two other
  distance measures. Not confident in the information sharing though" (`NT` 436–438).
- Lane T9: "*Been there* and *has held* ties written at scene close; a step-count walk over ways and parents;
  the two measurements as queries for genres, shown in the pool and the test view; used first by the Lair and
  Dungeon Crawler" (`ET` 145).
- The two measurements are "the closest a version has ever been to an entry, and how far it is now", each with
  a time (`ET` 70, 89–91).
- 2026-11-15 (#11): "Lets not bother adding the delta value to the returned results for now, just
  scenes/history entries" (`ET` 324–325).

**(a) *Has been there* at scene close.**
- A scene closes in two places:
  - `closeScene`: cast proposal 1561, `scene-closed` 1565, `applyAtSceneClose` 1573 (`scenes/liveScenes.ts`
    1524–1580).
  - `openScene`, closing the open scene: 1463–1470. The boundary watcher's automatic closes go through it
    (`scenes/boundaryWatcher.ts` 875, 1089, 1287, 1747).

  Both emit `core:event/scene-closed@1` (`pipelines/routines/moments.ts` 452–464).
- **A scene stores no place:** there is no place column on `scenes` (`db/schema.ts` 4842–5002). Its place is
  the genre's declared state key (`scenePlaceKeyOf` 505–526), read as of a message (`scenePlaceOf` 598–611,
  `worldStateReader` 538).
- Location is declared on the world **and** the cast. The genre's sheet picks which one carries it, and the
  value is words or `{ entryId }` of a `core:entry/location` (`sdk:core-catalog/src/registry/slots.ts`
  142–163).
- Settling compacts the ledger (`sessions/settle.ts` 164, 190). That is why the plan writes at close.
- **How a tie is written today:**
  - Writer: `writeKnowledgeTie` (`lorebooks/entryKnowledge.ts` 513–575). Kinds come from a CHECK with four
    values and no *has held* (`db/schema.ts` 5379–5380; `shared/lorebooks/knowledgeKinds.ts:2`).
  - The outlet `note-entry-knowledge@1` writes `has_been_there` through `noteEntryKnowledgeWrite`
    (`pipelines/runtime/host.loreWrites.ts` 939, call 1099). It goes to the lorebook under Full, otherwise to
    the notes, and Apply offers it there (kn-6).
  - No shipped pipeline places the outlet. Recipe 2 in the SDK guide (a `scene-closed` routine) uses the
    **seated** characters, not the scene's cast, and needs `run-script` steps to stand in for missing reads of
    a scene's participants and the location (`REPORT-kn-4b` 34–40).
- **Who was there** is the scene's stored cast (D57). Lane `wt-1a` (who a scene lists) waits on B1 and B2
  (D70).

**(b) Step-count walk.**
- Places are `core:entry/location` entries. **Places never have parents** (no `parent` role:
  `utils/lorebookImportMapper.ts:250`; `docs/lorebook-places.md:17`). Containment is a way: *is inside* /
  *holds* (`shared/lorebooks/linkVocabulary.ts:54`).
- A **way** is a `narrative_relationships` row between two places. It can be one-way or both ways, has a
  status, can be secret, and can be dated (`docs/lorebook-places.md` 21–29).
- A non-place entry reaches a place by being filed under it (**Part of**, `:17`), or, for an item, by lying in
  it (`state/supply.ts:73`).
- The session's ways come from `readGraphEntryLinks`: standing, not secret, both ends live
  (`sockets/sessionPlaces.ts` 1–30, handler 315).
- The only walk is **one hop**: `withinReach` (`pipelines/prompt/adventureContext.ts` 203–227) and the
  relationship read's `loreLinks` (`sdk:contracts/src/queries.ts` 2740).
- No path, distance or route code exists anywhere (searched app and SDK).

**(c) Queries beside the two measurements** (`sdk:contracts/src/queries.ts`):
- `relationshipSearch` (2746, one-hop `loreLinks`); `itemSupply` (3605: who holds an item and what lies in a
  place, **now**); `sessionState` (3570: the location); `castPresences` (1356); `lorebookEntries`.
- There is no places or ways query. `session-places` is a widget page request, not a pipeline query
  (`sdk:sdk/src/widgets.ts` 2121, 2409).
- NOMENCLATURE has no row for distance or *has been there*. The **date delta** row warns: "never a bare
  *delta* or *distance* (place distances are planned)" (`NOMENCLATURE.md:1033`).

**Can be built now, no owner decision:** the walk as a pure function over the ways `readGraphEntryLinks`
already returns (direction respected; one step per way), with unit tests. Nothing published, nothing
automatic.

**Open questions for the owner:**
- **D1. Where the opt-in lives (P1).** Options:
  - (a) a core **node** (step) a genre places on its `scene-closed` routine, replacing recipe 2's glue.
  - (b) a core write at close, beside `applyAtSceneClose`, switched on by a new declaration on the genre's
    `scenes` shape (like `scenes.place`).

  Recommendation: (a). The memory ruling "a genre-specific setting is a node, never a helper option" applies,
  and the receipt shows the cause.
- **D2. Who counts as there.** Recommendation: the scene's stored cast, after `wt-1a`. Today's recipe uses
  seated characters.
- **D3. Which place.** Options: the place at opening; the place at closing; every place the location took
  over the scene's range, read before settling. Recommendation: every place. Per-member location counts where
  the sheet puts it on the cast.
- **D4. *Has held* (items).** Options:
  - a fifth knowledge kind (generated migration on the CHECK; a published value).
  - leave items to `itemSupply` ("now" only).

  Recommendation: leave it for now.
- **D5. What the walk crosses.** Recommendation: the *From here:* set. One-way respected, *is inside*
  counted as one step, dated on the line.
- **D6. The measurements' names, shape and home (★).**
  - Recommendation: two read-only queries. Each answers steps plus a story `date`, and **no `dateDelta`**
    (#11 above). Names avoid bare *distance* (R3).
  - Shown in the Knows tab and the entry's test view.

**Tests that pin today:** `pipelines/runtime/host.noteEntryKnowledge.int.test.ts:204`;
`noteEntryKnowledge.recipes.int.test.ts:451`; `lorebooks/applyKnowledgeTies.int.test.ts:216`;
`pipelines/prompt/placeReach.test.ts` 49, 56, 63; `sockets/sessionPlaces.int.test.ts` 206, 301;
`scenes/liveScenes.autoApply.int.test.ts` 231, 256.

## 3. Small repairs (2.9; `SS` 79–89, cold review 168–169)

| Item | Plan says | Today | Fixed by | Smallest remaining change |
|---|---|---|---|---|
| **How strict, server** | "the server narrows the choices by ruleset as the form and creation do" | Narrowed at create (`sockets/sessions.create.ts` 695–698), at preset switch (`sockets/sessions.pipelines.ts` 1191–1198) and in the forms (`client/…/EditSessionForm.svelte` 303–310, 3073–3081). **Not** at `sessions:update` (`sessions.update.ts` 443–459) or at `sessions:updateSetting` (`sessions/settingsForm.ts` 311–316): genre options only. The derived field lists every genre option (`sessions/exposure.ts` 80–86). | open (ss-2b unified the writers; `writeRigour`, `sessions/settingsWrite.ts` 61–77, checks nothing) | Both checks also apply `rigoursPlayed(rulesetDecides(…))` (`shared/rulesets/rulesOffer.ts` 103–106). Example: a Lair session on Freeform accepts *Rules* by socket. Refusal copy ★ |
| **On revision description** | names moving the clock back | Docs done (`docs/sessions.md` 436, 470). The screen still reads *What deleting or regenerating the latest turn does.* (`EditSessionForm.svelte` 3095–3097) | docs: `time-t10` | One sentence in the form (★ copy; the docs' wording exists) |
| **Docs drift** | Tone "Before you start"; locks | Done: `docs/genre-story.md:21`, `docs/sessions.md:18` ("none of the built-in presets does"); locks `docs/sessions.md:466`, `docs/pipelines.md:19` | `doc-1`; `ss-5`, `ss-5-fix` | none |
| **Save-at-once** (★S6-c) | Settings tab saves at once; name, scenario, tags keep Save | Still split. With Save: story, reading, scenes (`EditSessionForm.svelte` 2944–2948), player label, tags, On revision (793–810, 3085–3086). At once: genre, pipeline and routine settings, Rules options. The rule sentence is at 2760–2765. | open | Per field at-once writes for On revision, scenes and player label, plus a new rule sentence. Needs ★S6-c |

**Dead settings (★S6-b per item):**

| Setting | Declared | Proof | Verdict |
|---|---|---|---|
| `sessions.world_attributes` | `db/schema.ts:2615` | Every write is refused (`sockets/state.ts` 2080–2093, retired 2026-10-23). Only the branch copy reads it (`sessions/branch.ts:200`). `worldAttributesFor` takes its own `on` (`state/resolve.ts:1432`; `state/lorebookState.ts:183`) | dead |
| `session_attribute_picks` | `db/schema.ts:11386` | Writes are refused (same handler). `attributePicksFor` has no caller (`state/resolve.ts:1518`). Written only by the branch copy (`branch.ts` 860–863) and frozen `dataUpgrades/0112` | dead. Check that 0112 still runs before a drop on a fresh database |
| `user_settings` / `system_settings.on_revision_default` | `db/schema.ts` 246, 4478 | Read at create (`sockets/sessions.create.ts` 700–704 → `sessions/revision.ts` 71–86). No writer anywhere | read, never writable (cold review) |
| `sessions.session_type` | `db/schema.ts:2627` | Read (`conversations/store.ts` 1148, 1282; `sockets/jump.ts:308`) and written by the summarizer. The client can send it through `sessions:update` (`sessions.update.ts` 331, 531, 666) | not dead. Close the client door; no migration |
| "Needs a story clock" | comments only (`pipelines/routines/log.ts:132`; `shared/sockets/types.ts:6110`) | `needs` carries only the unserved-model sentence (`log.ts` 163–183) | fix the two comments |

**Can be built now, no owner decision:**
- The How strict check on both doors (its refusal sentence reuses the existing one listing the options).
- Closing `sessionType` on `sessions:update`.
- The two stale comments.
- A test for each.

**Open questions for the owner:**
- **R1 (★S6-b).** World attributes and picks: drop the column and table with a generated migration and remove
  the retired handler. Recommendation: drop.
- **R2.** `on_revision_default`. Options: drop both columns (create always uses *Overwrite*, today's result
  for everyone), or give it a writer (P3: nobody has asked). Recommendation: drop.
- **R3 (★S6-c).** Save-at-once as the lead recommended.
- **R4.** On revision copy. Recommendation: *What deleting or regenerating the latest turn does, and moving
  the story clock back past what this session wrote.*

**Tests that pin today:** `sockets/sessions.createRulesets.int.test.ts` 189, 208, 231, 256;
`sessions/settingsForm.int.test.ts` 236–254; `sockets/state.attributes.int.test.ts:193`;
`sockets/sessions.clockMoveBack.int.test.ts`. **No test** covers `onRevisionDefaultFor`, the On revision
copy, or `sessionType` sent through `sessions:update`.
