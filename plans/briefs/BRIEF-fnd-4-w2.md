# BRIEF — worker `fnd-4-w2`: run-13 failures in `pipelines/runtime` and `sockets`

Supervisor: lane `fnd-4`. App repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/`.
Your report is your final message (not a file), under about 600 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: the SDK is not to change. If a fix needs the SDK, stop and report.)

## Goal

Each failing test below is one of: **(a)** it pins behaviour a lane changed on purpose → re-pin it, listing old → new
with the reason, never weakening an assertion; **(b)** a real defect → fix the code where this brief says so, test
unchanged; otherwise report it; **(c)** a flake → prove with three solo reruns, change nothing. The supervisor's
diagnosis is below; verify it (file:line) before editing, and where what you find disagrees, stop on that item and
report it.

Rules (quoted from the lane brief and CLAUDE.md):
- "Never 'fix' a test by deleting it, skipping it, or loosening a matcher. A registry or spec hash re-pin carries '(was …)'."
- "Comments state the rule, not the story." No lane tags or dates in comments or test titles.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- No new exported name, setting, migration or user-visible copy. No edits outside **Files owned**. Never edit
  `pipelines/runtime/host.ts` or `sockets/sessions.ts` (shared files); if a fix needs them, report it.
- `npx prettier --check` only, never `--write`.

## Files owned

- `pipelines/runtime/armsSpeaker.int.test.ts`, `bindings.firsthand.int.test.ts`, `lorebookListing.int.test.ts`,
  `structuralCompat.test.ts`
- `pipelines/runtime/host.loreWrites.ts` (item 5 only)
- `sockets/lorebooks.entryEdges.int.test.ts`

Readable: anything. Lane reports: `plans/REPORT-kn-2a-2026-11-16.md` (the `knownToSpeaker` param),
`plans/REPORT-fnd-2b-2026-11-16.md` (host split), `plans/REPORT-tl-2c-2026-11-16.md`,
`plans/REPORT-tl-2d-2026-11-16.md` (today's date; Year 1 default removed). Failure text: `plans/lead-full13.log`
(grep the test title).

## What lane `kn-2a` changed on purpose (from its report)

`knownToSpeaker` (boolean, default `true`) is the last field of each read's `params` (`contracts/src/queries.ts`).
Each read passes `knownToSpeaker: params.knownToSpeaker !== false` to the host's `lorebook_entries` read and
**logs a receipt note** (`knowledgeDropReceipt`). The speaker: the read's wired `speaker`; else the scope's subject;
no subject → reads everything. "entity-link: with the param on it also reads when `speaker` is unwired (the scope's
speaker)." Open owner ★4: "entity-link reading when unwired applies the scope's character-lore gate".

## Items

1. **`armsSpeaker.int.test.ts`** entity-link "unwired, links everything in the pool it can name — no second gate,
   as before" (~584) and "a null or empty speaker is unwired…" (~644): `['verity','world']` where
   `['brask','npc','verity','world']` was pinned. Likely (a) from the entity-link change above. Confirm that
   `brask`/`npc` drop because of the knowledge read under the default `knownToSpeaker: true` (not something else).
   Then re-pin: keep the old list asserted for the same input with `knownToSpeaker: false` (that is still "no
   second gate"), and pin the new list for the default with the reason; retitle only where the old title is now
   false.

2. **`bindings.firsthand.int.test.ts`** history-entries "with firsthandFor" (4 tests, ~465–486): one extra
   `["info", "Reads everything: not one cast member's turn"]` log call. Likely (a): kn-2a's receipt note. Confirm
   the sentence comes from `knowledgeDropReceipt` and that kn-2a's own tests pin it. Re-pin by asserting the exact
   calls in order (the firsthand receipt and the knowledge note), never by dropping the call check. "byte-identical
   output" stays asserted.

3. **`lorebookListing.int.test.ts`** (4 tests): `TypeError: ctx.log is not a function` at
   `bindings.retrieval.ts:698`. If the binding context's type declares `log` as required, the test's fake context
   is stale: add a `log` to it (assert nothing new unless a test is about the receipt). If `log` is optional in the
   type, that is a defect: report it, do not fix.

4. **`structuralCompat.test.ts`** "requiresOf … one contract gives that contract's whole surface" (~185): 4 keys
   where 3 were pinned. Likely (a): `knownToSpeaker` on that contract's params. Confirm and add it.

5. **`host.notesMeet.int.test.ts`** "with no year, the notes' day newer than the lorebook's newest is the story's
   day: the write files onto it" (~641) — kind (b), **test unchanged**. `commit` of a history write with
   `fields: {}` is refused by `typedFieldsOf` (`host.loreWrites.ts` ~818, called from `host.ts` ~6442 with
   `partial: false`): "'year' is required and not set". Cause: lane `tl-2d` removed the history `year` default, so
   the whole-entry check now requires `year`; before, the default satisfied it. The intended behaviour is stated in
   the code: `refuseYearlessHistoryDate` (~503) says "leave the date out to use the story's day", and
   `historyDateOf` (~520) fills the date from the story's day when `fields.year` is absent. Fix inside
   `typedFieldsOf` only: for the history type, a missing `year` on a new entry is not a misfit (the write's date is
   the story's day, `historyDateOf`); every other finding still refuses. Identify that finding by its field key /
   code from the SDK's `fieldsFindings` result (read its shape; do not match on message text). A one-line comment
   stating that rule. If the finding carries no field key, stop and report.
   Then run `host.notesMeet`, `host.historyWrites.int.test.ts`, `host.loreWrites*` tests and any test naming
   `refuseYearlessHistoryDate` to show nothing else moved.

6. **`sockets/lorebooks.entryEdges.int.test.ts`** "a book holding a dated and an undated version of one link can
   be overwritten and deleted" (~861): 1 link back after overwrite where 3 were pinned. Supervisor's guess: the
   fixture `b.chapter()` writes history entries with no `year` (it relied on the removed Year 1 default); since
   `tl-2d`, export writes `year: null` for them and import skips yearless history entries, so the two links dated
   to them do not come back. Verify. If so, kind (a) on the fixture: give the chapters this test makes a year
   (the smallest change that restores what the test means; check other tests in the file using `chapter()` still
   pass). Also report, as a finding for the owner, what import does with a link whose history entry it skipped
   (dropped, or brought in undated?) — do not change that code.

7. **`sockets/sessions.dungeonCrawlerRounds.int.test.ts`** "Rest (round 2) one line on the journal folio…"
   (~474): `"The party rests. Day 739445, 08:00 → Day 739445, 16:00."` where `"… Day 1, 08:00 → Day 1, 16:00."`
   was pinned. A new dated session now starts on today's date (`tl-2d`), and the line prints the absolute day
   index. **Diagnose only, change nothing:** find where the "Day N, HH:MM" line is formatted (file:line, app or
   SDK) and what N counts; report it. This is user-visible copy with two readings (count days from the crawl's
   start, or print the story date), so it goes to the owner.

8. **`pipelines/runtime/scoreLedAllocation.int.test.ts`** — failed at file level in runs 12 and 13 ("Something
   went wrong on the server…"). Kind (c) or real: run it **alone three times** (three separate capped runs) and
   report each result; if it fails, quote the first error and its file:line. Change nothing.

## Tests

Before every run: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Then exactly:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-4-w2-<n>.log 2>&1"`
One run at a time (another worker may also be running tests: always wait with the loop first). Never pipe vitest
into `head`. No full run, no `npm run build`, no `tsc` (the supervisor runs it).

## Done means

Items 1–6 green in one capped run of `armsSpeaker`, `bindings.firsthand`, `lorebookListing`, `structuralCompat`,
`host.notesMeet`, `sockets/lorebooks.entryEdges` (apart from anything you report); items 7–8 reported.

## Report (final message)

Per item: kind, cause (lane, file:line), what you changed (old → new for every pinned assertion), log and result.
Then `npx prettier --check` result on touched files, and **Noticed, not done**.
