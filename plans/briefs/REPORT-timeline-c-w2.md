# REPORT — timeline-c-w2

Status question: none relayed.

## Changed files
- `src/lib/server/lorebooks/timeline.ts` — `timelineDefaultFor` (🚧), header reader list note.
- `src/lib/server/lorebooks/ownBook.ts` — `insertOwnBook` row field `timelineEnabled?` (ignored when `overlayOf` is set).
- `src/lib/server/sockets/sessions.ts` — import; local `presetDefaults` (kept from the loaded preset row); `timelineEnabled` passed to `insertOwnBook` when `row.lorebookId == null`.
- `src/lib/server/sockets/sessionAdmin.ts` — `buildSessionPresets` rows carry `timelineDefault`; `getGenre` added to the existing static SDK import.
- `src/lib/server/sockets/storyClock.ts` — reply carries `timeline` (early return `true`; main `reading?.timelineOff !== true`). No other `Reading` builder in the server.
- `src/lib/shared/sockets/types.ts` — `PresetDefaults.timeline?`, `PresetRow.timelineDefault?`, `StoryClock.Reading.timeline`.
- Tests: `lorebooks/timelineDefault.test.ts` (new), `sockets/storyClock.timeline.int.test.ts` (extended), `sockets/sessions.timelineDefault.int.test.ts` (new), `pipelines/registrations/project.timelineDefault.int.test.ts` (new).

## Runs
- `timelineDefault.test.ts` + `storyClock.timeline.int.test.ts`: 2 files, 19/19 pass. Log `plans/timeline-c-w2-1.log`.
- `npx tsc --noEmit -p .`: 0 errors.
- NOT run, written only: `sessions.timelineDefault.int.test.ts`, `project.timelineDefault.int.test.ts`, and the regression set. The SDK is not built with the new declarations (`grep -c timeline` on `core-catalog/dist/seed/presets.js` and `dist/registry/genres.js` is 0; no `timeline: 'required'`/`false` anywhere in dist). The supervisor runs them after `sdk:build`. Seed keys used in them: core-story-minimal, -living, -rule-based, core-chat-basic, -agentic, core-guide-default, core-lair-words-only, -default, -rules-and-dice, core-dungeon-crawler-default. Those two files were not exercised at all, so they may need small fixes (e.g. create refusals for Lair/Guide without cast, the `emitToInterested` mock).

## Choices
- `timelineDefaultFor` also treats a `required` genre as on whatever `keepsTime` says.
- `sessions.ts` passes `timelineEnabled` only when `row.lorebookId == null`; `insertOwnBook` also ignores it when `overlayOf` is set (belt and braces).
- `getGenre` in `sessionAdmin.ts` imported statically (same SDK import line); the module already imported the SDK statically.
- The project test sets the core row's defaults back to the old (no `timeline`) shape before the first run, so it proves the re-force even if the seed step already wrote the new one.

## Names added (🚧)
`timelineDefaultFor`; `insertOwnBook` row `timelineEnabled`; `PresetRow.timelineDefault`; `StoryClock.Reading.timeline`; `PresetDefaults.timeline`; local `presetDefaults` in session create. Doc sentences on each.

## Noticed, not done
- Prettier `--check` flags the three new test files (repo style evidently differs from the default config; not changed).
- tsc passes although `Reading` gained a required field: client test fixtures typed as `Reading` evidently cast or are loosely typed; client code that builds a `Reading` was not inspected.
