# BRIEF — `sense-clk2-w1` — SDK: the round worth, its read, one clock owner per core genre

You are a `lane-worker` for lane `sense-clk2` (supervisor writes this). SDK repo: `/home/jody/github/serene-pub-sdk`.
App repo: `/home/jody/github/serene-pub`. Use absolute paths. Another session is editing both repos (visual-novel
layout: dialogue-box widget, `show-line` request, portraits `speaking`, and `core-catalog/src/registry/*`): do not
touch its files.

## The owner's rulings (2026-11-11, verbatim)

- "In core genres we should have one default owner that moves the clock."
- "Story should be round. Lair and dungeon I think need more management so maybe the routine? Maybe they can share
  the same session setting, sdk provides an API to grab the setting, if opted in and pipelines can act on it/choose
  to respect the interval unless you have a different suggestion"
- On Story's per-reply tick (*Each reply advances the clock by…*): "Remove it. The setting mentioned allows pipelines
  to handle time arbitrarily"

## Design (decided by the supervisor; build exactly this)

- **The setting** is a genre field, the **round worth** 🚧: key `roundWorth`, how many story minutes a round is
  worth, 0 = off. A genre opts in by placing the field in its `fields`. (Placing it in Story's and the Lair's
  declarations in `core-catalog/src/registry/genres.ts` is **not yours**: that file is a shared registry. Do not edit
  it. The supervisor queues it.)
- **The read** is one declared query, `core:query/round-worth@1` 🚧: the session's round worth as a whole number and
  as a clock step. 0 when the genre places no such field (not opted in) or the session sets 0.
- **Story**: the round tick (`core:spec/round-tick`) is the owner. It reads the round worth instead of its own
  exposed **By**. Story's *Note what changed* ships with *Move the clock* off.
- **The reply tick is removed** from `core:spec/story-respond`.
- **The Lair**: the keeper (`core:spec/lair-keeper`) is the owner. The round tick is no longer registered there.
  When the keeper runs and its own judgment names no clock move for the round, it moves the clock by the round worth.
- **The Dungeon Crawler**: unchanged (its turn's Planner names each round's minutes).

## Tasks

1. **`contracts/src/queries.ts`** — add, right after `castPresences` (about line 1187), modelled on it:
   `export const roundWorth = pin(describeQueryDefinition({ id: 'core:query/round-worth@1', i18n: { name: { en:
   'Minutes a round is worth' } }, timeoutMs: 2000, ports: { in: { scope: S.sessionScope }, out: { main: S.json,
   minutes: S.json, step: S.json } } }))`. Not `optional`. Docblock (🚧, `@experimental`): it reads the session's
   `roundWorth` genre field from the settings document (cascade applied: the session's value, else its preset's,
   else the genre's, else the field's default); `minutes` is a whole number ≥ 0; `step` is `{ by: minutes, unit:
   'minutes' }`, exactly what `core:task/clock-step@1`'s `step` in-port takes; `main` is `{ minutes, step }`; 0 when
   the genre places no `roundWorth` field (it has not opted in) or the session sets 0 (off). It never reads or moves
   the clock and does not say whether one is set. ⚠ Not the Dungeon Crawler Planner's round minutes (the time one
   round took, judged), not `clock-step@1`. Make sure it is exported wherever the other queries are (check
   `contracts/src/index.ts` and any list of definitions).
2. **`core-catalog/src/shared/roundTick.ts`** —
   - Export 🚧 `ROUND_WORTH_KEY = 'roundWorth'` and 🚧 `ROUND_WORTH_FIELD: FieldDecl` (`import type { FieldDecl }
     from '@serene-pub/sdk'`): `type: 'integer'`, `label: { en: 'Minutes each round moves the clock' }`, `group:
     'Turns'`, `reach: 'owner'`, `min: 0`, `max: 1440`, `default: 5`, `description: { en: 'When a round ends, the
     story clock moves on this many minutes. 0 turns it off. A story whose clock is not set is left alone.' }`.
     Docblock: a genre opts in by placing it under `[ROUND_WORTH_KEY]` in its `fields`; read by
     `core:query/round-worth@1`; written only by the session settings form (one value, one writer).
   - The graph: after the inlet, `.query('worth', ($) => C.roundWorth.v1({ scope: $.event.sessionScope }))`, then
     `.task('tick', ($) => C.clockStep.v1({ step: $.worth.step, params: slot.params() }))` with **no** `expose`; the
     `clock` → `present` → `clocked` → `advance` tail unchanged; remove `.defaults((p) => p.params('tick', { by: 5
     }))`. Version stays `1.0.0` (never shipped; edited in place). Rewrite the header docblock to say: it reads the
     session's round worth (5 by default; 0 off); Story registers it; the Lair's clock is its keeper's; the Dungeon
     Crawler's is its turn's; the reply tick is gone.
   - Export it from `core-catalog/src/index.ts` beside the existing round tick exports (the only edit there).
