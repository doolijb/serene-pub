# REPORT — build lane `edit-history-a` — an edit history for lorebook entries (2026-11-14)

Brief: `plans/briefs/BRIEF-edit-history-a.md` (its Corrections rule). Worker briefs `BRIEF-edit-history-a-w1.md` …
`-w4.md`; logs `plans/edit-history-a-*.log`. Server pass, then client pass. **Nothing was looked at in a running
app.** The supervisor ran its own scope review (five findings; two fixed, three carried as ★ below).

## The record

Table 🚧 `lore_redlines` (`loreRedlines`), migration **0161** `drizzle/0161_flowery_bishop.sql` (generated; only
this table; nothing seeded). Two keys into the lorebook: `entry_id` (FK, cascade) and nullable `amendment_id`
(FK, cascade; null = the entry itself). `changes` jsonb `{ wireKey: { before, after } }` (values wrapped `{v}`);
`cause` (CHECK: `save` · `routine` · `apply` · `revert` · `take-back` · `restore`); `user_id`, `session_id`,
`message_id` plain ints with no FK (deleting a session or person keeps the history); `run_id` (matching a
retraction only; never sent to a client); `shown_as` (the routine's shown name, else the pipeline spec's name,
as it read then); `created_at`.

One writer: `src/lib/server/lorebooks/redlines.ts` (`recordRedline`, `recordEntryRedline`). It compares only the
keys the write named (name on a titled type, content, keys, secondaryKeys, declared typed fields); a change of
nothing records nothing. After each insert an entry keeps its 50 newest rows plus the newest row a person wrote.
`takeBackRedline` / `putBackRedline` match a row by entry + session + run + message.

## Call sites

- Form save (`applyEntryUpdate` in `sockets/entries.ts` `saveEntry`; the unlocked branch now runs in a
  transaction): the person, `save` (or `restore`).
- Pipeline write (`changeLoreEntry` in `host.ts`, inside `write(tx)`; covers `fileOntoHistoryDay`): `routine`
  with the run; the early return into `holdLoreEntryChange` records nothing; a person's press through a pipeline
  (no turn message) is that person's `save`.
- Apply / Take back (`writeEntryKeys` in `ownBook.ts`): `apply` as the person who pressed, or with no person when
  automatic; `take-back` as the person; an applied dated change records nothing; a merged history day arrives as
  one `apply` row.
- Back / swipe / regenerate / Forward: `retractImprints` takes the row's key back when it reverts a field;
  `restoreImprints` puts it back only when the field is written back. A write that a retraction leaves standing
  (kept, spliced, overwritten by a person) keeps its row.
- Revert of a *replaced* note (`settleKeptImprint` with the user): `revert` as that person.
- A ruleset tie's entry-field write (`rulesets/ties.ts`): `routine` with the run.
- Editing a dated change (`amendments:update`, now `updateAmendment`): a row with `amendment_id`; a re-date,
  create and the cast branch record nothing.
- **Not recorded:** `sessions/dcCairns.ts` (it runs only at start-up, and the owner ruled start-up upgrades out;
  the brief had listed it), provided-book and boot upgrades, imports, marks, positions, archive, line moves.

## Restore; what clears it; sockets

Restore goes through the person's own save (earmark refusal, declared-field checks, `markImprintsKept`), recorded
as `restore`. Entry: owner only; refused when a key is no longer declared. Dated change: stored fields with each
key's *before* put back, an absent key removed.

Cleared by: the entry's ⋯ menu and Book settings › This book (owner only); Admin › Data (admins); **Share as a
lorebook**; an overwrite import; deleting an entry or a dated change. Never travels: entry-scoped registry spec,
`notCopied`.

Sockets (replies only): `entries:redlines`, `entries:restoreRedline`, `entries:clearRedlines`,
`entries:redlineCount` (scoped on `lorebookId`), `admin:redlineSummary`, `admin:clearRedlines`.

## Screens and copy (all 🚧)

An **Edit history** fold under the *Amendments* list in the entry form (interim placement), closed, *Edit history
· 3 edits*. A row: who (*You*, a name, *Someone*, *‹routine› in ‹session›* / *in a session* / *in a session that
was deleted*, *A routine*, *By itself, from ‹session›* …), the cause (*Saved · Wrote · Applied · Reverted · Took
back · Restored*), *On the change from ‹date›*, fields with *Before* / *After* and *Show* / *Hide*, **Restore**
(*Put back what this edit replaced*). *Clear edit history…* with three confirmations naming the count (entry,
lorebook, every lorebook). Admin › Data card *Edit history · N edits · ‹size›*. Refusals: *That edit is no longer
kept.* · *The dated change that edit was made on is gone.* · *‹label› is no longer part of this kind of entry.* ·
*Only the lorebook's owner can clear its edit history.*

