# BRIEF — worker `ss-7-fix-w1` — the Turn line's live region; one "Send is shown" rule; the dossier declares `sendShown`

Supervisor: lane `ss-7-fix` (report to it through your final message). App `/home/jody/github/serene-pub`,
SDK `/home/jody/github/serene-pub-sdk` (edit SDK files there).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout` / `restore` in either repo; never `prettier --write`; never `kill -9`; no migration.
Another worker runs at the same time on server files: every test run and every `sdk:build` goes through the lane's
lock (below) so only one runs at a time. Before `sdk:build` also check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` (none of ours may run: the lock covers our lane; if
another vitest is up, wait and retry, or report). The esbuild process whose parent is the VS Code
svelte-language-server is not a vite server; ignore it.

## Goal — three fixes, each with a test

### 1. The elapsed time leaves the polite live region

`core-catalog/components/shared/messages/TurnLine.svelte` ~332–380: `turn-line.runs` is the one
`aria-live="polite"` region (`aria-relevant="additions text"`); the elapsed words (`turn-line.run-since`,
re-rendered every second by the `now` tick ~199–206) sit inside it, so a screen reader is told the time every
second. Rule: the polite region announces arrivals and *‹name› finished* only. Put `aria-hidden="true"` on the
`turn-line.run-since` span (it stays visible; keep the part name). Do not move the region or change its parts.

Test (SDK, `sdk-tests/coreTurnLineRuns.test.ts`): mount a run with `since`; collect the live region's text
**excluding `aria-hidden="true"` subtrees**; wait past one tick (~1.2 s, as the existing finished-run test waits
with `setTimeout`); the collected text is unchanged, and `turn-line.run-since` is (inside) `aria-hidden="true"`.

### 2. "Send is shown" is one rule, read by the Composer and the Turn line

Today the Composer draws Send when `showSend || !submitOnEnter` (`SessionComposer.svelte` ~287 and ~1174:
`submitOnEnter = conv.ctx.layout?.v1?.tier !== "compact"` — at the compact (phone) width Enter writes a new line
and only the button sends, so the button always shows there). The Turn line reads the host's
`dossier.composer.sendShown` (`composerSendShownOf`, `components/shared/composer/target.ts` ~62–69) and ignores
width, so at phone width with the setting off it draws a second Stop and shows Continue under *Nothing*.

The lane's rule (owner brief F, 2026-11-16): *"At the compact (phone) width Enter writes a new line and only the
button sends: there the button stays whatever the setting says."*

Build: one function in `components/shared/composer/target.ts`:
`export function composerSendShown(setting: boolean | undefined, tier: string | undefined): boolean` —
true at the compact tier whatever the setting; otherwise the setting, absent read as shown (`setting !== false`).
Doc comment states the rule (🚧, `@experimental` like its neighbours). Then:
- `SessionComposer.svelte` ~1174 draws Send/Stop by `composerSendShown(showSend, conv.ctx.layout?.v1?.tier)`
  (same behaviour as today; `submitOnEnter` stays for Enter).
- `TurnLine.svelte` ~81: `sendShown = composerSendShown(composerSendShownOf(dossier), conv.ctx.layout?.v1?.tier)`.
  Update the two comments above `sendShown` / `composerStops` to state the rule (no history).
- The host keeps telling the setting answer (`composerShowsSendFor` in the app is not yours; leave it).

Test (`sdk-tests/coreTurnLineRuns.test.ts`): give `mountTurn` an optional tier (as `mountComposer` passes
`layout: { tier }`). At `compact` with `sendShown: false`: generating → no `turn-line.stop`; `nextUp: 'hidden'` →
no `turn-line.continue`; default `nextUp` → `turn-line.continue` present (Continue follows **Who is due next**
as before). Keep the existing Composer test green. A unit assertion of `composerSendShown` for the four cases is
welcome.

### 3. The dossier declares `composer.sendShown`; read without a cast

- `sdk/src/sessionDossier.ts` ~555–571 (`SessionDossierV1.composer`, beside `target` / `writingTo`): add
  `sendShown?: boolean` with a 🚧 doc comment and `@experimental`: told only to a Turn line: whether a Composer
  following the same Messages copy has **Show the Send button** on (absent: shown); at the compact width Send
  shows whatever this says (`composerSendShown`).
- `composer/target.ts` `composerSendShownOf`: take the dossier's type (check what `TurnLine` passes —
  `ConversationDossierV1` is `SessionDossierV1`, `core-catalog/src/shared/ui/conversation/dossier.ts` ~43) and
  read `dossier?.composer?.sendShown` with no cast.
- `/home/jody/github/serene-pub-sdk/INTEGRATING.md` ~1736 (the `session:full` row that lists `runsInProgress`,
  `rerunWaitsFor`): add one 🚧 clause for `composer.sendShown` in the same style.

## Files owned (edit only these)

SDK: `core-catalog/components/shared/messages/TurnLine.svelte`, `core-catalog/components/shared/messages/SessionComposer.svelte`,
`core-catalog/components/shared/composer/target.ts`, `sdk/src/sessionDossier.ts`, `INTEGRATING.md` (that row only),
`sdk-tests/coreTurnLineRuns.test.ts`, and `guides/widgets.md` only if `npx tsx scripts/gen-widget-parts.ts`
regenerates it (no parts should change).

## Files readable

Anything. Read `STYLE-GUIDE.md` §6.16's Turn line row (line ~1967) for the parts.

## Out of scope

NOMENCLATURE and docs (the supervisor writes the ledger and docs); the app's `sessionLayoutModel` and anything
server-side; any other copy, part or setting change.

## Rules to keep

- Comments state the rule, not the story (CONTRIBUTING §Comments: no "used to", "previously", no bug history;
  `commentHistory.test.ts` counts such phrases and only lets the count go down).
- No other product's name anywhere. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Svelte 5 runes; `$state(new Set())` is not reactive: use `SvelteSet` / `SvelteMap` if you need one.

## Stop and ask when

A new name beyond `composerSendShown`, a new setting, part or copy would be needed; a test needs a file not owned.

## Done means

All commands from the paths shown, through the lane lock, one at a time:

1. `cd /home/jody/github/serene-pub-sdk/sdk-tests && flock /home/jody/github/serene-pub/plans/ss-7-fix.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx tsx --test coreTurnLineRuns.test.ts > /home/jody/github/serene-pub/plans/ss-7-fix-w1-turn.log 2>&1"` — all pass.
   Also `coreConversationComponent.test.ts` the same way (log `ss-7-fix-w1-conv.log`): no new failures.
2. After the checks above: `cd /home/jody/github/serene-pub && flock plans/ss-7-fix.lock npm run sdk:build > plans/ss-7-fix-w1-sdkbuild.log 2>&1` — exit 0.
3. `cd /home/jody/github/serene-pub-sdk/sdk-tests && flock /home/jody/github/serene-pub/plans/ss-7-fix.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx tsc --noEmit > /home/jody/github/serene-pub/plans/ss-7-fix-w1-sdktsc.log 2>&1"` — 0 errors.
4. `npx prettier --check` on each file you changed.

Never pipe a test run into `head`. Report: changed files with line numbers, each test command with its result,
anything not done, anything noticed outside scope (not fixed).
