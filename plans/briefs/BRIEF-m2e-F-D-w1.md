# BRIEF m2e-F-D-w1 — rename two genre field-group headings; re-pin the moved hashes

Lane **m2e-F-D**, worker 1. Supervisor reads your report. Absolute paths only. App: `/home/jody/github/serene-pub`. SDK: `/home/jody/github/serene-pub-sdk`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal (owner ruling 2026-11-04, ★M2e-D-2: "rename the two field-group headings **Writing** (was Reply) and **Lair** (was Story)")
In `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/genres.ts`, only the `group` label strings change:
- `group: "Reply"` → `group: "Writing"` (two sites today, ~line 129 `CHARACTER_DETAIL_FIELD` and ~line 174 `AUTHORS_NOTE_FIELD`; grep for every `group: "Reply"` in `core-catalog/src` — `shared/speechFields.ts` and `src/lib/server/sessions/exposure.ts` in the app were checked by the supervisor and carry none, confirm).
- The Lair genre's `group: "Story"` → `group: "Lair"` (three sites today, ~lines 1104, 1129, 1147 — confirm each is inside the Lair genre's `fields`, not Story's). Grep `core-catalog/src` and the app's `src/lib/server/sessions/exposure.ts` for any other `group: "Story"` and report it; change only Lair's.
Nothing else in those declarations moves: no label, description, reach, key, default. Re-read each region immediately before the edit (another programme edits these files now); one-token hunks; never reformat.

## Then
1. `pgrep -af "vite dev"` — if a serene-pub server is up, stop and report. Else `cd /home/jody/github/serene-pub && npm run sdk:build` (log to `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/m2eFD-w1-build.log`).
2. SDK pins, in a capped scope (a failing assert on a DOM node has OOM-killed the editor): `systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && node --test --import tsx coreCatalog.test.ts writes.test.ts lair.test.ts' > <log> 2>&1` — first check `sdk-tests/package.json`'s `test` script and use the same runner/flags it uses, for these three files only. Then run the rest of `sdk-tests` the same way (`npm test --prefix /home/jody/github/serene-pub-sdk/sdk-tests` inside the capped scope) to find every OTHER pin the rename moved.
3. Re-pin every hash that moved **because of this rename**, and only those, each with a dated note in the existing style of that pin's neighbours (read the 3–5 notes above it and copy their form):
   - SDK `sdk-tests/coreCatalog.test.ts` golden (`assert.equal(digest.slice(0, 16), '…')`, ~line 1050): add a `// Moved 2026-11-04 (m2e-F-D, ★M2e-D-2): the genre field-group headings Reply → Writing and the Lair's Story → Lair; only the \`group\` strings. (was '<old>')` line above it.
   - SDK `sdk-tests/writes.test.ts` `core:spec/story-create` pin; SDK `sdk-tests/lair.test.ts` `'core:spec/lair-create'` (~line 760) — `// Moved …` line comments as there.
   - App `/home/jody/github/serene-pub/src/lib/server/pipelines/boot/specHashes.test.ts`: `"core:spec/story-create@2.2.0"` (~line 282) and `"core:spec/lair-create@1.0.0"` (~line 1493) — these use a trailing block comment: `"<new>" /* (was "<old>") — m2e-F-D 2026-11-04: field-group headings Reply → Writing, the Lair's Story → Lair (★M2e-D-2); only the group strings */,`. Also any other spec there whose genre carries `CHARACTER_DETAIL_FIELD`/`AUTHORS_NOTE_FIELD` (e.g. `assistant-create`) if and only if its test fails because of this rename. Run: `cd /home/jody/github/serene-pub && timeout 600 npx vitest run src/lib/server/pipelines/boot/specHashes.test.ts src/lib/server/pipelines/boot/registryHashes.test.ts > <log> 2>&1` (never pipe vitest into `head`). Note: `registryHashes.test.ts` already fails on HEAD for `core:task/sweep-duties@1` (another programme's change, NOT yours — leave that pin alone); re-pin there only an entry that moves because of this rename.
   - **Prove** each move is the rename only: for the SDK golden and each spec pin, show that temporarily reverting the two strings gives back the old hash (or argue it from the digest input if a revert is costly — say which). Restore the rename afterwards and rebuild.
4. Any other SDK test that fails: if it fails because of the rename (a test asserting the old group text), update that assertion and say so; if it fails on HEAD without your change, list it as pre-existing with the failure line — don't fix it.

## Files owned
`/home/jody/github/serene-pub-sdk/core-catalog/src/registry/genres.ts` (the `group` strings only), `/home/jody/github/serene-pub-sdk/sdk-tests/{coreCatalog,writes,lair}.test.ts` and any other `sdk-tests` file whose pin/assertion this rename moves, `/home/jody/github/serene-pub/src/lib/server/pipelines/boot/specHashes.test.ts`, `/home/jody/github/serene-pub/src/lib/server/pipelines/boot/registryHashes.test.ts` (rename-moved pins only).
## Out of scope
Any other declaration change; any pin not moved by this rename; client/docs/NOMENCLATURE (the supervisor queues the §25 note). Never `git checkout`/`restore`/`stash` in `../serene-pub-sdk` — most of it is uncommitted.

## Rules (quoted)
- CLAUDE.md: "after any SDK change run `npm run sdk:build` before app tests or builds — **never while a serene-pub `vite dev` runs**."
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- NOMENCLATURE R1 "One word, one meaning": the rename exists because "Reply" already names the Reply loadout and sampling config, and "Story" the Story genre.

## Done means
The five named pins (and any other rename-moved pin) green on both sides with dated notes; the old→new value of **story-create (SDK writes.test + app specHashes) and lair-create (SDK lair.test + app specHashes)** stated on the first lines of your report.

## Report
Write `/home/jody/github/serene-pub/plans/briefs/REPORT-m2e-F-D-w1.md` if the harness allows, else return it as your final message: first lines the new pin values (old → new, each side); changed files; how each move was proven; test runs with counts; Noticed, not done.
