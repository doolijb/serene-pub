# BRIEF playtest4-S8-w2 — the server half: `requestId` echoed on a by-date compile's refusals; `byDate` echoed on its activity

Lane `playtest4-S8`, worker w2. Report: your final message (the supervisor reads it). Edit with the Edit tool (never Write over an existing file); re-read each file immediately before editing — other lanes (P1, M2e) work in this repo right now.

## Goal
1. **`/home/jody/github/serene-pub/src/lib/shared/sockets/types.ts`** — namespace `Sockets.Scenes.Compile` (~14157):
   - `interface ByDate` gains `requestId?: string` with the doc: `/** 🚧 ★S6-1: echoed on this ask's \`scenes:compile:error\`, so the asker (the Chronicle's \`compile-history-entry\`, a Compile window) hears its own refusal and no other's. */`
   - `interface ErrorResponse` gains `requestId?: string` with the doc: `/** 🚧 The by-date ask's \`requestId\`, echoed when it sent one. */`
   - Nothing else in types.ts (no `requestId` on `ByEntry`, `Progress` or `Response`).

2. **`/home/jody/github/serene-pub/src/lib/server/utils/activityStore.ts`**
   - `CompileHistoryEntryActivity` (~195) gains, after `sceneIds?`:
     ```ts
     /**
      * 🚧 ★S7-2: the by-date ask this run answers (`date` null = *Undated*),
      * echoed so a Compile window — or the Chronicle's request — takes only
      * its own ask's run. Absent for an entry ask. Memory only, never persisted.
      */
     byDate?: { date: StoryDate | null }
     ```
   - `startCompile`'s `params` type (~528) gains `byDate?: { date: StoryDate | null }`; it already spreads `...params` into the activity, so check that is all it needs. Nothing else.

3. **`/home/jody/github/serene-pub/src/lib/server/sockets/scenes.ts`** — `sceneCompileHandler` (~1078–1570) ONLY:
   - Read the ask's `requestId` once, near `askedEntryId` (~1102): a string `requestId` on a by-date ask (no `historyEntryId` in the ask); otherwise undefined. Ignore a non-string.
   - Echo it on BOTH `scenes:compile:error` emits — `refuse` (~1110) and the run failure (~1507): `...(askedRequestId !== undefined && { requestId: askedRequestId })` beside `...about`. Every refusal string stays byte-identical.
   - In the by-date branch keep the parsed `date` and, when the ask was by date, pass `byDate: { date }` into `activityStore.startCompile({...})` (~1435) — e.g. a `let byDate: { date: StoryDate | null } | undefined` declared beside `params`, set in the by-date branch, spread as `...(byDate && { byDate })`. An entry ask passes none.
   - Nothing else in scenes.ts. Lane P1 owns `src/lib/server/scenes/{unfiledScenesByEntry,historyEntryOfDate,liveScenes}.ts` — never touch those.

4. **`/home/jody/github/serene-pub/src/app.d.ts`** — `interface CompileEntryState` (~655) gains, after `moment`:
   `/** 🚧 ★S7-2: the by-date ask this compile answers (\`date\` null = Undated); absent for an entry compile. */ byDate?: { date: import("$lib/shared/lorebooks/storyDate").StoryDate | null }`. Nothing else in app.d.ts.

## Tests (Done means)
- `/home/jody/github/serene-pub/src/lib/server/utils/activityStore.compileDedup.test.ts` (or `activityStore.compileApplied.test.ts`, whichever fits): + one test — `startCompile` with `byDate: { date: {year,month,day} }` and with `byDate: { date: null }` puts that `byDate` on the activity (`getById`/`getFor`); one without `byDate` has none (`"byDate" in activity` is false).
- `/home/jody/github/serene-pub/src/lib/server/sockets/scenes.compileLine.int.test.ts`, describe `"scenes:compile by date"` (~939): + tests —
  (a) a by-date compile's activity carries `byDate: { date }` with the asked day (and `{ date: null }` for an Undated ask — extend the existing "date null compiles the scenes with no story clock" test or add one);
  (b) a refused by-date ask that sent `requestId: "r-1"` (e.g. the existing "no unfiled scenes of that day" case) emits `scenes:compile:error` carrying `requestId: "r-1"` with the same sentence; one that sent no `requestId` carries none;
  (c) an entry ask's refusal carries no `requestId`.
  Follow the file's existing helpers for driving the handler and capturing emits. An `it`/`test` that opens a DB needs a 60 s timeout under load (match the file's existing timeouts).
- Run, capped, only these two files:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/utils/activityStore.compileDedup.test.ts src/lib/server/sockets/scenes.compileLine.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-S8-w2.log 2>&1; echo exit=$?'` (swap in `compileApplied` if that is where you put the test), then read the log. Never pipe vitest into `head`.

## Files owned (only these, only the spots named)
`src/lib/shared/sockets/types.ts`, `src/lib/server/utils/activityStore.ts`, `src/lib/server/sockets/scenes.ts`, `src/app.d.ts`, the two test files above.

## Out of scope — never built
`requestId` anywhere else; a new event; a setting; a migration (the activity is memory only); any change to the refusal sentences or the compile order; `Layout.svelte`, the modal, the client (another worker's).

## Rules your work depends on (quoted)
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- CLAUDE.md: "An event in `SCOPED_EVENTS` must carry its scope key … in the payload" — `scenes:compile:error` is not scoped (an `:error` is never gated); don't change that.
- Standing rule: "Stored data. … an additive field is fine only if every reader still works on rows that lack it (test that)" — `byDate` is memory-only and optional; the "has none" assertion covers the absent case.
- NOMENCLATURE R1/R3: the only new names are `requestId` (the existing wire-field pattern, as on `Sockets.Scenes.LiveSceneReply`) on those two interfaces, and `byDate` on the activity / `CompileEntryState`. No other new name.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need an sdk:build.)
- Also never `git checkout`, `git restore` or `git clean` in either repo.

## Report (your final message)
Changed files with a one-line summary each (and the scenes.ts line numbers you touched); exact test command and pass/fail counts; anything not done; Noticed, not done.
