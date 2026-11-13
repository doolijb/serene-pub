# BRIEF cv-close-w1 — type fix, interest-gate mocks, comment wording, one docs line (2026-11-06)

Worker for lane **cv-close** (supervisor: Opus lane-supervisor). App root `/home/jody/github/serene-pub`. Another worker (w2) runs at the same time on other files; never touch its files (listed under Out of scope).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

Extra for this lane: **do not delete any `/tmp/serene-pub-vitest-*` dir at all** — w2 runs tests at the same time and you cannot tell its dirs from yours. Before your first vitest run do `ls -d /tmp/serene-pub-vitest-* 2>/dev/null > /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/cv-close-w1-tmp-before.txt` and after your last one the same into `cv-close-w1-tmp-after.txt`; the supervisor cleans up. Never pipe vitest into `head`/`tail -n` while it runs (write to a log file, then read the log). Always `--maxWorkers=2`. Don't run `prettier --write` on whole files; keep your diffs to the lines you change (other lanes' uncommitted hunks sit in these files).

## Goal
Make these stage-1 verification failures green without changing product behaviour (unless a test exposes a real bug — then stop and report it, don't fix it).

### 1. svelte-check error
`src/lib/client/components/characterForms/CharacterForm.svelte` ~line 254: inside the `$effect`, `requestWithInterest("lorebooks:bindingsForCharacter", { characterId }, …)` passes `characterId` (`number | undefined`) where `number` is wanted. The effect has already narrowed it to `askFor` (a `number` after the `if (!askFor) return`). Pass `{ characterId: askFor }`. Nothing else in the file.

### 2. Interest-gate tests' mocked dbs (test files only)
These unit tests mock `$lib/server/db` with a hand-built fake. The character-versions programme moved writes/reads onto new db calls the fakes don't answer. Fix the **mocks** (fakes, seams) so each test's gate assertions hold as written. Do not weaken or delete assertions about the interest gate; if an assertion names a query label that the product no longer issues (e.g. a write now goes through `character_versions` instead of `characters`), update the label to what the product really issues and say so in the report, line by line.
- `src/lib/server/sockets/cast.interestGate.test.ts` — 5 failures. `characters:create` now runs inside `db.transaction(async (tx) => …)` (`insertCard` in `src/lib/server/characters/versions.ts`): the fake needs `transaction(cb) => cb(fakeDb)` (the callback must get the same fake so the recorded `seam.queries` still see the insert). `characters:setAvatar` now refuses with "Character not found or access denied" under the fake: find which read it now does (read `characterSetAvatar` / the setAvatar handler in `src/lib/server/sockets/characters.ts` and the versions writer it calls) and answer it in the fake.
- `src/lib/server/sockets/sessions.interestGate.test.ts` — 2 failures in `sessions:typing`: the persona read now goes through `cardsNow` (`src/lib/server/cast/seatedCast.ts`), which calls `db.selectDistinctOn(...)` — the fake lacks it. Teach the fake `selectDistinctOn` returning a version row for the persona card, and make sure the test's `"characters.findFirst(persona)"` label (or its real replacement — report which) is recorded once.
- `src/lib/server/sockets/sessionAdjacent.interestGate.test.ts` — 1 failure "a build log entry names the book the build was asked for": `narrativeGraph:build` → `storyStatesOf` → `castVersionsInForce` → `pickVersions` (`src/lib/server/cast/memberAsRead.ts` ~563) reads rows shaped `{ version, overlayOf }`; the fake returns rows without `version`. Make the fake answer that select with `[]` or properly shaped rows so the build reaches the log entry.
Read each test's existing fake first and extend it in its own style.

### 3. Comment-history ratchet (`src/lib/shared/conformance/commentHistory.test.ts`)
The ratchet bans story phrases in comments ("used to", "no longer", "previously", "deliberately not", …). Reword **only** these lines so the comment states the rule (present tense, what is true), meaning unchanged:
- `src/lib/client/lorebooks/cast/castVersionRead.ts` ~129: "Used to ask what a base save would still read differently…" → e.g. "Answers what a base save would still read differently at the moment being read (#113)."
- `src/lib/server/characters/guardScan.ts` ~98: "`rel` is only used to pick the script kind and for nothing else" → e.g. "`rel` picks the script kind and nothing else".
- `src/lib/server/lorebooks/ownBook.ts` ~1339: "…the session no longer reads it." → state the rule (e.g. "…: the session does not read it.").
- `src/lib/server/pipelines/prompt/seatCards.ts` ~18: "…a book the session no longer reads" → e.g. "a book the session does not read".
- `src/lib/server/embedding/vectorizationQueue.ts` ~781: "`characters.embed_text_hash` is no longer read." → e.g. "`characters.embed_text_hash` is not read." (only this one line; the file's other three hits are within its ratchet.)
Other files in that test's failure list belong to other programmes — leave them. Do not edit `commentHistory.ratchet.json`.

### 4. One docs line
`docs/sessions.md` line 54 ends: "If the old session had no lorebook, its session notes become a lorebook first (what **Share as a lorebook** does), and both sessions read it." Every session has a lorebook (its own book, shown as **Session notes**, or an attached one); the code (`src/lib/server/sockets/sessions.ts` ~907) shares the own book when the old session has no attached book. Replace that one sentence with exactly:
"If the old session's lorebook is its own **Session notes**, they become a shared lorebook first (what **Share as a lorebook** does), and both sessions read it."
Rule (owner): never write "no lorebook" / "no book" — every session has a lorebook.

## Files owned
- `src/lib/client/components/characterForms/CharacterForm.svelte` (the one line)
- `src/lib/server/sockets/cast.interestGate.test.ts`, `src/lib/server/sockets/sessions.interestGate.test.ts`, `src/lib/server/sockets/sessionAdjacent.interestGate.test.ts`
- `src/lib/client/lorebooks/cast/castVersionRead.ts`, `src/lib/server/characters/guardScan.ts`, `src/lib/server/lorebooks/ownBook.ts`, `src/lib/server/pipelines/prompt/seatCards.ts`, `src/lib/server/embedding/vectorizationQueue.ts` — the comment lines named above only
- `docs/sessions.md` — line 54's last sentence only

## Files readable
Anything in the repo.

## Out of scope (w2's files — never edit)
`src/lib/server/characters/versions.ts`, `versions*.test.ts`, `src/lib/server/sockets/shares.int.test.ts`, `src/lib/server/sockets/sprites.int.test.ts`, `src/lib/server/pipelines/parity/**`, `src/lib/server/sprites/**`, `src/lib/server/sockets/jump.ts`. Also: any product code change beyond item 1, NOMENCLATURE.md, any other comment in the ratchet list.

## Stop and ask when
A mock fix would need a product change; a gate assertion looks wrong rather than stale; anything needs a new name, setting or migration. Write it in your report and stop that item.

## Done means
- `npx vitest run src/lib/server/sockets/cast.interestGate.test.ts src/lib/server/sockets/sessions.interestGate.test.ts src/lib/server/sockets/sessionAdjacent.interestGate.test.ts src/lib/server/sockets/content.interestGate.test.ts src/lib/server/sockets/index.interestGate.test.ts --maxWorkers=2 > <scratchpad>/cv-close-w1-gate.log 2>&1` — all green.
- `npx vitest run src/lib/shared/conformance/commentHistory.test.ts --maxWorkers=2 > <scratchpad>/cv-close-w1-ratchet.log 2>&1` — none of the five files above appears in its failure list (it will still fail on other programmes' files; say which remain).
- Run the colocated suites of the five comment files if any exist (e.g. `guardScan`, `seatCards`, `ownBook` tests) only if your edit could matter — a comment edit can't, so skip them and say so.
- `npx tsc --noEmit -p .` — 0 errors (write to a log). Do **not** run svelte-check; the supervisor runs it.
- `npx prettier --check` on every file you touched (report results; for files that were already unformatted before you, say so and don't reformat).

`<scratchpad>` = `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad`.

## Report
Return your report as your final message (no report file): changed files with one line each, tests run with pass/fail counts and log paths, every query label you changed and why, the tmp-dir before/after file paths, open questions, Noticed-not-done.
