# REPORT hist-B1-w1

Status: done. The create and update ports now write history per the brief. Nine new tests pass, the seven neighbour test files pass, and tsc shows no error in my files.

## Changed
- `src/lib/server/pipelines/runtime/host.ts`
  - New helper `fileOntoHistoryDay` inside `createHost`, right after `changeLoreEntry` (~2087-2185).
  - `create-lore-entry` case:
    - `HISTORY_TYPE_ID` is imported lazily next to `typeId`.
    - `historyDay` is computed right after `forkedLoreLine`.
    - It replaces the `matchedId` source and short-circuits the insert and match branches.
    - The generic `imprintMade` is skipped for a history row.
    - `dayNote` is merged into `notes`.
  - `update-lore-entry` case: moved-date computation, then the "re-date or checked" transaction path with the three assertions before `changeLoreEntry`.
- New `src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts` (9 tests).

## Choices
- A blank new content on a history write leaves the stored content untouched.
- A non-numeric month or day in `fields` is read as null.
- A day entry that was only created (not matched) is returned in the new-row shape. Its `changed` is true, but `record` says "created", because `row` is set.
- `record(...)` on update is unchanged.
- Plain `Error`s from `assertDateLands`, `historyEntryOfDate` and the three update assertions are wrapped as `HostScopeError(`${node.key}: ${msg}`)`.
- In the update case, `settleThrough` and `recordLoreSources` are now guarded by `checked` inside the shared transaction. `recordLoreSources` still requires `did`.
- `moved` is computed with the brief's rule: the stored day compared via `dayOnly`/`compareDates`, and an undated stored row counts as moved.
- A resent same date skips all three assertions, including `assertRedateKeepsLines`. The socket runs that one always; the brief says none.

## Tests
- New file: 9/9 pass.
- Neighbours: 7 files, 59/59 pass (imprints, loreSources, forkTiming, withLinks, ownBook, ownNotesLine, sessions.retraction).
- tsc: the grep found no errors in `host.ts` or the new test (the `tsc-exit=1` printed is grep's no-match status).

## Surprises
- A retake does remove a created day entry: the made imprint goes in before the content change. Test 3 covers it, and it also covers reverting an appended paragraph.
- `fieldsFindings` does not refuse `fields` without `year` for history. The no-fields and legacy-undated cases reach my code.
- Without a book calendar, the field checker lets month 40 through, and `assertDateLands` does not refuse it either. The "cannot place" test uses a day without a month, `{year:2, month:null, day:3}`. I did not confirm which check produced that refusal; the test only matches `/can't be saved|does not fit/`.
- In the fork test, the refused earlier-dated create tries to create on main (the owning line). `changeLoreEntry` refuses it, and the rollback leaves main with no row.

## Noticed, not done
- The socket update runs `assertRedateKeepsLines` even for a same-date resend; the pipeline port does not, as briefed.
- DC cairn history writes that were undated will now be refused. They belong to lane hist-D; I did not touch them or run DC tests.
