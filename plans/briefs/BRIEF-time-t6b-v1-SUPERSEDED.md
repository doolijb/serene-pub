# BRIEF — build lane `time-t6b` — "was there": an opt-in SDK helper that leaves out what a character did not witness

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §7 "Measured 2026-11-15" (measurement 1) and §8 ★5, ★6,
`plans/REPORT-time-t6a-2026-11-15.md`, `plans/REPORT-time-t7b-2026-11-15.md` (how a docs recipe was written
and tested), `../serene-pub-sdk/INTEGRATING.md` (history, scenes, seats; by section), `docs/sessions.md`
(scenes, Bench, seats), `docs/pipelines.md`, the SDK's `guides/` folder, `NOMENCLATURE.md` §1, §24, §23, §14
Knowledge (**firsthand**) and the rows for *scene*, *benched*, *seat*, *place* / cast location.
`plans/briefs/BRIEF-time-t6b-WITHDRAWN.md` is the earlier proposal: **its rule is replaced** by the rulings
below; read it only for the measurement and the narrator limit.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite"` (dev **and** preview; the Svelte language server's esbuild is
not one) and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`. If a server or a run is up, don't build;
report 'blocked on your dev server'.

## Why (measured 2026-11-15)

A secret told in a scene the speaking character was not in, then that character asked about it on its own turn,
three local models, 20 replies each: with the earlier conversation left in, it leaked in 9–16 of 20; with a note
saying the character was not there, 8–20; with the conversation **left out**, about 0.

## Owner rulings (quote them in worker briefs)

- 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a character does not
  know." ★6: "where one model voices everyone, nothing can be left out; the plan offers per-character knowledge
  only where a character has its own turn."
- 2026-11-15, what decides presence: "I recommend a mixture of per scene, per location (when available) in core.
  Can add additional formulas for querying different methods in the SDK in the docs."
- 2026-11-15, on "seated and not benched": "unreliable, if someone is benched i.e. user doesn't want them to
  respond automatically but still considers them in scene". **Bench plays no part in presence.**
- 2026-11-15, the rule: "we can assume if a cast member responded at all within a scene's messages that they
  were present. We can filter and qualify further depending on their location. I.e. they responded and then left
  the room."
- 2026-11-15, where it lives: "build what we want best practice into our SDK helper (all features are opt in on
  invoke). But the other method that's valid but aren't using should be possible via custom querying and logic,
  so we should provide a formula among our example recipes in the docs."
- 2026-11-15, opt-in: "pipeline/node".
- 2026-11-15: "add a test too to make sure any doc formulas we have are still valid, this will also help once SDK
  hits 1.0 to make sure it doesn't break."
- Standing: P1 (off until invoked; every automatic action shows its cause); P2; P5; "SDK should feel like
  Drizzle"; "Genres expect, never lock"; "0.6 is in users' hands"; no position / location-detail stat in core
  (2026-11-14): use only the location core or a genre already tracks.

## The rule to build

For a reply spoken by **one cast member on its own turn**, when the pipeline invokes the helper:

- A **scene** counts as witnessed by a cast member when that member **spoke at least once in it** (a message of
  the scene carries it as speaker). The speaker's own lines are always kept.
- **Where a location is tracked** for cast members, the scene is qualified further: messages written while the
  member was elsewhere are left out (it spoke, then left the room: what was said after it left is not
  witnessed; if it arrived late, what was said before is not). What "tracked" means is inventory item 3; with no
  location data the scene rule stands alone.
- Messages outside any scene, and a scene still open in which the member has not spoken yet: say what the
  inventory finds sensible and **propose** it (★); the lead's starting point: the scene the reply is being
  written in is always witnessed by its speaker; messages in no scene are kept.
- Scene summaries follow their scene: kept when the scene is witnessed, else left out.
- A narrator's turn, an envoy's, and any step writing for several characters read everything (★6); stated in
  the docs.
- Shown, never hidden: the run's receipt / prompt preview says how many messages were left out and why
  (🚧 *12 messages left out: ‹name› was not there*).

## Build

### A. Inventory first (supervisor, read-only) — report with file:line

1. How a pipeline's reply step gets its conversation history: the SDK-declared node(s) and their params, the
   host function that reads the window, how scenes and scene summaries enter it, and how private messages and
   channel lanes already narrow it (this filter composes with them, never widens).
2. Scenes: how a message belongs to a scene (column, table), open vs closed scenes, sessions with no scenes,
   whether a scene carries a cast list of its own. Speaker identity on a message
   (`session_messages.cast_member_id`), a person's character lines, narrator / envoy lines.
3. Location: what core or a shipped genre records about where a cast member is (a lorebook cast presence / place
   tie, a stat, a scene's place), **whether its history over the session's messages can be read** (a per-turn
   record, dated versions, a stamp on the message), and what is lost on settle. If only the current location is
   knowable, say so: then "left the room" can only be answered from the moment something starts recording it.
4. The stored fact from `time-t6a` (`firsthand_cast_member_ids`, `messages/firsthand.ts`): it records "seated
   and not benched", which the owner has ruled unreliable. Report what the new rule needs from it: nothing (the
   scene rule is derivable from speakers), or a **changed meaning** (e.g. who was at the speaker's place when the
   message was written, bench ignored), with the cost. **Do not change or drop the column, its writer or
   migration 0165 in this lane without a ruling: propose (★) keep-and-redefine, or drop with a forward
   migration, with the trade-off.**
5. What a pipeline author can already query about messages, scenes and locations through the SDK (for the
   recipe of the alternative method), and where the SDK's helper for history lives so the opt-in can be one
   option on invoke.
6. Every recipe / formula in `docs/` and the SDK's `guides/` that contains code a pipeline or script author is
   told to use, and which of them a test executes today (the `time-t7b` recipe test, `guideSnippets.test.ts`).

### B. The SDK helper (additive, `@experimental`)

One opt-in on the history helper / node the reply step already uses (inventory 1, 5), by NOMENCLATURE §24 and
§14 (the word is **firsthand**; lead's proposal 🚧 `firsthandOnly: true`, or an option naming the member). Off
unless invoked; invoked on a turn that is not one cast member's own, it does nothing and says so in the receipt.
No setting. Which shipped pipelines invoke it: **propose (★), build none** beyond what a test needs.

### C. The host half

One module owns the decision (P2), pure where it can be (scenes, speakers, locations in → kept message ids and a
count with the reason out), no query per message. The receipt line.

### D. Recipes and the recipes test

- A docs recipe (the SDK's guides, linked from `docs/pipelines.md`): the alternative method the helper does not
  use (for example presence by who was seated when each message was written, or by a genre's own location stat),
  written as custom querying and logic an author can paste.
- **One test that executes every docs recipe** found in inventory 6 plus the new one, so a recipe that stops
  working fails the suite. Follow the pattern of
  `src/lib/server/pipelines/scripts/livingRecallRecipe.int.test.ts` (it runs the guide's exact fence); make the
  list of recipes explicit and fail when a guide gains a recipe fence the test does not know.

### E. Docs and names

`docs/sessions.md` and `docs/pipelines.md` (what the helper does, one example, the narrator limit, that Bench
does not make a character absent), the SDK guide, `NOMENCLATURE.md` (§14, the new names, §25). No other
product's name.

## Out of scope

Knowledge ties, the not-common-knowledge mark, cast Memory; a note in the prompt saying what a character does
not know (ruled out); backfilling; a new location or position stat; a session setting; changing Bench.

## Stop and ask when

CLAUDE.md §Decisions applies; location history cannot be read and the "left the room" half would need a new
stored fact or migration; the history node has no place for an option without changing a published name; the
rule would hide a message from a person (it only shapes one character's prompt); the `time-t6a` column would
have to change.

## Done means

- `npm run sdk:build` from the app root (after the checks above), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t6b-sdk.log 2>&1"`:
  only the four known failures.
