# INVENTORY — story time in query results, events, outlets and tools (D56; read-only, 2026-11-16)

Paths under `src/lib/server/` unless `sdk:` (`../serene-pub-sdk/`). Re-verify every file:line. ⚠ in flight:
`pipelines/runtime/host.read.lorebookEntries.ts`, `tools/coreTools.ts`, Dungeon Crawler files.

**Short answer:** only two shapes tell `timeless` from `undatable`: `SessionSettingsV1.timeline` (declared) and the
cast's `storyTime.timeline: false` (undeclared, 🚧). Everywhere else both cases read as `null` / absent, and
"no book", "the head" and "no clock yet" read the same way. Most date fields are already typed `… | null`, so
"values or null" costs little as a type change. The work is in the host: four reads still hand over stored dates
while the timeline is off. **No query has a param that switches time on or off today.**

## 1. Every shape that carries story time

D = dated, U = undatable, T = timeless.

| Shape | Time part (type) | D | U | T |
|---|---|---|---|---|
| `session-cast@1` `storyTime` (`sdk:sdk/src/participants.ts` 513–524; `pipelines/runtime/host.read.sessionCast.ts` 563–595) | `{ now: StoryTime & {from,label?} \| null, calendar: StoryCalendar \| null } \| null` + undeclared `timeline?: false` | now set | now null, no key | now null, **calendar still set**, `timeline: false` |
| ″ no book | — | key **absent** (the type allows `null`, which is never sent) | | |
| `SessionSettingsV1.timeline` (`sdk:sdk/src/sessionSettings.ts:75`; `sessions/settings.ts:239`); its `cast` is the row above (`settings.ts` 299–326) | `boolean` | true | true | false |
| Lore rows: candidates' payload and the `lorebook-entries@1` listing (`pipelines/runtime/host.helpers.ts` 1103–1105; `sdk:contracts/src/queries.ts:3989`) | `year/month/day: number \| null` | stored | null | history rows **left out** (⚠ `host.read.lorebookEntries.ts` 833–848, D55); other types' values not checked |
| `earlier-scenes@1` `openedStoryClock` (`queries.ts` 1485–1487; `scenes/earlierScenes.ts` 81–98) | `{year,month,day,hour,minute} \| null` | stamp | null | **stale stored stamp** |
| `cast-presences@1` `main[].from/until`, `at` (`queries.ts` 1285–1316; `state/presencesOnReading.ts` 86–100) | `StoryDate`, `StoryDate \| null`, `(StoryDate & {label?}) \| null` | at = moment | at null | at null (`state/reading.ts` 357–368); **stored rows delivered** |
| `lorebook-state@1` `moment`/`forkedAt`; `stat-trail@1` `moment`, `anchor.date` (`queries.ts` 3520–3528, 3641–3668; `state/statTrail.ts` 256–266) | `StoryDate \| null` | values | null | moment null; **anchor dates from stored history** |
| `advance-story-clock@1` out `clock`, `label`, `skipped` (`sdk:contracts/src/outlets.ts` 1605–1617; `pipelines/runtime/host.ts` 5228–5262) | `json` / `text` | clock object | halt, or `clock: null` + a reason under `skip` | `clock: null`, `skipped` = `TIMELINE_OFF_SENTENCES.clock` whatever `onRefusal` says |
| Event `story-clock-moved` `clock` (`sdk:sdk/src/events.ts` 967–978, 1456–1457) | `{ from: unknown; to: unknown }` | from/to | never fires | never fires |
| `scene-opened` / `scene-closed` (`events.ts` 933–958, 1454), `rest-taken` (1029–1045) | none (`sceneId`; values `{owner, rest}`) | — | — | — |
| Vars `current-date@1`, `history@1`, `earlier-scenes@1`, `story-calendar@1` (`sdk:sdk/src/variables.ts` 582–600, 629–650, 927–953, 970; `pipelines/prompt/assemble.ts` 266–296, 353–380) | `StoryDateValue` (optional), row `date?` / `dateDelta?` | values | currentDate absent, date null | absent; history `"date":""` (`pipelines/entities/variableLayouts.ts:396`); calendar absent |
| Widget `SessionMessageV1.storyClock*` (`sdk:sdk/src/widgets.ts` 300–312; `messages/store.ts` 95–109) | five `number \| null` | stamp | null | new rows null, **older rows stale** |
| Widget scene `openedAt` / `closedAt` (`sdk:sdk/src/sessionDossier.ts` 122–125; `client/components/sessionPage/liveSceneProjection.ts` 112–113), dossier `storyCalendar?` (273) | `StoryTime \| null` | stamps | null | **stale stamps** |
| Widget `SessionStateV1.storyTime?` (`widgets.ts` 750–755; `sockets/state.ts` 1380–1389) | `string` | words | absent | absent |
| Summarize rows `clock` (not in the contract; `pipelines/runtime/host.read.summarize.ts` 342–366) | `StoryClock \| null` | stamp | null | null (fixed in tl-2e-fix) |
| Tool `read_summary` history (⚠ `coreTools.ts` 342–349); assistant `clock` (`tools/assistantTools.ts` 10–16) | none (refuses on T); real time | — | — | refused |
| Cast versions (`CastMemberV1`, `sdk:sdk/src/characterProfile.ts:142`), `LoreLinkRow`, receipts, outlet in-ports | none (dates go in only through `fields`) | — | — | — |

