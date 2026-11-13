# REPORT — lane `sense-clk` — 2026-11-11

Written by the lead from the supervisor's final message. The round tick is built and registered for Story and the
Lair only; every targeted test passes. Six ★ are open.

## Built

- **`core:spec/round-tick`**, an **event** pipeline on `core:event/round-ended@1`, no model call: inlet `event` →
  step `tick` (`core:task/clock-step@1`, exposed to the session, By **5**, Unit minutes) → junction `clock` on
  `tick.moves` → query `present` (`core:query/cast-presences@1`, port `at`: the session's own clock, else the clock
  set on its line, else null) → junction `clocked` → outlet *Advance story clock* (`cause: 'tick'`,
  `onRefusal: 'skip'`). By 0: nothing read or written. No clock set: nothing moves and **no line is written**.
- **An event, not a routine** (implementation choice): no Off/Review/Full row; the session's only control is **By**.
- **Registered in Story's and the Lair's defaults only**, in every preset of each (Minimal included), Unit locked to
  minutes. The Guide and Chat do not register it. The Dungeon Crawler does not: confirmed it moves the clock by each
  round's own minutes (`docs/genre-dungeon-crawler.md` ~231, ~235; core-catalog `genres/dungeon-crawler/story.ts`
  ~1466–1485).
- **Undo as the reply tick's**: a normal clock move under the message that closed the round; a delete takes it back;
  a swipe or regenerate keeps it. The swipe rule and the per-reply tick are untouched.
- The settings form renders it from the declaration, on its own card (see ★CLK-1).

Assumption: genre registrations live in `core-catalog/src/genres/defaults.ts`, not `registry/genres.ts` as briefed;
Story's and the Lair's entries only were edited.

## Changed files

SDK: NEW `core-catalog/src/shared/roundTick.ts`; `core-catalog/src/genres/defaults.ts`; `core-catalog/src/index.ts`;
`sdk-tests/coreGenreDefaults.test.ts`; `sdk-tests/coreCatalog.test.ts` (digest re-pinned).
App: NEW `src/lib/server/pipelines/routines/roundTick.int.test.ts` (6 cases, incl. second boot changes nothing);
`src/lib/server/pipelines/boot/specHashes.test.ts` (one new pin); `docs/lorebook-time.md`, `docs/sessions.md`,
`docs/genre-story.md`, `docs/genre-lair.md`; `NOMENCLATURE.md` (§4 row **round tick**, §25 subsection).

## Golden pins

SDK announcement digest `cf4c379152e8e47a` → `a45adb233d3e2579` (new spec and its two registrations). App
`specHashes`: new `"core:spec/round-tick@1.0.0": "8090bdc19f449"`; no existing pin moved.

## Builds and tests

`npm run sdk:build` twice, exit 0, no vite dev or vitest running each time. SDK: 7 files 230/230. App: 41/41,
75/75, 23/23 across the round tick, settings form, registrations, routines and clock suites.

## Open ★

- **★R1** Retire the per-reply tick now that a per-round one sits beside it? Recommended at the next pre-release; it
  shipped in pr-7, so the owner's call.
- **★CLK-1 Where the setting shows.** The derived form puts it on its own card, *Each round moves the clock*, field
  **By** (5); no unit word shows because Unit is locked. "Under The story, below the story clock" needs a hand-built
  control. (The reply tick moved to the Reply card on 2026-10-21; the docs still say otherwise.) Recommended: keep
  the derived card and add a registration label such as *Minutes each round moves the clock*.
- **★CLK-2 No new cause value.** Reuses `cause: 'tick'`, giving the reply tick's rules exactly. A distinct `'round'`
  is a new name in a published port vocabulary and needs edits in `runtime/host.ts`, `scenes/boundaryWatcher.ts`,
  `state/clockMoves.ts`, `shared/state/ledgerLines.ts`, `shared/sockets/types.ts`. Recommended: keep `'tick'`.
- **★CLK-3 Two moves per round.** Story's *Note what changed* has *Move the clock* on by default (Full on Living and
  Rule Based); the Lair's *Keep the books* (Review) can move it too. Both moves happen. Options: accept; step the
  round tick aside while that duty runs; a different default By per preset.
- **★CLK-4 Story Minimal.** Its card says "nothing changes unless you change it", yet the tick runs on Minimal.
  Recommended: keep the tick (it does nothing without a clock; By 0 turns it off) and reword Minimal's description.
- **★CLK-5 The clock condition is narrower than "the lorebook's present".** The only declared read is
  `cast-presences@1`'s `at`: the session's own clock, else the clock set on its line. A lorebook whose present comes
  only from its newest dated history entry gets no tick. Covering it needs a new declared port.
- **★CLK-6** Copy: every new sentence is provisional.

## Provisional copy 🚧

**Each round moves the clock** (spec name, card heading) · **Each round advances the clock by** (step label) · the
docs paragraphs in the four docs above.

## Queued for other owners

- **Q1** `src/lib/server/pipelines/registrations/write.ts` `comparable` compares genre rows with `JSON.stringify`;
  stored jsonb reads `{ value, lock }` back as `{ lock, value }`, so with `setting()` the boot re-wrote the rows on
  every boot. Worked around with a key-order literal in `defaults.ts`. Proper fix: make `comparable` ignore key
  order, or have the SDK's `setting()` write `lock` first. **Any future lock in a genre's defaults hits this.**
- **Q2** `contracts/src/outlets.ts` `cause` doc says "`'tick'` — a reply's fixed tick"; `clock-step@1`'s docblock
  still says "Chat's reply".

## Noticed, not done

- Docs say the reply tick sits under The story; the code has drawn it on the Reply card since 2026-10-21.
- The move files under the session's newest message when it runs; if auto-advance has already written the next
  speaker's row, it could file under that row. Not seen in tests.
- The existing `by` declaration allows negatives: By −5 would run the clock backwards each round.
- Admins may see a "Run this step" switch for the optional presences read on this card; switching it off would stop
  the tick. Unverified.
