# BRIEF playtest4-S8-w3 — the page's answer to `compile-history-entry`

Lane `playtest4-S8`, worker w3. Report: your final message. Edit existing files with the Edit tool (never Write over one); re-read each immediately before editing — other lanes (P1, M2e) work in this repo now. The SDK half is built (dist rebuilt): `WidgetRequests['compile-history-entry'] = { params: { date: StoryTime | null }; result: void }`, askers `'core'`, API `'session'`. The server half is built: `Sockets.Scenes.Compile.ByDate.requestId?: string` is echoed on `scenes:compile:error` (`ErrorResponse.requestId?`) for every refusal of that by-date ask (before and after its entry is known, and the run's failure); the compile activity (`activity:update` frames, `activities[]`, `kind: "compile_history_entry"`) carries `byDate?: { date: StoryDate | null }` for a by-date run.

## Goal
The Chronicle's per-day **Compile** sends `compile-history-entry { date }`. The page answers it by sending the by-date `scenes:compile` ask directly — **no modal** — and the run and its review then arrive through the compile activity as for any compile. Refusals are heard, not lost: the shell never toasts `scenes:compile:error` (it is in Layout's `HANDLED_ERROR_EVENTS`), so this answer must reject the request in words when the refusal carrying ITS `requestId` arrives (the Chronicle then says it in place, as it says a summarize refusal).

### 1. New file `/home/jody/github/serene-pub/src/lib/client/components/sessionPage/requests/compileHistoryEntry.ts`
Model it on `./summarizeScenes.ts` + `./startHistoryEntry.ts` (doc header style, deps interface, `answerX`). Contents:

- Header doc: 🚧 `compile-history-entry` (★S6-1, owner 2026-11-04; core only): the Chronicle's per-day Compile — the lorebook's *Not yet compiled* Compile, with no window: one by-date `scenes:compile` on the session's line at now; settled on its own answer (the run's activity appearing, or the refusal carrying the ask's `requestId`); its refusal is the asking widget's to say. The server judges who may (the book's owner) and which scenes wait.
- `export interface CompileHistoryEntryDeps extends HistoryEntriesDeps { compileByDate(ask: { lorebookId: number; date: StoryDate | null; branchId: number | null }): Promise<void> }` (import `HistoryEntriesDeps`, `readChronicle` from `./historyEntries`; `StoryDate` from `$lib/shared/lorebooks/storyDate`).
- `export async function answerCompileHistoryEntry(params: unknown, deps: CompileHistoryEntryDeps): Promise<void>`:
  - params: `{ date }` must be present and either `null` or an object with a whole-number `year` and `month`/`day`/`hour`/`minute` each absent, null or whole. Otherwise throw `new Error("compile-history-entry takes a date of whole parts, or null for Undated")`. Pass on `{ year, month: month ?? null, day: day ?? null }` (hour/minute dropped — the day is what counts), or `null`.
  - `const { answer, branchId } = await readChronicle(deps, 0)`; `answer.lorebookId === null` → throw `"this session reads no lorebook"` (the existing sentence in startHistoryEntry.ts); `answer.ownerOnly` → throw `"only the lorebook's owner compiles its history"`.
  - `await deps.compileByDate({ lorebookId: answer.lorebookId, date, branchId })`.
- `export function compileByDate(socket: Pick<TypedSocket, "emit">, ask: {…same…}, timeoutMs = 15000): Promise<void>` — the socket ask:
  - `requestId = uuid()` (`import { v4 as uuid } from "uuid"`, as `./library.ts` does; never `crypto.randomUUID`).
  - Declare BOTH interests BEFORE the emit, with `declareInterest` from `$lib/client/sockets/interest.svelte` (the registry; never `socket.on`):
    - `"scenes:compile:error"` (bare): when `data.requestId === requestId` → settle, reject `new Error(data.error || "the day's scenes could not be compiled")`. A refusal with another id, or none, is ignored.
    - `"activity:update"` (bare; the shell's standing key): resolve when `data.activities` holds a compile activity (`kind === "compile_history_entry"`) with `status === "running"`, `lorebookId === ask.lorebookId`, `(branchId ?? null) === ask.branchId`, `(moment ?? null) === null`, and a `byDate` whose `date` is the asked day: both null, or both dated and `compareDates(dayOnly(a), dayOnly(b)) === 0` (`compareDates`, `dayOnly` from `$lib/shared/lorebooks/storyDate`). Comment why that is enough: a running by-date compile of that day on that line is either this ask's or one that makes the server refuse this one as already in progress — either way the day is compiling and its card says so.
  - timeout → reject `new Error(REPLY_TIMEOUT_MESSAGE)` (import from `$lib/client/utils/awaitReply`).
  - Every exit releases both interests and clears the timer (mirror `awaitReply`'s `finish`).
  - Then emit `socket.emit("scenes:compile", { lorebookId, date, branchId, moment: null, requestId } satisfies Sockets.Scenes.Compile.ByDate)`.
  - `TypedSocket` type from `$lib/client/sockets/typedSocket`.

### 2. `/home/jody/github/serene-pub/src/lib/client/components/sessionPage/requests/index.ts`
- Import `answerCompileHistoryEntry`, `compileByDate` from `./compileHistoryEntry`, and `useTypedSocket` from `$lib/client/sockets/loadSockets.client` (as `./library.ts` does).
- In `WIDGET_REQUEST_ANSWERS`, right after `"summarize-scenes"` (~513), add:
  ```ts
  // 🚧 ★S6-1: the Chronicle's per-day Compile — the by-date compile on the
  // session's line, no window; its refusal is the asking widget's.
  "compile-history-entry": (p, _from, d) =>
  	answerCompileHistoryEntry(p, {
  		...chronicleReads(d),
  		compileByDate: (ask) => compileByDate(useTypedSocket(), ask)
  	}),
  ```
- Do NOT add a member to `WidgetRequestDeps` (the page's deps are built in files this lane does not own).

### 3. Tests
- New `/home/jody/github/serene-pub/src/lib/client/components/sessionPage/requests/compileHistoryEntry.test.ts`. Mock `$lib/client/sockets/interest.svelte` the way `/home/jody/github/serene-pub/src/lib/client/utils/awaitReply.test.ts` does (a `handlers` map of key → handler, `released` list). Look at `./startHistoryEntry.test.ts` for how `readChronicle`'s deps are faked (readStoryClock / readHistory / readLines / sceneList …). Cases:
  - `answerCompileHistoryEntry`: sends the asked day with the session's line (a branch line → its `branchId`), hour/minute dropped; `{ date: null }` sends `null`; a bad date (`{ date: { year: "x" } }`, a missing `date`) is refused in words and nothing is sent; a session reading no lorebook → `"this session reads no lorebook"`; a non-owner reading (`isOwner: false`) → `"only the lorebook's owner compiles its history"`, nothing sent.
  - core only: through `guardWidgetRequests` (`./askers`), a plugin's widget is refused (`"only core's own widgets ask 'compile-history-entry'"`) and nothing is sent; core's is answered (copy `summarizeScenes.test.ts`'s third test); `WIDGET_REQUEST_ASKERS["compile-history-entry"]` is `"core"`.
  - `compileByDate`: both interests are declared before the emit; the ask is `scenes:compile` with `{ lorebookId, date, branchId, moment: null }` and a string `requestId`; a `scenes:compile:error` carrying THAT `requestId` rejects with its sentence; one carrying ANOTHER id (and one carrying none) is ignored (still pending); an `activity:update` with a running matching compile resolves it, while frames with a non-matching one (another day; Undated vs dated; another book; another line; a non-running one; one with no `byDate`) do not; every exit releases both keys; the timeout rejects with `REPLY_TIMEOUT_MESSAGE` (fake timers).
- `/home/jody/github/serene-pub/src/lib/client/components/sessionPage/requests/index.test.ts`: it already checks the table holds exactly the SDK's kinds — no change needed unless it fails; if it does, say why.
- Run, capped, only these files:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/sessionPage/requests/compileHistoryEntry.test.ts src/lib/client/components/sessionPage/requests/index.test.ts src/lib/client/components/sessionPage/requests/askers.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-S8-w3.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`.
- `npx prettier --check` the new two files and make them clean (format only those two).

## Files owned (only these)
`requests/compileHistoryEntry.ts` (new), `requests/compileHistoryEntry.test.ts` (new), `requests/index.ts` (the import + the one table entry), `requests/index.test.ts` (only if needed).

## Out of scope — never built
A modal; a toast (views never call `toaster`); a setting; any change to `pageAsks.ts`, `+page.svelte`, `Layout.svelte`, the modal, the server or the SDK; a new event. No new names beyond: `compile-history-entry` (given), `answerCompileHistoryEntry`, `CompileHistoryEntryDeps`, `compileByDate`, and the two error sentences quoted above. If you think you need another, stop and say so.

## Rules your work depends on (quoted)
- CLAUDE.md Sockets: "one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." — use `declareInterest`, release on every exit.
- CLAUDE.md: "`socket.off(event)` with no handler removes every listener app-wide" — you never call `socket.on/off`.
- CLAUDE.md: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- index.ts module note: "Every member of [the deps] is a function, called when a request arrives — never a value captured when the answerer is built" — hence `useTypedSocket()` called inside the arrow, at the press.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need one.)
- Also never `git checkout`, `git restore` or `git clean` in either repo.

## Report (your final message)
Changed files with one line each; exact test command and pass/fail counts; anything not done; Noticed, not done.
