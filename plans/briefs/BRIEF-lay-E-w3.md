# BRIEF lay-E-w3 — two socket test files follow the version 2 copy / set

Worker for lane **lay-E** (supervisor: lay-E). App: `/home/jody/github/serene-pub`. SDK read only (built; never edit, never build).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
Two integration test files still assert the version 1 behaviour that this lane intentionally changed. Update their EXPECTATIONS (never the code under test) so they state today's behaviour and keep each test's intent. Both files were green before this lane's edits (baseline 2026-11-06).

## What changed (the code is final — don't edit it)
- `copyLayoutIntoSession` (`src/lib/server/db/layoutPresets.ts`) reads the preset through `presetLayoutAsV2` (`src/lib/server/db/panelsFromStored.ts`): a preset whose layout is panels version 1, or only ⏳ old slots that place something, is copied as `{ ...oldSlotsKept, panels: <version 2> }`; its `widgetSettings` keys `composer`/`otherTabsComposer`/`showActions` move from a `messages` copy to its `composer` instance and `nextUp` to `turn-line`; `composerPosition`/`showComposer`/`showMessages`/`showNudge`/`backingMode` are dropped from messages copies, `hostCard` from every widget; a style pin on a composing `messages` copy is ALSO copied to its `composer` / `turn-line` (unless they have one).
- Save as new / Save changes pack through `storedLayoutAsV2` (same moves, written into the preset blob). `markStartedFrom`'s inserted row is v2.
- `sessions:panelLayout:set` (`src/lib/server/sockets/sessions.ts`) runs `panelLayoutWriteAsV2` (`src/lib/server/db/sessionLayoutPanels.ts`) BEFORE validating: a v1 / old-slot layout is stored as v2 and its sent (or, when not sent, stored) settings move the same way. A `{}` layout (no panels, no old slot) is NOT rewritten, but sent `messages.composer` still moves to a `composer` row (readers derive the floor's composer).
- Messages no longer DECLARES `composer` (lay-B): `messages: { composer: … }` is no longer a valid Messages setting anywhere.
Read `panelsFromStored.ts`'s doc comments first. Compute expected panels with `panelsV2Of(layout).panels` from `@serene-pub/sdk` rather than hand-writing them, the way `sessions.layoutPresets.int.test.ts` now does with its `asV2` helper (see it for the pattern — you may copy that helper into your file; don't import across test files).

## Do
1. `src/lib/server/sockets/sessions.layoutCopy.int.test.ts` — 8 failing tests:
   "a person's new-session layout is what their first open copies"; "🚧 a guest's own new-session layout still wins over the guests' layout"; "LB: the incoming layout's settings and pins win for each instance it names; the session keeps the rest" (≈:612); "a shared layout may be started from; …"; "no longer accepts a preset id: provenance is written only by a copy or Save as new"; "packs the PLACED instances' settings and pins, and the session now started from it"; "a placed `#n` copy's settings and pin survive Save as new and Start from, under the same ids"; "a plugin genre's own layout … is what a session of that genre copies on first open".
   For each, check that the difference is exactly the change described above (v2 `panels` added beside kept old slots; moved settings; copied pins). If it is, update the expectation. If a test's FIXTURE uses `messages: { composer: X }` purely as an example setting, prefer switching the fixture to a key Messages still declares or to the `composer` instance (`composer: { composer: X }`) when that keeps the test's intent more clearly than asserting the move — say which you chose per test.
2. `src/lib/server/sockets/sessions.widgetSettings.int.test.ts` — 5 failing tests: "what is set comes back keyed by widget id" (≈:102), "a blob-only set leaves the stored settings alone" (≈:148), "a core widget's id is accepted" (≈:287), "a key the client omits is still swept" (≈:357), "the accepted keys still land beside a dropped one" (≈:373). They use `messages: { composer: … }` as an example setting; Messages no longer declares it, so `:set` moves it to `composer`. Switch the FIXTURES to the `composer` instance (`composer: { composer: … }`, a core widget, valid values classic·minimal·writer·quill) or to a key Messages still declares (read `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/widgets.ts`, the `messages` entry), keeping each test's intent (keyed by widget id; blob-only set leaves settings alone; a core widget id is accepted; an omitted key is swept; accepted keys land beside a dropped one).
3. If ANY failure is not explained by the change above, don't touch it: report it with file:line and the assertion diff.

## Files owned
Only `src/lib/server/sockets/sessions.layoutCopy.int.test.ts` and `src/lib/server/sockets/sessions.widgetSettings.int.test.ts` — minimal hunks. NEVER edit `src/lib/server/sockets/sessions.ts` (shared with another programme) or any non-test file.

## Rules (quoted)
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `prettier --write` a whole file you didn't create.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need none.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` — or, in this app, on any file: other lanes' uncommitted work lives there.
- It is a **session**, never a *chat*. DB-in-`it` tests keep their 60 s timeout.

## How to run (MANDATORY — a bare run OOM-killed VS Code)
One file at a time, in the capped scope, logging to a file, never piped into `head`:
```
S=/tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run --no-file-parallelism <one file> > $S/lay-E-w3-t.log 2>&1; echo test-exit=\$? >> $S/lay-E-w3-t.log"
grep -E "Test Files|Tests |FAIL|✗|×|test-exit" $S/lay-E-w3-t.log
```
Scratch files start with `lay-E-w3-`. No tsc needed beyond: in its own scope (MemoryMax=12G, `--max-old-space-size=8192`) `npx tsc --noEmit -p .` > `$S/lay-E-w3-tsc.log`, then grep for your two files.

## Done means
Both files green, each run alone; tsc shows no error in them.

## Report (your final message — you cannot write report files)
Per test: what changed and why (one line); runs with results; anything unexplained; Noticed, not done.
