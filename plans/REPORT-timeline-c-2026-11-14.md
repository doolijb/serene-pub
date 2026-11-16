# REPORT — build lane `timeline-c` — a lorebook's Timeline switch: the session side (2026-11-14)

Brief: `plans/briefs/BRIEF-timeline-c.md` (its Corrections rule). Worker briefs `BRIEF-timeline-c-w1.md` to
`-w5.md`; worker reports on disk for w2, w4, w5; logs `plans/timeline-c-*.log`. Saved by the lead from the
supervisor's final message. **Nothing was looked at in a running app.** No migration, no boot pass, no commit.
One `sdk:build`, from the app root, with no dev server and no test run up.

## Changed — SDK (`../serene-pub-sdk`)

- `sdk/src/announce.ts`: `PresetDefaults.timeline?: boolean` 🚧; the "every key advisory" comment amended;
  `preset()` refuses a non-boolean, and refuses `false` when its genre value declares `timeline: 'required'`
  (a genre named by `use(…)` cannot be checked there; the server's resolver lets the mandate win).
- `sdk/src/genres.ts`: `timeline?: 'required'` 🚧 on a genre; refused without `keepsTime: 'story'`; absent
  from the frozen declaration when unstated, so other genres hash as before.
- `core-catalog/src/registry/genres.ts`: the Lair and the Dungeon Crawler declare `timeline: "required"`.
- `core-catalog/src/seed/presets.ts`: Story Minimal `defaults: { timeline: false }`; description: *Just the
  story: one model call a turn. On a lorebook with a timeline, the clock moves on a few minutes each round;
  nothing else changes unless you change it.* 🚧
- Tests: `sdk-tests/presets.test.ts`, `fit.test.ts`, `coreCatalog.test.ts` (digest re-pinned
  `f6f145e14824ad14` → `d997da157b5f16ab`). `guides/genres-presets-and-routines.md`. `INTEGRATING.md` unchanged.

## Changed — app

Server: `lorebooks/timeline.ts` (`timelineDefaultFor(genre, preset)`: required → true; preset's value; else
`keepsTime === 'story'`; unresolved genre → true); `lorebooks/ownBook.ts` (`insertOwnBook` takes
`timelineEnabled`, used only when the notes overlay nothing); `sockets/sessions.ts` (session create passes the
default only for a session whose lorebook is its own notes); `sockets/sessionAdmin.ts` (preset rows carry
`timelineDefault`); `sockets/storyClock.ts` (reply carries `timeline`); `shared/sockets/types.ts`.

Client: `sessionForms/StartSessionForm.svelte` (the offer under the chosen row in `bookPickRow`,
`plainBookRow` and the shared books' row; `asksTimeline` on the dialog mount; `createLorebook` sends
`timelineEnabled` when set); `SessionLorebookReading.svelte` (prop `timeline`; off shows the line alone);
`EditSessionForm.svelte` (the attached mount's prop); `sessionPage/sessionPageData.svelte.ts` (`storyTimeline`,
`coalescedRead`); `routes/sessions/[id]/+page.svelte` (the clock read sets the value and re-reads on
`state:changed` through the inbox); `modals/SummarizeLoreModal.svelte` (prop `timeline`; off: no History
entry block, Scene sends `historyEntryId: null`).

Docs: `docs/sessions.md` ("A timeline for a new session"), `docs/genres.md`, `docs/genre-story.md`,
`docs/lorebook-time.md`, `NOMENCLATURE.md` (~393, ~1770, §25).

## Tests

New: `lorebooks/timelineDefault.test`, `sockets/sessions.timelineDefault.int`,
`pipelines/registrations/project.timelineDefault.int` (first boot sets Story Minimal's default, a second
changes nothing, an admin's copy is untouched), `sessionForms/startSessionTimelineOffer.dom`,
`sessionLorebookReadingTimeline.dom`, `sessionPage/coalescedRead.test`, `sessionStoryTimeline.dom`. Extended:
`storyClock.timeline.int`, `summarizeLoreModal.writes.dom`.

Supervisor's runs: lane's targeted run 15 files / 94 tests pass; server regression 10 / 57 pass; SDK
`coreCatalog` 0 failures after the re-pin; `tsc` 0 errors. Not run by the lane: `npm run check`, full
`sdk:test`, `npm test`.

## Copy added (all 🚧)

- Offer: *This lorebook keeps no timeline. ‹Preset name› plays best with one.* · **Switch the timeline on** ·
  copy mode: *You can switch it on in the copy's Book settings.* · provided: *Story time won't move in this
  session.* · fallback refusal *The timeline could not be changed.*
- Read-only reading with no timeline: *The line is which version of the lorebook this session reads; Main is
  the original.* then *Turn on advanced controls to change it.* / *The session owner chooses it.*
- SDK error sentences for the two names (see `announce.ts`, `genres.ts`).

Offer rule: shown only when the preset's `timelineDefault` is true and the chosen row's `timelineEnabled` is
false; copy mode → the copy line; owner of a writable, non-provided lorebook → the button; otherwise the
story-time line.

## Session-page time controls found

| Where | Done |
|---|---|
| Summarize modal's History entry choice | hidden; the scene files under no history entry |
| Edit Session's reading, attached lorebook | clock mode hidden |
| Edit Session's reading, a session whose lorebook is its own notes | **not hidden** (★T-C5) |
| Start form's branch-off reading | hidden |
| An action's *Time passes…* clock step (`sessionPage/CollectModal.svelte` ~262–271) | not owned; drawn, the server refuses after send |
| The Chronicle | not edited (★T-C6) |
| Messages | unchanged: an unstamped message shows real time |

## Open ★

- ★T-C1 the two SDK names and their error sentences.
- ★T-C2 the Lair and Dungeon Crawler declaring `timeline: 'required'` (the lead's choice).
- ★T-C3 the offer's copy (two sentences where STYLE-GUIDE says help is one).
- ★T-C4 the start form's New lorebook dialog asks, but its switch starts off (the dialog's own default), not at
  the preset's default as the brief asked; presetting it needs a prop on `NewLorebookDialog.svelte`. As built it
  matches the ruling literally ("Off with offer at session creation, and ask when created").
- ★T-C5 Edit Session's reading for a session whose lorebook is its own notes still shows the story clock.
- ★T-C6 the Chronicle with the timeline off (read from code, not tested): the clock section stays with *No
  date yet* and *Nothing on its line is dated, and no clock is set.*; no **Next day**; **Move the clock…**
  still shows for the owner and is refused with the server's sentence.
- ★T-B2 again: a refusal of **Switch the timeline on** shows in place and as a toast.
- Admin copies of Story Minimal made before this build lack the default and start timelined.

## Noticed, not done

- `docs/summarization.md` ~32 still says a scene needs a History entry.
- The SDK's `presetFindings` (a preset arriving as data) does not check the mandate.
- The page re-reads `sessions:storyClock` on every `state:changed` for its session (coalesced: one in flight,
  one queued).
- No page-level test of the `state:changed` wiring.
- `SummarizeLoreModal.svelte` was reformatted whole by a worker's `prettier --write` on that one file.

## Scope review and lead follow-up (2026-11-14)

Scope review: no objection on scope or data safety; no SDK surface over the switch; the default applies only to
a session whose lorebook is its own notes; hashes move only for the Lair, the Dungeon Crawler and Story Minimal;
`SummarizeLoreModal.svelte` holds no whole-file reformat. Two low findings, fixed by the lead: the offer's
fallback refusal is in §25; the start form's held row takes `timelineEnabled` from the reply (it waited on the
re-sent list). Cost note kept: one coalesced `sessions:storyClock` read per `state:changed` per open tab.
`docs/summarization.md` corrected. **Left as built:** ★T-C5 (it shows only for a session whose own notes have
lines; a clock set there is refused with the sentence) and the *Time passes…* action (an action that collects
only a clock step; refused with the sentence after sending).

## Grouped verification (lead, 2026-11-14) — `timeline-c` and `timeline-d` together

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings), both before the last two small follow-up fixes, whose
tests were rerun (3 files, 40 tests pass). Full `vitest run` (`plans/timeline-cd-lead-full.log`): 2443 files,
2423 pass, 19 fail, 1 skipped; 25,658 tests pass, 26 fail. **None of the 19 is this programme's**: they are the
same files as after `timeline-b` (`sessions/genreFieldDefaults.int`, `runtime/allPipelines.int`,
`runtime/guideGrounding.int`, `runtime/scoreLedAllocation.int`, `sessionPage/narrateDraft.dom`,
`sockets/sessions.forms.int`, `adapters/importBoundary`, `adapters/registry`,
`dataUpgrades/0108_layering_registrations.int`, `plugins/coreRow.int`, `conformance/wiring`,
`conformance/commentHistory` (nine files of other work), `boot/paramsSlotWiring`,
`boot/placedNodeReconcile.int`, `config/panel/groups.int`, `entities/publishedValues.int`,
`entities/sessionGenres.int`, `sockets/presetFallback.int`, `sockets/sessionAdmin.presetActions.int`); each
failure message was read and names speech, adapter, session-language or plugin-frame work.

`npm run sdk:test` (`plans/timeline-cd-lead-sdk.log`): 4723 tests, 4718 pass, 4 fail, none over the two names
this lane added: `deriveDontSpell` (two: `factories/turnOrder.ts`, `shared/speakMessage.ts`, four ruled counts),
`surface` (untagged `STORY_CREATE_SPEC_ID`, `CREATE_SESSION_PERSONA_*_MAX`), `vocabulary`
(`guides/your-first-plugin.md`).
