# BRIEF playtest4-S8-w4 — the Compile window adopts only its own ask (★S7-2) and ignores another ask's refusal

Lane `playtest4-S8`, worker w4. Report: your final message. Edit existing files with the Edit tool (never Write over one); re-read each immediately before editing — other lanes (P1, M2e) work in this repo now. Server half built: `Sockets.Scenes.Compile.ByDate.requestId?: string` is echoed as `ErrorResponse.requestId` on every refusal of that by-date ask; a by-date compile's activity (server `CompileHistoryEntryActivity`, the `activity:update` frames) carries `byDate?: { date: StoryDate | null }` (absent for an entry compile); `CompileEntryState.byDate?` exists in `src/app.d.ts`. Another worker builds the Chronicle's request answer, which also sends by-date asks with its own `requestId`.

## Goal
### 1. One mapping for the compile activities, reachable from a test
- New file `/home/jody/github/serene-pub/src/lib/client/components/modals/compileEntryState.ts` exporting
  `export function compileEntryStateOf(a: any): CompileEntryState` — EXACTLY the field-by-field mapping now inline in `/home/jody/github/serene-pub/src/lib/client/components/Layout.svelte` (~2514–2530, `compileEntriesCtx.activities = compileActivities.map((a: any) => ({ activityId: a.id, userId: a.userId, … startedAt: a.startedAt }))`), plus `...(a.byDate !== undefined && { byDate: a.byDate })`. Doc comment: the shell's one mapping from a server compile activity to `CompileEntryState` (Layout's `activity:update` handler); a field the modal or the workspace reads must pass through here, which the modal's DOM test holds by building its fixtures through it.
- In `Layout.svelte`: replace ONLY that inline map with `compileEntriesCtx.activities = compileActivities.map(compileEntryStateOf)`, and add its import next to the other `$lib/client/components/...` imports. Nothing else in Layout.svelte — it is not your file beyond those lines.

### 2. `/home/jody/github/serene-pub/src/lib/client/components/modals/CompileHistoryEntryModal.svelte` — adoption and refusals only
- **The ask's own id.** `startCompile()`'s by-date emit (~305) adds `requestId` — a fresh one per press (a Retry is a new ask): `import { v4 as uuid } from "uuid"`; keep it in a `let askedRequestId: string | null = null` (plain `let`, not `$state`, unless the markup reads it). The entry-id emit sends none (the server echoes only a by-date ask's).
- **Refusals (`handleError`, ~346).** First: `if (typeof data.requestId === "string" && data.requestId !== askedRequestId) return` — a refusal carrying another ask's `requestId` (the Chronicle's, another window's) is never this window's; an entry window (no `askedRequestId`) therefore ignores every by-date ask's refusal. Then the existing rules unchanged. Update the doc comment above `handleError` to say so.
- **Adoption (the `$effect` ~246–285, the `id == null` branch).** Replace `(askedDate === null || isAskedDay(entryOf?.(a.historyEntryId)))` with a match on the activity's own ask: `a.byDate !== undefined && sameAskedDay(a.byDate.date)`, where the asked day and the activity's day are equal through `dayOnly` + `compareDates` (both from `$lib/shared/lorebooks/storyDate`, already imported) and **Undated matches Undated only** (both null). An activity with no `byDate` (an entry compile) is never adopted by a by-date window. Keep `!knownActivities.has(…)`, the book and `sameLineAndMoment` checks. Update the comment there ("of the asked day (any, for Undated)" is no longer true). Keep `isAskedDay` — `handleError` still uses it.
- Nothing else in the modal (title, save, stub, markup stay).

### 3. The DOM test `/home/jody/github/serene-pub/src/lib/client/components/modals/CompileHistoryEntryModal.dom.test.svelte.ts`
- The by-date describe's `activity(over)` fixture (~238) builds a SERVER-shaped activity (`id`, `kind: "compile_history_entry"`, `userId`, `historyEntryDate`, `lorebookLabel`, `startedAt`, `historyEntryId`, `lorebookId`, `branchId`, `moment`, `status`, plus `byDate` by default `{ date: { year: 1, month: 1, day: 2 } }` — the window's asked day — and overrides) and pushes `compileEntryStateOf(raw)` into `activities`. So a field the mapping drops fails the test. Adapt existing pushes (`activityId: "old"` → `id: "old"` etc.).
- Fix existing by-date expectations for the new `requestId` (`requestId: expect.any(String)` on the by-date emit).
- Add tests:
  - an **Undated** window (`byDate.date: null`) adopts only an Undated compile: a new dated activity (`byDate: { date: {year:1,month:1,day:2} }`) and a new entry compile (no `byDate`) on the same book/line/moment are NOT adopted; a new `byDate: { date: null }` one is;
  - a **dated** window adopts only its day: another day's `byDate` (same entry id even) is not adopted; one whose `byDate.date` has the same day but an hour (`{year:1,month:1,day:2,hour:5}`) is;
  - a refusal carrying **another** ask's `requestId` leaves the modal as it was (still running, no error text); one carrying the window's own `requestId` (read it off the sent emit) shows its sentence;
  - an entry window (the existing `render(...)` with `historyEntry`, `initialStep: "running"`) ignores a refusal that carries a `requestId`.
- Run, capped, only this file:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/modals/CompileHistoryEntryModal.dom.test.svelte.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-S8-w4.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. A failing assert on a happy-dom element can balloon memory: keep the cap.
- `npx prettier --check` the new `compileEntryState.ts` and make it clean.

## Files owned (only these, only the spots named)
`modals/compileEntryState.ts` (new), `modals/CompileHistoryEntryModal.svelte` (adoption + refusals + the by-date emit's `requestId`), `modals/CompileHistoryEntryModal.dom.test.svelte.ts`, `components/Layout.svelte` (the compile-activity mapping at ~2514 + its import only).

## Out of scope — never built
Any other Layout change (`HANDLED_ERROR_EVENTS` stays); the modal's title/copy; a toast; a setting; the server, SDK, `requests/` files. No new names beyond `compileEntryStateOf` (and its file) and the local `askedRequestId` / `sameAskedDay`. If you think you need another, stop and say so.

## Rules your work depends on (quoted)
- CLAUDE.md Sockets: "one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."
- CLAUDE.md: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`" — use `uuid`'s v4.
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- Memory rule: untrack reads in effect-called code that writes state (the adoption effect already wraps its writes in `untrack`; keep it so).

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need one.)
- Also never `git checkout`, `git restore` or `git clean` in either repo.

## Report (your final message)
Changed files with one line each (Layout line numbers touched); exact test command and pass/fail counts; anything not done; Noticed, not done.
