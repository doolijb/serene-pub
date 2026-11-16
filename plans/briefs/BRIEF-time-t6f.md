# BRIEF — build lane `time-t6f` — three ruled follow-ups to the knowledge and firsthand filters

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-time-t6c2-2026-11-15.md`, `plans/REPORT-time-t6c1-2026-11-15.md`,
`plans/REPORT-time-t6b-2026-11-15.md`, `plans/PLAN-entry-time-and-lines-2026-11-14.md` §11,
`../serene-pub-sdk/INTEGRATING.md` §1p, `docs/pipelines.md`, `docs/genre-story.md`, `docs/genre-lair.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form; `npx prettier --check <file>` only, **never `prettier --write`**. Never commit.
Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own
tests made, by name. Before any `sdk:build`, check `pgrep -af "vite"` (dev and preview; the Svelte language
server's esbuild is not one) and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one is up, don't
build; report 'blocked on your dev server'. Migrations: none expected; stop if one seems needed.

## Owner rulings, 2026-11-15 (quote them in worker briefs)

- Should Story and the Lair use the knowledge filter on a character's own turn: "Yes. It should be cheap enough,
  i think."
- A pipeline-check warning when a History filter is on and its output is not connected: "Yes".
- A scene compiled into History with no messages left: "Stored cast list, when messages are outside the context
  window, we won't be querying them anyway. Scenes/history are what persist."

## Build

### A. Story and the Lair place `core:query/unknown-entries@1`

In every shipped Story and Lair spec where **one cast member speaks on its own turn** and lore passes
`core:task/eligibility@1` (inventory first: story `core-catalog/src/genres/story/respond.ts` ~997–1012; lair
`reply.ts` ~473, ~1207, and decide per spec for `roomAnswer.ts`, `fileRoom.ts`: a narrator's or keeper's step
reads everything and gets no node), place the node with `speaker` wired as the spec already knows its speaker,
and wire its `exclusions` into that eligibility beside the lore lanes'. Nothing else in the spec changes. Not the
Dungeon Crawler, Chat or Guide. No setting, no preset switch.

Must hold: with nothing marked and no *kept from* tie the assembled prompt is byte-identical to before and the
run adds one statement; the node is the same `@experimental` definition (no new SDK name); parity / golden /
registry-hash tests are re-pinned with "(was …)" where the spec's shape moved; the run's receipt shows the node's
line. The node stays as built (its failure behaviour is with the owner; do not change it).

### B. `validate()` warns on an unconnected History filter

Law `firsthand 2026-11-15` (`sdk/src/validate.ts`): add the case "`core:query/history-entries@1` has
`firsthandFor` wired and its `exclusions` reach no `core:task/eligibility@1`": a warning, worded like the
`entry knowledge 2026-11-15` one. SDK test beside the existing firsthand tests.

### C. A compiled scene with no live lines is judged by its stored cast

`src/lib/server/sessions/firsthandFilter.ts`: today a scene with no live (not hidden, not rewound) lines counts
as attended by everyone (★T6C1-3). Change: such a scene is the member's when the member is in the scene's stored
cast (`scene_characters`; inventory how a cast member maps to that row), for both the scene-summary rule and the
History-entry rule. A scene with live lines is judged as today. Still no query per scene (one grouped read, only
when at least one such scene exists). Update the receipts only if a sentence becomes untrue; update
`docs/pipelines.md`, the SDK guide's limits, INTEGRATING §1p and the NOMENCLATURE **firsthand** row.

## Files owned

SDK: the Story and Lair genre specs named by the inventory, `sdk/src/validate.ts` (the one case), SDK tests, the
guide's limits text, `INTEGRATING.md` §1p. App: `sessions/firsthandFilter.ts` and its tests, the tests that pin
Story's and the Lair's specs, `registryHashes.test.ts`, `docs/pipelines.md`, `docs/genre-story.md`,
`docs/genre-lair.md` (one sentence each: what a character does not know is left out of its own turn),
`docs/lorebooks.md` if it says no shipped genre uses the mark, `NOMENCLATURE.md` §25.

## Out of scope

Screens; the three stated leaks (place listing, link-borne names, the triggers scan: lane T6e); replacement
summaries; the date / delta shape; the node's failure behaviour; any new name, setting or migration.

## Stop and ask when

CLAUDE.md §Decisions applies; a spec has no eligibility step to wire into; a spec's speaker is not a single cast
member where the brief assumed one; the byte-identical condition cannot be met.

## Done means

- `npm run sdk:build` from the app root (after the checks above), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t6f-sdk.log 2>&1"`:
  only the four known failures.
- App tests (that capped form with `npx vitest run --maxWorkers=3 <paths>`, strictly one run at a time): Story:
  a marked, untied entry is absent from a character's own-turn prompt and present on the narrator's; tied →
  present; nothing marked → byte-identical prompt and +1 statement (report the numbers); the same for the Lair's
  wired specs; C's cases (no live lines + in stored cast → kept; not in it → left out; live lines → as before);
  `allPipelines.int.test.ts`, `declaredReads.test.ts`, `paramsSlotWiring.test.ts`, `registryHashes.test.ts`,
  `bindings.firsthand.int.test.ts`, `bindings.entryKnowledge.int.test.ts`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story. No other product's name.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t6f-<date>.md`): inventory with
file:line (which specs were wired, which were not and why); statements added per reply; changed files in both
repos; when you ran `sdk:build`; tests with results; open ★; **Noticed, not done**. Under about 700 words.
