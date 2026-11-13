# REPORT — lane `sense-clk2` — 2026-11-11 (saved by the lead from the supervisor's final message; condensed)

Built as briefed, with one stop-and-ask hit (★CLK2-1). No migration, no commit.

## Inventory: what moves the story clock with nobody pressing anything

| Genre / preset | Before | After |
|---|---|---|
| Story · Minimal | round tick 5 min (on); reply tick (off, By 0) | round tick by the round worth (on); reply tick removed |
| Story · Living (default), Rule Based | round tick (on) **and** *Note what changed* → *Move the clock* (on): two moves | round tick (on); *Move the clock* ships off |
| Lair · Words only | round tick (on); keeper Off | **nothing** (★CLK2-1) |
| Lair · Rules (default), The rules decide | round tick (on); keeper at Review, `time: false` | the keeper's round-worth move (on, applied at once) |
| Dungeon Crawler | its turn moves the clock by the Planner's plan minutes each round (cause `action`) | unchanged; it is its own single owner and reads no round worth |

Person-pressed movers are unchanged everywhere (*Time passes…*, Rest, keeper actions, accepted proposals, by hand).

## Names (all 🚧; NOMENCLATURE §9, §4, §25)

- **round worth**: genre field `roundWorth` (`ROUND_WORTH_KEY`, `ROUND_WORTH_FIELD` in
  `core-catalog/src/shared/roundTick.ts`), integer 0–1440, default 5, 0 = off, `reach: 'owner'`, group `Turns`
  (the Lair: `Lair`), label *Minutes each round moves the clock*. One writer: the session settings form; cascades
  session < preset < genre < default. A genre field, not the tick's **By**, because the Lair keeps the setting
  without registering the tick.
