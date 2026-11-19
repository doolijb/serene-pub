# REPORT core-4 — X3, HW1, AP4 + AP5 — 2026-11-18

Saved by the lead from the supervisor's hand-back (the supervisor could not write this file). Brief: `briefs/BRIEF-core-4.md` (+ w1–w3).

**Tests (shared lock):** 19 lane test files plus `speakerInCast.reply.int.test.ts`: 370 of 371 pass; the one failure is that reply test, which pins the removed cap and lies outside the lane's files (fix task `core-4-fix`). `tsc` 0 errors. Every changed file inside Files owned. Rules broken: none.

## X3 — no cap
`REPLACED_DAY_CAP`, `fitSummaries` and both `cut`s are gone; a replaced day is every attended summary joined. Docs, NOMENCLATURE §14 row and §25 updated; SDK edits are text only. **Ranker:** a day larger than its history share is dropped whole, never trimmed (`ranking/select.ts` ~836, `excluded_token_limit`); pinned by a new case in `select.test.ts`; `docs/pipelines.md` says it. Nothing in the ranker changed.

## HW1 — six of eight built (#1, #2, #4, #6, #7, #8)
The technical text stays the halt reason; the people sentence rides on `forPeople` / `meta.peopleSentence`. **#3 has no true site:** the parked state reaches only the owner through `CapPauseDialog.svelte`, which never shows the technical cap text; `lineage.ts` unedited. **#5** needs `pipelines/routines/run.ts` (`routineLine` gains `peopleSentence?`), outside the lane's files: fix task. The new tests check each sentence where it is raised; none reads through the halt surface as an administrator and as a non-administrator: fix task.

## AP4 + AP5
A changed source file rewrites every row it ships and re-creates rows a person deleted, under any write mode. `held` removed end to end; `keptEdited` counts only a card that is the person's own (still never rewritten). A person's copy keeps its own rows (new test).

**Open ★:** a plugin's card linked from a lorebook a person owns. Built (a): at an update the card is overwritten; the person's member stays pinned to its version with Update offered. (b) never overwrite such a card: the person's copy stays frozen, the provided lorebook drifts from its file.

## Noticed, not done
- The enabling administrator can still edit a plugin's card (`sockets/characters.ts` 992–1001).
- A member a person removed comes back with a fresh card; the old card is orphaned and can look like a duplicate character.
- `Sockets.Plugins.ProvidedBook.state` still lists `"held"`.
- `attachments/placement.ts:145` duplicates `KIND_PLURAL`.
- Generated docs still carry the old cap text (`serene-pub-sdk/docs/generated/…/queries.md:513`, `src/lib/generated/docs/pages/`).
- `prettier --check` warns on six edited files (at least two warned before).

## Scope review and fix task `core-4-fix` (2026-11-18)
Scope review: no scope objection; four low findings, all taken. Fix task done:
- `speakerInCast.reply.int.test.ts` re-pinned: every attended summary arrives.
- HW1 #5 built (`routines/run.ts` `routineLine.peopleSentence`, `routines/evaluate.ts`); seven of eight sentences are in. #3 has no true site and is not built.
- One reader-path case per sentence (#1, #2, #4, #6, #7, #8): a non-administrator reads the ruled sentence with no raw id; the technical text is in the run record (`haltReason`), which is where an administrator reads it (`receiptHaltFor` shows the people sentence to every reader of the halt surface).
- `answererName` returns null for an empty name (no "This question is for .").
- `ProvidedBook.state` loses `"held"`; `providedMarks.ts` comments state the rule in force.
- Design choice named: a row is skipped only when it already equals what the same file item wrote (`rowHash === known.hash && known.up === up`), which avoids a spurious new card version; the outcome equals an unconditional rewrite. NOMENCLATURE also gained a clause on the **provided lorebook** row (~424).
- Tests: 20 files 164/167, the three failures were the new routine-log case polluting shared fixtures, fixed; re-run 9 files 114/114. Four files not re-run after that fix (`speakerInCast.reply`, `sessionEvents.emit`, `loreMatch.seatedMember`, `attachments/send.int`): covered by the grouped verification.