- App tests (targeted, each in that capped form with `npx vitest run --maxWorkers=3 <paths>`, strictly one run
  at a time): spoke in the scene → sees it; never spoke → scene and its summary left out; own lines kept; the
  current scene kept; a benched member who spoke still sees the scene; with location data, lines after it left
  and before it arrived are left out; no location data → scene rule alone; narrator turn reads all; not invoked →
  byte-identical prompt; composes with private messages and lanes; the receipt line; the recipes test.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t6b-<date>.md`): the inventory with
file:line; the rule as built; what the `time-t6a` column should become (★); every new name and sentence;
changed files in both repos; when you ran `sdk:build`; tests with results; open ★; **Noticed, not done**. Under
about 900 words.

## NOT READY TO BUILD — corrections after the cold review (2026-11-15), and what waits on the owner

**Replaced rulings (say so in worker briefs):** plan §8 ★5 ("Presence per message needs a new stored fact …")
and §5.4 ("Presence is per message, never per scene"), accepted 2026-11-14, are **replaced** by the owner's
2026-11-15 words ("a mixture of per scene, per location (when available)"; "if a cast member responded at all
within a scene's messages … they were present"). Known limits to state in the docs and the report: a scene that
never closes is witnessed whole by anyone who spoke once in it (unless location narrows it); sessions whose
genre runs no scenes get nothing from the filter.

1. **Two nodes, one host module.** Conversation history is `session-history@1`
   (`../serene-pub-sdk/contracts/src/queries.ts` ~212–262; binding `pipelines/runtime/bindings.ts` ~2473); scene
   summaries come from the separate `core:query/earlier-scenes@1` (`queries.ts` ~1388–1413; Story wires it at
   `core-catalog/src/genres/story/respond.ts` ~584–591, rendered ~1219). The opt-in goes on **both**, each with
   a speaker in-port (the reply knows the speaker as `$.input.characterId`, respond.ts ~488; messages carry
   `cast_member_id`: one mapping, in the host module); `validate()` warns when one is set without the other.
   "Spoke in the scene" is **one grouped query over each scene's whole range**, never judged from the history
   window (the window reads only the newest rows, ~2× the budget, `bindings.ts` ~2540). History entries compiled
   from an unwitnessed scene (`scenes.history_entry_id`, the `historyEntries` lane, respond.ts ~629) are **not**
   filtered here: that is T6c; say so in the docs.
2. **Location history is readable today; no stored stamp is needed for it.** A cast member's location over the
   session's messages is in `attribute_values.valid_from_message_id` (`db/schema.ts` ~10593, the `session_cast`
   layer), read on the messages clock by `stat-trail@1` (`state/statTrail.ts` ~8–16). Only the Dungeon Crawler
   puts a location on cast members (`core-catalog/src/registry/hostState.ts` ~58,
   `dungeon-crawler/shape.ts` ~50), and its story turn is its Narrator's (reads all, ★6); the default ruleset
   and Story keep one Location on the world / party. So **no shipped reply can use the location half yet**:
   build it against a made-up fixture and say so. The comparison (★, lead's proposal until ruled): a message is
   witnessed when the member's location in force at that message equals the message speaker's location in force
   at it; a line whose speaker has no location stays under the scene rule; references compare by `entryId`,
   words trimmed and case-folded. How far hearing carries between places is a separate discussion with the
   owner (a per-place hearing switch): **not in this lane**.
3. **The word and the charter (R1, P6), before code.** `NOMENCLATURE.md` ~955 defines **firsthand** as the
   `time-t6a` column ("every seat in play (live, not benched)"), which the owner ruled unreliable. A scene also
   has a stored cast (everyone seated, plus who spoke, plus names spoken to: `utils/sceneCastProposal.ts`
   ~26–37, ~533–541; `scenes/liveScenes.ts` ~953–957), which is a third notion. Waiting on the owner: (a) the
   column: lead recommends **dropping it** (forward migration; the writer and its SDK host field go) since the
   scene rule is derivable from speakers and location history is already message-anchored; then §14
   **firsthand** is redefined to the new rule and the option keeps the word; (b) whether a person's edit of a
   scene's cast should count as presence (it would be the member-facing way to correct the filter, P1 "how to
   undo"); if not, the docs say plainly that a scene's cast is not who witnessed it.
4. **Recipes test, defined.** Recipe fences are marked explicitly (🚧 a fence info string like `js recipe <id>`);
   one app test runs every marked fence from an explicit list (today: `guides/time.md`'s and this lane's) and
   fails on a marker it does not know. `ts` fences and `playground` fences stay covered by the SDK's
   `sdk-tests/guideSnippets.test.ts` and `guides.test.ts`; say so. The app's `docs/*.md` hold no code recipes.
5. Done list gains: Back, swipe and hidden lines (`is_hidden`, `schema.ts` ~3160–3171) do not count as "spoke";
   a member who spoke only before the history window still witnesses the scene.
