# BRIEF — build lane `sense-b4`, worker 5 — six state and lore test files, rewritten to the new rule

You are a `lane-worker`. Supervisor: build lane `sense-b4` (`plans/briefs/BRIEF-sense-b4.md`, readable for
context; this brief is your contract). Words: a **build lane** is this stream of work; a **channel** is a
session's message channel. Never write bare "lane" for a channel.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What is built (do not change production code)

**The rule (owner-ruled):** for a session that reads an attached lorebook **and whose scenes end by themselves**
(`scenesEndByThemselves(db, sessionId)` in `src/lib/server/lorebooks/ownBook.ts`: the scenes routine runs and the
scene mode is Automatic), a **pipeline's** write of a **new entry, a place, a history day or a link**
(`core:outlet/create-lore-entry`, `update-lore-entry`, `link-lore-entries`, history days) goes to the session's own
book whatever the lorebook's write setting, Full included; `sources` no longer moves the settle line for such a
session (provenance is still recorded); no line is forked by these writes (an Apply forks instead). **Every other
session writes exactly as before.** **Not changed by this build lane:** stat values (`state/write.ts`),
`recordToTimeline` and the delete safeguard (`state/durable.ts`), cast members and versions, a person's own press,
scenes and summaries, the lorebook annex.

All six files below pass today, because none of their sessions meets the rule (they bootstrap no pipelines, so no
scenes routine is registered). The supervisor's brief says they pin write-through under Full and must be
**rewritten to the new rule, never weakened**.

## Build (tests only)

For each file:

1. Find every case that pins a **pipeline's** new entry, place, history day or link landing **in the lorebook under
   Full**. For each such case: keep it, and say in its title (or its `describe`) that the session's scenes do not end
   by themselves; then add its twin for a session that meets the rule, asserting the new rule (the row in the own
   book, `route: "own-book"`, nothing in the lorebook, no line forked, and — where the original asserted the settle
   line moved with `sources` — that it does not move). Make a session meet the rule with a per-session partial
   mock of the predicate, exactly as `src/lib/server/pipelines/runtime/host.ownBookFull.int.test.ts` does (read its
   `vi.mock("$lib/server/lorebooks/ownBook", …)`; the real predicate is tested end to end in
   `host.scenesEndRoute.int.test.ts`). Confirm the mock reaches the code under test (a twin that fails without it).
2. Cases about stat values, the timeline, the delete safeguard, cast, a person's press or reading: **unchanged**. If
   a file has such a case under Full that a reader could mistake for this build lane's kinds, add one twin showing
   it is **unchanged** for a session that meets the rule (e.g. a value or a timeline capture still lands where it
   did) — at most one per file.
3. `src/lib/server/lorebooks/imprints.int.test.ts`: keep the kept/revert rule tested **through a direct writer**
   (a session that does not meet the rule, writing the real book), and add one twin showing that for a session that
   meets the rule the same run's write is in its own book (so it carries an own-book imprint, not a real-book one).

Files:
- `src/lib/server/messages/loreLinks.int.test.ts`
- `src/lib/server/state/sessionLoreWrites.int.test.ts`
- `src/lib/server/lorebooks/imprints.int.test.ts`
- `src/lib/server/state/durable.int.test.ts`
- `src/lib/server/state/locations.int.test.ts`
- `src/lib/server/state/ownNotesLine.int.test.ts`

If a file has **no** case of this build lane's kinds under Full, change nothing in it but one comment line in its
header saying which rule it pins, and say so in the report.

## Run

Only these six files, only inside:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. `npx prettier
--check` on each file you changed (if it failed before your edit, say so; never `--write` a directory). Typecheck:
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`, report only errors in your files.

## Files owned (edit only these)

The six test files above. **No production file.** If a twin cannot pass without a production change, stop that
case and report it with the evidence and the smallest fix you see.

## Out of scope

Every production file; the Lair and Dungeon Crawler suites and the host-level tests (other workers); docs.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — and in this build lane: **do not run `npm run sdk:build` at all.**
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. Inside `db.transaction(async (tx) => …)` use only `tx`. Never run npm at the SDK repo root. It is a
  **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Other sessions are editing this repo: never touch their files, never "fix" failures that are theirs.

## Report (your final message)

Per file: which cases pinned this build lane's kinds under Full, the twins added and what each proves, or "none —
comment only"; results per file (pass/fail counts); anything production that failed, with evidence; **Noticed, not
done**.
