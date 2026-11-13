# REPORT playtest4-S8 — the Chronicle's Compile starts the compile run (★S6-1); the by-date ask echoed on the activity (★S7-2)

(Saved by the lead from the supervisor's hand-back; the harness refused the lane's own write.)

**BUILT** inside the owned files plus three new files in owned folders. Workers w1 (SDK), w2 (server), w3 (the request answer), w4 (the modal and the mapping). No migration, setting or event added. The server already refuses a non-owner (`scenes.ts` by-date branch: `book.userId !== userId` → *Lorebook not found or access denied.*), so the stop rule did not fire.

## Changed files
**SDK** (`../serene-pub-sdk`; dist rebuilt under the flock, no dev server running)
- `sdk/src/widgets.ts`: 🚧 `'compile-history-entry': { params: { date: StoryTime | null }; result: void }` (doc, `@ruling ★S6-1`); `WIDGET_REQUEST_ASKERS` → `'core'`; `WIDGET_REQUEST_APIS` → `'session'`. Decision: placed beside `'summarize-scenes'` in the Chronicle group (a Chronicle write like its siblings), not beside `'pick-turn'`.
- `core-catalog/src/shared/ui/chronicle/index.ts`: each `ChronicleView.unfiled` item gains `compile: { date: StoryTime | null; label; title } | null` (null unless `canWrite`). Label *Compile*. Dated title *Compile this day's scenes into the history entry of ‹day›, making it if there is none*; Undated title *Compile the undated scenes into the newest dated history entry, making one if there is none*.
- `core-catalog/components/shared/chronicle/ChronicleWidget.svelte`: part `chronicle.unfiled-compile` in `chronicle.unfiled-day-head` after the count; `wand` icon (the History lens's glyph); disabled while busy; shown only when `day.compile` is set. `compileDay(date)` → `press("compile", "compile-history-entry", { date })`, so a refusal shows in place as *Not done: …*.
- `sdk-tests/coreChronicle.test.ts`: describe *🚧 ★S6-1: Compile per day*, 3 tests (owner's days carry the day's `date`/null, label, titles; guest gets null, owner-only view has no days; askers `'core'`, API `'session'`).
- `guides/widgets.md` regenerated (`unfiled-compile`).

**App**
- `shared/sockets/types.ts`: `Sockets.Scenes.Compile.ByDate.requestId?` and `ErrorResponse.requestId?`.
- `sockets/scenes.ts` (`sceneCompileHandler` only): `askedRequestId` — a string `requestId` on a by-date ask only; echoed on both `scenes:compile:error` emits (`refuse` ~1120, run failure ~1522), sentences byte-identical; `byDate = { date }` set once the by-date branch has resolved (~1315) and spread into `startCompile` (~1457).
- `utils/activityStore.ts`: 🚧 `CompileHistoryEntryActivity.byDate?: { date: StoryDate | null }` (memory only); `startCompile` `params.byDate?`.
- `src/app.d.ts`: `CompileEntryState.byDate?` (additive).
- `modals/compileEntryState.ts` (new): `compileEntryStateOf(a)` — Layout's field-by-field compile-activity mapping moved unchanged plus `byDate`; extracted so the modal's DOM test builds fixtures through the real mapping.
- `Layout.svelte`: the import (line 59) and the mapping (line 2515, `compileActivities.map(compileEntryStateOf)`) only.
- `modals/CompileHistoryEntryModal.svelte`: the by-date emit carries a fresh `requestId` per press (`uuid` v4; Retry is a new ask); `handleError` first ignores a refusal carrying another ask's `requestId` (an entry window has no id, so it ignores every by-date refusal); adoption with no entry yet requires `a.byDate` to match the asked day via `dayOnly` + `compareDates` (`sameAskedDay`) — Undated matches Undated only; an entry compile (no `byDate`) is never adopted by a by-date window; `isAskedDay` kept for refusals.
- `sessionPage/requests/compileHistoryEntry.ts` (new): `answerCompileHistoryEntry`, `CompileHistoryEntryDeps`, `compileByDate(socket, ask, timeoutMs)`. Date must be null or whole parts (hour/minute dropped). Refusals: *this session reads no lorebook* (existing), *only the lorebook's owner compiles its history* (new). Settles on the first of: (1) `scenes:compile:error` carrying its `requestId` → rejects with that sentence; (2) an `activity:update` frame holding a **running** compile on the same book and line at moment null whose `byDate` is the asked day → resolves; (3) 15 s → `REPLY_TIMEOUT_MESSAGE`. Interests via `declareInterest` before the emit (no `socket.on`), released on every exit. A same-day compile already running from another tab may resolve first; harmless (the server refuses *already in progress*, the day is compiling) — commented.
- `sessionPage/requests/index.ts`: one table entry after `"summarize-scenes"`, `answerCompileHistoryEntry(p, { ...chronicleReads(d), compileByDate: (ask) => compileByDate(useTypedSocket(), ask) })`. Decision: `useTypedSocket()` at the press, as `requests/library.ts` does — `WidgetRequestDeps`, `pageAsks.ts`, `+page.svelte` untouched.
- `sessionPage/requests/compileHistoryEntry.test.ts` (new, 19 tests).
- `docs/sessions.md` Chronicle paragraph (~573): the owner's **Compile** per day — compiles that day's scenes on the session's line, from every session on that line, into the dated entry, making it if there is none; no window; run and review in the activity list; refusal said in place; the History lens has the same Compile.

## Tests run (all capped)
- SDK: `coreChronicle.test.ts widgetParts.test.ts` → 32/32.
- Server: `activityStore.compileDedup.test.ts` (+1: `byDate` carried dated/null, absent for an entry compile), `scenes.compileLine.int.test.ts` (+3, 60 s each: activity `byDate` dated/null/absent; refusal echoes `requestId`, not when none or non-string; an entry ask's refusal never carries one) → 38/38.
- Client: `requests/compileHistoryEntry.test.ts`, `requests/index.test.ts`, `requests/askers.test.ts` → 31/31.
- Modal: `CompileHistoryEntryModal.dom.test.svelte.ts` → 15/15 (fixtures through `compileEntryStateOf`; new: Undated adopts only Undated; dated only its day incl. one with an hour; another ask's `requestId` leaves the window running, its own shows the sentence; an entry window ignores a refusal carrying a `requestId`; each press incl. Retry gets a fresh `requestId`).
- Supervisor re-run of the four client/server files → 46/46, exit 0. Prettier clean on the three new files.

## Stopped, needs owner (★)
- **★S8-1 (copy):** the two Chronicle titles above and the new refusal *only the lorebook's owner compiles its history*. Recommend keep ("this day's scenes" because the by-date ask takes the line's scenes from every session, as S6 asked).
- **★S8-2 (names beyond the brief's three):** `ChronicleView.unfiled[].compile` (shaped like `extend`/`summarizeAll`); helpers `compileEntryStateOf`, `answerCompileHistoryEntry`/`CompileHistoryEntryDeps`/`compileByDate`. Recommend keep (the view field lets the SDK test check the request's date without rendering Svelte; the extracted mapping is what lets the DOM fixtures go through the real mapping). Alternative: no view field, the widget reads dates from `answer.unfiledDays` by index (copies the filter rule).

## Canon rows needed (lead) — written to §25 by the lead; see NOMENCLATURE tail.

## Queued for the lead
- `docs/session-layout.md:55` Chronicle row: a sentence on the per-day Compile.
- STYLE-GUIDE §6.16 Chronicle row: `chronicle.unfiled-compile` entry.
- Optional: `remoteChronicle.dom.test.ts` press test that the built widget sends `compile-history-entry` with the day's date (SDK test covers it at view level only).

## Noticed, not done
- w3 ran `npx tsc --noEmit -p .` over the whole project (forbidden by the standing rules; left out of its brief); no errors in touched files; nothing changed.
- w2/w3 used a short Python replace instead of Edit for a few hunks; each match asserted unique and checked by grep.
- `CompileHistoryEntryModal.svelte` fails prettier on two older `<p class=…>` blocks (~536, ~581), pre-existing.
- A refusal worded generically by `register()` (*An error occurred…*, an unexpected throw) carries no `requestId`; the Chronicle's request then rejects on the 15 s timeout.
- The Chronicle's Compile stays pressable for a day whose compile is already running (refused or resolved on the running run); hiding it would need activity state inside the widget.
