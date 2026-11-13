# BRIEF playtest2-H-w1 — Back: one message per press (`history.back: 'message'`), server half

Lane `playtest2-H` · worker 1 · the supervisor reads your final message (no report file).
App: `/home/jody/github/serene-pub`. You edit no SDK file.

## Goal
Owner ruling 2026-11-04 (plan `plans/PLAN-story-playtest-fixes-2026-11-03.md` § Rulings): *"A Back: one message per press in **Story**; Lair and Dungeon Crawler keep the whole turn. Trailing routine lines (Time passes, notes) go with the message. **Genre-fixed** (declared like `history.settle`), no setting."* and *"6 Back title (★H2): count person lines at a table (2 lines and 3 replies (…)). In Story the one-message title names the message's author."* Regenerate keeps the turn unit in every genre (ruled: Back only).

The genre field is `shape.history.back?: 'message' | 'turn'` (default `'turn'`). It is **not declared in the SDK yet** (the lead adds it later). Read it defensively from the shape as `unknown`; no SDK rebuild is needed.

### 1. The step size — `src/lib/server/sessions/rewind.ts`
Add ONE **unexported** helper beside the other private helpers:
```ts
/** 🚧 How far one press of Back goes (`shape.history.back`, read as unknown until the SDK declares it): 'message' = the newest message; anything else = the whole turn. */
async function backStepOf(db: Db, sessionId: number): Promise<"message" | "turn"> {
	const genre = getGenre(await sessionGenreOf(db, sessionId))
	const back = ((genre?.shape as { history?: unknown } | undefined)?.history as { back?: unknown } | undefined)?.back
	return back === "message" ? "message" : "turn"
}
```
`getGenre` from `"@serene-pub/sdk"` (the same registry `sessionHistorySettle` reads, `sessions/settle.ts:90-92`), `sessionGenreOf` from `$lib/server/sessions/annexFields`. It takes the caller's `db` (inside `rewindTurn`'s transaction that is `t`: **inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently**).

### 2. The second unit shape, through `buildTurnUnit` — never a second write path
In `buildTurnUnit` (`rewind.ts:242+`), branch `opts.includePersonLines`, only when `at === null` (Back's newest; `turnUnitAt` is unchanged): when `backStepOf` says `'message'`, `start` is `newest.id` (the newest replayed story-lane line, `lines[lines.length - 1]`) instead of `newest.turnOf`, and the table-of-players rule is skipped. Everything else stays as is: `firstId = Math.max(start, firstPerson.id)`, `floor = firstId`, `storyIds` = every live story-lane row `>= firstId` (so the routine/system rows after the message — which the replay never counts as lines — go with it), the opening run, the creators' floored yields, the anchored rows, the refusals. `rewindTurn` / `forwardTurn` are not touched. With `'turn'` the unit must be **byte-for-byte today's** (`rewind.int.test.ts:571-597` and every other existing case pass unchanged). The `includePersonLines: false` branch (Regenerate, `retakeTurn.ts`) is never affected. Read `backStepOf` once per build, and only on Back's branch.
Update the module docstring's "## Back rewinds one turn" section with two sentences: a genre whose shape says `history.back: 'message'` (Story) takes the newest message instead — with the rows after it on the story's lane (Time passes, notes) and what its run wrote — and Regenerate still takes the whole turn.

### 3. The title's facts — `rewindStateOf` (`rewind.ts:126-160`)
`backTakes` keeps `count`, `names`, `throughId` exactly as now (story-lane non-person rows, distinct names, newest unit id) and gains two **optional** fields (the shared type `RewindBackTakes` in `src/lib/shared/sessions/rewind.ts` is worker 2's; it will read exactly these):
```ts
/** 🚧 The person lines the unit holds on the story's lane — present only at a table (2 or more). */
personLines?: number
/** 🚧 Present only when the genre takes one message per press: the message Back takes, who wrote it, whether it is the session owner's own line, and how many story-lane rows go with it. */
newestMessage?: { author: string | null; yours: boolean; filed: number }
```
- `personLines`: count of the unit's rows on `STORY_LANES` with `role === "user"`; set only when `>= 2` (so a one-person turn's `backTakes` stays `{ count, names, throughId }` — the existing test `rewind.int.test.ts:617-632` asserts that exact object and must pass unchanged). Never set under `'message'`.
- `newestMessage` (only under `'message'`): the message is the unit's lowest-id story-lane row. `author`: for a non-person row its `TurnUnit.rows[].name`; for a person row the persona's name (`characters.name` via `personaId`), else `null`. `yours`: a person row whose `userId` is the session's owner (`sessions.userId`). `filed`: the unit's other story-lane rows.
- Read what you need with one small query over `verdict.unit.ids` (id, channel, role, userId, personaId, persona name) plus the session owner — inside `rewindStateOf`, which already never throws. No new exported name; do not widen `TurnUnit`.

## Tests — `src/lib/server/sessions/rewind.int.test.ts` (existing cases unchanged)
- A step switch for the file: `const backStep = vi.hoisted(() => ({ value: "turn" as "turn" | "message" }))` and
  `vi.mock("@serene-pub/sdk", async (importOriginal) => { const real = await importOriginal<typeof import("@serene-pub/sdk")>(); return { ...real, getGenre: (id: string) => { const g = real.getGenre(id) as any; return { ...(g ?? {}), shape: { ...(g?.shape ?? {}), history: { ...(g?.shape?.history ?? {}), back: backStep.value } } } } } })`.
  Comment it: the file tests both unit shapes by name and pins `'turn'` by default, so its cases do not move when Story's own `back: 'message'` line lands (the lead's, with its own sdk-tests pin). New `'message'` tests set `backStep.value = "message"` and reset it in a `finally`. If that mock breaks an existing case (identity, a frozen object, a missing export), stop and report the failure and the error; do not change existing cases.
