# REPORT — build lane `timeline-b` — a lorebook's Timeline switch: the lorebook's screens and the server leftovers (2026-11-14)

Brief: `plans/briefs/BRIEF-timeline-b.md` (its Corrections rule). Worker briefs `BRIEF-timeline-b-w1.md` to
`-w6.md`; worker reports on disk for w2 and w3 (`plans/briefs/REPORT-timeline-b-w2.md`, `-w3.md`); logs
`plans/timeline-b-*.log`. Saved by the lead from the supervisor's final message. **Nothing was looked at in a
running app.** No migration, no SDK edit, no `sdk:build`, no commit.

## Paths the brief had wrong (the right file was used, same intent)

- The lorebook's clock and calendar handlers: `src/lib/server/sockets/lorebookStoryTime.ts`.
- `clockMoveProblem`: `src/lib/server/state/clockProposal.ts`.
- Client: `EntryInspector.svelte` in `lorebooks/sections/`; `CastMemberForm`, `PresencesPanel`, `MemberTimeline`
  in `lorebooks/cast/`; `RelationshipFields` in `lorebooks/graphs/`; `PlaceLinks` in `lorebooks/places/`.
- Edited though not in Files owned: `lorebooks/LensTrack.svelte` (named in E), `lorebooks/EntryPool.svelte`
  (draws the Scenes list), `lorebooks/cast/MemberTimeline.svelte` (correction 4).

## Changed — server (`src/lib/server/`)

- `lorebooks/timeline.ts`: sentence `TIMELINE_OFF_SENTENCES.dated`; `holdsSomethingDated` counts any history
  entry, dated or not; `timelineCountsOf`.
- `lorebooks/timelinePass.ts`: the corrected rule. Kits and primers are skipped. A book stays on when any
  session that reads or owns it, archived or not, plays a story-time genre or a genre that does not resolve
  (`getGenre`).
- `startup/index.ts`: task `timeline-switch`, `doneMarker` of the same name, `failsHealth`, after `plugins`.
- `sockets/lorebooks.ts`: `lorebooks:create` takes `timelineEnabled`; the import insert reads the file's key;
  `lorebooks:update` emits `state:changed` on a flip (attached sessions and a session whose notes are its whole
  world; only when the value changed); the owner's `lorebooks:get` reply carries `timelineCounts`.
- `sockets/lorebookStoryTime.ts`: setting or clearing the lorebook's clock or calendar is refused.
- `sockets/entries.ts`: the session's history write is refused.
- `state/clockProposal.ts`: `clockMoveProblem` refuses, reading the switch in its existing query.
- `pipelines/runtime/host.ts`: `changeLoreEntry` (~2479–2500) drops year/month/day from a change to a history
  entry; the update outlet's re-date checks (~12408–12412) are skipped while off so the rest of the change goes
  through.
- `lorebooks/ownBook.ts`: `heldChangeVerdict` (~1475): a dated held change waits with the reason;
  `applyOverlayItems` (~2059–2074): a notes' history day waits, in `heldDays`.
- `utils/lorebookExportBuilder.ts`: writes `extensions.serenepub.timelineEnabled: false` only when off.
- `src/lib/shared/sockets/types.ts`: `Create.Params.timelineEnabled`; `timelineCounts` on the `Get` reply.
- Unchanged: `messages/writes.ts`, `lorebookExportMapper.ts`.

## Changed — client (`src/lib/client/`)

- `lorebooks/bookData.svelte.ts`: `BookData.timelineEnabled`, `bookTimeline()` (true outside the workspace).
- `lorebooks/BookSettings.svelte` + new `lorebooks/time/TimelineCard.svelte`; with the switch off the clock and
  calendar editors are not drawn. A failed counts read saves nothing and shows the error.
- `components/lorebookForms/NewLorebookDialog.svelte` (prop `asksTimeline`, switch on the Blank way);
  `lorebooks/LorebookActions.svelte` passes it and sends `timelineEnabled`.
- `lorebooks/LorebooksWorkspace.svelte`: `timelineOn`, `momentRead`, `shownRoute`. Off: no moment is read; a
  route to History or a history entry draws the default view (the route is left alone); the moment bar becomes
  the line chip alone when a second line exists, nothing otherwise; the roster reads at now; the rail and the
  lens fallback follow the switch; the reading line drops "as of ‹clock›".
- `lenses/registry.ts`, `LensTrack.svelte`: Time and Lives hidden. `scopes.ts`: History not listed, not counted
  in All. `looseEnds.ts`: the three time chores neither listed nor counted.
- `EntryWorkspace.svelte`: hidden: History door, Save as of, Change the base, Off for a while, `AmendmentList`;
  history rows left out of `poolItems`; scenes in played order; no moment in its route.
- `EntryPool.svelte`: with the switch on, a **History** row at the end of the Scenes list.
- Drawn only when on: `sections/HistoryListActions`, `HistoryUnfiledGroup`, `HistorySceneList`, the inspector's
  Scenes tab.
