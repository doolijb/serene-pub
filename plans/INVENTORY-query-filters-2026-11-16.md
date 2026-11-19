# INVENTORY — reads that return lore, links, places, history; today's knowledge / presence wiring (read-only, 2026-11-16)

For programme 1.2. App paths under `src/lib/server/`; SDK under `../serene-pub-sdk/`. `b.*` = `pipelines/runtime/bindings.*`.
Re-verify every file:line.

## 1. The reads (declared in `contracts/src/queries.ts`)

| Read | Declared | In-ports today | Binding |
|---|---|---|---|
| `session-history@1` | :50 | scope, budget, messageId, channelLane, firsthandFor :344, firsthandBy :353 | `b.ts` 572–761 → host `session_messages` (`host.ts` ~1881) |
| `world-lore@1` / `character-lore@1` / `history-entries@1` | :1059 / :1099 / :1179 | scope (+ speaker on character-lore; firsthandFor/By on history-entries :1208/:1216) | `b.retrieval.ts` 700 / 710 / 722 via `loreFor` :367 |
| `lorebook-triggers@1` | :695 | scope, speaker | `b.retrieval.ts` 832; recursion `ranking/keywordQuery.ts` 401, 676–700 |
| `unknown-entries@1` | :1280 | scope, speaker | `b.retrieval.ts` 786–830 |
| `earlier-scenes@1` | :1544 | scope, budget, firsthandFor :1580, firsthandBy :1588 | `b.outlets.ts` 227–277 |
| `entries-named@1` | :1620 | scope, messages, budget | `b.outlets.ts` 284 → `loreMatch.ts` 275 |
| `vector-search@1` | :1700 | vectors, scope, speaker | `b.retrieval.ts` 952; `host.read.retrieval.ts` 58 |
| `entity-search@1` (`messages` out = recalled lines) | :1892 | scope, speaker | `b.retrieval.ts` 1441; `host.read.retrieval.ts` 440 |
| `mention-spans@1`, `entity-link@1` | :2124, :2236 | (speaker on entity-link) | `b.retrieval.ts` 1784 / 1892 |
| `relationship-search@1` (the link hop, `loreLinks`) | :2594 | — | `b.relationships.ts` 279; `chosenEntryIds` :132; host `graph_entry_links` (`host.ts` ~2806) |
| `relationships-known@1`, `relationships-perspectives@1` | :2510, :2472 | — | `b.ts` 834 / 856 |
| `lorebook-entries@1` (place listing; `withLinks`) | :3975 | scope | `b.retrieval.ts` 631; `host.read.lorebookEntries.ts` 29, `withLinks` 831–894 |
| others | | | `session-annex@1` :2929 (`b.ts` 1010), `lorebook-annex@1` :3004, `turn-plan@1` `locationPassage` :2893 (`b.ts` 773), `summarize-source@1/@2`, `graph-scenes@1` :3337, `session-cast@1` :2336 |

## 2. Today's wiring

- `unknown-entries` → `loadEntryKnowledge` (`lorebooks/entryKnowledge.ts` 238–309); exclusions repeat each entry for
  worldLore, characterLore, history (194–216). 0, 1 or 15 statements.
- `firsthandFor/By` → `loadFirsthandView` (`sessions/firsthandFilter.ts` 359–497), `keptLineIds` 259, `keptSceneIds`
  268, `leftOutEntryIds` 283; stored cast 449–464. Applied only when the key is present: `b.ts` 687–725,
  `b.outlets.ts` 249–273, `b.retrieval.ts` 734–779 (history-entries only appends to `exclusions`). **Each binding
  calls the loader separately.**
- Story `story/respond.ts`: `unknownEntries` placed 761–764, exclusions into `eligible` 1015–1019. Lair
  `lair/reply.ts`: `voiceBranch` 421–426, into `eligible` 478–483. **No shipped spec wires `firsthandFor`.**
- Eligibility merges lists: `pipelines/ranking/eligibility.ts` 84–105.
- No filter at all: Chat (`chat/respond.ts` 177, 201; `memory.ts` 75), Guide (`guide/respond.ts` 229, 257, 270),
  Dungeon Crawler (`respond.ts` 37–43; `story.ts` 1063, 1664), Story `narrate.ts`, `narrateCharacter.ts`, `look.ts`,
  Lair spine / `castellanAction` / `buildRoom` / `fileRoom` / `roomAnswer`, shared `sweep`, `reckon`, `summarize/*`,
  `reckoning.ts`, `toolLoop.ts`.

