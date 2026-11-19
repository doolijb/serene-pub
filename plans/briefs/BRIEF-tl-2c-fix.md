# BRIEF — worker task `tl-2c-fix` — six scope-review fixes to lane `tl-2c` (play's writes carry the story's date)

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-tl-2c-2026-11-16.md`, the comment rule in
`CLAUDE.md` ("comments state the rule, not the story"; ratchet
`src/lib/shared/conformance/commentHistory.ratchet.json`). Re-verify every file:line below before editing.

Rules: never `git stash / checkout / restore`; `npx prettier --check` only; never commit; no migration; no SDK
edit. Lane `tl-2e` is editing the prompt's date read (`pipelines/**/assemble.ts`) and may add an export to
`state/storyTime.ts`: re-read a file right before each edit, small targeted edits only. Inside `db.transaction`
only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2c-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## Fixes

1. **Guard allow-list reason** (`src/lib/server/pipelines/runtime/loreWriteDate.guard.test.ts` 37–42):
   `ownBookDaysCounted`'s reason is false ("the answer is not a write's date"): its `.now` is the default date
   of a history write (`host.loreWrites.ts` ~540) and its `.dating` is the history entry a notes-route row
   hangs on (~461). State what it is: the notes route's history day and hang-on, counting the notes' own days,
   deliberately not through `loreWriteDateOf`. Remove process references ("cold review 1", "today's value").
2. **Comments and test titles state the rule.** Remove lane tags and history from `state/storyTime.ts` (~391
   "(lane tl-2c)", ~402 "behave as they did before the lane" → e.g. "undatable: a history write is refused,
   every other write is stored undated") and from test titles carrying "(lane tl-2c…)" in
   `host.datedVersion`, `host.entryDefaults`, `host.fullDirect`, `ownNotesLine` test files (grep
   `lane tl-2c` under `src/` and fix every hit in comments and titles; titles say the rule being tested).
3. **The cast-member backstop sits too late and is untested** (`src/lib/server/characters/versions.ts` ~2023):
   it comes after the same-version update that returns early (~1994–2014) and after the retire update (~2019),
   so an undated `when` merging into the current version is never checked. Move the refusal above the
   `sameKey` branch (before any write in `storyWrite`), keeping behaviour otherwise identical, and add a
   mock-driven cast-member case to `host.undatedWriteBackstop.int.test.ts` (or a sibling beside
   `versions.ts`'s tests if the host file cannot reach it): refused, nothing written, for both a new version
   and a merge into the current one.
4. **Write down the history re-date refusal:** one sentence in `docs/lorebook-time.md` (the "What a session's
   pipelines date" section, ~31–38): a pipeline cannot move the date of a history entry that lives in an
   attached lorebook; it is refused with the existing sentence (quote it from the code). And add it to the
   "changed" list of the `tl-2c` §25 entry in `NOMENCLATURE.md` (~4344).
5. **The Lair walk case must prove a new session starts dated**
   (`src/lib/server/sockets/sessions.lairWalk.int.test.ts` ~674–680): it sets the clock by hand from
   `new Date()`. Replace that case with one that creates a **new** Lair session through `sessions:create`
   (the file's existing helper), runs the same update step, and asserts the version carries that session's
   own `storyClock*` year / month / day. Keep the cleared-clock case as it is.
6. **Back removes each newly dated write:** add one Back (or swipe, whichever the file's helpers already use;
   see `host.datedVersion` ~595 for the pattern) assertion to each of: the held amendment dated at the newest
   history day (`host.heldEntryChange`), the Item whose Beginning is dated at that day (`host.entryDefaults`),
   the notes cast version dated at that day (`ownNotesLine`). If a file has no way to press Back without a
   large harness, say so and skip that one.

## Tests

Run the files you touched plus `loreWriteDate.guard.test.ts`, `state/loreWriteDate.int.test.ts`,
`src/lib/shared/conformance/commentHistory*.test.ts`. `tsc` 0.

## Report (under 300 words)

Per fix: what changed (file:line); tests and counts with log names; anything skipped and why; **Noticed, not done**.