## Changed files

Server: `db/schema.ts` (the table), `drizzle/0161_*`, `lorebooks/redlines.ts` (new), `lorebooks/imprints.ts`,
`pipelines/runtime/host.ts` (`changeLoreEntry`), `lorebooks/ownBook.ts` (`writeEntryKeys`, callers,
`shareAsLorebook`), `rulesets/ties.ts`, `lorebooks/tableRegistry.ts`, `sockets/entries.ts`,
`sockets/amendments.ts`, `sockets/redlines.ts` (new), `sockets/index.ts`. Shared: `shared/sockets/types.ts`,
`interest.ts`, `scopedReplies.test.ts`, `client/sockets/typedSocket.ts`. Client: `lorebooks/editHistory/` (new:
`editHistoryCopy.ts`, `EditHistory.svelte`, `ClearEditHistoryDialog.svelte`, `EditHistoryAdminRow.svelte`),
`lorebooks/EntryWorkspace.svelte`, `lorebooks/BookSettings.svelte`, `admin/sections/data/Page.svelte`. Tests:
`lorebooks/redlines.callSites.int`, `redlines.apply.int`, `sockets/entries.redlines.int`,
`sockets/amendments.redlines.int`, three DOM tests. Docs: `docs/lorebooks.md` (*Edit history*),
`docs/system-settings.md`, `NOMENCLATURE.md` (row `redline`, §25).

## Tests (supervisor)

Grouped: 15 files, 170 tests pass. Workers: 8 + 6 server regression files (197 tests), 29 socket files (342),
all of `client/lorebooks` (1409). `tsc` 0 errors. `npm run check` no errors in the lane's files. Not covered: a
test of the ruleset tie's write; a mounted Admin › Data page.

## Open ★

1. The internal name 🚧 `redline` / `lore_redlines`.
2. `dcCairns` not recorded (owner's quote over the brief).
3. The fold's interim placement.
4. An automatic Apply or take-back has no person: *By itself, from ‹session›*.
5. A person's press through a pipeline is that person's save.
6. A run's write that a retraction leaves standing keeps its row (the reviewer wanted the spliced case folded
   into the later row).
7. Who sees the list: whoever `findOwnedBook` accepts (the owner; a session's people for its notes); other
   readers of a shared lorebook see no fold.
8. Admin › Data's Clear confirms first (spoken lines does not).
9. One request beyond the brief's list: `entries:redlineCount`.
10. All copy.

## Noticed, not done

`ties.ts` records on the handle it was given, which may not be a transaction (as its write and per-turn record
already were); a tie write to an undeclared field records nothing; a history day created by `fileOntoHistoryDay`
gets a `routine` row for its first text; the *A routine* fallback may name a pipeline; a refused Restore's
inline error stays until the next attempt; `sockets/redlines.ts` and `entries.ts` import each other (call-time
only).

## Lead follow-up (2026-11-14)

The six new `:error` events joined `Layout.svelte`'s `HANDLED_ERROR_EVENTS` (with a test), so a refusal is said
once, in place.

## Grouped verification of `timeline-a` and `edit-history-a` (lead, 2026-11-14)

`npx tsc --noEmit -p .` clean; `npm run check` exit 0. One capped run (`plans/verify-1114-tests.log`):
`server/lorebooks`, `state`, `scenes`, `messages`, `sessions`, `rulesets`, `pipelines/runtime`,
`pipelines/routines`, `startup`, the entries / amendments / scenes / sessions / lorebooks / storyClock / redlines
socket tests, `shared/sockets`, `shared/lorebooks`, `client/lorebooks`, `client/components`, `client/admin`:
1204 files, 1195 passed, 8 failed (10 tests).

- **Two were this lane's, fixed:** `sockets/lorebooks.duplicate.int` (the fixture now holds an edit-history row,
  so the "never copied" check is real); `sockets/scenes.afterBoundaryPlaced.int` (`sockets/redlines.ts` imported
  `./entries` and `./amendments` at load, which pulled `sockets/scenes.ts` in while a test's mock of `entries`
  was still being built: both imports are now made at call time). Rerun: both pass, with
  `entries.redlines.int` and `amendments.redlines.int`.
- **Six are not these lanes':** `sessions/genreFieldDefaults.int` (3 tests; failing since before 2026-11-13),
  `runtime/allPipelines.int`, `runtime/guideGrounding.int`, `runtime/scoreLedAllocation.int` (as in the
  2026-11-13 runs), `client/components/sessionPage/narrateDraft.dom` (a source-text check of the session page)
  and `sockets/sessions.forms.int` ~1120 (a reply carries a new `askedRunId`): the last two put to the other
  session.