- `CastWorkspace.svelte`: `AmendmentList` and `PresencesPanel` hidden; `onAmend` only when on; the Timeline tab
  lists rows in played order with no dates. `cast/CastMemberForm.svelte`, `cast/MemberTimeline.svelte`,
  `graphs/RelationshipFields.svelte` (no **When**), `places/PlaceLinks.svelte` (a new link starts undated).
- `components/Layout.svelte`: not changed (★T-B2).

## Docs

`docs/lorebook-time.md` ("Setting the switch", "What you won't see", the server rules); `docs/lorebooks.md`;
`NOMENCLATURE.md` rows ~366, ~372, ~393 and one §25 entry. `STYLE-GUIDE.md` unchanged.

## Tests

New server: `sockets/lorebooks.timelineB.int`, `sockets/entries.timelineOff.int`,
`sockets/lorebookStoryTime.timelineOff.int`, `state/clockProposal.timelineOff.int`. New client:
`time/timelineCard.dom`, `bookTimeline.dom` (+ probe), `lorebookForms/newLorebookTimeline.dom`,
`lorebooksWorkspace.timelineOff.dom`, `entryWorkspace.timeline.dom` (+ fixture), `sections/historyTimelineOff.dom`,
`cast/castMemberFormTimelineOff.dom`, `castWorkspace.timelineOff.dom`, `memberTimelineOff.dom`. Extended:
`ownBook.timeline.int`, `timelinePass.int` (one expectation changed per correction 3), `host.timelineOff.int`,
`lorebooksWorkspace.hiddenLens.dom`, `lensTrackAdvanced.dom`, `scopes.test`, `looseEnds.test`,
`historyUnfiledGroup.dom`, `PlaceLinks.dom`, `RelationshipFields.dom`.

Supervisor's run: 25 files, 244 tests pass; `tsc` 0 errors. Workers' wider runs green (w1 18 files / 164; w3
13 / 200; w4 62 / 736).

## Sentences and labels added (all 🚧 — ★T-B1)

- Server: *This lorebook has no timeline, so nothing dated is written to it.*
- Card: **Timeline**; *Dates, versions over time, history and a story clock. Turn it off for a world where
  nothing needs a date.*; *This lorebook has ‹n› dated version(s) and ‹m› history entr(y/ies). With the timeline
  off they are hidden, not deleted, and sessions read the lorebook as it stands now.*; **Cancel**, **Switch off
  here**; notes over a lorebook: *On: these notes follow their lorebook's timeline.* / *Off: …*; fallback
  refusal *The timeline could not be changed.*; aria-label *Switch the timeline off*.
- New lorebook dialog: **Keep a timeline**; *Dates, history and a story clock. You can turn it on later in Book
  settings.*
- Scenes list (on): a **History** row with the count, tooltip *Open History*.

## Hides decided narrowly, or not possible

- The roster stays (reads at now); `RosterPopover.svelte` still words arrivals and leaving (not owned).
- `PresencesPanel` is hidden whole, including "how old they are while here".
- `DatedEntryPanel`'s Recompile sits only inside the hidden Time lens; left.
- An existing dated link edited while off keeps its history entry; new links start undated.
- With one line and the switch off there is no way to fork from the lorebook screen.
- "Story order" sort stays; an unsaved calendar draft is lost when the switch goes off.
- Scene order "as played" = smallest id in `selectedMessageIds`, then scene id.

## Open ★

- ★T-B1 the copy above.
- ★T-B2 a refusal of the card's save shows twice (card and Layout's toast), as `BookRulesCard`'s does;
  `lorebooks:update:error` cannot be marked handled while `EditLorebookForm` relies on the toast.
- ★T-B3 the dialog's `asksTimeline` prop keeps the start form unchanged; `timeline-c` decides that screen.
- ★T-B4 STYLE-GUIDE: "Help is one sentence"; the card's help is two.
- ★T-B5 the import that overwrites an existing lorebook (`sockets/lorebooks.ts` ~5289) and the starter-kit copy
  do not read the file's switch; unchecked whether `duplicateLorebookRows` copies the column.
- ★T-B6 the card shows on a starter kit's Book settings.
- ★T-B7 (P1) the pass switches existing books off at first boot with only a log line.
- From timeline-a: ★T-A4 answered by the corrected rule; ★T-A1, ★T-A2 open.

## Noticed, not done

- `host.ts` ~11779 still pre-checks with `sessionTimelineOf` (from timeline-a).
- Re-dating a history entry: on, refused by `hold`; off, the date is dropped and the rest is written.
- `CastWorkspace` still loads history entries and presences while off.
- `docs/sessions.md`, `docs/genre-story.md` mention the moment bar and Time view without the caveat.
- `prettier --check` flags most edited files (many already were); nothing reformatted.
- Two `/tmp/serene-pub-vitest-*` dirs (`0c7RLl`, `b8USCN`) left.
- Tests that mock `../bookData.svelte` with only `getBookData` may break where a component now reads
  `bookTimeline`.

