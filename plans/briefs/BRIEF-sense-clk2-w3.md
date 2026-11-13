# BRIEF — `sense-clk2-w3` — App tests: one default clock owner per core genre, the reply tick gone

You are a `lane-worker` for lane `sense-clk2`. App repo: `/home/jody/github/serene-pub`. SDK (read only):
`/home/jody/github/serene-pub-sdk` — already built (`dist` is current); do **not** build. Use absolute paths.
Another session is editing this repo (visual-novel layout: dialogue-box widget, `show-line` request, portraits
`speaking`): do not touch its files. A docs worker runs beside you; docs and `NOMENCLATURE.md` are not yours.

## What changed (already built — read the code, it is the truth)

Owner, 2026-11-11: "In core genres we should have one default owner that moves the clock." "Story should be round.
Lair and dungeon I think need more management so maybe the routine?" On the per-reply tick: "Remove it."

- **Round worth** 🚧: a genre field, key `roundWorth` (`ROUND_WORTH_KEY`, `ROUND_WORTH_FIELD` in
  `core-catalog/src/shared/roundTick.ts`): story minutes a round is worth, default 5, 0 = off. **Not yet placed in
  any genre's `fields`** (that two-line edit to `core-catalog/src/registry/genres.ts` is queued for the lead; you
  must not make it). Until it lands, every session's round worth reads 0.
- **`core:query/round-worth@1`** (contracts `roundWorth`; in `scope`; out `main` `{ minutes, step }`, `minutes`,
  `step` `{ by, unit: 'minutes' }`). Host binding: `src/lib/server/pipelines/runtime/roundWorth.ts`
  (`roundWorthBindings`, `roundWorthOf`), spread into `runtime/bindings.ts`.
- **Story**: `core:spec/round-tick` (`shared/roundTick.ts`) now reads the round worth (`worth` query → `tick`
  clock-step fed `worth.step` → `clock` → `present` → `clocked` → `advance`, `cause: 'tick'`); nothing exposed. Story's
  *Note what changed* (`core:spec/story-reckoning`) ships its `duties.time` (*Move the clock*) **off**.
- **The reply tick is gone** from `core:spec/story-respond`: no `tick` node, no `clock` junction, no
  `clock.moves.advance`. Boot pass `boot/replyTickDrop.ts` drops stored values at those keys (it has its own test).
- **The Lair**: the round tick is no longer registered. The keeper (`core:spec/lair-keeper`, `shared/reckoning.ts`
  `ownsTheClock`) owns the clock: its `time` junction gained a `round` branch, `reckon.on.time.round.*` (`worth` →
  `step` → `clock` → `present` → `clocked` → `advance`, `cause: 'tick'`), taken when the reckon script's
  `clockUnnamed` is true (the routine named no move this round; with `time` off, always). The keeper ships
  `time: false` and runs at **Review** in *Rules* and *The rules decide*; *Words only* ships it **Off** (so nothing
  moves the clock there by default: an open ★ for the owner — do not "fix" it).
- **The Dungeon Crawler**: unchanged; its turn (`core:spec/dungeon-crawler-respond`) moves the clock by the minutes
  the Planner's plan names (`genres/dungeon-crawler/story.ts` ~1445–1485).

## Tasks

1. **Pins.** Run `src/lib/server/pipelines/boot/specHashes.test.ts`, `boot/registryHashes.test.ts`,
   `boot/declaredReads.test.ts`, `boot/paramsSlotWiring.test.ts`, `boot/shippedNames.int.test.ts`,
   `boot/registrySync.int.test.ts`. Re-pin only what this change moved (expected: `story-respond`, `round-tick`,
   `story-reckoning`, `lair-keeper`, and the new `core:query/round-worth@1` definition), each with a dated note
   naming lane `sense-clk2` as the file's other notes do. Report every pin: old → new. A pin that moved for a reason
   that is not this change: do not re-pin it; report it.
2. **`src/lib/server/pipelines/routines/roundTick.int.test.ts`** — bring it to the new design. Before the genre
   field is placed, control the round worth by mocking the binding module:
   `vi.mock("$lib/server/pipelines/runtime/roundWorth", async (orig) => ({ ...(await orig()), roundWorthBindings: () =>
   ({ "core:query/round-worth@1": reads(async () => ok({ main: w, minutes: w.minutes, step: w.step }), { ports:
   ["scope"] }) }) }))` with `w` from a `vi.hoisted` holder the cases set (5, 0). Cases: a Story session with a
   clock moves 5 minutes once when a round ends, with a line under the closing message, cause `tick`; worth 0 moves
   nothing and writes no line; no clock → nothing moves, no clock starts, no line; deleting the closing message
   takes the move back; **only Story registers the round tick** (the Lair, the Guide, Chat and the Dungeon Crawler
   do not); a second boot changes nothing. Drop the case that read the old exposed **By** setting. Header docblock
   updated.
