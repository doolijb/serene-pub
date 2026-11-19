# PROGRAMME (owner, 2026-11-15: "I need them all to be build out. Merge them into the updated plan where they belong.")

One ordered list of every lane ruled or directed on 2026-11-15. Detail lives in the plans named per phase; this
file is the order and the latest rulings. Each lane = brief → cold review → build → scope review → grouped
verification. Facts: `INVENTORY-session-settings-2026-11-15.md`, `INVENTORY-core-session-couplings-2026-11-15.md`.

## Latest rulings (owner's words, 2026-11-15 night) — these rule over earlier text in the detail plans

- **Line picker (reverses "I don't see a use for it" of the same day):** "Keep the line picker. Make it a button
  with a modal that pops out and allows the user to navigate the tree choose current, any time in between, or
  extend the lines in either direction."
- **Knowledge / presence leaks and where the filter lives:** "I expect you to close all the leaks as part of the
  sprint. When querying on a characters history/knowledge, have it be a toggle that's on by default, that way a
  modder can disable it if they want to do somethign custom. Since it's an SDK built-in, I'm thinking it should
  be in the query markup, not in the helper tooling that core genres use."
  ⚠ Against it, same day earlier: "build what we want best practice into our SDK helper (all features are opt in
  on invoke)" and opt-in "pipeline/node". The later words rule: the toggle is on the query, default on.
