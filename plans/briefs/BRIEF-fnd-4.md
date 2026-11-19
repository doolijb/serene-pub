# BRIEF — build lane `fnd-4` — the failures full run 13 found (programme 0, verification)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: not expected to change; if
a fix needs it, stop and report). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-standing-failures-2026-11-16.md` (how lane `fnd-3` triaged the last set: same method), and the
reports of the lanes that most likely caused each failure (named below).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash / checkout / restore`; `npx prettier --check` only, never `--write`. Never commit. No migration.
Inside `db.transaction` only `tx`. Comments state the rule, not the story. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-4-<n>.log 2>&1"`,
one run at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done` (the lead is running
the SDK suite and the build at the start of this lane). `NODE_OPTIONS=--max-old-space-size=10240` for
`npx tsc --noEmit -p .`. No full run, no `npm run build`.

## The run

Full run 13: `plans/lead-full13.log` / `plans/lead-full13.json` (17 files failed, 27 tests; 26,982 passed). Run
12 for comparison: `plans/lead-full12.json`. Read each failure's assertion message from the JSON before
opening code.

**Left failing on purpose, do not touch:** `pipelines/boot/paramsSlotWiring.test.ts` (D19),
`pipelines/config/panel/groups.int.test.ts` (D20), `pipelines/runtime/guideGrounding.int.test.ts` (D22).
**Waits on the owner, do not re-pin:** `sockets/sessions.creationModes.int.test.ts` "a following session is
followed by a following one" (D52(b)).
**Old, also in run 12:** `pipelines/runtime/scoreLedAllocation.int.test.ts` (1): triage it too; say whether it
is a flake under load (rerun alone three times) or real.

**New since run 12 (12 files, 22 tests), with the lead's guess at the cause to verify, not to trust:**
- `entries/declarations.test.ts` (1) — the history type's `year` lost its default (`tl-2d`).
- `pipelines/boot/contentAddressing.int.test.ts` (4) — `TransactionDeadlockError` in test-database setup
  (`db/index.ts:476` under `boot/store.ts:100`): find which lane's change made the outer `db` get used inside
  a transaction; this may be a **real defect** in boot code, not a test problem.
- `pipelines/boot/lorebookTriggerControls.int.test.ts` (1), `retrievalModeCull.int.test.ts` (1) — an extra
  `knownToSpeaker` control (`kn-2a`; D36 is about how that control shows: pin what is true today, do not
  redesign).
- `pipelines/boot/specSlugRename.int.test.ts` (1) — a lost `contextBudget` override: possibly a **real
  defect** from the session-settings store lanes (`ss-2a/2b`).
- `pipelines/runtime/armsSpeaker.int.test.ts` (2), `bindings.firsthand.int.test.ts` (4),
  `lorebookListing.int.test.ts` (4), `structuralCompat.test.ts` (1) — query params / shapes changed by `kn-2a`
  (`knownToSpeaker`) or the host split (`fnd-2b`).
- `pipelines/runtime/host.notesMeet.int.test.ts` (1), `sockets/lorebooks.entryEdges.int.test.ts` (1),
  `sockets/sessions.dungeonCrawlerRounds.int.test.ts` (1, the Rest's clock line) — today's date lanes
  (`tl-2c`, `tl-2d`, `tl-2d-fix`).

## Method (per failing test)

1. Read the assertion and decide: **(a) the test pins behaviour a lane changed on purpose** (find the lane's
   report and the owner ruling it built) → re-pin, listing old → new, never weakening an assertion; **(b) a
   real defect** → fix the code if the fix is small and inside the area the causing lane owned, with the test
   unchanged; if it is not small, or two readings are possible, stop on that one and report it;
   **(c) a flake** → prove it (three solo reruns) and report, change nothing.
2. Never "fix" a test by deleting it, skipping it, or loosening a matcher. A registry or spec hash re-pin
   carries "(was …)".
3. Write `plans/INVENTORY-run13-failures-2026-11-16.md`: one row per test: file, title, cause (lane, file:line),
   kind (a / b / c), what was done.

Use at most 2 Sonnet `lane-worker`s, split by directory (`pipelines/boot` + `entries`; `pipelines/runtime` +
`sockets`), briefs `plans/briefs/BRIEF-fnd-4-w<n>.md`.

## Done means

Every new failure is fixed, re-pinned with its reason, or reported as needing the lead; the 12 files rerun
green together in one capped run (apart from anything reported); `tsc` 0.

## Report

Final message = the report (lead saves `plans/REPORT-fnd-4-<date>.md`): the table (file → kind → cause → done);
every real defect found and its fix; pinned tests changed (old → new); what is left and why; **Noticed, not
done**. Under about 600 words.
