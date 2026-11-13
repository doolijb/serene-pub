# BRIEF — lane `sense-clk2` — one default owner moves the clock in each core genre

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `plans/briefs/BRIEF-sense-clk.md`
(the first clock lane; its **Verbatim rules** bind you and your workers word for word),
`plans/REPORT-sense-clk-2026-11-11.md` (what was built; CLK-1…6), plan §2.11 and §5.8 in
`plans/PLAN-sensible-engine-2026-11-11.md`, `docs/lorebook-time.md`, `docs/genre-story.md`, `docs/genre-lair.md`,
`docs/genre-dungeon-crawler.md`, `../serene-pub-sdk/INTEGRATING.md` (the steps on ports and session values),
NOMENCLATURE §1, §24, §25, and CLAUDE.md P1, P2, P3 and "0.6 is in users' hands".

## The owner's rulings (2026-11-11, verbatim)

- "In core genres we should have one default owner that moves the clock."
- "Story should be round. Lair and dungeon I think need more management so maybe the routine? Maybe they can share
  the same session setting, sdk provides an API to grab the setting, if opted in and pipelines can act on it/choose
  to respect the interval unless you have a different suggestion"
- On Story's per-reply tick (*Each reply advances the clock by…*, published at pr-7): "Remove it. The setting
  mentioned allows pipelines to handle time arbitrarily"
- Earlier the same day: "every 'round' moved the clock forward 5 minutes automatically, with a simple setting in the
  sessions that opt in to the clock. Simple setting in the session would suffice. Genres like guide that use real
  time would be an exception."

## Goal

1. **Inventory first, in the report.** For Story, the Lair and the Dungeon Crawler, per shipped preset: everything
   that can move the story clock without a person pressing something, and whether it is on by default. Known:
   `core:spec/round-tick` (Story and Lair, By 5), Story's reply tick (`core-catalog/src/genres/story/respond.ts`),
   Story's *Note what changed* → *Move the clock*, the Lair's *Keep the books*, the Dungeon Crawler's round minutes.
2. **One session setting, one read.** The session holds one value: how many story minutes a round is worth, with
   off as a value. Find the least-new home before naming anything: today it is the round tick's own exposed
   parameter **By** (`expose: { session: true }`); a genre-declared session field is the other existing mechanism.
   Then give pipelines **one declared SDK read** of it (the owner: "sdk provides an API to grab the setting"), so any
   pipeline, core's or a plugin's, can act on the interval or ignore it. Name both by §24, mark them 🚧, record them
   in §25. One value, one writer (P2). The label says minutes (CLK-1).
3. **Story: the round tick is the owner.** It reads the setting. *Note what changed*'s *Move the clock* ships off in
   every Story preset and stays available as a switch. Reword Minimal's description if it still says nothing changes
   (CLK-4).
4. **The reply tick is removed** from core's Story: the step, its exposed setting, its docs. Stored sessions,
   presets and registrations that hold its setting get a forward boot pass (never a migration seeding rows), with a
   test that a second boot changes nothing. List every published name that goes, in the report.
5. **The Lair and the Dungeon Crawler: the routine is the owner.** The round tick is not registered there (it was
   added today and never shipped). The owning routine is handed the interval through the read of goal 2 and
   respects it: when the routine's own judgment names no move for the round, the round is worth the interval; when
   it names one, that is the move. If the Dungeon Crawler's round minutes already come from its rules, that is its
   owner: leave it, and say so.
6. **No default double move.** A test per core genre: with shipped defaults, one round ending moves the clock
   exactly once. With the setting off, the round tick moves nothing.
7. **Docs and ledgers** in the same change: the three genre docs, `docs/lorebook-time.md`, `docs/sessions.md` if it
   names the setting, the SDK guide that lists declared reads, NOMENCLATURE §25.

## Files owned

In `../serene-pub-sdk/`: `core-catalog/src/shared/roundTick.ts`, `core-catalog/src/genres/defaults.ts`,
`core-catalog/src/genres/story/respond.ts` and the Story, Lair and Dungeon Crawler routine specs (the clock switch
and its default only), `contracts/src/` for the one new read, the guides and tests and pins these move.
In the app: the host side of the new read under `src/lib/server/pipelines/runtime/` (the smallest addition), the
boot pass beside the existing ones, their tests, and the three test files the lead adjusted for the round tick's run
(`sockets/sessions.enabledWhen.int.test.ts`, `sessions.lairCastRows.int.test.ts`, `sessions.actions.int.test.ts`).
The docs and NOMENCLATURE lines of goal 7.

## Out of scope

A new clock cause value (CLK-2 stays `'tick'`); CLK-5 (a lorebook whose present is only its newest dated entry);
the Guide and Chat; any UI beyond what the declaration derives; scenes; `writes` keys; migrations.

## Stop and ask when

A shipped Lair or Dungeon Crawler preset runs **without** its routine, so that goal 5 would leave its clock with no
mover (report the preset matrix and your recommendation, build the rest); the setting cannot have one home without a
second writer; removing the reply tick would remove a published name other than its own step and setting; a
migration would be needed.

## Done means

Goal 6's tests pass for the three genres; the boot pass test passes twice; `npx tsc --noEmit -p .` with
`NODE_OPTIONS=--max-old-space-size=10240` is clean; `npm run sdk:build` once at the end after the `pgrep` check,
then `sdk-tests/coreCatalog.test.ts`, `deriveDontSpell.test.ts` and `surface.test.ts`: re-pin a digest only with a
dated note naming this lane, and report every count you moved. Known red you do not touch: `deriveDontSpell`'s
`speakMessage.ts` and `turnOrder.ts` lines, `surface.test.ts`'s three untagged exports.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-sense-clk2-2026-11-11.md`):
the inventory matrix, the names chosen, every published name removed, changed files in each repo, tests and results,
open ★, provisional copy, **Noticed, not done**.
