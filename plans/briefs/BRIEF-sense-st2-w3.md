# BRIEF — sense-st2 worker 3 — fix the annex narrowing for turns with several deltas

You are a `lane-worker` for lane `sense-st2`. App repo `/home/jody/github/serene-pub`. Absolute paths. Report in your
final message (changed files, tests run with exact results, Noticed-not-done). No report file.

## Background (read the code first)

`src/lib/server/sessions/annexChanges.ts` keeps whole-document annex deltas per owner (`before`/`after` =
`{ document, audiences }`), anchored to a message. `retractAnnexDeltasAnchoredTo(tx, messageId, { keep })` walks the
message's rows newest first. A replaced turn (swipe, regenerate) passes `keep(owner)` = the owner's annex fields
declared `keepOnRetell: true` (now a typed member of `AnnexFieldDecl` in `@serene-pub/sdk`; the SDK is built). The
current code (just written) classifies each row: kept keys unchanged → delete + land `before` as before; only kept
keys changed → row untouched; mixed → row narrowed (`after'` = `before` + kept keys) and `after'` landed.

Two bugs when one message holds **several** deltas of one owner (a turn that wrote the owner's document twice):

1. **Retraction.** A narrowed or untouched newer row of the same message stays in the table, so the older row's
   `laterDeltaStands(...)` check sees it and the older row's changes are never reverted. And landing an older row's
   `before` would put back the kept keys' pre-turn values.
2. **Restore** (`restoreAnnexDeltas`, used when a failed swipe puts back what it took). Rows of the message that the
   retraction left untouched are not in `taken`, so `laterDeltaStands(..., takenIds)` sees them and skips landing;
   and landing an older row's `after` would overwrite the untouched newer row's kept values.

## What to build

**Retraction**, keeping the per-row walk (so a row of another message interleaved by id still wins as today):

- Keep a set `remain` of this pass's rows left in place (untouched or narrowed). Pass it as `except` to every
  `laterDeltaStands` call in this function.
- When the walk lands a side (a deleted row's `before`, or a narrowed row), land it with the owner's kept keys
  **held at their current stored values**, document and audiences, exactly as `withTimeless` holds the `TIMELESS`
  keys (so the kept fields keep the value the turn finally left). Do this by giving `landOwner` an optional
  `hold?: ReadonlySet<string>` that `withTimeless` (or a sibling) applies alongside `TIMELESS[owner]`; for audiences,
  hold the same keys from the current `annex_audiences[owner]`. Without `keep`, behaviour is byte-for-byte today's.
- The narrowed row's stored `after` stays `before` + its own kept keys (as now): a later Back (no `keep`) lands
  `before` and takes the kept keys too.

**Restore**, per owner instead of per row:

- Re-insert / upsert every taken row as now (`onConflictDoUpdate` on id, setting `before` and `after`).
- Then for each owner among the taken rows: if any taken row of that owner was `reverted`, find the **newest delta
  row of that owner anchored to the same message(s) as the taken rows** (taken or left in place — query the table),
  and land its `after` (with the existing owner-version migration step) unless a delta of that owner from another
  message with a greater id stands. Whole-document deltas make the newest row's `after` the full state.
- Check this gives the same result as today for a plain Back → Forward of a single-delta and a two-delta turn
  (existing tests in `annexChanges.int.test.ts` and `rewind.int.test.ts` must stay green).

Also in `src/lib/server/state/write.ts`, `keepOnRetellOf`: replace the narrow cast
`(d as { keepOnRetell?: unknown }).keepOnRetell === true` with `d.keepOnRetell === true` now that the SDK type has it.

## Tests

Extend `src/lib/server/sessions/annexChanges.keepOnRetell.int.test.ts` with:
- a message with two deltas of one owner, both mixed (kept key `plan` and a plain key `note` changed in each):
  retraction with `keep` → `note` back to its pre-turn value, `plan` at the turn's final value; a later retraction
  with no `keep` → `plan` back to its pre-turn value too.
- two deltas, newer changes only `plan` (untouched), older changes only `note` (taken): after retraction `note` is
  back and `plan` stays; `restoreAnnexDeltas(taken)` → document equals the newer row's original `after`.
- an interleaved row of another message (ids: message A row, message B row, message A row): retracting A with `keep`
  leaves B's change standing (later writer wins), as today without `keep`.

## Files owned

`src/lib/server/sessions/annexChanges.ts`, `src/lib/server/sessions/annexChanges.keepOnRetell.int.test.ts`, and the
one cast in `src/lib/server/state/write.ts` (`keepOnRetellOf`). Nothing else.

## Out of scope

The `annex_deltas` schema, migrations, any other file. Findings go under Noticed-not-done.

## Done means

- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean.
- `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/annexChanges.keepOnRetell.int.test.ts src/lib/server/sessions/annexChanges.int.test.ts src/lib/server/sessions/annexChanges.memberForm.int.test.ts src/lib/server/sessions/rewind.int.test.ts"` green; report counts.
- `npx prettier --check` on the test file (the source files were not prettier-clean before this lane; do not
  `--write` them, and do not reformat lines you did not change).

## Verbatim rules (from `.claude/guides/multi-agent.md` and `plans/briefs/BRIEF-sense-clk.md`)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not build.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never
  `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`. It is a **session**, never a *chat*.
- **No reference to any other project or product** in code, comments, tests or docs.
- Run only your targeted test files, in a capped scope (command above). An int test that opens a DB inside an `it`
  needs a 60 s timeout. Never pipe vitest into `head`. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.**
