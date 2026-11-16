# BRIEF — build lane `perf-F` — the client does per-row work while a reply streams, and ships one icon map

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then: `plans/PLAN-performance-2026-11-13.md`
Part 1, W1-c/d/e and W6-a; `plans/REVIEW-performance-2026-11-13.md` rows B4, B5, B6, G1; `plans/REPORT-perf-A-2026-11-13.md`
(what the server side already does: frames still arrive as `sessionMessage` with the full row — ★P1 is unruled, so
the client still receives full rows); CLAUDE.md Principles, Hard rules (`SvelteSet`/`SvelteMap`, sockets rule) and
`STYLE-GUIDE.md` only if you touch markup (you should not). The peer session `serene-pub-c4` has just finished with
`src/lib/client/sessions/store/sessionStore.svelte.ts`, `derive.ts`, `records.ts`,
`src/lib/client/components/sessionPage/sessionPageData.svelte.ts` and `sessionPageProjections.ts`: build on their
current uncommitted contents (`mergeRunStatus` keeps a `routine` field; the first-load branch drops held routine
runs; `rewind` carries an optional `step`). Line numbers are from 2026-11-13; re-read before editing. Rows marked
**S** are sweep findings: re-verify at their lines first.

## Rulings that bind

- Owner 2026-11-13: change how often, never what. What a member sees while a reply streams — text, status line,
  sidebar row, widgets — is unchanged. ★P1 (delta frames) and ★P7 (lazy-loaded views) are unruled: no new event,
  and no view becomes lazy in this lane.
- `$state(new Map())` / `new Set()` is not reactive on mutation: `SvelteMap` / `SvelteSet`.

## Build

1. **Page-side deriveds stop scanning every row per frame** (B5, **S**). `sessionStore.svelte.ts:62–70` (`messagesOf`
   rebuilds the array), `sessionPageData.svelte.ts` ~100–103, ~401, ~432, ~459, ~463, ~474, `openSessionView.svelte.ts`
   ~14–21, `SessionHostViews.svelte` ~471–474, `shared/sessions/rewind.ts:139` (`[...messages].reverse().filter`).
   Verify first with a counting test (a fake socket delivers 50 `sessionMessage` frames for one row; count how many
   times each derived runs). Then: keep the rows array identity stable when a frame patches an existing row's content
   (patch in place behind a `SvelteMap` keyed by id, or keep the streaming row in its own signal), so only deriveds
   that read that row's content rerun; derive "newest row", "any generating", "last author line" and the rewind
   facts from the ids window or the one changed row, not a scan. Same values in every case.
2. **Widgets get a row patch, not a window clone** (B4). `RemoteWidget.svelte:200–204` snapshots and re-projects
   every row per frame; `widgetWire.svelte.ts:234`, `:316`, `:309–347`, `:645–676` re-project, structured-clone and
   JSON-compare session, props, settings, annex, turn order and attendance per token. Post the full projected list
   only when rows are added or removed or a non-content field changes; post one projected row (the existing
   `message:delta` / `witnessMessage` machinery if it fits, else a row-patch frame on the wire that already exists —
   **no new socket event**; this is the worker boundary, not the socket) when only `content`/`reasoning` of one row
   changed; drop the per-token JSON comparisons in favour of identity checks on the inputs that did not change.
   Widgets that declare no `reads` still count as reading messages, as today.
3. **SDK rows read O(1) facts** (B6, SDK repo `../serene-pub-sdk`). `SessionMessage.svelte:61–66`, `:212`;
   `SessionContainer.svelte:160–268`; `MessagesWidget.svelte:206–260`; `conversation.svelte.ts:177–191`. Compute
   `hasGeneratingMessage`, the set of rows that answer forms, and the `scened` set once in `conversation.svelte.ts`;
   rows read them O(1). Key the container's and widget's O(N) deriveds on the existing `msgOrderKey`; gate
   `selectable` on `selecting`. **The peer session owns `TurnLine.svelte`, `rewindStrip.ts`, `ComposerWidget.svelte`,
   `sdk/src/sessionDossier.ts` in that repo: do not touch them.** After SDK edits: `pgrep -af "vite dev"` first; then
   `npm run sdk:build` from the serene-pub root — and **message the lead before you run it** (the peer session
   rebuilds the SDK too and must not be mid-test); then `npm run sdk:test` in the capped scope.
4. **One icon map** (G1, W6-a). `AdminView.svelte:22`, `:111` (`Icons[i.icon]` over `import * as Icons`) and
   `routes/+layout.svelte:12`: replace the computed lookups with an explicit name → component map holding exactly the
   icons those sites use (grep the admin route table for its `icon:` values), and the namespace imports with named
   ones. Find any other `Icons[` computed lookup reachable from the entry (`grep -rn "Icons\[" src/lib/client src/routes`)
   and treat it the same. No view becomes lazy (★P7). Measure: `npm run build` once at the end (capped scope,
   `systemd-run --user --scope -p MemoryMax=12G`) and report the size of `build/client/_app/immutable/nodes/0.*.js`
   and the largest chunk before (2.71 MB / 2.24 MB lucide chunk) and after.

## Files owned

`src/lib/client/sessions/store/{sessionStore.svelte.ts,derive.ts,records.ts,openSessionView.svelte.ts}`,
`src/lib/client/components/sessionPage/{sessionPageData.svelte.ts,sessionPageProjections.ts,SessionHostViews.svelte}`,
`src/lib/shared/sessions/rewind.ts` (the `rewindOf` scan only), `src/lib/client/components/host/RemoteWidget.svelte`,
`src/lib/client/components/frames/widgetWire.svelte.ts`, `src/lib/client/admin/AdminView.svelte`,
`src/routes/+layout.svelte`, any file holding an `Icons[` computed lookup on the entry path; SDK:
`core-catalog/components/shared/messages/{SessionMessage,SessionContainer,MessagesWidget}.svelte`,
`core-catalog/src/shared/ui/conversation/conversation.svelte.ts`; tests beside each.

## Out of scope

★P1, ★P7. `Layout.svelte` (the peer edited it; W6-b waits on ★P7). `SpMessageBody.svelte` (done). Any new event,
setting or user-facing name. Markup or styling.

## Stop and ask when

A step needs a new socket event or a lazy import; a derived cannot be made O(1) without changing a value; the SDK
change would alter a widget's visible behaviour; `sdk:build` is needed while a `vite dev` runs.

## Done means

Existing tests for every touched file (list them: `sessionStore.svelte.test.ts`, `derive.test.ts`, the sessionPage
dom tests, `widgetWire` tests, SDK `sdk-tests` for the messages widget) green; the step-1 counting test before/after;
a widgetWire test that 50 content frames post 50 row patches and one list; `npm run sdk:test` after step 3; the
build size numbers from step 4. `npx prettier --check` on changed files; `npx tsc --noEmit -p .` filtered clean.

## Report path

`plans/REPORT-perf-F-2026-11-13.md`: per step verified/built, counts before/after, bundle sizes, tests, open ★,
**Noticed, not done**.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". Tell the lead before each `sdk:build`.
- Never pipe vitest into `head`. Heavy SDK DOM tests run in a capped scope (`systemd-run --user --scope -p MemoryMax=10G`).
- Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.
- At most 2 workers at once. Workers get these rules inline.