3. **`core-catalog/src/genres/defaults.ts`** — the `roundTick` registration becomes `register(coreEvents.roundEnded,
   roundTickSpec())` (no `values`: nothing is exposed, so the Unit lock and its ⚠ key-order comment go). Keep it in
   `storyRegistrations`; **remove it from `lairRegistrations`**. Update the comments: Story's line says the round
   tick moves the clock by the session's round worth; the Lair's header list says the keeper owns the clock.
4. **`core-catalog/src/genres/story/respond.ts`** — remove the reply tick: the `tick` task, the `clock` junction and
   its `advance` outlet (about 1447–1480) and their docblock. Append to the spec's history comment block (the `⚠
   Edited in place` entries ending about line 424) one entry: `⚠ Edited in place (2026-11-11, owner ruling R1, lane
   sense-clk2) — content-addressed; specHashes.test.ts records the move. The reply tick is removed: the step `tick`
   and the junction `clock` with its outlet (`clock.moves.advance`). The session's round worth
   (`core:query/round-worth@1`) lets a pipeline move time as it likes; the app's boot pass drops stored values at
   those keys.` Fix any other comment in the file that lists "the tick" in the reply's tail (about 1245). Remove
   imports that become unused.
5. **`core-catalog/src/genres/story/reckoning.ts`** — pass `duties: { time: false }` with a comment: *Move the clock*
   ships off (owner 2026-11-11: one default owner moves the clock; Story's is the round tick); a session may switch
   it on, and then the routine's judgment moves the clock too.
6. **The keeper respects the round worth** — `core-catalog/src/shared/reckoning.ts` and `genres/lair/keeper.ts`:
   - Add an internal flag to `ReckonTerms` (preferred) or `ReckoningRoutineTerms`: `ownsTheClock?: boolean`, doc:
     the routine is its genre's clock owner — when its judgment names no move for the round, the round is worth the
     session's round worth. Story leaves it unset; the Lair keeper's terms set `ownsTheClock: true`.
   - In `STORY_RECKON_SCRIPT` (about 494–530) add one output, `clockUnnamed: move && time !== "off" ? null : true`
     (true when the routine names no move this round, whatever its mode: Full's move and Review's held proposal
     both count as named). Add it to the `Reckoned` interface and to the script's docblock list.
   - In `reckonBranch`'s last junction, `time` (about 853), when `terms.ownsTheClock`, add a second branch
     `.when('round', { path: (v: Reckoned) => v.clockUnnamed, truthy: true }, …)` that holds exactly the round
     tick's tail: query `worth` (`C.roundWorth.v1({ scope: $.input.sessionScope })`) → task `step`
     (`C.clockStep.v1({ step: <worth>.step, params: slot.params() })`) → junction `clock` on `moves` → query
     `present` (`C.castPresences.v1({ scope: $.input.sessionScope })`) → junction `clocked` on `present.at` →
     outlet `advance` (`C.advanceStoryClock.v1({ by, unit, cause: 'tick', onRefusal: 'skip', params:
     slot.params() })`). No `expose` on any of these nodes. Reference nodes by the full paths the builder needs
     (see how the existing `moves` branch reads `$.reckon.on.time.moves.decided.by`). A shared helper exported from
     `roundTick.ts` is welcome if the builder's types allow it; otherwise write the nodes out.
   - Keeper's docblock: replace the "**it moves no clock** (`time` off)…" bullet with: it judges no time (`time`
     off: lane F ★3, no model-driven time in the Lair) but **owns the clock** (owner 2026-11-11): each round it
     runs, the clock moves by the session's round worth, at once whatever the routine's mode (a fixed step, code's,
     not the model's; it leaves its line and goes back with its message like the round tick's); when *Move the
     clock* is switched on and the routine names a move, that move is the round's instead. Its spec version stays
     (edited in place; the app pins the hash).
7. **`core-catalog/src/seed/presets.ts`** — Story Minimal's `description` becomes `"Just the story: one model call a
   turn. The clock moves on a few minutes each round; nothing else changes unless you change it."`, and its docblock
   (about 45–53) stops saying nothing changes. Nothing else in the file.
8. **Comments only** in `contracts/src/tasks.ts` (`clockStep`, about 4845–4925) and `contracts/src/outlets.ts` (the
   `cause` doc that says "`'tick'` — a reply's fixed tick"): no longer name the reply tick or the round tick's exposed
   setting. `clock-step@1`: *Time passes…* hands it the press's step; the round tick and the Lair's keeper hand it
   the round worth's `step`; its own **By**/**Unit** answer when nothing is handed. Its `unless` in-port: nothing in
   core wires it since 2026-11-11; a pipeline that re-drives a row wires it so a regenerate never moves the clock
   twice. `cause` `'tick'`: a fixed step — a round's. Do not change any declared shape.
