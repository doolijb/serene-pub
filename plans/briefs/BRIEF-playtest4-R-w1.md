# BRIEF playtest4-R-w1 — the by-date compile answers only its own ask (client side)

Lane `playtest4-R`, worker 1 of 2. Working dir `/home/jody/github/serene-pub`. You are a `lane-worker`. Report back in your final message (no report file). Worker w2 edits server files at the same time — never touch them.

*"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*

## Background (what the server will send — w2 builds it)
The by-date `scenes:compile` ask already carries a `requestId` (a fresh uuid per press). The server echoes it on both `scenes:compile:error` emits, and (new, w2) on the compile **activity** too: `activity.byDate = { date, requestId? }` — `requestId` present only when the by-date ask sent a string one. An entry ask's activity has no `byDate`. An activity without `byDate.requestId` must never be taken as a by-date ask's answer.

## Goal — three items
**1. Types.** `src/app.d.ts` `CompileEntryState.byDate` (~line 669) gains `requestId?: string` — `byDate?: { date: …StoryDate | null; requestId?: string }`. Edit only that line and its doc comment (add "and its ask's `requestId`" or similar, one clause). `src/lib/client/components/modals/compileEntryState.ts` already spreads `a.byDate` whole, so `requestId` passes through; leave the code as is unless a type error forces a change, and say so.