## 2. Inconsistencies

- **T and U look the same** in every row except settings `timeline` and the cast's undeclared key: presences
  `at`, lorebook-state / stat-trail `moment` (null also means "the head"), `current-date`, history `date`,
  widget `storyTime`, scene stamps. The clock outlet tells them apart only by the sentence in `skipped`.
- **Absent vs null:** the cast's `storyTime` is absent without a book, although its type says `| null`. `current-date`
  and widget `storyTime` are absent where other fields are null. History prints `""`.
- **Stored values that still get through with the timeline off**, beyond tl-2e's fixes: (1) `earlier-scenes@1`'s
  `openedStoryClock` (only Assemble nulls it, `assemble.ts:821`); (2) widget message stamps and scene
  `openedAt`/`closedAt`, which the conversation widget turns into day marks with no timeline check
  (`sdk:core-catalog/components/shared/messages/sceneMarks.ts` 113, 293); (3) presence rows, read at the head,
  so a member with an `until` counts as gone (a change in behaviour, not only in what is shown); (4)
  stat-trail `anchor.date`; (5) the cast's `calendar` (Assemble drops it, other readers get it); (6) default
  scene names keep their stored day (`scenes/liveScenes.ts` 655–659); (7) lore rows' Beginning on types other
  than history (not checked).
- **Out-of-date docs:** `varCurrentDate`'s comment (`variables.ts` 940–946) still says a stored dated history entry
  can supply a date with the timeline off; tl-2e and D55 removed that path. The cast `storyTime` comment
  (`participants.ts` 513–519) does not mention `timeline`.
- With no book, `currentDateOf` falls back to the newest retrieved history entry (`assemble.ts` 375–380).

## 3. Params today

- **Nothing switches time on or off.** The only time inputs choose a moment: `at`, `branch`, `forkCut`
  (`queries.ts:3584`, 3747), `since.date` (3743) and `atHour` (1310).
- **The model, `knownToSpeaker`** (`boolean`, `default: true`): `queries.ts` 856 (lorebook-triggers), 1081
  (`loreSlots`: world-lore, character-lore, history-entries), 1626, 1810, 2001, 2299, 2694, 4155. The opposite
  pattern is `withLinks`, `default: false` (4137).
- **"On by default, values or null"** would add a time part to these reads:
  - The lore lanes, listing, searches and `entries-named`: rows already carry `year/month/day`. They would gain
    one `timeline` (or a `storyTime`) per result.
  - `earlier-scenes`: would gain `timeline`, a null clock on T, and a closing clock (D57).
  - `session-history`, `message-line`, `summarize-source`: rows carry no stamp in any contract. They would gain
    `storyClock: StoryTime | null`.
  - `cast-presences`, `lorebook-state`, `stat-trail`: would gain `timeline`.
  - `graph-scenes`: its scenes would gain opened/closed clocks.
  - **Open:** what the param's *off* returns (absent?). That would be a third state beside value and null.

