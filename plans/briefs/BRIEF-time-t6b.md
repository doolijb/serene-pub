# BRIEF (v2) — build lane `time-t6b` — the per-character filter: a character on its own turn is not shown what it did not witness

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-living-world-preset-2026-11-15.md` **§9 only** (the design this filter serves; §1–§8 are superseded),
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §7 "Measured 2026-11-15" (measurement 1),
`plans/REPORT-time-t7b-2026-11-15.md` (how a docs recipe is written and tested),
`../serene-pub-sdk/INTEGRATING.md` (history, scenes, state; by section), `docs/sessions.md` (scenes, Bench),
`docs/pipelines.md`, `NOMENCLATURE.md` §1, §24, §23, §14 Knowledge. `BRIEF-time-t6b-v1-SUPERSEDED.md` holds the
two cold reviews' file:line findings in its last section: use them as the inventory's starting point, verify
them, and ignore its rule.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`; **never `prettier --write`** (a worker lost time rebuilding files after one today).

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite"` (dev **and** preview; the Svelte language server's esbuild is
not one) and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`. If a server or a run is up, don't build;
report 'blocked on your dev server'.

## Why (measured 2026-11-15)

A secret told while the speaking character was away, then that character asked about it on its own turn, three
local models, 20 replies each: earlier conversation left in → leaked in 9–16 of 20; a note saying "was not
there" → 8–20; the conversation **left out** → about 0.

## Owner rulings (quote them in worker briefs)

- 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a character does not
  know." ★6: "where one model voices everyone, nothing can be left out" (a narrator or envoy reads everything).
- 2026-11-15: "a mixture of per scene, per location (when available)"; "we can assume if a cast member responded
  at all within a scene's messages that they were present. We can filter and qualify further depending on their
  location. I.e. they responded and then left the room."; on Bench: "unreliable … user doesn't want them to
  respond automatically but still considers them in scene" (**Bench plays no part**); "Not so much a seperate
  history, but a per character filter on what gets put into their context."
- 2026-11-15, where it lives: "build what we want best practice into our SDK helper (all features are opt in on
  invoke) … the other method … should be possible via custom querying and logic, so we should provide a formula
  among our example recipes in the docs"; opt-in: "pipeline/node"; "add a test too to make sure any doc formulas
  we have are still valid".
- These replace plan §8 ★5 and §5.4 ("Presence is per message, never per scene", 2026-11-14).
- Standing: P1 (off until invoked; the cause shown); P2; P5; no position / location-detail stat in core.

## The rule

For a reply spoken by **one cast member on its own turn**, when the pipeline invokes the option:

1. **By scene:** a scene is witnessed by a member that **spoke at least once in it** (hidden, rewound and
   swiped-away lines do not count). Its own lines are always kept. Messages in no scene are kept. The scene the
   reply is being written in is witnessed by its speaker.
2. **By place, when the invoker names a cast-level state slot** (for example the location slot): a message is
   witnessed when the member's value of that slot **in force at that message** equals the message speaker's
   value in force at it (references compare by `entryId`; words trimmed and case-folded; history from
   `attribute_values.valid_from_message_id` as `state/statTrail.ts` reads it). A message whose speaker has no
   value falls under rule 1. With a slot named, rule 2 decides wherever both values exist.
3. **Scene summaries** (the separate `core:query/earlier-scenes@1` node): kept for a member that witnessed the
   scene's last message or more than half of its messages; else left out.
4. A narrator's turn, an envoy's, and a step writing for several characters read everything (★6): the option
   does nothing there and the receipt says so.
5. Shown, never hidden: the run's receipt / prompt preview says how many messages and summaries were left out
   and why (🚧 *12 messages left out: ‹name› was not there*).

Known limits, stated in the docs: a scene that never closes is witnessed whole by anyone who spoke once in it
unless a place slot narrows it; a genre that runs no scenes gets rule 2 only; History entries compiled from
scenes are not filtered yet (the next lane); a summary is never cut in two.

## Build

### A. Inventory (supervisor, read-only; file:line in the report)

Verify the superseded brief's findings: `session-history@1` and `earlier-scenes@1` (params, ports, bindings;
`contracts/src/queries.ts`, `pipelines/runtime/bindings.ts` ~2473–2540), the speaker (`$.input.characterId` →
`cast_member_id`), how a message belongs to a scene and what "hidden" is, the stat trail's read on the messages
clock, private messages and channel lanes (the filter composes with them and never widens), every recipe fence
in the SDK's `guides/` and which test runs it.

### B. SDK (additive, `@experimental`; list every name)

One option on **both** nodes, with a speaker in-port: lead's proposal 🚧 `firsthandFor` (the member whose
viewpoint filters; unset = no filter) and 🚧 `firsthandBy` (optional: the cast-level slot for rule 2). The word
is §14's **firsthand**: redefine its row to this rule (the per-message column of lane `time-t6a` keeps existing
and is no longer what the word means; say so in the row; **do not touch the column, its writer or migration
0165**). `validate()` warns when one node carries the option and the other does not. No shipped pipeline is
changed to invoke it.

### C. Host

One module owns the decision (P2): pure core (scenes, speakers, slot trail in → kept message ids, kept scene ids,
counts and the reason out) plus one loader. "Spoke in the scene" is one grouped query over each scene's whole
range, never judged from the history window. No query per message. The receipt line.

### D. Recipes and their test

- A recipe in the SDK's guides (linked from `docs/pipelines.md`) for the method the option does not use: presence
  by a genre's own rule through custom querying (for example by who was seated when each message was written,
  reading the stored per-message set), as code an author can paste.
- Mark recipe fences explicitly (🚧 fence info `js recipe <id>`). **One app test runs every marked fence** from
  an explicit list (today `guides/time.md`'s and this one) and fails on a marker it does not know; `ts` and
  `playground` fences stay covered by `sdk-tests/guideSnippets.test.ts` and `guides.test.ts` (say so in the
  guide's contributor note if one exists).

### E. Docs and names

`docs/sessions.md`, `docs/pipelines.md` (what the option does, one example, the limits above, that Bench does not
make a character absent, the narrator limit), the SDK guide, `NOMENCLATURE.md` (§14 **firsthand** redefined, the
new names, §25, and that plan ★5 / §5.4 are replaced). No other product's name.

## Files owned

SDK: `contracts/src/queries.ts` (the two nodes' option and port), the validation warning, the guide page(s), SDK
tests. App: a new module under `src/lib/server/sessions/` or `src/lib/server/messages/` for the decision, the two
bindings in `pipelines/runtime/bindings.ts` (only to call it), the receipt, the recipes test (extend or replace
`pipelines/scripts/livingRecallRecipe.int.test.ts`), tests, the two docs, `NOMENCLATURE.md`.

## Out of scope

A whereabouts value for Story, the turn pool, Messages views, the preset (later steps of the plan); History
entries; knowledge ties and the not-common-knowledge mark; a note telling the model what a character does not
know; a setting; changing Bench; the `time-t6a` column.

## Stop and ask when

CLAUDE.md §Decisions applies; an option cannot be added to a node without changing a published name; the stat
trail cannot answer "value in force at message M" for many messages in one read; the filter would hide a message
from a **person** (it only shapes one character's prompt); a migration seems needed (none is expected).

## Done means

- `npm run sdk:build` from the app root (after the checks above), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t6b-sdk.log 2>&1"`:
  only the four known failures (re-pin hashes that move on purpose, with a dated comment).
- App tests (each in that capped form with `npx vitest run --maxWorkers=3 <paths>`, strictly one run at a time):
  spoke → sees the scene; never spoke → scene and summary left out; own lines kept; current scene kept; a benched
  member who spoke still sees it; a member who spoke only before the history window still witnesses; Back / swipe
  / hidden lines do not count as spoke; with a slot: lines after it left and before it arrived are left out,
  missing values fall back to rule 1; the summary rule (last message, more than half); a narrator turn reads all;
  not invoked → byte-identical prompt; composes with channel lanes; the receipt line; statements added per reply
  (report the number); the recipes test; `src/lib/server/pipelines/boot/declaredReads.test.ts` and
  `paramsSlotWiring.test.ts` (a new param must be declared as read: `runtime/bindings.ts`).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t6b-<date>.md`): the inventory with
file:line; the rule as built; every new name and sentence; statements added per reply; changed files in both
repos; when you ran `sdk:build`; tests with results; open ★; **Noticed, not done**. Under about 900 words.
