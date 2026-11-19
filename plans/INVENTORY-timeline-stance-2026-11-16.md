# INVENTORY — the timeline, as genres, presets, sessions and the SDK see it today (programme 1.7; read-only, 2026-11-16)

SDK = `../serene-pub-sdk`; APP = `src/lib/server`. Re-verify every file:line.

## 1. Declarations today

- `GenreDecl.keepsTime?: 'story' | 'real' | 'none'` (SDK `sdk/src/genres.ts` 236–237); `GenreDecl.timeline?:
  'required'` (238–241; props 458–461; `genre()` checks 1202–1209: "`timeline: 'required'` needs `keepsTime:
  'story'`"). The doc at :239: "Not a lock on a session … genres expect, never lock".
- Core genres (`core-catalog/src/registry/genres.ts`): Story :542 story; Chat :763 real; Guide :911 real; Lair
  1180–1181 story + required; Dungeon Crawler 1552–1553 story + required.
- Preset `PresetDefaults.timeline?: boolean` (`sdk/src/announce.ts` 330–337), refused when the genre requires a
  timeline (755–765); a genre named through `use(…)` is not checked (:757). One core use: story-minimal
  `defaults: { timeline: false }` (`core-catalog/src/seed/presets.ts` 51, 64).
- `keepsTime` drives `rulesetFit` only (`sdk/src/fit.ts` 296–411; `FunctionDecl.countsTime`,
  `sdk/src/functions.ts:298`); APP `rulesets/genreFit.ts`, `lorebooks/timelinePass.ts:69`.
- `timelineDefaultFor(genre, preset)` (APP `lorebooks/timeline.ts` 59–69): genre missing or required → true;
  else the preset default; else `keepsTime === 'story'`. Used for a new session's own notes only
  (`sockets/sessions.create.ts` 778–783) and on the preset list (`sockets/sessionAdmin.ts:753`).
- Run time: column `lorebooks.timeline_enabled`, read only through `lorebooks/timeline.ts` (`timelineOf` :72,
  `sessionTimelineOf` :116). The host sees `LineReading.timelineOff?` (`state/reading.ts` 89–90, 358–396).
  **No flag in the SDK input or scope.**
- Timeline off: no moment; `storyNowOf` null (`state/storyTime.ts` 283); `writeDatingAt` null
  (`state/reading.ts:512`); message stamps skipped; sentences `TIMELINE_OFF_SENTENCES` {history, clock, dated}
  (`lorebooks/timeline.ts` 45–49).

## 2. Reads that depend on a timeline

`core:var/current-date@1` (`sdk/src/variables.ts` 926–947; not marked optional; APP `currentDateOf`,
`pipelines/prompt/assemble.ts` 343–375, returns undefined); `core:var/story-calendar@1` (:956+; not marked
optional; APP 815–818; `bookCalendarOf` does not check the switch, `state/storyTime.ts` 139–149);
`StoryDateValue` / `StoryDateDelta` (`sdk/src/storyTime.ts` 64–93; fields `STORY_DATE_FIELD`,
`STORY_DATE_DELTA_FIELD`, variables.ts 484–570); `core:var/history@1` rows and `core:var/earlier-scenes@1`
(`date`, `dateDelta` `optional: true`; APP `datedOf` 277–287); `core:query/earlier-scenes@1`
(`contracts/src/queries.ts` 1505–1563; stored opened clocks still come through with the timeline off);
`core:query/history-entries@1` (1213–1260; no timeline check found); `core:query/cast-presences@1` (1298–1330;
`at` null when off); widget `HistoryEntriesV1.timeline?` (`sdk/src/widgets.ts` 2603).

## 3. Writes that mutate timeline state

`core:outlet/advance-story-clock@1` (`contracts/src/outlets.ts` 1517–1646; APP `host.ts` ~5100–5260: timeline
off → `skipped: "This lorebook has no timeline, so its story time doesn't move."`, whatever `onRefusal` says);
`create-lore-entry@1` of a history entry (nothing written, sentence in `notes`, `host.ts` ~6455);
`update-lore-entry@1` on a history entry (date parts dropped, ~420–436); dated versions only when on (~474);
held dated changes conflict `dated` on accept (`lorebooks/ownBook.ts` ~1484). Sockets refuse with the sentences
(`sockets/lorebookStoryTime.ts`, `storyClock.ts`, `entries.ts`, `scenes.ts`, `state/clockProposal.ts`).
`core:task/clock-step@1` is pure.

## 4. How the SDK expresses requirements and types

- `GenreDecl.uses` ("Never a requirement"), weighed by `rulesetFit`. **No spec, pipeline or registration
  declares what it needs from a genre.**
- `validate(doc, { templates? })` (`sdk/src/validate.ts` 84–98) → `Finding { law, severity, nodeKey?, message,
  fix }`; laws are inline loops over `doc.nodes`. **No law reads a genre property**; `doc.genre` is display only.
- Ports are typed by a `ShapeId` string (`sdk/src/shapes.ts`); no optional or nullable shape; query-level
  `optional` means a failure becomes an empty ok. Handler inputs are `any` (`sdk/src/nodeInput.ts:235`); the `$`
  scope gives a `DataRef` per port with no value type.

## 5. Templates

Helpers print nothing for null (`sdk/src/variableLayouts.ts` 113, 123). `VarField.optional` = "absent or null"
(`sdk/src/template.ts` 224–231), used in the `VarValue` TS type and sample checks; **the template checker never
reads `optional`** (`sdk/src/templateCheck.ts`; `shapeMismatch` always a warning 413–425). Shipped templates
guard with `{{#if currentDate}}`. A template cannot declare that it needs a timeline.

## 6. Where sessions meet lorebooks

`StartSessionForm.svelte` `timelineOfferFor` 947–958; copy 2418–2433 ("This lorebook keeps no timeline. {preset}
plays best with one." / "Story time won't move in this session." / "Switch the timeline on"): advisory; nothing
refused; no server-side refusal at create or attach.

## 7. Tests

SDK `sdk-tests/fit.test.ts` 326, 400–411; `presets.test.ts` 472–487; `coreCatalog.test.ts` 1083. APP
`pipelines/runtime/host.timelineOff.int.test.ts`; `state/timelineOff.int.test.ts`,
`timelineQueries.int.test.ts`; `lorebooks/timelineDefault.test.ts`, `timelinePass.int.test.ts`;
`sockets/sessions.timelineDefault.int.test.ts` and the `*.timelineOff` socket tests; client
`startSessionTimelineOffer.dom.test.svelte.ts`. No validate law exists for the timeline.