## 4. Candidate uniform shapes (none chosen)

| | Fits today | Must change | For readers | Core-catalog edits |
|---|---|---|---|---|
| (a) one `StoryTime`-like object `{ timeline: boolean, now: StoryTime \| null, calendar: StoryCalendar \| null }` on each time-carrying result | the cast's `storyTime` (declare `timeline`, always send it, send `calendar: null` on T); settings already holds `timeline` | each other result gains the object; on T the host nulls the stored dates | additive (new key) | none required; DC scripts read `.now` and keep working |
| (b) every date `StoryDate \| null` plus one `timeline` boolean per result | the date fields are already nullable (table) | the host nulls the stored values in the 7 leaks; one `timeline` per result | additive; null more often | `sceneMarks.ts`, `storyDays.ts` callers get nulls |
| (c) a union `{kind:'dated',date} \| {kind:'timeless'} \| {kind:'undatable'}`, as `LoreWriteDate` (`state/storyTime.ts` 404–407) has it | app-internal only | every date field | **breaking** | DC `story.ts:170`, `rest.ts:122` (`own(own(v.cast).storyTime).now`), Assemble, widgets |

## 5. Consumers and pins

- **Readers:** `assemble.ts` 258–296, 353–380, 799–829; `pipelines/runtime/bindings.prompt.ts` 971–1044;
  `variableLayouts.ts` 381, 396, 409–411, 517; `pipelines/entities/contextTemplateDefaults.ts` 143–144.
- **Catalog:** ⚠ DC `sdk:core-catalog/src/genres/dungeon-crawler/story.ts:170` and `rest.ts:122` (epoch fallback when
  `now` is null); `sdk:core-catalog/src/shared/ui/session-state/stateView.ts` 507, 540, 605 and `timeFormat.ts`
  150–165; `sceneMarks.ts` 113, 293; `sdk:core-catalog/src/shared/weather.ts:78`.
- **Elsewhere:** routine jump words `pipelines/routines/evaluate.ts` 186–190; the client's own timeline flag
  `client/components/sessionPage/sessionPageData.svelte.ts` 193–197, 1211–1215, 1452–1454.
- **Tests:** `pipelines/prompt/currentDate.storyTime.test.ts:117` (`OFF = { now: null, calendar, timeline: false }`);
  `pipelines/runtime/promptAtReading.int.test.ts:525`; `sockets/sessions.storyUndated.int.test.ts:234`;
  `sessions/sessionSettings.timeline.int.test.ts` 12, 58–67; `pipelines/runtime/earlierScenesQuery.int.test.ts:132`;
  `scenes/timelessPreamble.int.test.ts`; `state/loreWriteDate.int.test.ts`; `sdk:sdk-tests/turnOrder.test.ts:432`.
  The prompt baseline shas (`plans/tl-2e-fix-shas.txt`) move only if rendered text changes.
- **Registry:** output ports are `S.json` or a shape id (`sdk:sdk/src/shapes.ts:162`), so result fields carry no
  hash. A new **param** changes the descriptor rows `snapshotRegistry` stores (`sdk:sdk-tests/registry.test.ts:27`).

## 6. Open questions the code cannot answer

1. One per-result `timeline`, or a time part on each row (scenes, messages)?
2. What a time param's *off* returns: absent, or null? Does T, U or "no book" each deserve its own value?
3. Should T null the stored presences, so every member counts as present, or keep them?
4. Should the cast's `calendar` be null on T? The dossier's `storyCalendar`, and whether stale stamps are cleared
   or only hidden.
5. Are the settings' `timeline` and the cast's `storyTime.timeline` one fact in two places (P2), or does one go?
6. Should message stamps enter the SDK contracts for `session-history@1` and `summarize-source@2`, where
   `row.clock` is published but undeclared?