- New cases, rows written straight with the existing `group()` helper (`:531-570`; a `role: "system"` row on `main` stands in for a filed routine line — e.g. *"Time passes: 3 hours."*; one row on another channel with `metadata.anchorMessageId` set to the message's id stands in for a table row anchored to it):
  1. `'message'`: `p1 a1 b1 sys` → `rewindUnitIds` is `[b1, sys, <the anchored row>]` (sorted), `rewindTurn` takes exactly those; the next Back takes `[a1]`, the next `[p1]`, then `REWIND_REFUSALS.nothing`-style empty (`rewindUnitIds` `[]`, as the existing round test checks).
  2. `'turn'` on the same shape of rows → the whole `[p1, a1, b1, sys, anchored]` (today's unit).
  3. Forward after a one-message Back restores it: the rows are live again (`rewindOrdinal` null, `isHidden` as before), `forwardStackHeight` 0, and `rewindUnitIds` is the one-message unit again.
  4. Regenerate keeps the turn under `'message'`: `turnUnitOf(db, id, { includePersonLines: false })` gives the same `ids` with `backStep.value` `'message'` as with `'turn'`.
  5. `backTakes`: a table of two players under `'turn'` (copy the existing table case `:634-648`) → `personLines: 2`; `'message'` with a reply newest → `newestMessage: { author: <Birch's name>, yours: false, filed: <n> }`; `'message'` with the owner's own line newest → `{ author: null, yours: true, filed: 0 }` (no persona). One person under `'turn'` → no `personLines`, no `newestMessage` (the existing case covers it; don't duplicate).
- Each `it` that opens/uses the DB gets `120_000` like its neighbours.

## Run
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sessions/rewind.int.test.ts src/lib/server/sockets/sessions.retake.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-H-w1-<n>.log 2>&1; echo exit=$?'` then read the log (grep for `Tests`, `FAIL`, `✓`/`×`). If `systemd-run` is refused, `timeout 1200` with the same NODE_OPTIONS. **Never pipe vitest into `head`.** Then `npx prettier --check` on each file you changed (report the result; the morning left some prettier-dirty files — do not reformat lines you did not touch).

## Files owned (edit only these)
`src/lib/server/sessions/rewind.ts` · `src/lib/server/sessions/rewind.int.test.ts`. Re-read each immediately before every edit (other lanes work in the same trees); use Edit, never Write, on these existing files.

## Out of scope — never build
`src/lib/shared/sessions/rewind.ts` and its test (worker 2), any SDK file, `descriptors.ts`, `sockets/sessions.ts`, `shared/sockets/types.ts`, the client, docs, `NOMENCLATURE.md`. A setting for the step size (genre-fixed, ruled). Any change to Regenerate's unit, to `turnUnitAt`, to `rewindTurn`/`forwardTurn`'s writes, or to Forward's semantics.

## Stop and ask (in your final message) when
The one-message unit cannot be expressed as the `start` change above without a second write path; an existing case fails and the fix would change it; a name beyond `backStepOf`, `personLines`, `newestMessage` (`author`, `yours`, `filed`) and `backStep` (test) is needed; a migration seems needed (it is not — `backTakes` is computed, never stored).

## Rules that apply (quoted)
- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." · "Never seed a row at a hardcoded id."
- Principles P1: "Code decides what code can; the model only judges. Same inputs, same result." The step is genre-fixed, read off the declaration.
- NOMENCLATURE R3: "qualify, never the bare noun" — hence `personLines`, `newestMessage`. §24 turn unit: "Back takes a whole turn unit; Regenerate takes the same unit without the person's lines" — after this change Back takes a turn unit or, under `history.back: 'message'`, its newest message; Regenerate unchanged.
- "0.6 is in users' hands": `backTakes` is computed per read and never stored, so no migration; every reader of the old shape must keep working (worker 2 tests the shared reader).
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- An int test that opens a DB inside an `it` gets a long timeout (this file uses 120 s).

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You run no sdk:build.)

## Report (your final message)
Changed files with a one-line summary each · the exact test command(s) and pass/fail counts per file · prettier results · anything stopped · Noticed, not done.