## 3. How a query learns the speaker

- `HostScope` (`host.types.ts`): `currentCharacterId` :134 (null in narrator mode), `currentCastMemberId` :139
  (card-less seat only); `portrayals` :149 never exposed.
- `runTurn.ts`: scope built 892–906; speaker 1827–1836 (`character:<id>`, envoy ref, or null); card-less member
  1839–1848; input carries `speaker` 1953, `characterId`, `sessionScope` 1965–1971.
- **A binding cannot read the speaker without a port**: bindings get `RenderRun` (runId, user, seed)
  (`prompt/renderers.ts` 61–72); `CoreQueryCtx` has no scope. The speaker arrives through the `scope` port value
  or a `speaker` port. The host lorebook read takes its subject from the query (`host.read.lorebookEntries.ts`
  117–132; `host.helpers.ts` 432–455).
- No single speaker: routines (`routines/run.ts` 375, 380), actions (`fireAction.ts` 1210), built-ins, form
  child runs (`runTurn.ts` 1654–1657), summaries, narrator turns, envoys (`castellanAction.ts` 72), multi-voice.

## 4. Presence rule today

Spoke a live line in the scene (`firsthandFilter.ts` 245–256; with a slot, the member's place value per message);
a summary kept if there for the last line or more than half (268–280); a closed scene with no live lines judged
by `scene_characters` (452–463); a history entry left out if any of this session's scenes in it fails (283–288).
Cost: ≤13 statements without a slot, ≤70 with three members.

## 5. Leaks

- Link-borne names: the hop (`b.relationships.ts` 190–239) and `withLinks`; hop candidates have source
  `relationships`, not covered by exclusions. The hop passes only `currentCharacterId`, never the card-less member
  (137–140, 337–340).
- Place listing and ways: `lorebook-entries@1` bypasses eligibility (Story `scenePlaces` `respond.ts` 458, 1060;
  Lair `rooms` 394, 1269; DC `respond.ts` 85; `look.ts` 256; `reckoning.ts` 802).
- Lair voice: history and history entries from the shared `gather`, unfiltered (448–450, 500); room prose
  (`turn-plan` `locationPassage`, 396).
- Triggers: no filter; recursion scans triggered entries' text before eligibility (`keywordQuery.ts` 693;
  `maxRecursionDepth` default 0).
- Recalled lines (`b.retrieval.ts` 1636–1690) not judged for presence (no shipped spec wires them).
- History entries with none of this session's scenes, or text a person wrote, are kept (`firsthandFilter.ts` 27–31).
- Earlier scenes: unfiltered (ports unwired). Annex, cast sheets, relationships-known: no filter.

## 6. What pins today's wiring

`sdk/src/validate.ts` laws 1319–1388, 1390–1411; `shared/conformance/wiring.test.ts` `UNFILLED_IN_PORTS`
747–800; `boot/registryHashes.test.ts` 784, 905, 1856, 1858; `specHashes.test.ts` 208–209, 1887–1888;
`declaredReads.test.ts` 243–252; `receipts.int.test.ts` 268; `sockets/pipelines.scoping.int.test.ts` 1253;
`unknownEntries.reply.int.test.ts`, `sessions.lairUnknownEntries.int.test.ts` (prompt baselines);
`bindings.firsthand.int.test.ts`, `bindings.entryKnowledge.int.test.ts`, `firsthandFilter*.test.ts`,
`ranking/eligibility.entryKnowledge.test.ts`; SDK `sdk-tests/firsthand.test.ts`, `unknownEntries.test.ts`,
`lair.test.ts` 224, 792, `coreCatalog.test.ts` 1077, `nodeInput.*`; recipe `spoke-or-named`
(`guideRecipes.int.test.ts` 179); docs `docs/pipelines.md` 344–372, `docs/lorebooks.md` 116, guide
`genres-presets-and-routines.md` 399–453, 502–533, `INTEGRATING.md` §1p; `NOMENCLATURE.md` 959–962, 1490, 4303–4308.
