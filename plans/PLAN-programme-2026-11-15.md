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

## How this file is kept (owner, 2026-11-15: "I want everything moving, and I don't want to hear "done" just for the rest of the sprint to get left behind and forgotten.")

- Every lane below has a **State**. The lead updates it when a lane is briefed, building, built, verified.
- A report to the owner says what is finished **and what is still open in this file**, every time. "Done" is said
  of the programme only when every row is verified or moved to `plans/DISCUSS-LATER.md` with the owner's word.
- Items that need the owner live in `plans/DISCUSS-LATER.md`; nothing waits silently anywhere else.

## Phase 0 — foundations first (owner, 2026-11-15: "perhaps you should first prioritize optimizing those files and the verification suite")

In flight before Phase 0 starts: scope review of `time-t7d`, then one grouped verification of `time-t6f` +
`time-t7d` (built work must not sit unverified).

| # | Lane | State |
|---|---|---|
| 0.1 | **Verification suite speed.** A full run is ~85 min (import time alone ~2,300 s summed; 3 workers under a 10 GB cap); `tsc` needs 10 GB, `npm run check` 12 GB. Measure where the time goes, then cut it: shared test database set-up, import cost of the giant modules, worker count under the cap, a fast lane-level subset that is trustworthy. Target and method set by the measurement. | measuring (read-only) |
| 0.2 | **Split the files every lane collides in**: `pipelines/runtime/bindings.ts` (>9k lines), `pipelines/runtime/host.ts` (>13k), `sockets/sessions.ts` (>11k), `sockets/narrativeGraph.ts` (>6k), `EditSessionForm.svelte` (~3.7k). Mechanical moves by area behind unchanged exports; no behaviour change; one file at a time, each verified; announced to the peer session before each. | seams being mapped (read-only) |
| 0.3 | **Standing test failures**: the 21 app files / 26 tests and the SDK's 4. Each is fixed, or deleted with the reason written down; the suite ends green so a run reads clean at a glance. | to brief |
| 0.4 | **Walk what was built** in an isolated running instance (knowledge filter in Story and the Lair, dates in prompts, migrations 0166–0167, entry defaults, earlier walks owed) and one **upgrade of a copy of real data** by the recorded recipe. Findings become fixes or rows here. | to do after 0.1 |
| 0.5 | **Statements per reply** (Story ~2,040, the Lair ~4,580 per run, measured 2026-11-15): profile one reply, cut repeated reads. | to brief |
| 0.6 | **Import / export round trip**: a test that exports a lorebook with lines, dated links, knowledge ties and marks, imports it, and compares everything; fix what is lost (links' dates and lines today). | to brief |
| 0.7 | **Docs against behaviour**: each `docs/*.md` page checked against its feature; false statements fixed (two found on 2026-11-15: locked settings, Tone "Before you start"). | to brief |
| 0.8 | **Audit of the areas not touched on 2026-11-15** (connections and models, speech, image generation, the admin shell, plugins): read-only; findings land here or in DISCUSS-LATER. | to do |

## Phase 1 — finish the lorebook and knowledge sprint (`PLAN-entry-time-and-lines-2026-11-14.md` §11)

| # | Lane | State |
|---|---|---|
| 1.1 | `time-t7d` structured `date` / `dateDelta`, layouts per parent, calendar readable | building |
| 1.2 | **Filters live in the queries.** Every SDK read that returns lore, links, places or history for a run that speaks as one cast member takes a toggle, on by default, for (a) what the character knows and (b) what it was there for; a modder switches it off per query. This closes every leak at the source: lore lanes, entity and vector search, the scene's place listing and ways, link-borne names (the link hop, `withLinks`), the triggers scan and recursion. `core:query/unknown-entries@1`, the `firsthandFor` / `firsthandBy` ports and the exclusions wiring in Story and the Lair are replaced. Cold review must settle: how a query learns the run's speaker; the presence rule that is safe as a default (lead: a scene's stored cast **or** spoke in it, so a silent listener keeps the scene); narrator and multi-voice steps read everything. | to brief |
| 1.3 | Attended-scene summaries as a core read (a character who missed part of a day); the shipped behaviour uses it | to brief |
| 1.4 | Knowledge screens: **Known by** on the entry, **Knows** on the cast member (buttons + drag), bulk mark; hand kinds **Knows** / **Kept from**; SDK write API with recipes, placed by no shipped pipeline | to brief |
| 1.5 | Cast Memory (advanced fold) | to brief |
| 1.6 | Distances (*has been there* at scene close; step-count walk; two measurements as queries) | to brief |
| 1.7 | Timeline stance typed in the SDK (requires / excludes / either; values and writes typed to match; `validate()` refuses a mismatch) | to brief |
| 1.8 | Admin debug switch: step time limits off, shown while on in notifications / activity, the admin dashboard and the session's Turn line | to brief |

## Phase 2 — session settings (`PLAN-session-settings-cleanup-2026-11-15.md`)

| # | Lane | State |
|---|---|---|
| 2.1 | `ss-2` one store and one writer for session values | briefed (`briefs/BRIEF-ss-2.md`) |
| 2.2 | Prompt row per model call for every session owner (on by default) + two views (normal / in order of operation, one switch for the tab) | to brief |
| 2.3 | Turn controls. **Turn order options are pipelines registered on one built-in core event** (🚧 "decide who speaks next"); each registration a genre or preset makes is one entry of the **Turn order** select, exactly one active per session; round robin, by user, random, narrator replies, a model-backed one and a genre's scripted one are all such pipelines; nothing implied; scripts per genre. **Auto-advance** on / off (★ still open: keep *Next turn* / *Whole round* as Story's own option). Charter (S10). Core's silent default goes. Importers map *manual* to Auto-advance off. | to brief |
| 2.4 | Locks shown read-only with their cause (reverses R32); locks honoured at run time | to brief |
| 2.5 | Line picker as a button + modal over the lorebook's tree: pick a line's present, any time in between, or extend a line in either direction (to define with the owner: what "extend" creates) ; replaces the Line and Story clock rows | to brief |
| 2.6 | Routine groups: the group owns trigger, stacking, caps, sequential / async; routines keep order, mode, own settings; boot pass | to brief |
| 2.7 | Turn line shows every run in progress with Stop, carries Reply; Composer setting *Show the Send button* | to brief |
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
