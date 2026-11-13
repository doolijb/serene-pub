# BRIEF lay-V-w1 — app tests left asserting the pre-split / pre-R10 behaviour (session layouts, simplified)

Worker (Sonnet) under lane supervisor lay-V. App: /home/jody/github/serene-pub. SDK (read only for you): /home/jody/github/serene-pub-sdk.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Context (what the build changed — ruled by the owner 2026-11-05, already built)
- R8: "Split the messages, composer and activity status/turn select into three widgets". Core now ships three conversation widgets: `messages` (the log), `composer` (the field, persona, actions, the closed/waiting reasons and join prompt) and `turn-line` (what the last run did, who is next). Their built modules are `node_modules/@serene-pub/core-catalog/dist/components/{messages,composer,turn-line}.js` (built 2026-11-06 03:29). The composer's DOM still carries the old part names plus aliases (`messages.compose …` and `composer.*`), and `sp-composer-field` is now placed by the Composer, not by Messages.
- R10: "don't have most widgets show placeholder text when there's nothing to show. Messages being an obvious exception" — an empty widget draws nothing. Error states, a greyed control's reason, owner buttons and CAUSE lines (e.g. "Pick a key in settings", "Nothing matches." after a search) stay.
- Composer and Turn line are placeable core widgets: they are in `coreDefaultWidgets()` on purpose (the session layout manager needs them as instances for settings and the editor tray); they read `messages` (same reads as Messages) and declare `panel` (fit) instead of `layout`, and have no `icon` yet (owner ★7 "no glyph for Composer/Turn line" is OPEN — do not invent an icon).
- `CORE_VIEW_ONLY_COMPONENTS = ['messages','composer','turn-line']` (core trust; never cloneable).

