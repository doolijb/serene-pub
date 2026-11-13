# REPORT hist-C-w1
Status question: none relayed.

## Changed (all under /home/jody/github/serene-pub-sdk)
- contracts/src/outlets.ts: create-lore-entry JSDoc (history dropped, new "History is compiled" section with the optional sentence), entryType param description; update-lore-entry re-date paragraph; new `noteScene` after proposeSceneCue (as given, type shape matched siblings); update-cast-member JSDoc and `changes` port comment.
- sdk/src/variables.ts: varCurrentDate description only.
- core-catalog/src/registry/entries.ts: history JSDoc paragraph only.
- guides/writing-lore-from-a-pipeline.md: "Story events: scenes first", running-summary line, "Advanced: reading what changed, when".
- guides/genres-presets-and-routines.md: "### What a summarizer writes" (links lore guide section by relative .md#anchor like other links).
- INTEGRATING.md: 1k update-cast-member bullet; new 1l.

## Tests
From sdk-tests, the six listed files, capped scope: test-exit=0, 93 tests, 93 pass, 0 fail (log /tmp/claude-1000/hist-C-w1-tests.log; the `^# ` grep matches nothing, the runner prints `ℹ` lines).
No tsc run on contracts (no tsconfig there); the tests import src via tsx, which does not type-check.

## Unverified in the recipe
- How lorebook-state@1 / stat-trail@1 json outputs (`state`, `trail`, `points`) reach an assemble template: I did not find it, so the guide states only their ports and params, no wiring. Verified: history-entries `bands: { history }` (read as `{{history}}`), stat-trail params slotId/mode/last and `since.date`, lorebook-state `at`, current-date scope `currentDate` with year/month/day/label.
- The handlebars fence is not type-checked; `{{currentDate.label}}` is optional in the scope (absent for free-form books).

## Facts not matching the brief
None. Only: the brief's section 1a line numbers were close; texts matched.

## Noticed, not done
- varHistory description ("from the chat") and other copy untouched.
- Confirmed by grep that no other list enumerates outlets: I checked only that contracts/src/index.ts re-exports; I did not grep exhaustively for hand-kept outlet lists elsewhere (e.g. api-docs, conformance counts of outlets), which may need a count bump.
