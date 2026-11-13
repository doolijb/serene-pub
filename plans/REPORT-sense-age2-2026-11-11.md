# REPORT: lane `sense-age2`, 2026-11-11 (saved by the lead from the supervisor's final message; condensed, no fact dropped)

## Headline

Every value a session writes is stamped with that session's story clock. A ruleset function body is handed how long
ago each value it reads was written: **`writtenAgo[id].minutes`** always, plus **`realSeconds`** when the function
declares `countsTime: 'real'` or `'both'`. All **Done means** cases pass through `resolveRulesetTurn`: the sleep meter
drains awake and refills asleep; a re-run with no time passed changes nothing; after Back past a write the minutes
count from the earlier write; no clock gives null and nothing fails; real seconds reach only a function that opts in;
branch, rewind and retract-then-restore keep the stamp; a non-session write reads null. `tsc` clean, `sdk:build` once,
no pin moved in `coreCatalog.test.ts`, nothing committed.

## The migration

`drizzle/0154_red_the_watchers.sql`, index 154, generated after re-checking 0153 was highest. Five nullable integer
columns on `attribute_values` (`story_clock_year`, `_month`, `_day`, `_hour`, `_minute`) plus the four shape CHECKs
every other table with these columns carries (`storyClockChecks`). Old rows read null; no backfill, no boot pass.
`valueStoryClock0154.int.test.ts`: a 0153 row survives, the CHECK refuses a minute without an hour, a second boot
changes nothing.

## The key

`writtenAgo` on each attribute role beside `values` and `bounds`:
`{ [attributeId]: { minutes: number | null, realSeconds?: number | null } }`. `since` and `elapsed` are taken. The real
instant is recorded on the run as `facts.functions.realNow` (ISO) only when a function with a body counts real time.
Recorded in NOMENCLATURE §25 and the Rulesets vocabulary row.

## How the numbers are worked out

- `minutes`: `minutesBetween` (lifted out of `hoursCrossed`, which answers as before) from the stamp to the session's
  clock now, read once per moment. Null when: no stamp; no session clock; cannot be placed (free-form calendar across
  a month); the stamp is later than now (decision: null, not clamped to 0).
- `realSeconds`: `floor((realNow − created_at) / 1000)`, never below 0; one `Date.now()` per moment, by the host.
- Computed in every mode whenever the ruleset runs function modules. The stamp comes from exactly the row `valueOf`
  takes the value from (`valueStampsOf`, sharing the layer walk via `answeringLayer`). A default, a derived slot, or a
  place value in the notes' overlay reads null.

## Copy paths and insert sites

- **Stamped (session writes):** `state/write.ts` `setValue` reads `sessionStoryNowOf(tx, …)` in its own transaction.
  Callers: `applyChange` / `applyChangeSet`, `sockets/state.ts:1604`, `sprites/choices.ts:366`,
  `sessions/convertRuleset.ts:187/242` (see ★2).
- **Carry unchanged:** `sessions/branch.ts` ~735 (also keeps `createdAt` now; tested), `retractStateAnchoredTo` →
  `restoreRetractedState` (tested), `sessions/rewind.ts` Back / Forward (tested), and by reading:
  `lorebooks/foldInParent.ts`, `lorebooks/ownBook.ts` 849–890 and `dropTurnTiesOfPlaces`, `lorebooks/tableRegistry.ts`
  `attributeRow`, `sessions/seatKeys.ts` `applyPlan`, `sockets/narrativeGraph.ts` story restore.