## Goal — make each file below pass by updating it to the ruled behaviour (fix code only where stated)
1. `src/lib/client/components/sessionPage/composerSlashArgument.dom.test.ts`, `composerDraftClear.dom.test.ts`, `narrateDraft.dom.test.ts`, `composerClosedJoin.dom.test.ts`: they mount `dist/components/messages.js` and drive `sp-composer-field` → "nothing matches 'sp-composer-field' in the mirrored component". Mount `dist/components/composer.js` instead (keep `owner: "core"`, `coreConversation: true` if the harness accepts it for the composer; check `../serene-pub-sdk/cli/src/testing.ts` and how `../serene-pub-sdk/sdk-tests/coreComposerComponent.test.ts` mounts the composer, and mirror that). Keep every behavioural assertion; only change what mounting/locating needs. If a test's assertion is about something that now lives in the Turn line (e.g. a "Waiting: …" line), mount `turn-line.js` for that test instead — look at the component source in `../serene-pub-sdk/core-catalog/components/shared/{composer,turn-line,messages}/` to decide; say in your report which file draws it.
2. `src/lib/client/components/sessionPage/remoteActions.dom.test.ts` ("groups: turn draws the turn controls alone" expects "This session offers none of these actions here.") and `remoteAlbum.dom.test.ts` ("source and channel narrow it; empty says so in one line" expects "Nothing has been attached or generated in this session yet."): those sentences were removed by R10. Change the assertions to: the widget draws no sentence (the root's text is empty / no such line), keeping the rest of each test. Retitle the album test so its name no longer says "empty says so in one line" (e.g. "…; empty draws nothing (R10)").
3. `src/lib/server/components/authoredArtifact.dom.test.ts`: Stats with no data now draws nothing (R10), so `expect(drawn(clone)).not.toBe("")` fails. Keep that non-empty guard (it stops the equality being vacuous): give BOTH mounts a context in which Stats has something to draw — e.g. use `componentParitySections()` from `@serene-pub/conformance` (as composerSlashArgument does) or a `scoped.session_state` section with one attribute, whichever makes core's Stats draw text. Both mounts must receive the same context.
4. `src/lib/client/components/sessionPage/coreWidgets.test.ts`: update to the ruled list — the 15 ids now include `composer` and `turn-line`; the "every side widget declares icon and layout" check exempts exactly `composer` and `turn-line` (comment: they are conversation widgets that declare `panel`, not `layout`; their glyph is owner ★7, open); "the side widgets read no log — but the album" exempts the album AND the two conversation widgets (comment: they draw the same log and dossier as their Messages copy). Update the stale prose comment ("Eleven: … thirteen with the routine log") with one line for the split (PLAN-session-layout-simplify, owner R8 2026-11-05). Do not change `coreWidgets.ts`.
5. `src/lib/server/components/core.ts` (CODE fix): `SOURCES` has no loader for `composer` / `turn-line`, so `components.int.test.ts` "listed with their source hashes…" fails (`CORE_SOURCE_SLUGS` ≠ `CORE_COMPONENTS`). Add `composer` and `"turn-line"` loaders in the same `?raw` pattern (after `messages`), and update the file's header comment: `messages` → "the conversation widgets (`messages`, `composer`, `turn-line`) are view-only". The int test file itself needs no change unless it then fails for another reason (report it).
6. Comment-history ratchet (`src/lib/shared/conformance/commentHistory.test.ts`): rewrite exactly these three comments as present-tense rules (no "no longer" / "used to" / "deliberately not"), meaning unchanged:
   - `src/lib/client/sessionLayout/SessionLayoutEditor.svelte:122` `/** The chosen tab (instance id); one no longer placed reads as null. */` → e.g. `/** The chosen tab (instance id); null when nothing is chosen or the tab is not placed. */`
   - `src/lib/client/sessionLayout/sessionZones.svelte.ts:47` (the sentence starting "`shown` is no longer available") — reword, e.g. "when `shown` is not among the available zones, `shown` becomes `opening`…".
   - `src/lib/client/utils/keyboardNavigation.ts:28` "Alt+[ / Alt+] are the app's again (the session no longer takes them)" → "Alt+[ / Alt+] are the app's (no session binding claims them)…".
   Comment-only edits; touch nothing else in these three files. Do NOT run `npm run comments:ratchet` and do not edit `commentHistory.ratchet.json` (18 other files over the ratchet belong to other programmes; the test will still fail for them — that is expected; check only that these three files are no longer listed).

## Files owned (edit only these)
The six `.dom.test.ts` files and `coreWidgets.test.ts` named above; `src/lib/server/components/authoredArtifact.dom.test.ts`; `src/lib/server/components/core.ts`; the three comment lines in item 6.

## Files readable
Anything. Especially `../serene-pub-sdk/core-catalog/components/shared/{composer,turn-line,messages,actions,album,stats}/`, `../serene-pub-sdk/cli/src/testing.ts`, `../serene-pub-sdk/sdk-tests/core{Composer,TurnLine}Component.test.ts`.

## Out of scope
Any other failing test (speech, cast/seat, migrations, wiring, interestGate…) — other programmes' work. Any SDK file. `messageBacking.ts`/`.test.ts` (owner deletion pending). No new names, settings, copy.

## Stop and ask (in your report, don't decide) when
A test can only pass by changing behaviour (code) other than item 5; a new user-visible string would be needed; a file outside "Files owned" needs a change.

## Rules (quoted from CLAUDE.md / lane common brief)
- "Never hand a DOM node to an assertion (compare `x === null` to `true`)." — so `expect(view.query(X) === null).toBe(true)`, never `expect(view.query(X)).toBeNull()` / `.not.toBeNull()`. Rewrite any such assertion you touch or add; a failing assertion on a happy-dom node balloons and has OOM-killed VS Code.
- "Every test or typecheck run goes inside a memory-capped scope … never bare, one group at a time, logging to a file", ONE test file per run:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run <ONE file> > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-V-w1-<name>.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-V-w1-<name>.log'` then grep the log.
  tsc only if needed: same scope with MemoryMax=12G and `--max-old-space-size=8192`, `npx tsc --noEmit -p .`, filter to your files.
- "Never pipe vitest into `head`" (SIGPIPE leaks PGlite temp dirs). DB-in-`it` int tests need a 60 s timeout.
- "It is a session, never a chat." Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. `$state(new Set/Map)` is not reactive — `SvelteSet`/`SvelteMap`. `socket.off(event)` always with the handler.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need a build at all.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.
- Another programme is editing server files concurrently: re-read a file right before editing it; minimal hunks; never rewrite whole files.

## Done means
Each of these, run alone in the capped scope, green: composerSlashArgument.dom, composerDraftClear.dom, narrateDraft.dom, composerClosedJoin.dom, remoteActions.dom, remoteAlbum.dom, authoredArtifact.dom, coreWidgets, sockets/components.int (after item 5). commentHistory run once: the three files no longer listed. `npx prettier --check` on every file you changed.

## Report (your final message)
Changed files with one line each; per test file the run result (pass/fail counts); for item 1 which component draws the closed reason / join prompt; anything you could not do and why; Noticed-not-done.
