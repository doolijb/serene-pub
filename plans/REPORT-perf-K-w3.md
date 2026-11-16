# REPORT perf-K w3

Status question: none relayed.

## Changed
- src/lib/server/sockets/entries.ts: module-local `loadDefaultVectorMarks` (selects entryId/model/vectorizedAt only; same filters), used in `listEntryRows` and `toListRow`; `loadDefaultVectors` dropped from imports, `type EntryVector` added; doc comment updated. Nothing else touched.
- new src/lib/server/sockets/entries.listWire.int.test.ts (1 case, listEntryRows only; toListRow has no cheap call path without socket harness).
- deleted src/lib/server/scripts/run.ts, engine.ts. abuse.test.ts: local `PINNED_ENGINE = "0.32.0"`, runScript import and the run.ts-contract block removed.
- docs/lorebooks.md: no natural place (doc never describes what the list carries); nothing added.
- RuntimeManager.ts untouched.

## Withdrawn cases (verbatim)
1. caps a log line rather than letting it into a receipt whole
2. fails a return carrying an undeclared key, naming it
3. refuses a transform that returns a scalar
4. lets a verdict operation return a scalar, and never merges it
5. pins Date.now() and new Date() to the run's start
6. keeps ctx.log lines from a link that then failed
(block title: "run.ts contract — not (yet) true of the production host"; the "reports a syntax error" case before it stays.)

## Reader grep
No client/SDK code reads the vector off an entries:* row. Hits are test fixtures, `LorebookEntry.embedding` type (shared/entries/types.ts:327, stays `number[] | null`; supervisor should make it optional), unrelated sessionPageProjections status and narrativeGraph wire types.
Script grep: no remaining hit for the deleted files (only unrelated `C.runScript` catalog task).

## Tests
- vitest: new test + entries*, lorebooks*, content.interestGate, bookPatches, abuse.test: 51 files, 452 tests pass.
- test:budgets: 4 pass, 1 FAIL: docsDist.budgets "keeps rendered pages inside the page budget" (4.45 MB vs 3.00 MB, rendered docs dist) - unrelated to this change; script budgets pass.
- tsc: no errors in my files. prettier --check: entries.ts unclean (peer's ~250 uncommitted lines; not run --write); the new test and abuse.test.ts clean.

## Noticed, not done
- shared sockets type for entries rows still declares `embedding: number[] | null`; make optional later.
- pluginBindings.ts:58 still imports RuntimeManager type (queued by supervisor).
- docsDist budget over (docs dist grew; sdk pipeline pages are the largest).