- **"The model decides":** "Maybe instead of "Model Decides", we can make that option a built-in event.
  Pipelines get registered to that event in the config, and each one becomes a new option in the dropdown."
  (Replaces relaxing the SDK's swap-fit rule.)
- **The step-time-limit switch must be visible when on:** "Yes, notification/activity, admin dashboard, and in
  the session activity/turn order widget."

- **Timelines and writes (owner, 2026-11-16; settles D46):** "I think we should enforce true type safety for
  dates." Then: "Genres must respect timelines if they are writing to the lore book. Refuse the fucking write if
  dated entries don't get a date". Lead's reading: the lorebook's timeline is the authority, at the write. On a
  lorebook that keeps a timeline, a write of anything dated (a history entry, a dated change, a scene's stamp)
  that arrives without a date is **refused with a sentence**, never written undated; whatever genre wrote it.
  No session is locked to a lorebook; the "stance" design (requires / excludes / either) is dropped except for
  the SDK telling an author, before run time, that a step writes dated lore without a date wired.
  Same day, two more: "This is what we are enforcing type safety on timelines lorebooks" (the guarantee is scoped
  to lorebooks that keep a timeline) and "Sessions are locked to one lorebook for now" (a session's lorebook
  does not change, so whether it has a timeline is a fact of the session: the run can be told it, typed; the
  lane verifies the code really holds a session to one lorebook and names every path that could change it or
  flip the lorebook's timeline switch under a live session).
  And: "Once the session starts, the lorebook can't be swapped." (a rule to enforce, not only to check: any
  path that swaps a started session's lorebook is closed, with a sentence).

- **A story's first date (owner, 2026-11-16, later; settles D47 and supersedes the "Year 1, day 1" worry of
  2026-11-11 by removing that default altogether):** "If the genre/preset supports undated, use undated by
  default. With dating on, default to real calendar. For an existing lorebook, default to the most recently
  active point. There shouldn't be a scenario where it defaults to 1-1-1. The exception would be if the
  genre/presets session init pipeline changes the date." Lead's reading: (1) a new lorebook made for a session
  starts with no timeline wherever its genre / preset allows that; (2) a new lorebook that does keep a timeline
  starts on the real calendar at today's real date; (3) a session on an existing lorebook starts at that
  lorebook's most recently active point; (4) no code path may fall back to year 1, month 1, day 1; (5) a
  genre's or preset's create pipeline may set another date. So a lorebook that keeps a timeline always has a
  date, play's writes are always dated, and the refusal of an undated write is a backstop.

- **Rulings page, 2026-11-16 evening (owner's answers; full quotes in `DISCUSS-LATER.md` rows D6–D59):**
  - **Prompts (D58, D59):** the session's owner picks a prompt and may read its wording ("There should be a
    preview button for prompts"); a guest sees nothing; outside a session only an administrator. A call offers
    only the prompts made for its own pipeline, plus its default. "Regular users shouldn't be able to choose
    advanced settings, like context templates etc. Such settings shouldn't be able to be set as user surfaced
    (admin only). SDK should ignore context/variable template exposure to users on build, possibly with a
    warning." "Guests can only see the session detail view, and manage cast/cards they own." New: a session
    option, for sessions that allow multiplayer, by which the owner lets guests add / manage their own
    personas and characters, or not.
  - **Who was there (D57, D21):** "It's up to the sessions scene management/compiler to determine who gets
    listed in the scene. For core catelogue, we will go with: Spoke at least once, and further filtering by
    cast members position. For dated lorebooks, we should also store the time the scene started and ended so
    we have the full window." A benched seat is not ruled out "if they were active at least once during the
    window and location didn't rule them out." Lead's reading: *position* = the place a cast member is in (the
    location slot), not a posture stat (declined 2026-11-14); the scene's stored cast list is the one answer
    queries read, and core's compiler fills it by that rule.
  - **Lorebook file (D37):** "Back them out. We aren't ready to re-enable exports." Lines in a format-3 key:
    yes in principle, not built until export returns.
  - **Dates:** a new session on an undated timeline lorebook starts today, shown, with a branch / date picker
    (D52b); "We should have/create a universal, highly polished and beautiful component that we can reuse for
    tree/time navigation." A genre / session sets its own fictional time when none is chosen, or a starter
    lorebook's current point offers it (D52a). The calendar's leap rule gets "a logic builder where operators
    can be set/chained" (D52d). Import and the notes fallback follow the undated default (D53a); Story's
    description says "story time when the lorebook keeps it" (D53b); the switch's words stand (D54); history
    entries are left out of a prompt while the timeline is off (D55).
  - **Time in query results (D56):** "no one has shipped a plugin, and we can still freely edit our core
    catelogue. Consider if the query param should always be on by default and deliver it's values or null when
    available. We need the same behavior to match across querying anything that could carry timelines/time."
  - **Knowledge:** a hand tie always wins over play's (D39); one knowledge switch per pipeline, under Advanced
    (D36); a tie play writes off Full is offered in Apply (D41).
  - **Others:** deleting a lorebook a session uses is refused, naming the sessions (D50); Edit stays always
    free (D14); whoever a run blocks may stop it (D15); Auto-advance on / off everywhere and Story keeps
    *Next turn* / *Whole round* (D6); the Line picker reading is right (D7).

- **State of the work the rulings page added (lead, 2026-11-17; each has `plans/REPORT-<lane>-2026-11-1x.md`):**
  built and scope-reviewed, lane tests only until full run 14 (running 2026-11-17): `io-2` (member-sheet keys
  backed out), `lb-1` + fix (deleting a lorebook in use is refused), `kn-5` + fix (a hand tie wins; one
  knowledge switch per pipeline), `tl-4` (undated-default paths, Story's description, history out of prompts
  with the timeline off, Dungeon Crawler's day label), `tm-1` and `tm-2` + fix (story time in what a run reads;
  the cast's `storyTime` declared in the SDK; presences ignored and compiled scenes kept with the timeline
  off), `gs-1` + fix (who reads prompts), `gs-2a` + fix (an administrator inside someone else's session is a
  guest; the compiled prompt is the owner's), `gs-3a` + fix (two guest seat switches, the freeze, a guest's
  card-less cast list). **Full run 14 on 2026-11-17** (27,224 passed; only the four tests left failing on purpose; SDK suite, Svelte
  check and build clean); both repos staged for the owner's commit. **Built since, lane tests only:** `kn-6` +
  fixes (play's ties in Apply, D41), `sdk-g7` (template exposure ignored with a warning, G7), `gs-2b` + fix
  (Edit session for a guest is the participants list; a guest cannot reorder seats), `gs-2c` + fix (the notes
  closed to a guest; a guest still manages the card they brought; the scene list sends a guest no summary
  text; administrators no longer receive other people's summary drafts), `gs-2d` + fix (controls that open the
  notes are absent for a guest in the shared widgets). `ss-3b-1` + fix (one rule for which prompts a model call offers; the table; the panel's write refuses what
  is not offered), `wt-1b` + fix lanes (a character reads only the scenes it was in: param `speakerInCast` on
  every read that can return a history day, judged once in the host's lore read). `rt-1` (a routine's `when` is applied), `perf-1` + fix and `perf-2` + fix (statements per reply: Story 2076 → 1036, the Lair 4668 → 2500; programme 0.5 done). **Full run 15 on 2026-11-17** over all of it: 27,414 passed; only the four tests left failing on purpose (one comment reworded by the lead); SDK suite the four known; Svelte check and build clean; **both repos staged again**. **After run 15 (2026-11-17):** `rp-1`; `perf-3` + fix and `perf-4` + fix (statements per reply: Story 1036 → 806, the Lair 2500 → 1928; a two-member push 338 → 220; remaining: the cast memo cleared around every host call and commit, `host.ts` 851–856, ~53 / ~102 per reply); `cpl-A` + fix (3.6 one definition of `STANDARD_GENRE_ID`; 3.8 summary registrations found by `summaryRegistrationOf` with a stated pick rule); UI walk of the built app with no model (`REPORT-walk-2026-11-17.md`) and its fixes `walk-fix-A`–`D` (phone switch scroll, guest toast and lorebook opener, stale prompt card, tab strip, one-press accounts turn-on through the new `sockets/runHandler.ts` so the admin logbook records it). `cpl-B1` HELD (a no-op until ★3.1-A; folds into `cpl-B2`). **Full run 16 on 2026-11-17:** 27,305 passed in `src` plus 395 in `scripts` and the egress check; only the three files left failing on purpose; Svelte check 0 errors; build clean; app repo staged again (SDK unchanged). New owner questions on the page: SM1–SM3, S3, S4. Open from the walk: entry inspector wording, `derived_inert` warnings in the delete refusal dialog, seeded admin created date, admin seeded at id 1, `AccountsCard.svelte` toasts from a view. **To build:** `gs-3a2` (the
  owner seats for a guest: waits on S1, S2 / D65), `gs-3b` (shared cards: waits on C1 / D68), `ss-3b-2`
  (prompt rows on every call: waits on the owner seeing the table and P1 / D69), `wt-1a` (who a scene lists:
  waits on B1, B2 / D70), the tree / time navigation component and the leap-rule builder (D52b, D52d: to
  propose), turn controls (D6; 2.3), the Line picker (D7; 2.5), routine groups (2.6), distances (1.6), cast
  Memory (1.5), idle-running (2.8), small repairs (2.9), phases 3 and 4. **Open with the owner (rulings
  page):** S1, S2 (D65), D64, W1 (D66), A1 (D67), C1 (D68), P1 (D69), B1, B2 (D70).

- **Rulings page, second round, 2026-11-16 (owner; full quotes in `DISCUSS-LATER.md` D60–D63):**
  - **Guests:** a guest sees the session page plus the full participants list read-only (G1); neither opens nor
    edits the session's notes (G2); Prompt details is for the session's owner and administrators only (G5); in
    another person's session an administrator is a guest (G6).
  - **Seats (G3, G4):** "Owners can also assign cast/cards they own to the guests. Guests can bring their own
    if enabled. Guests can grab the sessions/lorebooks cast members if also enabled. So two settings, both on
    by default. The genre still has to opt in to characters/personas since we still have to support the user
    as a speaker and envoys etc. Guests can't choose directly from the owners card list, but can choose from
    shared cards from other users, shared cards are copied into the lorebook unlinked." Off freezes guests'
    seats as they are.
  - **SDK (G7):** a spec that exposes a context / variable template to users: "ignored, with a warning"
    (softens today's error).
  - **Time:** no switch; time is always delivered, null when the lorebook keeps no timeline (T1); while the
    timeline is off, dated presences are ignored: everyone listed is present (T2); earlier scenes also include
    compiled scenes while the timeline is off (D60).
  - **Knowledge:** standing in a place wins over a hand *Kept from* (K1): as built.

- **Undated by default includes Story (owner, 2026-11-16; settles D48):** asked whether "If the genre/preset
  supports undated, use undated by default" includes Story: "Yes, story as well". So a new session's own
  lorebook starts **without** a timeline for every genre that does not require one (Story, Chat, Guide); a
  preset may still say `timeline: true`; the Lair and Dungeon Crawler require one. Existing sessions and
  lorebooks keep their switch. Lane `tl-3`, after `tl-2b`.

- **Dates, three more (owner, 2026-11-16; settles D49):** to the three questions (existing campaigns with no
  date; is "default to real calendar" the real calendar at today's real date, and how to fix the leap rule;
  Story: Minimal on a timeline lorebook): "1. Go with the safest option for existing lorebooks 2. Yes 3. User
  gets a choice, undated by default without an existing lorebook." Lead's reading: (1) existing sessions and
  lorebooks with no date are left exactly as they are; nothing dates them; for them only a history entry is
  refused, as today. (2) A new dated lorebook starts on the real calendar at today's real date (the owner's time
  zone); the leap-rule defect is fixed by **adding** a correct real calendar for new dated lorebooks, not by
  changing the built-in one in place (the safest option for existing lorebooks). (3) Starting a session with no
  existing lorebook, the person chooses story time on or off on the start form, off by default; on an existing
  lorebook that lorebook's own switch stands, and on a lorebook that keeps a timeline every genre and preset,
  Story: Minimal included, dates what it writes.

## How this file is kept (owner, 2026-11-15: "I want everything moving, and I don't want to hear "done" just for the rest of the sprint to get left behind and forgotten.")

- Every lane below has a **State**. The lead updates it when a lane is briefed, building, built, verified.
- A report to the owner says what is finished **and what is still open in this file**, every time. "Done" is said
  of the programme only when every row is verified or moved to `plans/DISCUSS-LATER.md` with the owner's word.
- Items that need the owner live in `plans/DISCUSS-LATER.md`; nothing waits silently anywhere else.

## Phase 0 — foundations first (owner, 2026-11-15: "perhaps you should first prioritize optimizing those files and the verification suite")

Done before Phase 0: `time-t6f` and `time-t7d` (+ fix lane) verified 2026-11-16 (full run 9: standing 21
failures only after four pinned expectations were updated; build, tsc, check clean).

| # | Lane | State |
|---|---|---|
| 0.1 | **Verification suite speed.** | **verified 2026-11-16** (`REPORT-fnd-1-2026-11-16.md`): full run 82.4 → 62.9 min (run 10, standing 21 failures only); `tsc` warm 8 s; `npm run check` 48 s. Follow-ups still open: 0.1b bootstrapped template (~7 min more; needs an option name ★), 0.1c one full run at 4 workers with the memory sampler, 0.1d `scripts/*.ts` and `vitest.config.ts` are in neither type-check pass |
| 0.2 | **Split the files every lane collides in**: `pipelines/runtime/bindings.ts` (>9k lines), `pipelines/runtime/host.ts` (>13k), `sockets/sessions.ts` (>11k), `sockets/narrativeGraph.ts` (>6k), `EditSessionForm.svelte` (~3.7k). Mechanical moves by area behind unchanged exports; no behaviour change; one file at a time, each verified; announced to the peer session before each. | mapped (`INVENTORY-file-splits-2026-11-15.md`): `bindings.ts` first (7 steps, 10.4k → ~1.4k lines), then `host.ts`, `sessions.ts`, `narrativeGraph.ts`, `EditSessionForm.svelte`; `bindings.ts` **split, built 2026-11-16** (`REPORT-fnd-2a-2026-11-16.md`): 10,363 → 2,009 lines + 7 files; pipelines and conformance tests show only standing failures; **verified 2026-11-16** (full run 11: standing failures only; build, tsc, check clean). `host.ts` **split, built 2026-11-16** (`REPORT-fnd-2b-2026-11-16.md`): 13,150 → 7,466 lines + 8 files, steps 1–5; step 6 (lore commits, ~1,500 lines) not done, it needs a getter for `turnMessageId`; scope review no objection; **verified 2026-11-16** (full run 12, 62 min: standing failures plus two pinned tests broken by `ss-7-fix`, fixed by the lead: a reply run is no longer announced as *working* at its start). `sessions.ts` **split, built 2026-11-16** (`REPORT-fnd-2c-2026-11-16.md`): 12,643 → 2,059 lines + 9 files, all 8 steps; lane tests green; confirmed by the Phase 0 full run. **From here a full run happens once per phase, not per lane (owner, 2026-11-16: "Can't you just build everything, then run verification last?"); each lane runs its own tests and `tsc`.** `narrativeGraph.ts` **split, built 2026-11-16** (`REPORT-fnd-2d-2026-11-16.md`): 6,194 → 453 lines + 5 files. `EditSessionForm.svelte` **split, built 2026-11-16** (`REPORT-fnd-2e-2026-11-16.md`): 4,167 → 3,168 lines + 9 files, rendered HTML identical in 81 states. **All five files split.** Still to do: the `host.ts` lore-commit step (~1,500 lines; needs a getter for `turnMessageId`). |
| 0.3 | **Standing test failures**: the 21 app files / 26 tests and the SDK's 4. Each is fixed, or deleted with the reason written down; the suite ends green so a run reads clean at a glance. | triaged 2026-11-16 (`INVENTORY-standing-failures-2026-11-16.md`: 22 stale expectations or environment, 1 comment ratchet, 1 unsure, 2 real defects that need the owner: D19, D20); **built 2026-11-16** (`REPORT-fnd-3-2026-11-16.md`): 18 of 19 files fixed, tests and comments only; left failing on purpose: `paramsSlotWiring` (D19), `panel/groups` (D20), `guideGrounding` (D22); scope review running; confirmed by the Phase 0 full run |
| 0.4 | **Walk what was built** in an isolated running instance (knowledge filter in Story and the Lair, dates in prompts, migrations 0166–0167, entry defaults, earlier walks owed) and one **upgrade of a copy of real data** by the recorded recipe. Findings become fixes or rows here. | to do after 0.1 |
| 0.5 | **Statements per reply** (Story ~2,040, the Lair ~4,580 per run, measured 2026-11-15): profile one reply, cut repeated reads. | to brief |
| 0.6 | **Import / export round trip**: a test that exports a lorebook with lines, dated links, knowledge ties and marks, imports it, and compares everything; fix what is lost (links' dates and lines today). | **built 2026-11-16** (`REPORT-io-1-2026-11-16.md`): every lorebook column classified and guarded (25 tables, 350 columns); round-trip, duplicate, overwrite and old-file tests; member sheets and aliases now survive a file; lines are **not** carried: ⚠ ruling conflict D37; other gaps D38 |
| 0.7 | **Docs against behaviour**: each `docs/*.md` page checked against its feature; false statements fixed (two found on 2026-11-15: locked settings, Tone "Before you start"). | **done 2026-11-16** (`REPORT-doc-1-2026-11-16.md`): all 47 pages, ~2,700 statements, ~80 sentences fixed; one code defect fixed by the lead (deep link to the step-time-limits card); D32–D34 for the owner. Follow-up 0.7b: the pages' in-flight lines after `ss-2a` and `io-1` land; ten cannot-tell items; a wrong comment in `genres.ts` ~1555; NOMENCLATURE's **Make a lorebook from it** label; three stale code comments |
| 0.8 | **Audit of the areas not touched on 2026-11-15** (connections and models, speech, image generation, the admin shell, plugins): read-only; findings land here or in DISCUSS-LATER. | audited 2026-11-16 (`REPORT-audit-untouched-areas-2026-11-16.md`): 7 findings; five fixed by lane `aud-1` (**built 2026-11-16**, `REPORT-aud-1-2026-11-16.md`, lane tests green; scope review running; confirmed by the Phase 0 full run); D25, D26 for the owner. 0.8b **built 2026-11-16** (`REPORT-clip-1-2026-11-16.md`): `copyText`, 14 copy sites, a guard test; `JobSheetSampling.svelte` deleted |
| 0.9 | **Bug (owner, 2026-11-16): after editing an earlier line, a swipe's reply still quotes the pre-edit text.** Cause: a routine still running when the reply is swiped lands its writes afterwards (`sockets/sessions.editedLineRerun.int.test.ts`, race case `it.fails`). **Ruled 2026-11-16:** "Shouldn't need to automatically stop/backtrack the routines etc if the activity is properly surfaced in the activity/turn bar"; then: "no, the button would still be disabled. But have the user manually stop what ever is running first". So: nothing is cancelled or taken back automatically; **while any run is in progress in the session, the actions that re-run or remove a reply are disabled** (lead's reading: swipe, regenerate, retake, Back, delete; the server refuses them too, as its busy door already does while a person's line is being answered, `sockets/sessions.ts` ~3163–3237), with words naming what is running; the person stops it on the Turn line (lane 2.7) or waits. ★ whether **Edit** is disabled too (lead: yes for the reply a run is reading and the lines before it, since an edit during a run is how the old words got filed). Built with lane 2.7, pulled forward to right after the `bindings.ts` split; the test's race case then asserts the refusal. | ruled; built with lane 2.7 |

## Phase 1 — finish the lorebook and knowledge sprint (`PLAN-entry-time-and-lines-2026-11-14.md` §11)

| # | Lane | State |
|---|---|---|
| 1.1 | `time-t7d` structured `date` / `dateDelta`, layouts per parent, calendar readable (and `time-t6f`: Story and the Lair place the knowledge filter, the warning, stored cast) | **verified 2026-11-16** |
| 1.2 | **Filters live in the queries.** Every SDK read that returns lore, links, places or history for a run that speaks as one cast member takes a toggle, on by default, for (a) what the character knows and (b) what it was there for; a modder switches it off per query. This closes every leak at the source: lore lanes, entity and vector search, the scene's place listing and ways, link-borne names (the link hop, `withLinks`), the triggers scan and recursion. `core:query/unknown-entries@1`, the `firsthandFor` / `firsthandBy` ports and the exclusions wiring in Story and the Lair are replaced. Cold review must settle: how a query learns the run's speaker; the presence rule that is safe as a default (lead: a scene's stored cast **or** spoke in it, so a silent listener keeps the scene); narrator and multi-voice steps read everything. | facts gathered (`INVENTORY-query-filters-2026-11-16.md`); cold review 2026-11-16 cut it in two: **`kn-2a` built 2026-11-16** (`REPORT-kn-2a-2026-11-16.md`): `knownToSpeaker`, default on, on every lore / link / place read; standing-place exception; knowledge leaks closed; `unknown-entries@1` removed; prompts byte-identical for unchanged data; lane tests green; scope review done and its fix lane `kn-2a-fix` **built 2026-11-16** (the off switch's working spelling documented and tested, core tools filtered, +3 statements explained); confirmed by the Phase 1 full run; D27, D28, D30, D31 for the owner; follow-up: a card-less seat's tool calls still read everything; **`kn-2b`** presence toggle, waits on D21 (benched seats are not in a scene's stored cast) |
| 1.3 | Attended-scene summaries as a core read (a character who missed part of a day); the shipped behaviour uses it | facts gathered 2026-11-16 (`INVENTORY-attended-scene-summaries-2026-11-16.md`): ruled 2026-11-14, not built; an unwired earlier attempt exists (*firsthand*: spoke in the scene; drops a whole day for one missed scene); **waits on the owner: what counts as attended** (D21 and D57) before a brief |
| 1.4 | Knowledge screens: **Known by** on the entry, **Knows** on the cast member (buttons + drag), bulk mark; hand kinds **Knows** / **Kept from**; SDK write API with recipes, placed by no shipped pipeline | facts gathered (`INVENTORY-knowledge-screens-2026-11-16.md`: the data layer exists, no socket, no screen, no SDK write); briefed in two halves, both in cold review 2026-11-16: `kn-4a` the screens, cut by cold review into **`kn-4a1` built 2026-11-16** (`REPORT-kn-4a1-2026-11-16.md`: the door, the **Not common knowledge** toggle, **Known by**, bulk mark; 374 lane tests green; scope review running; D39, D40, D45 for the owner) and **`kn-4a2` built 2026-11-16** (`REPORT-kn-4a2-2026-11-16.md`: the **Knows** tab, a two-zone pool with drag and a button for every drag; the three fixes; lane tests green), `kn-4b` the SDK write + recipes **built 2026-11-16** (`REPORT-kn-4b-2026-11-16.md`): outlet `note-entry-knowledge@1`, refuses over a hand tie, session-only when not on Full, taken back with its reply, three checked recipes; lane tests green, SDK suite standing failures only; scope review running; D41, D43 for the owner |
| 1.5 | Cast Memory (advanced fold) | to brief |
| 1.6 | Distances (*has been there* at scene close; step-count walk; two measurements as queries) | to brief |
| 1.7 | Timeline stance typed in the SDK (requires / excludes / either; values and writes typed to match; `validate()` refuses a mismatch) | facts gathered (`INVENTORY-timeline-stance-2026-11-16.md`); **re-scoped by the owner 2026-11-16** (see Latest rulings: refuse an undated write of dated lore on a lorebook with a timeline); facts gathered (`INVENTORY-undated-lore-writes-2026-11-16.md`); briefed (`briefs/BRIEF-tl-2.md`) and cut by cold review: **`tl-2a` built 2026-11-16** (`REPORT-tl-2a-2026-11-16.md`): nothing bypasses the lorebook lock (a guard test holds it; the two ruled moves allow-listed); `SessionSettingsV1.timeline` tells a run whether its session keeps a timeline; the timeline switch reported; found: deleting a lorebook in use clears sessions' lorebook (D50), `current-date` can appear with the timeline off (for `tl-2c`); D47 ruled 2026-11-16 ("A story's first date"); **`tl-2b` built 2026-11-16** (`REPORT-tl-2b-2026-11-16.md`: the most recently active point `storyStartOf`; Year 1 removed from history writes and scene filing, a guard test; it stopped on the calendar: the built-in one prints today's weekday wrong); **`tl-2d` built 2026-11-16** (`REPORT-tl-2d-2026-11-16.md`; lane tests and both prompt baselines green, no full run; scope reviewed, small fixes applied; its open points are D52); **`tl-3a` built 2026-11-16** (`REPORT-tl-3a-2026-11-16.md`: a new session's own lorebook keeps no timeline unless its genre requires one or its preset says so, Story included; existing data and the boot pass untouched; scope reviewed, a weak test and three doc sentences fixed by the lead; D53); **`tl-3b` built 2026-11-16** (`REPORT-tl-3b-2026-11-16.md`: the start form's **Keep a timeline** switch for a session with no chosen lorebook, create parameter `notesTimeline`, the date line; scope reviewed, five fixes built by `tl-3b-fix`; D54); lane tests only, no full run; **`tl-2c` built 2026-11-16** (`REPORT-tl-2c-2026-11-16.md`: one typed answer `loreWriteDateOf` (dated / timeless / undatable) for every pipeline lore write; items, entry updates, held changes and cast versions carry the story's day; a backstop refusal for rows that store a date; undatable lorebooks unchanged; scope reviewed, six fixes built); `tl-2d-fix` built (Time passes… on a story with no date is refused in words; the year-less history sentence restored); **`tl-2e` built 2026-11-16** (`REPORT-tl-2e-2026-11-16.md`: no story date in a prompt without a timeline; scope reviewed; `tl-2e-fix` building: no key on the published cast query, no extra statement, summary transcripts); D55; **full run 13 on 2026-11-16** (26,982 passed, 27 failed in 17 files; SDK suite and `npm run build` clean); lane `fnd-4` fixed or re-pinned every new failure but the Dungeon Crawler's day count (`REPORT-fnd-4-2026-11-16.md`: two real defects fixed); `io-2` built (member-sheet keys backed out of the lorebook file, D37a); building: `tl-4`, `lb-1` (refuse deleting a lorebook in use, D50), `kn-5` (a hand tie always wins, D39; one knowledge switch per pipeline, D36); to brief: `kn-6` (play's ties in Apply, D41: moves the row like a link, Back stops at Apply), prompts and guests (D58, D59), who was there (D57, D21), time in query results (D56), the tree / time navigation component and the leap-rule builder (D52b, D52d), turn controls (D6), Line picker (D7); D60 for the owner; `tl-4` briefed (import and notes fallback follow the undated default, Story's description, history out of prompts with the timeline off, Dungeon Crawler's day 1, the next-chapter re-pin) (no date in a prompt with the timeline off) (`briefs/BRIEF-tl-2d.md`: the real leap rule and a real calendar for new dated lorebooks; a new dated session starts today; the start form shows the date; the last Year 1 defaults; import / export of undated history); D51 for the owner; **`tl-3`** (undated by default, Story included; the start form's choice) briefed, after `tl-2b`; **`tl-2c`** (play's writes dated; the backstop refusal; no date in a prompt with the timeline off) unblocked 2026-11-16 (D48, D49 ruled), to brief after `tl-2b` reports; the first brief (`briefs/BRIEF-tl-1.md`) is superseded; earlier: cold review 2026-11-16 not launched (D46): whose stance (genre or preset), and whether any stance may promise a non-null date given "genres expect, never lock"; the review's five corrections are recorded in the brief |
| 1.8 | Admin debug switch: step time limits off, shown while on in notifications / activity, the admin dashboard and the session's Turn line | **built 2026-11-16** (`REPORT-dbg-1-2026-11-16.md`): migration 0168, SDK run option, Diagnostics card, Needs you item, standing notice, admin-only Turn line marker; lane tests green, SDK suite four known failures; scope review running; D24, D29 for the owner |

## Phase 2 — session settings (`PLAN-session-settings-cleanup-2026-11-15.md`)

| # | Lane | State |
|---|---|---|
| 2.1 | `ss-2` one store and one writer for session values | cold review 2026-11-16 cut it in two: **`ss-2a` built 2026-11-16** (`REPORT-ss-2a-2026-11-16.md`): `registrations.values` is the one store; the panel resolves in the run's order; boot pass `sessionOverrideFold`; lane tests green; scope review done and fix lane `ss-2a-fix` **built 2026-11-16** (one shared rule for what the run reads, called by the run, the panel, the fold and the attic; the fold never changes another address); D35, D42 for the owner; **`ss-2b` built 2026-11-16** (`REPORT-ss-2b-2026-11-16.md`): `writeGenreFields` / `writeRigour`, every writer routed, the preset switch atomic, a guard test; scope review running. The summaries half is dropped: already settled by the 2026-11-12/13 rulings |
| 2.2 | Prompt row per model call for every session owner (on by default) + two views (normal / in order of operation, one switch for the tab) | facts gathered 2026-11-16 (`INVENTORY-prompt-rows-2026-11-16.md`); briefed (`briefs/BRIEF-ss-3a.md`) and **held by cold review, not launched**: any member can read every prompt's name and wording today, a ratified rule that conflicts with later rulings (D58); prompt pools are per step type, so a row on every call would offer prose prompts to JSON routines (D59); the row count is double digits per genre. Waits on the owner (D58, D59) |
| 2.3 | Turn controls. **Turn order options are pipelines registered on one built-in core event** (🚧 "decide who speaks next"); each registration a genre or preset makes is one entry of the **Turn order** select, exactly one active per session; round robin, by user, random, narrator replies, a model-backed one and a genre's scripted one are all such pipelines; nothing implied; scripts per genre. **Auto-advance** on / off (★ still open: keep *Next turn* / *Whole round* as Story's own option). Charter (S10). Core's silent default goes. Importers map *manual* to Auto-advance off. | to brief |
| 2.4 | Locks shown read-only with their cause (reverses R32); locks honoured at run time | **built 2026-11-16** (`REPORT-ss-5-2026-11-16.md`): shown read-only in words with its cause on the Settings tab, Read aloud block and narrator cadence; one rule `settingLocksOf` makes a lock hold in the run, the panel and the form; scope review done and fix lane `ss-5-fix` **built 2026-11-16** (routines and background sampling honour a lock; a `null` lock shows what lies below); confirmed by the Phase 2 full run; D44 for the owner |
| 2.5 | Line picker as a button + modal over the lorebook's tree: pick a line's present, any time in between, or extend a line in either direction (to define with the owner: what "extend" creates) ; replaces the Line and Story clock rows | to brief |
| 2.6 | Routine groups: the group owns trigger, stacking, caps, sequential / async; routines keep order, mode, own settings; boot pass | to brief |
| 2.7 | Turn line lists background runs with Stop; Continue stays when Send is hidden; Composer setting *Show the Send button* (no effect on phones); swipe, regenerate, retake, Back, delete refused while a counted run is in flight (programme 0.9); Edit left free (D14); whoever a run blocks may stop it (D15) | **built 2026-11-16** (`REPORT-ss-7-2026-11-16.md`); verified as built by full run 11 (2026-11-16); scope review found six items, fix lane `ss-7-fix` **built 2026-11-16** (six fixes, lane tests green); full run owed (with the `host.ts` split). Not built: event pipelines as runs (D16). Follow-ups: a status cleared mid-run drops from the page's list; lineage child runs hold re-runs with no status; a layout with no Turn line has no Stop for a routine |
| 2.8 | *Keep running while nobody is playing* (shown only when a group can fire unattended; bounded by the system limit) | to brief |
| 2.9 | Small repairs: How strict narrowing on the server, On revision's description, docs drift, dead settings (per-item ★), save-at-once | to brief |

## Phase 3 — core stops special-casing genres (to be written as its own plan from the couplings inventory)

3.1 Scenes, summaries, earlier scenes, close-out and settle follow the channels a genre declares as story, not
`main`. 3.2 One definition of a round, stated by the genre's turn-order pipeline. 3.3 Genre settings core acts on
by name become steps the genre places (prompt- and turn-shaping ones) or declared genre properties (permission
gates). 3.4 Core listeners (vectorization, read aloud, scene hook, form re-check, goals) become registrations a
genre or preset can drop. 3.5 Genre-specific names leave core (`story-goals`, the `table` slug, lane membership
by annex shape). 3.6 One fallback genre. 3.7 Remove the three unused opt-in flags. 3.8 Close out and summarize
found by registration, not fixed keys.

## Phase 4 — Story: Living world (experimental) (`PLAN-living-world-preset-2026-11-15.md` §9)

Moments carry channel and lane; the genre proposes a scene's cast; the per-character place value and turn pool by
focus; Messages views with **Cut to…** / **Bring here…**; the preset with the reckoning field; lore from a side
scene.

## Costs the owner has been told (2026-11-15) and how they are handled

- Modders must declare a turn order: handled by 2.3 (registering one shipped pipeline is one line) plus a
  copy-and-paste starter in the guide.
- Breaking SDK shapes land together before 0.7 (dates, routine groups, turn-order registration, prompt flag,
  query toggles): one upgrade note per lane; the recipes test runs every guide example.

## Rulings page, third round, first answers (owner, 2026-11-17)

Owner's words, then the lead's reading where the answer picked no option.

- **S1** (owner seats for a guest): "Let's reshape the persona seats (UI). One persona seat group per user. The owner can seat anyone they want to whoever they want as long as it's something they can see. The guest can seat to themselves when allowed, with cards they are allowed." *Reading:* the participants area shows one group of persona (player) seats per person in the session; the owner may put any card or cast member they can see into any person's group; a guest adds to their own group only, under the two guest switches. AI-played seats are their own group and belong to no guest.
- **S2**: "No: the owner re-assigns only seats holding their own cards or card-less cast members" + "Guest cast members can still be moved to the ai playable seats by the owner freely, even personas". *Reading:* a guest's card is never handed to another person; the owner may move any guest's seat, a persona included, to the AI-played group.
- **C1**: a shared card's copy lands in **the session's notes**.
- **A1**: "Can't apply to a lorebook owned by someone else. On apply would require cloning the lorebook to the session owner first. Sharing is for viewing only, not editing. We can add more granular permissions later to allow co-editing/playing, but not in this sprint, just don't block the future permission structure from being able to be implemented in core." *Reading:* Apply never writes into a lorebook the session's owner does not own; there, Apply offers to copy the lorebook to the session's owner first and applies into the copy. The check stays one function so a later permission can widen it.
- **D64**: "Administrators also get Prompt details inside a session they are a guest of" + "Actually we shouldn't allow non admins to see the full diags anyway, could be considered semi sensitive." The first half is built now. The second half reverses G5 (2026-11-16, "The session's owner and administrators only") for owners: asked on the page as **DG1** (and **DG2**, the token count), not built.
- **S3**: say nothing beside a seat no person plays.
- **S4**: "Make it a session permission when guests are invited, exist in the session. Hide otherwise like the rest." *Reading:* taking a seated card-less member that no person plays is allowed under the session's **take cast members** switch; the guest switches show only when the session has guests (invited or present), and are absent otherwise.

Lanes: `gs-3a2` (S1, S2, S3, S4), then `gs-3b` (C1; same form), `ap-1` (A1), `gs-4` (D64 first half).

- **DG1 (owner, 2026-11-17, in conversation):** "Correct on d64. I was not considering the users permission level. Regular users see the error and a basic generic user friendly description of the problem and a suggestion to notify admin." Reverses G5 (2026-11-16, "The session's owner and administrators only") for owners: **Prompt details is administrators' only** (Inspect run already was: R55, 2026-09-23; the lead's earlier wording that owners had it was wrong); a person who is not an administrator, the session's owner included, sees that something failed, a plain description, and a suggestion to tell an administrator. Lanes `dg-1a` (the gates) and `dg-1b` (failure wording: audit first; a plain sentence plus "An administrator can see the details." already exists in `utils/generationStatus.ts`). DG2 (the token count) is still open on the page.

## Rulings page, third round, second answers (owner, 2026-11-17)

Owner's words, then the lead's reading where no option was picked.

- **PS1** (the owner gives a guest a persona that has a card): picked "copy into the notes", then the note, which rules: "If the card owner is the session owner, seat the card as a cast member, keep the card connected. There's no reason to make it cardless just because a guest is using it. You're over thinking it." *Reading:* the session owner's own card is seated **linked** for the guest; whoever holds the seat speaks as it. Only a card that belongs to someone else (shared) is copied card-less into the notes (C1).
- **HM1** (the sheet of the owner's character a guest plays): "Session owner via their own card or cast in the lorebook. Granular permissions later to allow co-editin". *Reading:* only the card's owner (the session's owner) changes that character's sheet; the guest takes its turns. The check stays one place so a later permission can widen it.
- **MV1**: "Move the old seat's lines to the new seat, then remove the old seat."
- **AP1**: "The plugins and core catalogues starter lorebooks are not owned by users, but by the source. Admins have limited management and can't mutate or delete them, only disable them or remove the plugin. To mutate, the admin/user clones it first". *Reading:* nobody writes a provided lorebook, the enabling administrator included: no Apply, no entry edits, no delete; only disable, or remove the plugin.
- **AP2**: "Let's just clone the starter lorebook instead on session start so we are never superimposing on something that can get deleted." *Reading:* a new session never plays directly on a provided lorebook; it is copied at start like any other starter. This replaces playing on a live provided lorebook pub-wide (★M3-1's later reading). Existing sessions: asked (AP3), not rewritten.
- **DG3**: old failed replies keep showing what they showed. "For the future, never publish raw errors directly to the message body". *Reading:* a rule for every writer of a message row's error text: no receipt-derived or thrown reason goes into the body; the body carries a sentence written for people, the reason goes where administrators read it.
- **DG2**: the token count is administrators' only, like the rest.
- **B1**: active means spoke at least once in the scene.
- **B2**: "Keep latest version, track change history". *Reading:* a scene's cast lists speakers only; no "edited by hand" lock: the latest write stands, and each change to a scene's cast is recorded in change history so an overwritten hand edit can be seen and brought back.

Lanes: `gs-3a3` (PS1, HM1, MV1; after `gs-3b`), `ap-2` (AP1, AP2), `dg-2` (DG2, DG3; after `dg-1-fix`), `wt-1a` (B1, B2).

- **B2, confirmed (owner, 2026-11-17, in conversation):** "B2, no, hand edits aren't treated differently. Just keep a change history so a user can overwrite. Optionally we can probably add a manual lock to all entry types so pipelines can't make edits to individual locked entries". So: no hand-edit marker; the latest write of a scene's cast stands; change history lets a person bring an earlier version back. **The manual lock** (any entry of any entry type can be locked by a person; a pipeline's write to a locked entry is refused) is the owner's idea, said as optional: asked on the rulings page (EL1) before anything is built (a new stored field and a migration).
  Added by the owner the same day: "We can probably add a cast member lock as well to prevent pipeline edits to cast members, I.e. a pipeline that adjusts cast member details over time". EL1 on the page now covers entries of every entry type **and cast members**.

## State after full run 17 (2026-11-17, evening)

Built, reviewed, fixed and staged in the app repo (SDK unchanged; nothing committed): `gs-4` + `dg-1a` (Prompt details: an administrator in the session only), `dg-1b` / `dg-1c` / `dg-1-fix` / `dg-2` (failure wording: a non-administrator never reads a model call's raw reason; no raw reason in a message row's body; the token count is administrators' only), `ap-1` + fix and `ap-2a` + fix (Apply never writes another person's lorebook; a live provided lorebook is read-only to everyone; `canWriteLorebook`), `gs-3a2` + fix (seats grouped by person, **Played by**, a guest takes a card-less member), `gs-3b` + fix (a guest plays a shared card as a card-less copy in the notes), `gs-3a3a` + fix (the owner seats their own card, linked, for a guest; only the card's owner changes its sheet), `wt-1a` + fix (a scene's cast lists who spoke, by the line's stored speaker; refresh 5 statements for a listed speaker). **Full run 17:** 27,663 passed; 16 new failures triaged by `fnd-6` (`REPORT-fnd-6-2026-11-17.md`: one real defect, a frozen-column read in `sessions/guestSeats.ts`; the rest stale fixtures or mocks under HM1 / DG3); re-run of the affected groups 870/870; only the three files left failing on purpose remain; Svelte check 0 errors; build clean; prompt fingerprints identical to `perf-3-shas-final.txt`; statements per reply Story 806, the Lair 1928.

**Not built, waiting on the owner (rulings page):** `gs-3a3b` the cross-kind seat move (MV2), the card-less sheet rule (HM2), `ap-2b` start on a copy of a provided lorebook (AP3 for existing sessions; AP4 plugin updates), change history for a scene's cast (SC1), narrator-written speech (SC2), the unused cast model call (SC3), the entry and cast-member lock (EL1), DG4–DG6, plus the earlier groups (prompts, turn controls, routine groups, navigation, cast Memory, phase 3).
**Open defects / follow-ups, no owner answer needed:** non-model halts still show step wording to a non-administrator on the card and toast; `pipelines:previewRetrieval` is gated on the session's owner, not administrators (decide whether it is diagnostics); copying the same shared card twice makes two members; the review proposal can show one person twice (side-character and card lines).

## Rulings page, third round, third answers (owner, 2026-11-17 evening)

- **HM2:** "A seat the guest made is theirs; a cast member they took or were handed stays the owner's". (A guest's named seat and their shared-card copy: the guest changes the sheet. A card-less cast member of the lorebook a guest took or was handed: the session's owner.)
- **MV2:** "Earlier lines move to the new seat and keep their kind". With MV1: the cross-kind seat move is go (`gs-3a3b`).
- **AP3:** "Leave them as they are and offer the merge, also when the lorebook was switched off".
- **AP4:** "A provided lorebook always takes its source's updates".
- **DG4:** keep the steps on the progress card for everyone. **DG5:** tell the sender in plain words that attachments can't be sent here. **DG6:** regular users get the embedding mark's state only, worked out on the server.
- **SC1:** go: a scene is a subject of change history, with a cause for the compiler's writes (a migration). **SC2:** a cast member with a speech tag in the narrator's lines counts as having spoken. **SC3:** switch the cast-reading step off for scene summaries and remove the code that read it (an SDK core-catalogue change).
- **EL1:** "Build it now, as described": a manual lock on any entry of any entry type and on a cast member; while locked no pipeline write changes it (refused, the run record says so); a person still edits it by hand (a migration).
- **W1:** hide story dates on old lines while the timeline is off.
- **PR:** build the prompt rows as the table shows.
- **P1** (no option picked): "What do you mean by unmarked? That a prompt has no node it belongs to? Prompts should always be listed under a specific. Offer all for that node/pipeline to any user that owns a session. Only show disabled/hidden prompts to admins for use." *Reading:* every prompt is listed under one specific pipeline step; a session's owner is offered every enabled prompt of that step; disabled or hidden prompts are shown to administrators only. A prompt that records no pipeline belongs nowhere, so it is offered to no session until an administrator gives it one; administrators see such prompts (with the hidden ones) so they can place them.

Lanes: `ss-3b-2` (PR, P1), `w1` + `dg-6` (W1, DG6), `gs-3a4` (HM2), `gs-3a3b` (MV1, MV2), `ap-2b` (AP2, AP3, AP4), `el-1` (EL1; migration), `sc-1` (SC1; migration, after `el-1`), `sc-2` (SC2, SC3), `dg-5` (DG5). New on the page: HW1 (seven failure sentences that name plumbing).

## State after full run 18 (2026-11-18, early)

Built, reviewed, fixed and staged in both repos (nothing committed) since run 17: `dg-1d-0/1/2` + fixes (a halt outside a model call: a sentence marked for people reaches everyone, everything else is plain for a non-administrator; the failed row, the routine log, save / delete refusals, card actions; DG5 the attachments sentence), `dg-2` and `small-1/2` (token count, embedding mark's state, story dates hidden with the timeline off, model plumbing out of the settings payload; **the recovery key's hash no longer sent to clients**), `ss-3b-2` + fix (prompt rows; P1), `ap-2b` (a session starts on a copy of a provided lorebook; the merge always works), `el-1a` / `el-1b` (entry, scene and cast member locks; migration `0169`; HM2 through `lorebook_bindings.created_by`), `gs-3a3b-1/2` + fix (a seat moves between a person and the AI, both ways, with **Played by**), `sc-2a` (speech tags), `sc-1` + fix (a scene's cast in Edit history; migration `0170`), `sc-3` (dead cast-reading code removed; the model step was already off), `walk2-fix-A/B`. **Full run 18:** 27,992 passed; four new failures (sender-fixable attachment refusals had turned plain) fixed by `fnd-7`; affected groups re-run green; only the three files left failing on purpose remain; Svelte check 0 errors; build clean; prompt fingerprints unchanged (Story 806, the Lair 1928 statements per reply).

**Not built, waiting on the owner (rulings page):** plugin updates overwriting earlier edits (AP5), a shared copy's source (SH1), speak-as by seat (SP1), prompts with no pipeline (PR2, PR3), failure sentences that name plumbing (HW1; add "vision switched off" and the attachment reasons that name a connection), and the earlier groups (turn controls, routine groups, navigation, cast Memory, phase 3, X1–X4, SM1–SM3).
**Open, no owner answer needed:** a browser walk of everything since the second walk; Back / Forward of a scene opened at the taken line loses its cast and history; `assertSeatDecider` does not hold a proposal on a card-less AI-played seat for the owner; open session pages are not told when a member is locked; leftover references to a plugin's card after a merge (`session_characters.character_id`, `session_messages.character_id`).

## State after full run 19 (2026-11-18)

**Full run 19 over the final state: 28,024 passed; only the three files left failing on purpose (4 tests).** Since run 18: `fnd-7` (sender-fixable attachment refusals keep their words), the third UI walk (`REPORT-walk-3-2026-11-18.md`) and its fixes `walk3-fix-A/B/C`, each seen working in a browser on the built app (scene Restore; seat lists after moves; phone routing; the notes inspector; "your persona"; the administrator's failed row; reader requests; lock mark; the attachment explanation for a member). Svelte check 0 errors; build clean; both repos staged; nothing committed. Rulings page: 32 open (new: WK1; HW1 now eight sentences).
**Follow-ups in progress (no owner answer needed):** Back / Forward of a scene opened at the taken line; a proposal on a card-less AI-played seat held for the owner; telling open session pages when a member is locked; references to a plugin's card left after a merge; cast-version Edit history requested for readers.
- **`small-3` (2026-11-18), after run 19:** Forward restores a scene's cast with the scene (the `rewind_taken` snapshot carries it; no Edit history row); a model proposal on a card-less AI-played seat is held for whoever holds its sheet (`assertSeatDecider` covers `seated_member`); cast-version Edit history is not requested for readers. No change needed: no session-page surface reads a member's lock; after a merge and an uninstall the session keeps its seats and speakers (both card columns are `on delete set null`; pinned by a test). Verify set 197 files, 2,313 tests; `tsc` 0; Svelte check 0 errors; build clean; staged. **Everything that does not wait on the owner is done.**

## Rulings page, third round, fourth answers (owner, 2026-11-18)

- **AP5** (no option picked): "There's no plugins published yet that users have. No data fix needed. Starter lorebooks always overwrite on plugin update. A users own custom starter lorebook is their own, unchanged." *Reading:* a provided lorebook is overwritten by its source at every update, earlier hand edits included; no copy is saved first and no migration is written for edited rows; a lorebook a person owns (a clone, or one they made into a starter) is never touched by an update.
- **SH1:** "Store the source and stop offering a card that guest already copied into this session" (one nullable field on the cast member; a migration).
- **SP1:** "Make the choice by seat, so every character a person holds can be chosen" (core-catalogue composer widget and its request; the by-card request is still accepted).
- **WK1:** "All fine as built", with the note "Media can still be added, just can't update the casts configuration". Points 1–4 stand. The note touches point 5 (art from a run on a locked cast member is refused today) and has two readings; asked back as **WK2** (D79). Nothing changed until answered.
- **HW1:** "Reword all eight as proposed and show them to everyone".
- **PR2:** "A switched-off plugin's prompts are offered to nobody" (as built; the 2026-09-24 rule stands, "disabled" in P1 meant hidden).
- **PR3:** "Add both: a pipeline choice on a prompt for administrators, and a manifest field for plugins".
- **TC1:** "Every genre gets an on / off switch; Story adds a second setting for how far it runs". **TC2:** the Turn order choice shows "To the session's owner, with the turn settings, advanced controls on or off" (only where the genre offers more than one option).
- **RG1** (no option picked): "Presets can declare groups, genre has a default preset." *Reading:* a routine group is declared by a preset; a genre's groups are the ones its default preset declares; a preset may declare its own groups and place routines in them.
- **RG2:** "One counter and one run limit per group". **RG3:** "Side by side means the group's own routines run together; the group still finishes before the next queued work". **RG4:** nobody is playing = "Nobody has sent anything for a while" (as today's limit works; whether a tab is open is not checked).
- **X1:** a run keeps the cast it started with (as built). **X2:** a routine skipped by its condition stays due (as built).
- **X3:** "No cap: every attended scene's summary, whatever the length", with the note "That measurement is arbitrary. Limits should be done by token/entry limits defined in pipelines, configurations etc. we may be moving more towards scenes over history entries for per character knowledge." (The twice-the-day cap is removed; core invents no length rule of its own.)
- **X4:** "Add a warning for genres and rulesets too".

Lanes: `small-4` (X3, HW1), `ap-3` (AP5 with AP4: a provided lorebook always takes its source's updates), `sh-1` (SH1; migration), `sp-1` (SP1; SDK core catalogue), `pr-3` (PR3; app + SDK manifest), `x-4` (X4; SDK), `tc-1` (2.3 turn controls: TC1, TC2), `rg-1` (2.6 routine groups and 2.8 idle running: RG1–RG4). SDK-touching lanes run one at a time.
**Still open on the page (26):** WK2, AP6, AP7, TN1–TN4, RN1–RN4 (D80; turn controls and routine groups are planned, `PLAN-turn-controls-2026-11-18.md` and `PLAN-routine-groups-2026-11-18.md`, and wait on these), SM1–SM3, N1–N3, CM1–CM4, G3A–G3E.
**Lanes as briefed after planning:** `core-4` (X3, HW1, AP5/AP4), `sdk-5` (X4, PR3), `sh-1` (SH1), `sp-1` (SP1); `tc-1a…h` and `rg-1a…f` not started.

## Rulings page, third round, fifth answers (owner, 2026-11-18, later)

- **WK2:** "A lock stops runs changing the cast member's details and sheet; art a run makes is still added".
- **AP6:** "Remove both: the lorebook becomes exactly what the source ships" (rows the source dropped and rows a person added are removed at an update; the owner was told an older session still playing on that lorebook loses those rows).
- **AP7:** "Extend the refresh to all of it" + "And drop deleted rows" (a core starter's cast, knowledge ties, exits, calendar, clock, name and Rules refresh on upgrade, and rows the release no longer ships are removed).
- **TN1:** "Use these names" (`PLAN-turn-controls-2026-11-18.md` §2). **TN3:** "Move those sessions to Round robin and say so in the upgrade note, naming each session". **TN4:** "Remove them in this work" (the old turn-order SDK names).
- **TN2** (no option picked): "I don't understand the issue here". Lead's choice, told to the owner in plain words: each Turn order entry keeps its own pool and mention settings (no new machinery); existing sessions keep today's values on the entry they use.
- **RN1:** "Yes: that shape and those names" (`PLAN-routine-groups-2026-11-18.md`). **RN2:** Keep running while nobody is playing is "Off until the owner switches it on" (real-clock routines in existing sessions stop running between sends at the upgrade). **RN3:** "The first routine's settings become the group's, with a line in the routine log". **RN4:** Run now "runs that routine alone and leaves the group's counter untouched".
- **SM1:** "Off stops the automatic run only; the button still works" (as built). **SM2:** "Remove the field now" (the genre declaration's separate scene-summary field; the four shipped genres move to the registration). **SM3:** "No genre means every field, as the SDK says".
- **N1** (no option picked): "Should use a premier library that's well sorted and maintained. You can propose some options and design mockups. I think a vertical tree with a horizontal option is best for the full view". (Owed: library options and mockups; then a ruling.)
- **N2:** "A chain of rows: every N years, except every N, unless every N, with add and remove". **N3:** "Replace all six with one shared date field".

Lanes: `wk-2` (WK2), `ap-4` (AP6, AP7, and AP1's "can't mutate" for a plugin's card), `sm-1` (SM2, SM3), `nav-2` (N2), `nav-3` (N3), `nav-1` research + mockups (N1), `tc-1a…h` (turn controls: go), `rg-1a…f` (routine groups and idle running: go). SDK-touching lanes one at a time.
**Still open on the page:** CM1–CM4, G3A–G3E, N1 (after the mockups), PC1 (the Pipeline picker's wording), PC2 (a shipped prompt's pipeline).

## Rulings page, third round, sixth answers (owner, 2026-11-18, evening)

- **PC1:** the Pipeline picker's wording is "Fine as written".
- **PC2** (no option picked): "Sounds like you're describing configs on a pipeline, there should be no choices to make on a shipped pipeline. Custom configs get updated where settings are compatible. Give admins a note when the configs diverge after an update." *Reading:* a shipped prompt offers no choice of pipeline (as built: its source files it). What an administrator customises is their own copy; a copy takes its source's later updates wherever the two are still compatible, and administrators get a note when a copy and its source diverge after an update. The second half is new work (a copy that follows its source; the divergence note): facts and a proposal owed before building (D83).
- **CM1:** "Fold: Memory. Fields: "Remembers as of ‹line, date›" and "Nothing before ‹date›"". **CM2:** nothing-before drops "Events only: history days, scene summaries and earlier scenes". **CM3:** the prompt shows "The session's date: the body is in the present". **CM4:** "Deleting a line moves Memories on it to the parent line, and the delete says how many". Cast Memory (1.5) is go: `briefs/BRIEF-cm-1.md` to be refreshed against these, cold-reviewed, built (a migration).
- **G3A:** "Several story channels, each with its own scenes and rounds", with the note: "The turn order dictates the order of when cast/envoys respond to user messages. The genre/pipelines handle where they pull messages from. Events and routines can bypass turn order by design and even pull in benched users if designed to, I.e. a city living on in the background."
- **G3B:** "One round, stated by the genre's turn-order pipeline".
Phase 3.1 (scenes follow the story channels a genre declares) and 3.2 (one definition of a round) are go once turn controls have landed; `PLAN-core-genre-couplings-2026-11-17.md` to be refreshed against G3A's "several story channels" (it assumed one).
**Still open on the page:** N1L, N1V, N2C, N2P, N3M, N3S, G3C, G3D, G3E.

## Navigator: go (owner, 2026-11-18, evening)

"Mockup looks good. Do another mockup for the cast viewer version. Need to visualize time travel as well" → mockups C (the cast view: what a character remembers and where their body is) and D (the session's clock moving back and forth) added to https://claude.ai/code/artifact/981c2bf0-eda7-4b35-a478-22cafddabf94 → **"Mockups work. Run with it"**.
*Reading:* N1L and N1V are ruled as recommended on that page: two layers over one model; the drawing on the flow library the app already ships (kept on its 1.x), the list on Skeleton's Tree View; our own date-placed lane layout; the list and the vertical tree, with horizontal as a switch on the full view; the cast view (C) and the played-order arcs (D) are part of it. Lane `nav-1` (programme 2.5): to plan, cold-review and build; the cast view depends on cast Memory (`cm-1`). Still to define with the owner (row 2.5): what "extend a line" creates.
**Still open on the page:** N2C, N2P, N3M, N3S, G3C, G3D, G3E.

## Rulings page, third round, seventh answers (owner, 2026-11-18, night)

- **CM5:** "Yes: what the character lived through in this session is theirs" (as the cast Memory brief builds it).
- **PC3:** "I meant settings only; a copy is the administrator's own and stays frozen". Nothing to build for copies (`PLAN-copies-follow-source-2026-11-18.md` Step 1 is dropped); owed: one check that each existing settings notice names its cause and its undo. **PC4** ("Take it by itself, show it afterwards with Undo") applied only if copies followed; with PC3 it has nothing to act on.
- **AP8:** "Before deleting, copy each row a session points at into that session's notes" (then a plugin's lorebook becomes exactly what the source ships; lane `ap-5`).
- **TN5:** "Use the existing showIf; add no new name".
- **NX1:** "Forwards: move the line's present to the new date, writing nothing. Backwards: only on the main line, by starting an empty day at the earlier date" (lane `nav-1d`).
- **N2C:** "Allow any number of levels", with the note "Something in the middle. Give a liberal limit, but a limit so it can't be used abusively." (Lead: at most eight levels.) **N2P:** "Say the whole rule". **N3M:** "Add the month names for widgets". **N3S:** "Show the problem while typing; Save behaves as today" (as built).
Lanes: `ap-5` (AP8); `cal-1` (SDK and app: leap levels beyond three with a limit, the prompt's whole leap rule, month names for widgets, the Chronicle's Move the clock on the shared date behaviour); `nav-1d` (NX1).
**Still open on the page:** G3C, G3D, G3E.

## Rulings page, third round, eighth answers (owner, 2026-11-18, night)

- **G3C:** "Read aloud, the scene hook and goals become registrations a genre or preset can drop; vectorization and the form re-check stay in core", with the note: "Yep, they should registered to the event at the end of a reply. Vectorization remains managed by core for now. We have several retrieval options so a lack of vectors shouldn't break anything, only degrade unless a custom node queries only for vectors etc."
- **G3E:** "Remove the two that nothing declares; keep the one in use" (removes `turnSeatChanges` and `forms.modelAnswers`; keeps `castFromLorebook`).
- **G3D** (no option picked): "Are we talking about access permissions etc, or something else? A node that requires Internet access for instance causes that permission to surface up the chain, I.e. to the plugin. I'm not sure what permissions a genre alone would directly need." The question was badly named: these are play rules core finds by a setting's exact name (`keepEveryTurn`; owner / player sheet latitude and item moves; `tools`), not access permissions. Re-asked in plain words as G3D on the page (D89).
Phase 3 as ruled so far: 3.1 several story channels, each with its own scenes and rounds (G3A); 3.2 one round, stated by the genre's turn-order pipeline (G3B); 3.4 read aloud, the scene hook and goals registered on the end-of-reply event and droppable (G3C); 3.7 two flags removed (G3E). `PLAN-core-genre-couplings-2026-11-17.md` to be refreshed against these before any lane.
**Still open on the page:** G3D (re-asked).

**G3D ruled (owner, 2026-11-18, night):** "Got it. Yes, something like honor mode would be a genre setting that it's pipelines can reference, etc." *Reading:* the play rules (whether earlier turns may be changed, sheet and item latitude, whether the model may use tools) are a genre's own settings that the genre's declaration and pipelines point at; core reads what the genre declares and never a setting's name (the first option). Phase 3 has no open question; its plan is to be redone against G3A–G3E before any lane.
**The rulings page is empty.**

## Owner, 2026-11-18 night: performance, packages, the engine

"As far as query amount, a modder should be able to narrow them considerably. A setup that doesn't have everything enabled already shouldn't be making as many calls" · "If I'm right, all those queries should still be relatively cheap. Even with multiple active users on a pub" · "Upgrade to the latest safe version of pglite, also look at the rest of the packages. Look at what quiries we can gate when a setup doesn't support it." · "Also yes, actively optimize as you go." · "Are there more database views we can leverage?" · (earlier the same evening) "My hope is that SP and the SDK makes most purpose built clients I.e. dungeon crawling, living worlds etc redundant."
- Measured: `INVENTORY-statements-floor-2026-11-18.md` (a fixed floor of ~780 + ~406 statements per Story or Chat reply whatever is enabled; ~1.3 ms each; one connection).
- Plan: `PLAN-statements-floor-2026-11-18.md` (lanes p6-0 … p6-5; p6-0 measurement started; cold review running). No database view enters it (a per-run memo or one joined query does the job without a migration).
- Packages: `INVENTORY-dependency-audit-2026-11-18.md`; group A applied at the next quiet point; group B as small tasks; group C left.
- PGlite: `INVENTORY-pglite-upgrade-2026-11-18.md`; an upgrade is a conversion of every install's data; asked as PG1 (D90).

## Rulings page, ninth answers (owner, 2026-11-18, night)

- **PG1:** "Do it, starting with a prototype on a copy of real data" (PGlite 0.2.17 → 0.5.15 by a start-up conversion; the prototype first, nothing shipped until it is proven).
- **PF1:** "No line when the condition only looks at the event itself; keep the line when it looks at the session" (a registration whose `when` reads only `event.*` declines quietly; R24's run-list line stays for a condition on the session's state). As `tc-1d` built it.
- **PF2:** "Skip it when there is no clock to move" (the round tick; one new fact on the round's event).
- **PF3:** "Leave the narrator's name out where the genre registers no narration".
Lanes: `pg-0` (the prototype, in the scratchpad, on a copy; no repo change), then `pg-1…` (the start-up conversion, recovery, backups, packaging, tests); PF2 and PF3 join `p6-4`.
**The rulings page is empty.**

## State after full run 20 (2026-11-18, night) — the first full run over the day's lanes

Gates: `tsc` 0, `sdk:build` clean, `npm run check` 0 errors, `npm run build` clean. `sdk:test`: 4908 tests, the four standing failures only. App `src scripts`: **28,410 passed, 15 failed in 12 files** (60 min). Four of the 15 are the three files left failing on purpose. **New: 11 tests in 9 files** → fix task `cp1-fix`:
- `sockets/sessions.sendChannel.int.test.ts` (3): auto-advance reads `off` where the test expects a fire (tc-1e: a real defect or a fixture genre that declares no switch).
- `sessions/genreFieldDefaults.int.test.ts` (3), `pipelines/runtime/host.sessionSettingsQuery.int.test.ts` (1): expectations of the old settings shape (tc-1e).
- `plugins/pluginVariables.int.test.ts`, `plugins/pluginDefaultConfigName.int.test.ts` (suites fail in setup): the showcase plugin `showcase.twenty-questions` swaps onto `core:spec/story-turn-order#decide.rules.strategy`, a node tc-1d removed; the plugin must register a turn order option instead.
- `sockets/sessions.guestEditSession.int.test.ts` (1): pipeline cards = 0 since tc-1d removed swaps (tc-1g's).
- `shared/lorebooks/lineColumns.test.ts` (1): `TypeError … reading 'date'` (nav-1b-fix).
- `characters/frozenColumns.guard.test.ts` (1): two frozen-column reads in session-path files (a lane read `characters.*` there).
- `pipelines/boot/bootstrap.queries.int.test.ts` (1): expected 0 to be 70.
Built since run 19 and covered by this run: core-4, sdk-5, sh-1, sp-1, small-5, nav-23, ap-4, tc-1a, tc-1b, tc-1d, tc-1e, nav-1a, nav-1b, shake-1/2, p6-0, p6-12 and their fix tasks. Not yet done: the browser walk; package group A; the transaction detector (pg-1a).
