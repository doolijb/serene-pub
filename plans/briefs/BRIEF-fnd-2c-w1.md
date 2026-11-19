# BRIEF — fnd-2c worker 1 — the move tool for `sockets/sessions.ts`, and steps 1–2 (`sessions.shared.ts`, `sessions.messages.ts`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-2c`. You are the only agent editing these files right now. Another lane (`fnd-3`) runs at the same time: it edits test files and comments elsewhere and also runs vitest.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No `sdk:build` is needed in this lane: the SDK is not touched.)

Also: never `git checkout` / `restore` / `git show HEAD:… >` over a file (other lanes' uncommitted work sits in this tree; `sessions.ts` itself carries uncommitted edits that must survive byte for byte); never `prettier --write`; never `kill -9`; never `pkill -f` with a generic pattern; no top-level `await` added anywhere; no full test run and no `npm run build`. Comments state the rule, not the story.

`$S` = `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad`.

## Goal

`src/lib/server/sockets/sessions.ts` (12,643 lines) is being split into sibling `sessions.*.ts` files by **mechanical moves only**. The lane's rule, verbatim from the lane brief:

> **Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved code.** Every name importable from `sockets/sessions` today stays importable from that path (188 importers; `ownBooks.fold.int.test.ts` mocks `./sessions` for `pushSessionToParticipants`: the re-export must stay and the mock must still take effect for the code that calls it; prove it by running that test). `registerSessionHandlers` stays the one entry point and **registers every event in today's order**. A module-level map, cache or lock ends up in exactly one module. […] if a move needs more than that to compile, stop that step and report.

> Per step: no new import cycle (new files import shared helpers from `sessions.shared.ts`, never from `sessions.ts`; an existing cycle is left and named); `tsc` 0 errors; the export set of `sockets/sessions` unchanged.

Every handler in `sessions.ts` is already a top-level `export const …Handler`, and `registerSessionHandlers` only calls `register(socket, xHandler, emitToUser)` on imported names, so these are pure top-level moves: `registerSessionHandlers` itself is never touched.

You do: **(A)** adapt the previous lane's move tool to `sessions.ts`; **(B)** steps 1 and 2, one after the other, each verified before the next.

## Files owned

- `src/lib/server/sockets/sessions.ts` — through the tool only, nothing by hand.
- `src/lib/server/sockets/sessions.shared.ts`, `sessions.messages.ts` — new, written by the tool, nothing by hand.
- Scratch `$S/fnd-2c-move.cjs`, `$S/fnd-2c-w1-*`; logs `plans/fnd-2c-w1-*.log`.

Readable: anything. Do not change the specs `$S/fnd-2c-step1.json`, `$S/fnd-2c-step2.json` or the supervisor's scripts `$S/fnd-2c-*.cjs` other than the one you create (if one is wrong, stop and report). Do not edit any other file.

## (A) The tool: `$S/fnd-2c-move.cjs`

Copy `$S/fnd-2b-move.cjs` (verified on the previous split; read it whole first) to `$S/fnd-2c-move.cjs` and change only this:

1. The target file is `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.ts` (rename the constant if you like; messages say `sessions.ts`).
2. When copying imports into the new file, skip a declaration whose module is exactly `./sessions` or `$lib/server/sockets/sessions` (`./sessions.shared` etc. ARE copied). Self-check 3 refuses exactly those two specifiers (`/^(\.\/sessions|\$lib\/server\/sockets\/sessions)$/`) in the new file.

Nothing else changes. The spec format is the same (`newFile`, `header`, `top: [{ name, leading? }]`; `leading: "all"` takes every comment between the previous statement and the unit, used here for detached section banners).

Know this about `sessions.ts`: two top-level consts sit **inside the import block** (`MAX_SEEDED_SWAPS` line 96, `voicedCharacter` line 106). Neither moves in steps 1–2. Self-check 2 compares only the lines after the last import; your independent proof (check 7) covers the rest.

## (B) Steps

Before the first real run of the tool: `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` must show nothing (a run that loads `sessions.ts` while you rewrite it is spoiled, the supervisor's or the other lane's). If one is up, wait with a short loop, e.g. `until ! ps -eo args | grep -E "node.*vitest" | grep -qv grep; do sleep 20; done` (run it in the foreground with a timeout of up to 600000 ms, repeating if needed), never a blind sleep.

For **each** step `<n>` = 1, 2, in order:

1. `cp src/lib/server/sockets/sessions.ts $S/fnd-2c-w1-before-<n>.ts`; `wc -l` it. `node $S/fnd-2c-top.cjs $S/fnd-2c-w1-before-<n>.ts > $S/fnd-2c-w1-top-<n>.txt` (start-end of every top-level statement, without comments).
2. `node $S/fnd-2c-move.cjs $S/fnd-2c-step<n>.json --dry`. For every unit: its end line must equal the statement's end in `fnd-2c-w1-top-<n>.txt`, and its start may be earlier than the statement's start only by comment lines (for `leading: "all"` units also blank lines between comments). Otherwise stop and report.
3. Run it for real. Paste its summary into your report.
4. `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors.
5. `NODE_OPTIONS=--max-old-space-size=10240 node $S/fnd-2c-exports.cjs $S/fnd-2c-w1-exports-<n>.txt` then `diff $S/fnd-2c-exports-baseline.txt $S/fnd-2c-w1-exports-<n>.txt` → no difference (86 exports; ignore its "host.ts diagnostics" line, it is a standalone program without the app's ambient types).
6. `NODE_OPTIONS=--max-old-space-size=10240 node $S/fnd-2c-cycles.cjs` → every `sessions*.ts` line says `cycle size 1` (it says that for `sessions.ts` today). If not, stop and report the members.
7. Independent proof: `node $S/fnd-2b-w1-diff.cjs $S/fnd-2c-w1-before-<n>.ts src/lib/server/sockets/sessions.ts src/lib/server/sockets/<new file>` → `missing 0`; report blocks, removed lines, added lines. Also `diff <(sed -n '/^export function registerSessionHandlers/,$p' $S/fnd-2c-orig-sessions.ts) <(sed -n '/^export function registerSessionHandlers/,$p' src/lib/server/sockets/sessions.ts)` → empty (registration order unchanged).
8. `grep -nE 'from "(\./sessions|\$lib/server/sockets/sessions)"' src/lib/server/sockets/sessions.*.ts` → nothing (no new file imports `sessions.ts`).
9. The test run (below).

Expected units (re-derive with `--dry`; today's statement lines):

- **Step 1** → `sessions.shared.ts`, 25 units: `checkCharacterOwnership` 180 (with the `// ===== SECURITY HELPERS =====` banner at 175), `checkPersonaOwnership` 196, `checkCharactersOwnership` 214, `checkPersonasOwnership` 230, `checkLorebookOwnership` 252, `processSessionTags` 283 (with the comments 277–281), `buildSessionsListFor` 359, `BINDING_FROZEN_OFF` 589, `putCardsNow` 617, `SESSION_SPRITE_SETS` 686, `relistSessions` 732, `relistWithRow` 742, `relistSessionMembers` 755, `noteSocketInteraction` 849, `getSessionFromDB` 2003, `getPromptSessionFromDb` 2179, `withSessionExtras` 5619, `REFRESH_ROWS` 6197, `buildSessionRefresh` 6207, `resendSession` 6256, `broadcastSessionToParticipants` 6279, `pushSessionToParticipants` 6295, `runLorebookBindingCheck` 6385 (with the banner 6348–6351), `sessionLinePatch` 6497, `clockFromColumns` 6593. Expected after: `sessions.ts` imports what it still uses from `./sessions.shared` and re-exports the exported ones (`relistSessionMembers`, `getPromptSessionFromDb`, `pushSessionToParticipants`, `runLorebookBindingCheck`, `sessionLinePatch`); the new file ends with an `export { … }` of the moved non-exported names `sessions.ts` still uses.
- **Step 2** → `sessions.messages.ts`, 16 units: `MESSAGES_PAGE_LIMIT` 4439, `sessionsMessagesPageHandler` 4449, `sessionsChannelLanesHandler` 4518, `sessionsLaneReadHandler` 4603, `sessionMessagesSendPersonaMessageHandler` 8877, `sessionMessagesUpdateHandler` 9141, `heldRerunRefusal` 9330, `sessionMessagesDeleteHandler` 9345, `sessionMessagesRegenerateHandler` 9552, `sessionMessagesExtendHandler` 9786, `sessionMessagesSwipeLeftHandler` 9947, `sessionMessagesSwipeRightHandler` 10133, `sessionMessagesCancelHandler` 10429, `sessionMessageHandler` 10609, `promptTokenCountHandler` 10696 (with the comments 10686–10694), `playerSeatRefOfPersona` 12058. (Line numbers shift after step 1; the names are what count.) Expected after: `heldRerunRefusal` is in the trailing export (the turn handlers still in `sessions.ts` use it).

Test runs — check no vitest is running first (wait as above), then `ls -d /tmp/serene-pub-vitest-* 2>/dev/null | sort > $S/fnd-2c-w1-tmp-before-<n>.txt`, then exactly this, one run at a time:

```
cd /home/jody/github/serene-pub && T="$(node $S/fnd-2c-tests-for.cjs <n>)" && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 $T > plans/fnd-2c-w1-<n>.log 2>&1"
```

(Step 1 runs the whole lane list, 118 files, about 15–25 minutes: run it in the background and wait for it, don't poll in a tight loop.) Read results with `sed 's/\x1b\[[0-9;]*m//g' plans/fnd-2c-w1-<n>.log | grep -E "FAIL|Test Files|Tests "`; never pipe vitest itself into `head`. Baseline: the supervisor's pre-change run `plans/fnd-2c-0.log` (read it the same way); a failure is allowed only if the same test fails there. Anything else failing is a stop: report it with the failing assertion. Afterwards delete by name only the `/tmp/serene-pub-vitest-*` dirs that are new compared with your before-list and that your run made (if the other lane's vitest ran meanwhile, leave any dir you are not sure of and say so).

## Stop and ask when

A move needs any change to a moved line to compile; an import cycle appears; the export set differs; the tool's self-check fails and the cause is not a tool bug; `--dry` resolves a unit to other lines than the rule in (B)2 allows; a test fails that does not fail in the baseline. Report instead of improvising; a step that is not green is not followed by the next.

## Done means

The tool exists; steps 1 and 2 landed in order, each with checks 4–9 green.

## Report

Final message: the tool's changes (a line each); per step — the `--dry` output, `sessions.ts` lines before/after, the new file's lines, the import/re-export lines the tool wrote into `sessions.ts`, the trailing export list, pruned specifiers, checks 4–9 with numbers (tests: files/tests passed/failed and which); anything you changed in the tool beyond (A) and why; Noticed, not done. Under 600 words plus the pasted `--dry` outputs.