## Scope review and lead follow-up (2026-11-14)

Scope review: in scope, no new event, no migration; `lorebookDuplicate.ts` ~88–93 copies the switch (answers
part of ★T-B5). Four findings, fixed by the lead:
1. **The pass could switch off a lorebook holding cast presences** (every one is dated) or scenes stamped with
   story time. `holdsSomethingDated` now counts both (two cases added to `timelinePass.int`).
   `timelineCountsOf` returns `presences`.
2. **The prompt opened for a clock alone but named "0 dated versions and 0 history entries".** It now names
   only what the lorebook holds: *This lorebook has 1 dated version, 2 cast presences and a story clock. With
   the timeline off that is hidden, not deleted, and sessions read the lorebook as it stands now.* 🚧
3. **§25** gained the unrecorded props and parameters.
4. **Does a session re-read its clock on a flip?** `state:changed` refreshes `state:get` and sends the widgets
   `story:moved` (the Chronicle re-asks `sessions:storyClock`). No path to the page's own clock read was found;
   left for `timeline-c`, which owns the session page. The stale comment in `db/schema.ts` is corrected.

## Grouped verification (lead, 2026-11-14)

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings). Full `vitest run`: 2433 files, 22 failed.
- **This programme's, fixed and green on rerun** (83 files, 857 tests, `plans/timeline-b-lead-rerun2.log`):
  `timelinePass.int` and `lorebooks.timelineB.int` (edited by the follow-up above while the run was going);
  `content.interestGate` (a fourth read of the lorebook row on `lorebooks:createBinding`, from lane
  `timeline-a`: `bookPresentOf`, `characters/versions.ts`, now reads the switch in its own query, hands it to
  `readingOf`, and returns no present for a lorebook with no timeline); one comment in `EntryWorkspace.svelte`
  over the comment ratchet.
- **Not this programme's** (asked of the peer session; untouched): the six old ones; `adapters/importBoundary`,
  `adapters/registry`, `dataUpgrades/0108_layering_registrations.int`, `plugins/coreRow.int`,
  `conformance/wiring`, `boot/paramsSlotWiring`, `boot/placedNodeReconcile.int`, `config/panel/groups.int`,
  `entities/publishedValues.int`, `entities/sessionGenres.int`, `sockets/presetFallback.int`,
  `sockets/sessionAdmin.presetActions.int`, and nine other files over the comment ratchet. They read as speech,
  adapter and plugin-frame work in flight.

## Walk in a running app (lead, 2026-11-14) — lanes b, c and d

Isolated instance, fresh data, no model set (so nothing was played). **Seen working:** the Timeline card; the
switch-off prompt naming what the lorebook holds, with its three buttons; **Make a timeless copy** (the copy
opens, entry folded to its latest text, no History, no moment bar, no Time or Lives view; the source untouched);
**Switch off here** and back on (everything dated hidden, then back); the start form's offer under a lorebook
with no timeline for Living, and **Switch the timeline on** (the lorebook's switch went on); no offer under
Minimal; a new session whose lorebook is its own notes starts with no timeline under Minimal and with one under
Living; `sessions:storyClock` reports `timeline` for each. No console errors.

**Found and fixed:** with the timeline off, Book settings' *What this book holds* still listed History with its
dates (`BookSettings.svelte` leaves that row out), and Loose ends counted the hidden history entry under *Needs
keywords* (`looseEnds.ts` skips history entries; one test added).

**Noticed, not done:** after the timeless copy opens, the **Book settings** rail item stays highlighted though
the copy shows its Everything list.

**Not walked (needs a model or messages):** the Chronicle with the timeline off (★T-C6), the Summarize modal,
the session page's re-read when the switch flips, Edit Session's reading, the New lorebook dialog's switch, the
one-time pass on real data (on fresh data it reported 0 lorebooks changed).

## ★T-B7 built (lead, 2026-11-14 — owner: "Go with your safe suggestions")

The one-time pass marks each lorebook it switches off (`extra_json.timelineOffByPass`, the time it did; no
migration). That lorebook's Timeline card says: *An update switched this off because nothing in this lorebook was
dated. Switch it on to keep dates, history and a story clock.* 🚧 The mark goes on any save of the switch and is
never copied by Duplicate or the timeless copy. A lorebook the pass switched off on an instance that booted
before this was built carries no mark. Tests: 5 files, 66 pass (`plans/timeline-bypass.log`). Ruled with it, as
recommended: ★T-C1 (the two SDK names stand), ★T-C2 (the Lair and the Dungeon Crawler require a timeline).
**Not built: ★T-C6** — hiding the Chronicle's clock needs a field on the published `HistoryEntriesV1`, which
"Do not provide SDK api for this yet" ruled out; it stays the owner's call.
