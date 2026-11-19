# INVENTORY — attended-scene summaries: what is stored, read and filtered today (programme 1.3; read-only, 2026-11-16)

Paths under `src/lib/server/` unless `sdk:` (`../serene-pub-sdk/`). Re-verify every file:line.

**Short answer:** ruled, never built. Owner 2026-11-14 (`PLAN-entry-time-and-lines-2026-11-14.md:343`): a character
who missed part of a day gets the summaries of the scenes it attended, *"As recommended. Build that query behavior
as part of the core tooling, so someone can code a different strategy instead"*. Today no shipped spec filters by
presence. The opt-in `firsthandFor` drops the **whole day** (*"A character that missed one scene of a day loses
that day's entry"*, `sdk:guides/genres-presets-and-routines.md:442`). Everything the read needs is stored except
**when a seat was benched or seated**.

## 1. Who was in a scene: what is stored

| Fact | Where | Written by / when |
|---|---|---|
| Stored cast | `scene_characters` (scene, binding, role `participant`/`mentioned`), `db/schema.ts` 5068, 5021 | `writeSceneCast` (`utils/sceneCast.ts:153`, replaces per role). Live scenes: `proposeAndWriteCast` at open (and the scene it closes), close, move, merge (`scenes/liveScenes.ts` 1454–1455, 1561, 1707, 1762). Every line of an open scene: `refreshOpenSceneCast` (835) via `followOpenSceneCast` (`scenes/boundaryWatcher.ts` 712, 729), only with `castRefresh` (Story only, `sdk:core-catalog/src/registry/genres.ts:605`) and a mode that is not Manual. Also `scenes:create` (`sockets/scenes.ts:481`), `saveSceneSummary` (822; not under the routine's Full, 565–567), graph apply/merge, import |
| Proposal input | `utils/sceneCastProposal.ts` 467–560 | senders ∪ roster ∪ names at promoting sites. Roster: character seats **with `is_active`** (`liveScenes.ts:922`) + **every** player seat (930–937, no bench or removed filter). Read **when written**, not when the scene opened |
| Never resolved | `scenes.cast_resolved_at` NULL (schema 4890) | the writes above |
| Bench | `is_active` on both seat tables (schema 4018, 4184) | `setSeatBench` (`sessions/seats.ts` 1764–1849): a boolean flip. **No timestamp, no history.** Seats also have no seated-at time |
| Per-message presence | `session_messages.firsthand_cast_member_ids` | added in 0165, **dropped in 0166** |

`cast_presences` (schema 9534) holds dated stays in the world, not attendance.

A benched character seat that neither speaks nor is named leaves the stored cast at the next write. That goes
against D21's *"Bench is not absence"*.

## 2. Summaries today

- **Scene:** `scenes.summary` / `summary_status` / `summary_origin` (schema 4875, 4935, 4950). One writer:
  `saveSceneSummary` (`sockets/scenes.ts:574`, called on a person's Save / Apply or by the routine under Full).
  Drafted by `core:spec/summarize-scene` (or a genre's own `*-summarize-scene`). The routine
  `core:spec/scene-summaries` starts it via `scene-summary-due@1` → `core:outlet/summarize-finished-scene@1`
  (`sdk:contracts/src/outlets.ts:877`). The summary survives compile.
- **Day:** a History entry's content, compiled from its scenes by `core:spec/summarize-history`, linked by
  `scenes.history_entry_id`.
- **Session:** none. **Into the prompt:** `earlier-scenes@1` → `earlierScenesOf` (`scenes/earlierScenes.ts` 54–61). It takes this
  session's `main` scenes that are closed, `done` and **not compiled**, and only those whose lines left the window.
  A compiled day reaches the prompt only as a History entry, by score. `earlier-scenes@1` has no `knownToSpeaker`.

## 3. Today: a character who missed part of a day (Story reply)

In `sdk:core-catalog/src/genres/story/respond.ts`:

- `sessionHistory` (566) has no presence filter.
- `earlierScenes` (584–592) returns every summary.
- `historyEntries` (629–636) is filtered only by `knownToSpeaker`; its exclusions reach eligibility (1003–1011).

**So the speaker sees the missed scenes' lines and summaries, and the whole compiled day.** The same holds in
Narrate, the side-character turn and the Dungeon Crawler (`narrate.ts:318`, `narrateCharacter.ts:236`, `story.ts:1662`).

The shipped attempt is **firsthand** (`sessions/firsthandFilter.ts` 1–42, 268–288):

- A member was there for a scene if it spoke in it.
- A summary is kept for the last line or more than half of the lines.
- A closed scene with no live line counts by its stored cast (452–463). An open scene is kept.
- Bench plays no part.
- A day is dropped if one of this session's scenes in it was missed.

No shipped spec wires it (`firsthandFor` appears only in `pipelines/runtime/bindings*.ts`).

## 4. SDK queries beside it (`sdk:contracts/src/queries.ts`)

- `firsthandFor` / `firsthandBy` ports on `session-history@1` (50; 344 / 353), `history-entries@1` (1215; 1244 / 1252,
  plus `exclusions`) and `earlier-scenes@1` (1505; 1541 / 1549, param `share`). Out of `earlier-scenes@1`:
  `{ maxTokens, scenes: [{ sceneId, name, summary, firstLineId, openedStoryClock }] }`.
- Also: `scene-summary-due@1` 1446, `scene-boundaries@1` 1399, `cast-presences@1` 1298.

The pattern for the switch is `knownToSpeaker`: a boolean, default `true`, the last field of `params`, label
*Only what the speaker knows* (1070–1087). Owner 2026-11-15: *"a toggle that's on by default … in the query markup"*.
The speaker comes from the read's `speaker`, else the scope; with neither it reads everything
(`REPORT-kn-2a-2026-11-16.md` 25–30).

## 5. Knowledge model

`judgeEntryKnowledge` (`lorebooks/entryKnowledge.ts` 160–200) judges marked entries by ties: latest date, then
nearer line, then *kept from*. `was_told` and `has_been_there` are two of the knowing kinds
(`shared/lorebooks/knowledgeKinds.ts` 2–7). **Attendance does not feed it:** the module reads no scene. Play ties
come only from `note-entry-knowledge@1` (`host.ts` 7374–7378), which no shipped spec places.

## 6. Open questions

1. **What counts as attended** (D21, open):
   - (a) in the stored cast: one indexed read, but it misses benched listeners and depends on `castRefresh`;
   - (b) spoke: today's rule, which loses silent listeners;
   - (c) (a) or (b): the `kn-2b` brief, `briefs/BRIEF-kn-2.md` 65–70;
   - (d) also benched while the scene ran: the lead's option, which needs a **new stored fact**.

   Owner 2026-11-15: *"Stored cast list, when messages are outside the context window, we won't be querying them
   anyway. Scenes/history are what persist."*
2. **What the absent character gets for the day:**
   - the attended scenes' summaries, as ruled. Cheap: `scenesOfEntry` + `keptSceneIds` (`firsthandFilter.ts` 80,
     268) + `scenes.summary`;
   - nothing, as firsthand does today;
   - the day plus a note. A note does not stop the leak (measured 2026-11-15, NOMENCLATURE **firsthand**).

   Also open: an attended scene with no `done` summary.
3. **A fully attended day:** keep the day's text? `kn-2b` drops a day only when **no** scene was attended. Other
   sessions' scenes and a person's paragraphs go unjudged.
4. **Open scenes:** `earlier-scenes` never returns them (`earlierScenes.ts:61`); firsthand keeps them.
5. **No cast list** (`cast_resolved_at` NULL, or a selection scene saved without its cast): ★T6F-2 (D9) drops such
   a scene for everyone.
6. **Several players:** player seats never speak a reply, but every player seat is on the roster (930–937).
7. **Narrator:** the proposal's "prefix each summary with who was present"
   (`NOTES-entry-time-and-lines-2026-11-13.md` 448–452). It is not known whether the ruling covers it.
8. **Shape and name:** a new query, or a mode of `earlier-scenes` / `history-entries`, and how it relates to the
   `kn-2b` toggle (blocked on D21). *attendance* is taken (Who's here), *presence* names a cast presence,
   *firsthand* is 🚧.

## 7. Tests that pin it

- `sessions/firsthandFilter.test.ts`: 140, 149 (last line / more than half), 158–168 (stored cast, open scene),
  180–194 (entries).
- `sessions/firsthandFilter.int.test.ts`: 230 ("a benched member who spoke was there"), 368, 427.
- `pipelines/runtime/bindings.firsthand.int.test.ts`: 361, 449.
- Earlier scenes: `scenes/earlierScenes.int.test.ts` 120, 198; `pipelines/runtime/earlierScenesQuery.int.test.ts` 118, 237.
- Cast writes: `scenes/boundaryWatcher.genre.int.test.ts:486` ("a new speaker joins the stored cast…");
  `scenes/liveScenes.castMembers.int.test.ts` 116.
- SDK: `sdk:sdk-tests/firsthand.test.ts` 23, 79, 94.
- **No test pins how the bench affects the stored cast.**
