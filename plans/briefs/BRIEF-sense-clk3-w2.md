# BRIEF — worker `sense-clk3-w2` — a ruleset conversion keeps a renamed value's stamp

You are a `lane-worker` under supervisor `sense-clk3`. App repo `/home/jody/github/serene-pub`. Use absolute paths.
Another session is editing this repo (visual-novel layout work); never touch its files. A read-only agent is
diagnosing `src/lib/server/utils/replyRoad.int.test.ts`: do not edit, run or chase it. No SDK change in this task.

## The owner's ruling (2026-11-11, verbatim)

"Renamed keeps its stamp (Recommended)" — described as: "A rename is a re-key, so the value keeps the time it was
really written. A default added by the conversion gets no stamp and reads as unknown."

## What exists (re-read these lines before changing anything)

- `src/lib/server/state/write.ts` `setValue` (~2548–2610): inside its transaction it reads
  `const now = await sessionStoryNowOf(tx, ctx.sessionId)` and inserts `...clockColumns(now ? clockOfNow(now) : null)`
  (five `story_clock_*` columns); `created_at` defaults to now (`db/schema.ts` `attribute_values.createdAt`,
  `notNull().defaultNow()`). `ValueChange` (~212) is the **published** shape: `core:task/set-state@1` takes it on
  `changes`, proposal payloads hold it, and `applyChange` (~2725–2742) forwards the incoming object **as is** to
  `setValue`. So any string-keyed field added to the change could arrive from a pipeline, a plugin or a socket payload.
- `src/lib/server/state/resolve.ts` ~1096: `ValueWriteStamp { clock: StoryClock | null; writtenAt: Date }` — already
  exported; `valueStampsOf` (~1110) answers it for the row `valueOf` reads. `state/storyTime.ts`: `clockOf(row)`
  (~98, columns → `StoryClock | null`) and `clockColumns(clock)` (~111).
- `src/lib/server/sessions/convertRuleset.ts`: the renamed value `setValue(t, ctx, { owner, slotId: now, value: held })`
  (~187; `r` is the old slot's latest full `attribute_values` row, so it has the five `storyClock*` columns and
  `createdAt`); the added-slot default `setValue(t, ctx, { owner, slotId, value })` (~242); the `clear` rows (~156)
  insert directly and are already unstamped.
- Precedent for a module-private symbol constant: `src/lib/server/sockets/interest.ts:209`
  `export const ANY_SCOPE: unique symbol = Symbol("any scope")`.
- Existing tests: `src/lib/server/state/valueStamp.int.test.ts` (helpers `world`, `columnsOf`, `rowsOf`; the branch
  test ~259), `src/lib/server/sessions/convertRuleset.int.test.ts` (its own rename/added/removed fixtures ~161–190).
  How `writtenAgo` is worked out: `rulesets/resolve.ts` `writtenAgoOf` (~195, private): `minutes =
  minutesBetween(stamp.clock, now, calendar)` (`rulesets/clockHours.ts` ~45), `realSeconds` from `writtenAt`.
- The as-of reader: `state/resolve.ts` `valueRows` ~1255–1280 filters `attribute_values.created_at <= (the message's
  created_at)` when `ValueQuery.asOfMessageId` (~909–912) is given. `sessions/branch.ts` ~726–742 copies value rows
  keeping `created_at`; copied messages keep their `created_at` (~424).

## Tasks