- **`core:query/round-worth@1`** (contracts `roundWorth`): in `scope`; out `main { minutes, step }`, `minutes`,
  `step { by, unit: 'minutes' }` (plugs into `clock-step@1`'s `step`). 0 when the genre has not opted in or the
  session sets 0. Host binding `src/lib/server/pipelines/runtime/roundWorth.ts`; `host.ts` untouched.
- Internal: `ReckonTerms.ownsTheClock`, the reckon script's `clockUnnamed`.

## Published names removed (ruling R1)

In `core:spec/story-respond`: node keys `tick`, `clock`, `clock.moves.advance`; the session setting *Each reply
advances the clock by* (By/Unit). Stored values are removed by the boot pass
`src/lib/server/pipelines/boot/replyTickDrop.ts` (registrations values in every scope, story-respond's
`instance_values`, `pipeline_node_overrides`, named-config values); a second pass changes nothing. Nothing else
published goes; `clock-step@1`'s `unless` port stays, now unwired in core. Never shipped and gone: the round tick's
exposed **By**, the Lair's round-tick registration.

## Built

- **Story:** the round tick reads the round worth (`worth` → `tick` → the clock/presence gates → *Advance story
  clock*, cause `'tick'`). *Note what changed* ships `duties.time: false`. Minimal's description: "Just the story:
  one model call a turn. The clock moves on a few minutes each round; nothing else changes unless you change it."
- **The Lair:** no round tick. The keeper's `time` junction gains a `round` branch, taken when it names no move
  (always while `time` is off): it applies the round worth at once, cause `'tick'`, even at Review. A named move
  replaces it.
- **Dungeon Crawler:** untouched.

## Changed files

SDK: `contracts/src/queries.ts`; comments in `contracts/src/tasks.ts`, `outlets.ts`; `core-catalog/src/shared/
roundTick.ts`, `shared/reckoning.ts`, `genres/defaults.ts`, `genres/story/respond.ts`, `genres/story/reckoning.ts`,
`genres/lair/keeper.ts`, `seed/presets.ts` (Minimal's wording); `guides/time.md`, `guides/storage.md`;
`sdk-tests/coreGenreDefaults.test.ts`, `coreClockOwners.test.ts` (new), `coreCatalog.test.ts`.
App: `pipelines/runtime/roundWorth.ts` (+test), `runtime/bindings.ts` (2 lines); `boot/replyTickDrop.ts` (+int
test), `boot/bootstrap.ts`; `boot/specHashes.test.ts`, `registryHashes.test.ts`; `routines/roundTick.int.test.ts`,
`clockOwners.int.test.ts` (new), `roundWorth.genres.int.test.ts` (new); `runtime/receipts.int.test.ts`,
`utils/replyRoad.int.test.ts`, `sessions/stepSettings.int.test.ts`; `sockets/sessions.lairCastRows.int.test.ts`;
docs `lorebook-time`, `genre-story`, `genre-lair`, `genre-dungeon-crawler`, `sessions`, `pipelines`; NOMENCLATURE.

## Tests (lane)

SDK `coreClockOwners` 6/6 (Story → round-tick; Lair Rules / The rules decide → lair-keeper; Words only → none;
DC → its respond). App: `roundWorth` 11/11; `replyTickDrop.int` 3/3; `roundTick.int` 6/6; `clockOwners.int` 4/4
(one move per round in Story · Living and Lair · Rules; worth 0 moves nothing; keeper *Move the clock* on gives its
own 30-minute move and no worth move); `tsc` clean. Pins moved with dated notes: SDK digest, four spec hashes
(story-respond, lair-keeper, story-reckoning, round-tick), one new registry hash.

## Lead's follow-up (same day)

- **Q-1 placed**: `core-catalog/src/registry/genres.ts` declares `[ROUND_WORTH_KEY]` in Story's fields and the
  Lair's (group `Lair`). `sdk:build` exit 0 (no vite dev running). Re-pinned: SDK digest `5a8838e44d157dc0` →
  `1270b6f1409384bb`; `core:spec/story-create@2.2.0` → `1ad4d7a73cdeca`; `core:spec/lair-create@1.0.0` →
  `af2c76053c8c5` (the create specs carry the genre's fields). `roundWorth.genres.int` now passes; `specHashes`,
  `registryHashes`, the three socket tests and the clock tests pass; `tsc` clean.
- `replyRoad.int.test.ts` is unstable (1 to 8 failures per run, first chunk missing from the row mid-stream, then
  timeouts). Under read-only diagnosis.

## Open ★

- **★CLK2-1** The Lair's **Words only** preset ships its keeper Off, so it has no automatic mover. A (lane's
  recommendation): the round tick owns the Lair's clock in all three presets and the keeper does not read the round
  worth. B: keep the keeper as owner; Words only registers the round tick. C: Words only's clock is the GM's alone.
- **★CLK2-2** The keeper's round-worth move applies at once even at Review. Recommended: keep.
- **★CLK2-3** Story with *Move the clock* switched on moves twice a round (by opt-in; docs say set round worth 0).
- **★CLK2-4** DC could use the round worth in place of its 10-minute fallback. Recommended: no.
- **★CLK-5** carried: a lorebook whose present is only its newest dated entry gets no round move.
- Owner's call at 0.7: `clock-step@1`'s `unless` port is unwired in core.

## Provisional copy 🚧

The field label and description ("When a round ends, the story clock moves on this many minutes. 0 turns it off. A
story whose clock is not set is left alone."), the query's name *Minutes a round is worth*, Minimal's description,
the doc lines in the six docs, `guides/time.md`'s new section, the NOMENCLATURE rows.

## Noticed, not done

- `paramsSlotWiring.test.ts`: `core:spec/speak-message` declares slots it never wires (speech work).
- Stale comments: headers of `sessions/stepSettings.ts` and `pipelines/runtime/clockStep.ts` still describe the
  reply tick.
- Q1 (`registrations/write.ts` `comparable`) is no longer hit by core but stays latent.
- A plugin preset that set values on story-respond's `tick` has its stored rows stripped; its own declaration is
  then refused at the registration door, said plainly.
- No scope review yet.