9. **SDK guide** `guides/time.md`: intro "when a reply takes a tick" → "when a round ends"; add a 🚧 section **How long
   a round is worth**: the field (`ROUND_WORTH_FIELD` under `ROUND_WORTH_KEY` in a genre's `fields`, label, default
   5, 0 off, owner-set), the read (`core:query/round-worth@1`, ports, 0 when not opted in or off), a short `ts
   nocheck` example wiring `step` into `clock-step@1` and gating on `castPresences`' `at` so a story with no clock is
   never started, `cause: 'tick'`; that Story's round tick and the Lair's keeper are core's two readers and the
   Dungeon Crawler names its own minutes. Then grep `guides/`, `INTEGRATING.md`, `core-catalog/README.md`,
   `contracts/README.md` for "reply tick", "Each reply advances", "round-tick", "Each round advances" and make them
   true (comments/docs only).
10. **SDK tests** in `/home/jody/github/serene-pub-sdk/sdk-tests/` (run there with `npx tsx --test <file>`; they read
    `dist`, so build first — see Build):
    - `coreGenreDefaults.test.ts`: Story registers the round tick with no values; the Lair and the Dungeon Crawler
      do not.
    - NEW `coreClockOwners.test.ts` (goal 6, "no default double move"): for every core preset of Story, the Lair
      and the Dungeon Crawler (`corePresetInputs` / `corePresets`, `effectiveRegistrations` as `seed/presets.ts`
      uses), list the effective registrations that move the clock with nobody pressing anything, on by default:
      not an action, not on `core:event/rest-taken@1`, mode not `off`, a pipeline holding a
      `core:outlet/advance-story-clock@1` node — and a reckoning routine counts only when its `duties` default has
      `time` on or its graph holds a `core:query/round-worth@1` node. Expected: each Story preset →
      `['core:spec/round-tick']`; `lair-rules` and `lair-rules-and-dice` → `['core:spec/lair-keeper']`;
      `lair-words-only` → `[]` with a comment naming the open ★ (its keeper is Off; owner to rule);
      `dungeon-crawler-default` → its reply spec only. Also assert: `core:spec/story-respond` holds no
      `advance-story-clock` node and no `tick` node; Story's reckoning's `duties` default `time` is false; the Lair
      keeper's graph holds `core:query/round-worth@1` and Story's reckoning's does not; the round tick's `tick`
      step reads `worth`'s `step`; `ROUND_WORTH_FIELD` is an integer, min 0, default 5.
    - `coreCatalog.test.ts`: re-pin the announcement digest **only** with a dated comment naming lane
      `sense-clk2` (as the file's other re-pins do); report the old and new digest and every count you moved.
    - `surface.test.ts`, `deriveDontSpell.test.ts`: run; new exports must be tagged as the others are. **Known red
      you do not touch:** `deriveDontSpell`'s `speakMessage.ts` and `turnOrder.ts` lines, `surface.test.ts`'s three
      untagged exports.
    - Also run `contract.test.ts`, `catalogueParity.test.ts`, `catalogueVocabulary.test.ts` and fix what this
      change broke (only that).

## Files owned

SDK: `contracts/src/queries.ts`, `contracts/src/index.ts` (export line only, if needed), comments in
`contracts/src/tasks.ts` and `contracts/src/outlets.ts`, `core-catalog/src/shared/roundTick.ts`,
`core-catalog/src/shared/reckoning.ts`, `core-catalog/src/genres/defaults.ts`, `core-catalog/src/genres/story/respond.ts`,
`core-catalog/src/genres/story/reckoning.ts`, `core-catalog/src/genres/lair/keeper.ts`,
`core-catalog/src/seed/presets.ts` (Minimal's description and docblock only), `core-catalog/src/index.ts` (export
lines only), `guides/time.md` and the doc lines task 9 finds, the sdk-tests named above.

## Files readable

Anything. Useful: `core-catalog/src/genres/dungeon-crawler/story.ts` ~1445–1485 (the DC's clock move, for the
test), `sdk/src/registrations.ts`, `sdk/src/announce.ts` (`PresetInput`), `contracts/src/inlets.ts` (`routine`,
`sessionEvent` ports).

## Out of scope

`core-catalog/src/registry/*` (shared; queued by the supervisor), the app repo, a new clock `cause` value (stays
`'tick'`), the Dungeon Crawler's own clock, scenes, `writes` keys, migrations, any UI.

## Stop and ask when

A new name beyond `roundWorth` / `ROUND_WORTH_KEY` / `ROUND_WORTH_FIELD` / `core:query/round-worth@1` /
`ownsTheClock` / `clockUnnamed` seems needed; a published name other than the reply tick's nodes would go; the
builder cannot express task 6 without a new node type or port. Report it instead of building around it.

## Build

`npm run sdk:build` from the **app** root (`/home/jody/github/serene-pub`), at most twice (once when the code is in,
once after fixes). Before each: `pgrep -af "vite dev"`; if a serene-pub dev server is up, don't build; report
"blocked on your dev server". Report how many builds you ran.

## Done means

The SDK tests above pass except the known red; `npx prettier --check` on every file you changed; a report listing
changed files, tests and results (counts), the digest move, anything you decided, and **Noticed, not done**.
Report path: return the report as your final message.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  It is a **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** Line numbers are approximate.
- NOMENCLATURE R3: qualify, never the bare noun (`round worth`, never bare `worth` in prose). Mark new vocabulary 🚧.
