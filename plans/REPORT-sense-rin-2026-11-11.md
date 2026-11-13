# REPORT — lane `sense-rin` — 2026-11-11

Written by the lead from the supervisor's final message.

## What was wrong (A14 confirmed)

The main cause was in the client, not missing data. The run explanation already carried a reason for most entries
that never became candidates, and the client threw it away: `judgedEntryRows` dropped every `outcome: "skipped"` row
(where the keyword and semantic lanes record "entry is archived", "entry is disabled", condition notes, "no key
matched … relevance scored X against a threshold of Y", "not visible to the current speaker"), and an
`excluded_ineligible` row showed a generic verdict while the rule's own sentence sat unused in `why[0]`. The owner's
path (`entries:recentDecisions`) got no reason although `ranking_decisions` stores `reason` and `why`.

## Built

- `src/lib/client/lorebooks/editor/readIn.ts`: the sentence field `reason` renamed `verdict`; `reason` (the code)
  and `why` (the stored sentence) added, matching `RetrievalRow` and `ranking_decisions` (removes an R1 clash). New
  `GATE` sentences, `skipReasonOf`, `skippedEntryRow`, `skipVerdict`, `storeVerdict`. `readInFacts` falls back to
  the entry's skipped row; an ineligible row uses its rule sentence.
- `src/lib/client/lorebooks/editor/signals.ts`: `signalFactsFrom(explanation, { entryId, enabled, reading })`
  applies the first-gate order. `src/lib/client/components/lorebookForms/EntryFireTest.svelte`: that call only.
- `src/lib/server/sockets/entries.ts` (`entryRecentDecisionsHandler` only) and `src/lib/shared/sockets/types.ts`
  (`Entries.RecentDecisions` facts only): a left-out entry's fact carries `reason` and `why`; an included one never does.
- Tests: `readIn.test.ts`, `signals.test.ts` (one per gate), `entries.workspaceVerbs.int.test.ts`.
- `docs/lorebooks.md`: one paragraph under "Why was it read in, or not?".

No new event, setting, table, migration or stored fact.

## Tests

Client: 3 files, 66/66. Server: 18/18. `tsc --noEmit -p .`: 0 errors. Prettier: lane-written files clean; four files
already failed at HEAD and were not reformatted.

## Which gates can be told

- **Read in? tab:** switched off · archived · off for a while (by the session's reading, or by a disabled skip with
  the base row on) · not on the session's line or dated after its clock · another speaker's character lore · secret,
  presence, exclusion, shown elsewhere · no keyword, name or meaning match (verbatim, with score and threshold where
  the keyword lane has them) · budget.
- **Read in line, admin path:** switched off · archived · another speaker's character lore · secret / presence ·
  no match · budget.
- **Read in line, owner path:** budget · pinned but did not fit · a rule's own sentence.
- **Still the honest catch-all:** in the tab, an entry with no row at all (character lore the host's read withheld;
  an entry kind no mechanism reads); "on another line" and "dated after the clock" cannot be told apart; in the
  line's owner path, every entry the turn never judged, because the ranking store keeps no skips.

## Item 2, the chain-depth switch

No change. **Let other entries pull this one in** is drawn only in
`src/lib/client/lorebooks/sections/EntryAdvancedFields.svelte:145-171` (not owned), which already says, for every
session, that these do nothing until an admin raises the chain depth and that it is 0 by default.

## Open ★

1. Say the chain-depth line only when the reading session's depth is 0? Recommended: leave as is.
2. Close the line's remaining catch-alls: `retrievalReadout.svelte.ts` `factsFor` falls back to the store fact's
   `reason` / `why` (one line, not owned); `entries:recentDecisions` also hands, for entries the turn never judged,
   whether the reading has the entry off, archived, or off its line or clock (one more query per read; new fields).
3. Copy: every sentence below is provisional.

## Provisional copy 🚧

Prefixes: `Not read in last turn · ` (line), `Would not be read in · ` (tab).
`it is switched off` · `it is archived` · `it is off for a while at this point in the story` · `it is not on this
session's line, or it is dated after the session's clock` · `it is another speaker's character lore` · `it was left
out for budget` · `it is pinned, but it did not fit`. Engine sentences are passed through verbatim.
Docs paragraph in `docs/lorebooks.md` listing the gates.

## Noticed, not done

- `readIn.ts` recovers a skipped row's raw reason by stripping "Never reached the ranker — " from the verdict; if
  that wording changes the client falls back to the catch-all. A raw-reason field on skipped rows would be cleaner.
- "not visible to the current speaker" is an inline literal in `runtime/bindings.ts` ~3166, not pinned by a test.
- The `entries:recentDecisions` rows query has no `orderBy`; with several rankings in one turn the last rejection wins.