1. **One optional, core-internal field on `setValue`'s change**, unreachable from a plugin, a pipeline or a socket
   payload, that either supplies a stamp to keep or says "no stamp". Build it as a **symbol-keyed** field, so no JSON
   payload can ever carry it and `applyChange` and every other caller need no change:
   - in `write.ts`: `export const GIVEN_WRITE_STAMP: unique symbol = Symbol("given write stamp")` with a short
     docblock (what it is; that it is not on `ValueChange`, so the published set-state shape is unchanged; who uses it:
     the ruleset conversion's re-key);
   - `setValue`'s `change` parameter type becomes `ValueChange & { readonly [GIVEN_WRITE_STAMP]?: ValueWriteStamp | null }`
     (import the type from `./resolve` / `$lib/server/state/resolve`, as the file already imports from it);
   - behaviour: key **absent** (or `undefined`) → exactly as today (reads `sessionStoryNowOf`, stamps now, `created_at`
     defaults); a `ValueWriteStamp` → the five columns from `clockColumns(stamp.clock)` and `createdAt: stamp.writtenAt`,
     and `sessionStoryNowOf` is not read; `null` → the five columns null, `created_at` defaults. Nothing else changes.
     The overlaid-place branch (`setOverlaidPlaceValue`) ignores it (a place in the notes' overlay has no row stamp).
   - Before naming: grep `GIVEN_WRITE_STAMP` / `givenWriteStamp` across `src`, `/home/jody/github/serene-pub-sdk/*/src`
     and `db/schema.ts`. If it collides, stop and report a different name; do not pick one silently.
2. `convertRuleset.ts`: the renamed value passes `[GIVEN_WRITE_STAMP]: { clock: clockOf(r), writtenAt: r.createdAt }`;
   the added-slot default passes `[GIVEN_WRITE_STAMP]: null`. Update the file's header docblock with one sentence
   (a renamed value keeps the time it was written; an added default has none). Nothing else in the file changes.
3. **Tests** in `src/lib/server/sessions/convertRuleset.int.test.ts` (reuse its fixtures; add a `describe`) or in
   `valueStamp.int.test.ts` if that is far simpler — say which and why:
   (a) a renamed value keeps its old row's five clock columns and `createdAt`; then move the session clock on (e.g.
       90 minutes) and show `valueStampsOf` on the new slot answers the original clock and `writtenAt`, and
       `minutesBetween(stamp.clock, sessionNow, null)` counts from the original write (original gap + 90), not from
       the conversion;
   (b) an added default's row has all five columns null (so `writtenAgo.minutes` reads null);
   (c) an ordinary `setValue` (no symbol) still stamps the session's clock now (one line, may reuse the existing test
       in `valueStamp.int.test.ts` if it already proves it — then say so and do not duplicate).
4. **The scope review's test** (test only): in `valueStamp.int.test.ts` "copies keep the stamp", add a case: a value
   written at message `m1`, then a later message `m2` (created after the write), branch from `m2`; an as-of read at
   the copied `m2` in the branch (`valueOf` with `asOfMessageId`, or the public reader that takes it — find it)
   returns the copied value, exactly as the same as-of read at `m2` does in the source session. **If it fails, report
   the failure and the evidence; do not change any code.**
5. `docs/rulesets.md` line ~129 ends "A value nothing in the session has changed yet has no such time." Add one short
   sentence after it: moving a session to a newer version of its rules keeps a renamed value's time, and a value the
   move adds has none. Nothing else in the doc.
6. `npx prettier --check <file>` on each changed file (these files were already unformatted as whole files under
   other lanes; report, do not reformat whole files).

## Files owned (edit only these)

`src/lib/server/state/write.ts` (the symbol, `setValue`'s parameter type and its stamp lines only),
`src/lib/server/sessions/convertRuleset.ts`, `src/lib/server/sessions/convertRuleset.int.test.ts`,
`src/lib/server/state/valueStamp.int.test.ts`, `docs/rulesets.md` (one sentence).

## Files readable

Anything. Not editable: everything else, including `NOMENCLATURE.md` (the supervisor records the name),
`state/resolve.ts`, `sessions/branch.ts`, `sessions/rewind.ts`, `db/schema.ts`.

## Out of scope

Any change to `ValueChange`, `applyChange`, set-state, proposals, sockets; real seconds of an added default (its
`created_at` is NOT NULL, so it counts from the conversion: report it, do not change it); migrations; UI; the
stale comment at `sessions/rewind.ts:851` (report only).

## Stop and ask (in your report) when

The name collides; the symbol cannot be typed without touching `ValueChange` or `applyChange`; the branch test
fails; anything outside the owned files must change.

## Done means

The tests pass: `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/convertRuleset.int.test.ts src/lib/server/state/valueStamp.int.test.ts src/lib/server/rulesets/writtenAgo.int.test.ts"`
(report counts), and `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`
is clean or its errors are shown to be another lane's (name the files).

## Report (your final message)

Changed files; the name and its grep; the exact `setValue` diff summary; tests with counts; the branch test's result;
prettier results; Noticed, not done.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You run no `sdk:build`: worker w1 does.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  It is a **session**, never a *chat*. Every session has a lorebook (its own book, or an overlay): never write "no
  lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