3. NEW **`src/lib/server/pipelines/routines/clockOwners.int.test.ts`** (goal 6, "no default double move"), with the
   same mock: real turns with a scripted model (copy `roundTick.int.test.ts`'s `FakeAdapter` set-up; return the
   reckoning's JSON — `{"changes":[],"clock":[{"by":30,"unit":"minutes"}],"place":[]}` — when the call is the
   reckoning's/keeper's, prose otherwise; find how `routines/routines.int.test.ts` lets routines run). Cases:
   - **Story, Living (shipped defaults), routines on, a clock set:** one round ending moves the clock **exactly
     once**, 5 minutes, cause `tick` — the reckoning's named 30 minutes is not applied (its *Move the clock* is off).
   - **The Lair, Rules (shipped defaults: keeper at Review), a clock set:** one round ending moves the clock exactly
     once, 5 minutes, cause `tick`, applied at once (not held for review); no `core:spec/round-tick` run exists.
   - **The Lair with worth 0:** the round moves nothing and writes no line.
   - **The Lair with the keeper's `time` duty switched on at Full:** the round moves exactly once, by the named 30
     minutes, cause `keeper`; the round worth's move does not happen.
   - **The Dungeon Crawler:** if an existing int test already plays a DC round with a scripted Planner and you can
     reuse its set-up in under ~150 lines, assert one round moves the clock exactly once (by the plan's minutes);
     otherwise skip the DC case and say so in your report (the SDK test `coreClockOwners.test.ts` covers it
     structurally).
   Use 60 s+ timeouts for anything that opens a DB inside an `it`; temp-dir prefix `serene-pub-vitest-clock-owners-`.
4. NEW **`src/lib/server/pipelines/routines/roundWorth.genres.int.test.ts`** — the real chain, **no mock**: a fresh
   Story session and a fresh Lair session read `minutes: 5` from `core:query/round-worth@1` (call the binding with
   the host's real `ctx`, or run the round tick and read its receipt — your choice, say which); a session that
   stores `roundWorth: 0` reads 0; a Guide session reads 0 (not opted in). Header comment: this file goes green only
   once the lead places `ROUND_WORTH_FIELD` in Story's and the Lair's `fields` (queued Q-1). Run it and report it
   red with that reason; do not work around it.
5. **Tests the reply tick's removal broke** — fix the assertion to the new shape, nothing else:
   `src/lib/server/pipelines/runtime/receipts.int.test.ts` (~330–360: the reply's node trail ends at
   `spriteShow`; keep the "no advance-story-clock in a reply" assertion), `src/lib/server/utils/replyRoad.int.test.ts`
   (~435–450), `src/lib/server/sessions/stepSettings.int.test.ts` (it used the reply tick as its example step
   setting: switch to another exposed step setting that still exists — the sprite picker `spritePick` is one —
   keeping each case's intent).
6. **The three files the lead adjusted for the round tick's run**: `src/lib/server/sockets/sessions.enabledWhen.int.test.ts`,
   `sessions.lairCastRows.int.test.ts`, `sessions.actions.int.test.ts`. Run them. In `lairCastRows` the round-tick
   filter (~399) is now dead (the Lair registers no round tick): remove it and fix its comment. Leave the Story ones
   (the round tick still runs there) unless they fail.
7. Then grep `src` tests for `round-tick`, `"tick"`, `Each reply advances`, `Each round advances`, `lair-keeper` and
   run any other test whose expectations this change moves (e.g. registrations projection / genre defaults counts);
   fix only what this change broke, and list each.

## Files owned

The test files named in tasks 1–7 (pins, the three new/updated routine tests, the three reply-tick tests, the three
socket tests, and any test task 7 finds broken by this change — list each).

## Out of scope

Every non-test file in either repo (if production code looks wrong, report it — do not fix it), `registry/genres.ts`,
docs, `NOMENCLATURE.md`, migrations, building the SDK.

## Stop and ask when

A test can only pass by changing production code; a pin moved for a reason that is not this change; a ★ (e.g. Words
only) would need deciding.

## Tests

Run only your targeted files, in a capped scope, from `/home/jody/github/serene-pub`:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
Never pipe vitest into `head`. Int tests: 60 s timeouts. `npx prettier --check <file>` on each file you changed. Do
not start a dev server. Delete only temp dirs your own tests made.

## Done means

Every test file above passes except `roundWorth.genres.int.test.ts` (red until Q-1, with that reason); a report with
changed files, each test file's result (counts), every pin old → new, what you decided, and **Noticed, not done**.
Return the report as your final message.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  `socket.off(event)` always passes the handler. Never seed a row at a hardcoded id. It is a **session**, never a
  *chat*. Every session has a lorebook: never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** Line numbers are approximate.