**2. `src/lib/client/components/modals/CompileHistoryEntryModal.svelte`** (658 lines; edit only the spots named; the file has two pre-existing prettier failures ~536/~581 — do not reformat the file, never `prettier --write` it):
- The adoption `$effect` (~255–275): before the entry is known (`id == null`), the `list.find` adopts ONLY an activity whose `a.byDate?.requestId` is a string equal to this window's `askedRequestId` (and `askedRequestId !== null`). Keep every existing condition (`!knownActivities.has`, lorebook, `sameLineAndMoment`, `a.byDate !== undefined && sameAskedDay(a.byDate.date)`) as further conditions. Update the comment above it in one or two lines.
- `handleError` (~362–378): a refusal whose `data.requestId` is a string equal to this window's `askedRequestId` (non-null) is this window's — accept it (set `errorMessage = data.error`, `step = "error"`) **without** the `historyEntryId` / `isAskedDay` checks. Today `isAskedDay(entryOf?.(data.historyEntryId))` gets `undefined` for an entry `entryOf` does not hold yet and drops the refusal, so the spinner runs forever. Everything else (the `step !== "running"` guard, ignoring another ask's `requestId`, the entry-window path) stays. Update the doc comment above `handleError` in one sentence.
- DOM tests in `CompileHistoryEntryModal.dom.test.svelte.ts` (fixtures are built through `compileEntryStateOf` — keep that): (a) a by-date window ignores a running by-date activity of its own day whose `byDate.requestId` is another id, and one with no `requestId`; adopts the one carrying its own `requestId` (read the id from the emitted `scenes:compile` params, as existing tests do). (b) a refusal carrying this window's `requestId` and naming a `historyEntryId` that `entryOf` returns `undefined` for shows the error sentence. Adjust existing adoption tests whose fixtures now need `requestId` to adopt — say which in your report.

**3. `src/lib/client/components/sessionPage/requests/compileHistoryEntry.ts`** — `compileByDate`:
- Build it on `awaitReply` from `$lib/client/utils/awaitReply` (read that file; do NOT edit it): `event: "scenes:compile"`, `params` = the existing `satisfies Sockets.Scenes.Compile.ByDate` object with its `requestId`, `replyKey: "activity:update"`, `errorEvent: "scenes:compile:error"`, `match` = the frame holds a compile activity (`kind === "compile_history_entry"`, `status === "running"`) whose `byDate?.requestId === requestId`, `matchError: (d) => (d as { requestId?: unknown } | null)?.requestId === requestId`, `fallbackError: "the day's scenes could not be compiled"` (the existing sentence, byte-identical), `timeoutMs` passed through only if the caller gave one (the 15000 literal goes — awaitReply's default is 15000). Resolve `void` (`.then(() => undefined)`).
- `match`'s parameter is typed as `scenes:compile`'s response (awaitReply types it by `event`); it really is an `activity:update` frame (`{ activities: [...] }`) — cast it, as `plugins/IdPage.svelte` does with its `replyKey: "plugins:list"`. Keep a small local frame type (`CompileFrame` with `byDate?: { date…; requestId?: string }`).
- Remove what the requestId match makes dead (`sameDay`, the day/line/moment/lorebook comparison, the `compareDates`/`dayOnly` imports and `declareInterest` import if unused, and the "another tab's same-day run may resolve first" note). Keep `REPLY_TIMEOUT_MESSAGE` only if still used. Keep the header doc comment, updated in a clause: it settles on the running activity carrying its own `requestId`, or the refusal carrying it.
- `compileHistoryEntry.test.ts`: tests follow — it should still pass the frames/refusals through the same mock of `declareInterest` that awaitReply calls (both import `$lib/client/sockets/interest.svelte`). Cover: resolves on a running frame with its own `requestId`; does NOT resolve on a running frame of the same day/line with another `requestId` or none; rejects with the refusal's sentence carrying its `requestId`; ignores a refusal with another `requestId`; fallback sentence when the refusal has no `error`; timeout rejects with `REPLY_TIMEOUT_MESSAGE` (pass a short `timeoutMs` or fake timers); releases both interests on every exit.

## Files owned (only these; re-read each right before editing; use Edit, never Write on an existing file)
- `src/app.d.ts` — `CompileEntryState.byDate` only
- `src/lib/client/components/modals/compileEntryState.ts`
- `src/lib/client/components/modals/CompileHistoryEntryModal.svelte` + `CompileHistoryEntryModal.dom.test.svelte.ts`
- `src/lib/client/components/sessionPage/requests/compileHistoryEntry.ts` + `compileHistoryEntry.test.ts`

## Files readable
`src/lib/client/utils/awaitReply.ts` (+ `.test.ts`), `src/lib/client/admin/sections/plugins/IdPage.svelte` (~250–300, replyKey example), `src/lib/client/sockets/interest.svelte.ts`, `src/lib/shared/sockets/types.ts` (`Sockets.Scenes.Compile`), `requests/index.ts`, `requests/index.test.ts`, `Layout.svelte` (read only).

## Out of scope — never built
`awaitReply.ts`, `Layout.svelte`, `requests/index.ts`, any server file, `NOMENCLATURE.md`, docs, the SDK. No new names beyond `requestId` on `byDate` (already named). No new sentence: the only strings are the existing ones. No new event, setting or helper module.

## Stop and ask (in your report, don't decide) when
A new user-visible sentence or a new exported name seems needed; a change outside the owned files seems needed; the brief's rule conflicts with an existing test you cannot reconcile.

## Rules your work depends on (from CLAUDE.md, verbatim where quoted)
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." (keep `uuid` v4.)
- "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." (you use `declareInterest`/`awaitReply`, no `socket.on`.)
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Sockets: one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."
- Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean`.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build.)
- Never run project-wide `tsc`, `npm run check`, `svelte-check` or `npm test`.

## Tests (Done means — all green)
Run exactly (one command, then read the log; never pipe vitest into `head`):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/client/components/modals/CompileHistoryEntryModal.dom.test.svelte.ts src/lib/client/components/sessionPage/requests/compileHistoryEntry.test.ts src/lib/client/components/sessionPage/requests/index.test.ts src/lib/client/utils/awaitReply.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-R-w1-<n>.log 2>&1; echo exit=$?'
```
Then `npx prettier --check` on `compileHistoryEntry.ts`, `compileHistoryEntry.test.ts`, `compileEntryState.ts` (report results; the modal's two old failures are known).

## Report (final message)
Changed files with a one-line summary each · the exact test command and pass/fail counts · decisions you made · anything skipped and why · Noticed, not done.