- **Null (non-session):** `state/placeStats.ts:281`, `state/cardState.ts:318` (tested), `sockets/lorebooks.ts:4326`
  (import; export does not write the stamp), `characters/dowry.ts:444/568`, `plugins/providedBooks.ts:1308`,
  `lorebooks/starterKits.ts:806`, `sessions/convertRuleset.ts:156` (`clear`), `state/durable.ts:313` (timeline rows;
  decision: unstamped, they lose to a session's message-anchored row in `inForce`).

## Script read paths

Changed: the function envelope (`rulesets/functionRun.ts` `bindingValues`). Left: the older seeded-script form
(`rulesets/scripts.ts`) and pipeline scripts / templates reading through `state/resolve.ts` (no per-value write
context; the brief scoped the fact to function bodies).

## Changed files

App: `db/schema.ts`; `drizzle/0154_red_the_watchers.sql`, `meta/0154_snapshot.json`, `meta/_journal.json`;
`state/write.ts`; `sessions/branch.ts`; `state/resolve.ts` (`ValueWriteStamp`, `valueStampsOf`, `answeringLayer`);
`rulesets/clockHours.ts` (`minutePair`, `minutesBetween`); `rulesets/types.ts` (`EngineInput.writtenAgo`, `realNow`);
`rulesets/resolve.ts` (`writtenAgoOf`, `facts.functions.realNow`); `rulesets/functionRun.ts`. Tests new:
`db/valueStoryClock0154.int.test.ts`, `state/valueStamp.int.test.ts`, `rulesets/writtenAgo.int.test.ts`; added to
`clockHours.test.ts`, `functionRun.test.ts`. `docs/rulesets.md` line 129; `NOMENCLATURE.md`. Worker briefs
`plans/briefs/BRIEF-sense-age2-w{1,2,3}.md`.
SDK: `guides/rulesets.md` ~278–285. No published envelope type; storage guide and `INTEGRATING.md` unchanged.

## Tests

App capped run: 12 files, 88 passed. Worker 1: `rewind.int`, `handEdits.int` and three more, 86/86 at
`--maxWorkers=2` (six load failures in `rewind.int` at 3 workers; 22/22 alone). SDK: 98/98 across `coreCatalog`,
`guides`, `guideSnippets`, `functions`, `fit`. Full suites not run; a whole-row `toEqual` on `attribute_values`
elsewhere may notice the five new fields.

## Open ★

- **★1** The four shape CHECKs in 0154 go beyond "five nullable columns". Recommended: keep.
- **★2** A ruleset conversion writes through `setValue`, so renamed values and added defaults are stamped at the
  conversion. Recommended: a renamed value carries its old row's stamp; an added default carries none (one optional
  core-internal field on `setValue`'s change).
- The first lane's ★B, ★C, ★D stay open.

## Noticed, not done

- A branch's value rows now keep the source's `created_at`; `valueRows`' `asOfMessageId` filter compares it with
  message `created_at`. Expected harmless; how a branch sets copied messages' `created_at` was not checked.
- Place values in the notes' overlay are no `attribute_values` row: always `minutes: null`.
- A meter nobody has written reads `minutes: null`, so a rule like the test body never starts draining until one write.
  The guide could give an example.
- Prettier: the touched source files fail `--check` as whole files (already unformatted under other lanes);
  `writtenAgo.int.test.ts` does not settle under prettier.
- No scope review was run by the lane.

## Scope review (lead-run, 2026-11-11)

Migration, `tx`-only stamp, the `answeringLayer` refactor, names and "no other project" all checked clean. Three
objections:

1. **Medium — ★2 contradicts the brief's reading** ("a ruleset conversion carries no stamp"): `convertRuleset.ts:187`
   and `:242` stamp at conversion. Put to the owner 2026-11-11 with the lane's recommendation; not built.
2. **Low to medium — ★1**: the four CHECKs were built before asking, against the brief's stop line. Put to the owner
   the same day; the migration is uncommitted, so regenerating is cheap until it ships.
3. **Low — a behaviour change made in passing.** `branch.ts:735` keeping `created_at` means an as-of read at a copied
   line (`state/resolve.ts:1274-1275`, used by the live-scenes boundary watcher, `scenes/liveScenes.ts:534`) now sees
   the branch's copied value rows, as the source session did; before, every copy was dated at branch time and the read
   saw none. Messages were already copied with their original `created_at` (`branch.ts:424`). Other readers checked,
   no harm found. Untested. The comment at `sessions/rewind.ts:851` ("its copies were stamped at the copy") is now
   stale; that file is outside the lane.

Note: `realSeconds` is `number | null` (null when no stored row answers), where the brief proposed `number`.
