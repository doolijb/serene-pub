# BRIEF — lane `perf-N` — the other widget sections skip by identity; the SDK's per-frame order work is measured

**Supervisor:** read `.claude/guides/multi-agent.md` first, then `.claude/guides/review.md` §2. Plan:
`plans/PLAN-performance-2026-11-13.md` Part 1, §4.2c row perf-N. Build on `plans/REPORT-perf-F-2026-11-13.md`
(`heldFrom`/`postChangedFrom`, the "Step 2 follow-on" line: 150 → ~0 stringifies per 50 frames if the owners of
session, settings and scoped replace rather than mutate) and `plans/REPORT-perf-H-2026-11-13.md` (what a streamed
frame now posts).

## Part (a) — identity skip for session, settings and scoped (build)

`widgetWire.svelte.ts` `push()` (~`:340-375`): `session` goes through `postChanged` (a stringify compare),
`settings` and `scoped` likewise; `props`, `actions`, `annex`, `theme` already use `postChangedFrom`
(reference skip, then stringify only when the reference moved). Do the same for the three. Then prove at each owner
that the reference is **stable while nothing changed and new when something did**:

- `host/RemoteWidget.svelte` `sessionV1` (`:228`): what it derives from; a streamed frame must not rebuild it
  (perf-F made the page's composed `session` stable across frames — check that `sessionV1` inherits that).
- `surfaces/Panel.svelte` `session` (`:305`), `resolved.settings` (`:308`), `grantedScoped` (`:311`):
  same question for each; `` objects rebuilt from unchanged inputs are a new reference per rerun — key
  them so they rerun only on their own inputs (`untrack` what is not theirs; no `` mutation of a shared
  object).

A wrong answer here is a missed update (a settings change that never reaches a widget), so every owner gets a dom
test: 50 streamed frames → 0 posts of that section; one real change → exactly one post with the new value.

**Challenger [C13], accepted:** the hottest wire is not in the list above. The eager primary conversation mount is
`sessionLayout/SessionLayoutRender.svelte:208-221`, passing `scoped={dossier ? { session_full: dossier } : undefined}`
and `settings={r.settings}`; `dossierFor` (`sessionLayoutModel.svelte.ts:649-680`) builds a new object on every call,
and the page's `conversationDossier` (`sessionPageProjections.ts:740`) derives from `session.sessionMessages`, which a
streamed delta hands a new source each frame. So `session_full` is a new reference every frame and the whole dossier is
stringified per frame; a Panel-fixture test would show 0 posts while the real mount does not change. **Add to Files
owned and prove:** `SessionLayoutRender.svelte` (those two props), `sessionLayoutModel.svelte.ts` `dossierFor`, and the
`conversationDossier` derivation in `sessionPageProjections.ts` — the dossier must keep its reference while a reply
streams and change when a dossier input changes. Also: the push effect (`widgetWire.svelte.ts:740-757`) reruns after a
deep in-place change today only because `push`'s stringify reads deeply; a reference skip removes that trigger, so
every owner test gets a **nested in-place mutation** case (and if any writer mutates in place, stop and name it —
the challenger found none in `widgetSettings.svelte.ts:50-55,97-104`, `sessionPageData.svelte.ts:374-375`,
`sessionState.ts:240`). Report **real-mount** counts (SessionLayoutRender with the page store streaming 50 frames), not
only fixture counts.

**Also yours ([C12]):** `ready` is handled in `widgetWire.svelte.ts:564-577` and the option is read off `opts` at push
time (`:362`, `:403`); `attach()` (`:821-829`) resets `sent`/`heldFrom`/`deliveredLog`. perf-M (if the owner rules it)
will need the declaration read in the `ready` handler and reset on every `ready` and in `attach`; you own the file this
round, so leave that handler readable and do not restructure it.

## Part (b) — measure the SDK's per-frame order work, build only if material

`SessionContainer.svelte:164` `msgOrderKey = messages.map(...).join(",")` reruns whenever `messages` is a new
array; `componentWire.ts` `case 'message'` copies the array per row patch (perf-H, on purpose), so this is O(N)
per streamed frame, as are the per-channel re-filters in `conversation.svelte.ts` (~`:160-190`). **Measure** on a
500-row window, 50 frames, in a node/happy-dom bench (the SDK has `PERF_BENCH`-style benches in `sdk-tests` —
follow their shape): ms per frame for the order key and the filters. Report the numbers. **Build a skip only if the
cost is over ~1 ms per frame** and only where it is exact: a patch that replaced one row by id with the same id at
the same index cannot change order, hidden-ness or channel membership unless `isHidden` or `channel` moved — so
**[C14], accepted:** the exact condition is wider than id/`isHidden`/`channel` — `conversation.svelte.ts:178-194`
orders and filters on `metadata.anchorMessageId` (`interleave.ts:32-35`) and on round and kind (`rowsByKind`, `:144`),
and `SessionContainer`'s `laneKey` (`:177-179`) reads `anchorOf`/`isInterleaved`. So a skip is exact only when, for
every row, id, `channel`, `isHidden`, `anchorMessageId`, round and kind are unchanged. **Reuse only strings/keys, never
a filtered row array** (`SessionContainer.svelte:166-172` says why: the template would draw the stale row). An O(N)
shape check costs about what the `join` saves, so the only real win is an O(1) "same shape" fact crossing the wire
from `componentWire` — **that is a new name: do not build it; raise it as ★N-1 with the measured numbers.** State the
gate in phone terms: measure on this machine and apply a ×4 factor (the standing ruling: browser code runs on phones)
— so build nothing unless the per-frame cost here exceeds ~0.25 ms, and even then only the exact, key-only form.

## Rules you quote into every worker brief

- P1: a skipped post is one whose value is identical; a missed real change is a bug, not a saving. Tests prove both
  directions for every section touched.
- Svelte 5: `` reruns on any tracked read; use `untrack` deliberately and say why in a comment;
  `(new Map())` is not reactive.
- NOMENCLATURE §24/§25 for any new name (a "same shape" fact crossing the wire would be one — record it 🚧).
- SDK edits only under (b) and only if built; then `sdk:build` at the end after `pgrep -af "vite dev"` is empty
  and the lead's go. Never `git checkout/restore/stash` in `../serene-pub-sdk`.
- perf-M runs at the same time and may queue a one-hunk change to `widgetWire.svelte.ts` (an option set after
  construction); if its report lands while you hold the file, apply that hunk and say so.

## Files owned

`src/lib/client/components/frames/widgetWire.svelte.ts` (+ tests), `src/lib/client/sessionLayout/SessionLayoutRender.svelte` (the two props), `src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts` (`dossierFor`), `src/lib/client/components/sessionPage/sessionPageProjections.ts` (`conversationDossier`), `src/lib/client/components/host/RemoteWidget.svelte`
(the `sessionV1` derivation only, + tests), `src/lib/client/components/surfaces/Panel.svelte` (the three inputs
only, + tests), SDK `core-catalog/components/shared/messages/SessionContainer.svelte`,
`core-catalog/components/shared/messages/conversation.svelte.ts`, `sdk/src/componentWire.ts` (only for the
"same shape" fact, only if (b) is built), `sdk-tests/` bench + tests, `NOMENCLATURE.md` §25 (append only).

## Out of scope

`PluginFrame.svelte` (perf-M's); the messages section's own rules (perf-H's); any throttle or timer; changing what
any section carries.

## Stop and ask when

CLAUDE.md §Decisions applies; an owner's object is mutated in place by someone else (name the writer; do not patch
around it); (b)'s only exact skip needs a wire change you judge larger than the saving.

## Done means

Part (a): the three dom tests above; `widgetWire*` and `host/*`, `surfaces/*` dom tests green; a wire test that
50 messages-only pushes stringify the three sections 0 times (perf-F asserted 600 → 150 for the whole push; extend
that assertion). Part (b): the bench numbers in the report; if built, a test that a row patch with unchanged shape
reuses the key and a hidden/channel change does not. `npx tsc --noEmit -p .` clean on touched files; prettier on each.

## Report

`plans/REPORT-perf-N-2026-11-13.md` (dated 2026-11-14 inside): changed files, per-section before/after post counts,
the (b) measurements and the decision, tests with counts, open ★, **Noticed, not done**.

Every worker brief carries verbatim:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- "Never pipe vitest into `head`. Run int and dom tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`. Never `prettier --write` a file that was unclean at HEAD."
