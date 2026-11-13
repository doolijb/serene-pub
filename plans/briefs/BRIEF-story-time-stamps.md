# BRIEF st-w1 — message time in story time (lead-supervised worker; owner 2026-11-06)

You are a lane-worker. Read `plans/briefs/BRIEF-lay-common.md` (rules apply: EVERY test/tsc run inside the memory-capped `systemd-run` scope; never hand a DOM node to an assertion). App = /home/jody/github/serene-pub, SDK = /home/jody/github/serene-pub-sdk.

Owner: "When a session/lorebook has it's own time, the message time should reflect it, instead of real time."

## Facts (from a read-only map; verify lines)
- Each row carries its story stamp: `MessageV1.storyClockYear/Month/Day/Hour/Minute` (sdk/src/widgets.ts ≈299-311; DB `session_messages.story_clock_*`, written at insert by `withStoryClockStamp`, server/messages/store.ts ≈84-101; NULL on pre-pr-5 rows and Chat/Guide/no-present sessions).
- The row time today: core-catalog `components/shared/messages/SessionMessage.svelte` ≈321-342 `messageTime` (toLocaleTimeString of updatedAt since createdAt is a day-only date) rendered ≈746-748 as part `messages.message-time`, no title. Show times hides it via CSS only.
- Day marks already use the stamp: `sceneMarks.ts` `storyDayOfRow` (≈110) + `storyDayLabelIn` (core-catalog/src/shared/ui/conversation/storyDays.ts ≈30) → SDK `formatStoryTime` (sdk/src/storyTime.ts ≈175); calendar on the dossier (`conv.dossier.storyCalendar`).
- `timeFormat` (Messages' Story time format) → `formatStoryTimeAs(storyTimePartsOf(t, calendar), fmt)` (core-catalog/src/shared/ui/session-state/timeFormat.ts ≈49/≈101); missing parts collapse.

## Build (lead decisions)
1. In `sceneMarks.ts`: `storyTimeOfRow(row)` → `{ year, month?, day?, hour?, minute? } | null` (null unless year is a whole number; day needs month; minute needs hour — as the DB checks); `messageStoryTime(row, calendar, timeFormat?)` → `{ text, full } | null`: text = `timeFormat` set → `formatStoryTimeAs(…)`; else `HH:MM` when the stamp has an hour; else the calendar's day spelling (date-only stamps show the day on each line — lead ★1). full = `formatStoryTime(t, calendar)`. Extend `SceneMarkRow` with hour/minute.
2. `SessionMessage.svelte`: a stamped row shows the story text; an unstamped row keeps today's real time (mixed sessions: real time on old rows — lead ★2). Add `title` on the part: stamped → "‹full story time› · written ‹real local date and time›"; unstamped → the full real date/time. Add `data-story-time` on the part when stamped. Pass `timeFormat` + the calendar down from `MessagesWidget.svelte` / `SessionContainer.svelte` as needed. Folio keeps no time. Show times still hides the part.
3. Importer: `src/lib/server/sockets/import.ts` ≈1674-1697 (SillyTavern → `insertLegacyMany`) passes `storyClockYear/Month/Day/Hour/Minute: null` explicitly so imported lines are never stamped with the import moment (the store keeps caller-passed stamps, store.ts ≈95). `sockets/import.ts` is shared with another programme: re-read right before the edit, minimal hunk.
4. Do NOT edit `core-catalog/src/registry/widgets.ts` (another lane is in it — the lead widens the Story time format description later). Do NOT run sdk:build (the lead builds).

## Tests (capped, one file per run)
- `sdk-tests/conversationSceneMarks.test.ts`: stamped with hour → `08:30`; date-only → the calendar day; timeFormat wins and collapses; unstampable shapes → null; free-form vs declared calendar incl. `dayName`.
- `sdk-tests/coreConversationComponent.test.ts` (it mounts source or dist — check; if dist, note it needs the lead's build): stamped row shows story text + title holds real time + `data-story-time`; unstamped shows locale time; folio no time.
- App int test (new or existing import test): a SillyTavern import into a session whose book has a clock leaves `story_clock_*` NULL.

## Docs
`docs/session-layout.md` (Show times: the story time a line was written at, when the story has a clock or a dated present, else real time; real time on hover; Story time format covers lines too), `docs/lorebook-time.md` ≈126 (each line shows that time), and the SDK `MessageV1` JSDoc (sdk/src/widgets.ts ≈299: "and the row's time"). NOMENCLATURE: add one §25 row (re-read right before; minimal hunk).

## Files owned
sceneMarks.ts, SessionMessage.svelte, MessagesWidget.svelte, SessionContainer.svelte (core-catalog components/shared/messages/), sdk/src/widgets.ts (the MessageV1 JSDoc only), src/lib/server/sockets/import.ts (the one hunk), the tests above, the docs above, NOMENCLATURE.md (one row).

## Done means
Tests green in capped runs; SDK tsc + app tsc no new errors in your files. Final message = report: changed files, tests + results, anything needing the lead's sdk:build, Noticed.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."
