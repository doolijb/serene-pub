# BRIEF playtest-H-w3 — one Regenerate test for the run floor (lead-issued, 2026-11-04)

**Goal.** `src/lib/server/sessions/rewind.ts` now floors `unitRuns` by a message id in every branch of `buildTurnUnit` (Back: `firstId`; `turnUnitAt`: `newest.turnOf`; Regenerate: `head.turnOf`), and at `:~365` drops yielded rows older than the floor. Only the Back branch has a test. Add ONE int test to `src/lib/server/sessions/rewind.int.test.ts`, next to the existing "an `updated`-only run doesn't widen the unit" test: the same fixture (a person line, two replies, an older run that only `updated` a row from before the exchange), but through the Regenerate path (`includePersonLines: false`, the way the existing Regenerate tests in that file call it). Assert the unit's row ids are only the replies, the rewriting run is still in `unit.runs`, and no row older than the floor appears. Read the file's existing Regenerate tests and the new floor tests first and copy their fixture helpers; don't add helpers of your own.

**Files owned:** `src/lib/server/sessions/rewind.int.test.ts` only. Never edit `rewind.ts`; if the test exposes a bug, report it with the failing assertion.

**Run:** `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sessions/rewind.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-H-w3.log 2>&1; echo exit=$?'`. Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Never hand a DOM node to an assertion.

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.* Never `git checkout`, `restore` or `clean`.
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- Report in your final message: the test added (name + line), the vitest summary line, and anything noticed.
