# BRIEF playtest-H-w1 — Back: people not speakers, the run sweep floor, and `backTakes` on the server

Lane `playtest-H` · worker 1 · supervisor reads your final message (no report file).
Work from `/home/jody/github/serene-pub`.

## Goal
Three server fixes and one new field, item 6 of `plans/PLAN-story-playtest-fixes-2026-11-03.md` (lines 351–390). The unit Back takes stays exactly the whole exchange (owner ruling 2026-10-24: "one turn = your line and every reply that answered it"); do not change what a turn is.

1. **People, not speakers.** `ReplayedLine` (`src/lib/server/pipelines/routines/moments.ts:224-237`) gains
   `userId: number | null` — doc: `/** The account that wrote the row (session_messages.user_id); null when none. */`.
   Fill it where lines are pushed (`lines.push({ … })`, ~line 220) from `row.userId ?? null` (the select already reads `userId`). Touch nothing else in moments.ts.
   In `buildTurnUnit` (`src/lib/server/sessions/rewind.ts:258-266`) the "table of players" rule counts distinct **people**:
   key each turn-opening person line by `l.userId !== null ? \`account:${l.userId}\` : l.speaker` instead of `l.speaker`. Update the comment there (one person switching persona mid-round is one person). Player seats are per account (`cardlessPlayerSeatOf(db, sessionId, userId)`), so this matches the Lair/Dungeon Crawler table too.
2. **Run sweep floor.** `unitRuns` (`rewind.ts:413-427`) and the turn-yield loop (`rewind.ts:341-343`) must never pull a row older than the turn into the unit. Compute a `floor` (a message id) in each branch of `buildTurnUnit`:
   - `includePersonLines` and `at === null`: `firstId` (the `Math.max(start, firstPerson.id)` already there);
   - `includePersonLines` and `at !== null`: `newest.turnOf`;
   - `!includePersonLines` (Regenerate): `head.turnOf` (NOT the min of storyIds: the Lair test's plan row on `sanctum` sits between the GM line and the first story reply and must stay in Regenerate's unit).
   Then: `unitRuns(db, ids, floor)` adds `gte(schema.pipelineRunArtifacts.entityId, floor)` to its where; the yield loop adds a yield row only when `row.messageId >= floor`.
   **Do NOT filter `unitRuns` to `action = 'created'`.** Its docstring (`:412`, "The runs that created or rewrote one of these rows") includes rewriting runs on purpose: such a run stays in `runs` so its writes elsewhere are still taken back. Only the rows are bounded.
3. **`backTakes` on the strip state.** In `src/lib/shared/sessions/rewind.ts`:
   ```ts
   /** 🚧 What Back would take now (playtest item 6): how many rows besides the person lines, the names on them, and the newest row id it covers — so the page can tell the count went stale. */
   export interface RewindBackTakes {
   	/** The unit's rows that are not a person's line (`TurnUnit.rows`). */
   	count: number
   	/** The names on those rows, oldest first, each once. */
   	names: string[]
   	/** The newest row id in the unit (`TurnUnit.ids`). */
   	throughId: number
   }
   ```
   and on `RewindState`: `/** 🚧 What Back would take; absent when Back is refused or the count is stale. */ backTakes?: RewindBackTakes`.
   - Server `rewindStateOf` (`rewind.ts:126-152`): when `verdict.ok`, add `backTakes: { count: verdict.unit.rows.length, names: <distinct non-empty verdict.unit.rows[].name, in order>, throughId: Math.max(...verdict.unit.ids) }`. The archived path, a refused verdict and the catch path carry no `backTakes`.
   - Shared `rewindStateOf` (`shared/sessions/rewind.ts:47-56`): parse it defensively — kept only when it is an object whose `count` is a non-negative integer, `names` an array (keep only strings), `throughId` a number; otherwise the key is **absent**. Use a conditional spread (`...(takes ? { backTakes: takes } : {})`) so a payload without it gives exactly the old object: the existing `src/lib/shared/sessions/rewind.test.ts` uses `toEqual` on the old shape and must pass unchanged.
   - Shared `rewindStateWith` (`:70-98`): carry `backTakes` only when the final `back` is null AND no message in `messages` on the story lanes (`STORY_LANES`) has a numeric `id` greater than `backTakes.throughId`; otherwise absent (conditional spread again). Reason: the server sends `rewind` only with the session (`sessions:get` / `sessions:refresh`), so after a new turn the served count describes the previous turn; a missing count falls back to the plain "Back one turn", a stale one would mislead.
   - `withStackReplaced` stays as it is.

## Tests — `src/lib/server/sessions/rewind.int.test.ts`
Existing tests must pass **unchanged** (in particular `:571-597`, the unit as ruled 2026-10-24, and the Lair test `:708`). Add, in the `"🚧 the unit Back takes, on rows written straight"` describe unless noted:
- **"one person switching persona mid-round: Back takes only the newest exchange"** — a group session (the `group()` helper); two personas (`schema.characters`, `isPersona: true`, `userId: ownerId`); rows via `insertLegacy` with `personaId`: p1 (persona A), a1, b1, p2 (persona B), a2. Expect `rewindUnitIds` = `[p2.id, a2.id]`. **Run it red first** (temporarily revert the people rule, or write the test before the fix) and quote the failing output in your report; if it passes before the fix, vary the fixture (e.g. p1 with no persona, p2 with one; or no b1) until it reproduces the widened round, and say which fixture did.
- **"an updated-only run doesn't widen the unit"** — rows p1, a1, x1 (`channel: "sanctum"`), p2, a2; run R0 `created` a1 and x1; run R1 `created` a2; R0 also has an `action: "updated"` artifact on a2 (copy the `run()` / `made()` helpers from the Lair describe, `:658-686`). Expect `turnUnitOf(…, { includePersonLines: true })` ids = `[p2.id, a2.id]` and its `unit.runs` to contain both R0 and R1 (the rewriting run is kept). Red first, as above.
- **"rewindStateOf.backTakes is the unit Back takes"** — on a group session with p, a, b (Ash, Birch): server `rewindStateOf(db, id).backTakes` equals `{ count: <unit ids that are not the person's>, names: [Ash's name, Birch's name], throughId: max(rewindUnitIds) }`; and with nothing to go back to, `backTakes` is undefined.
- A small pure describe (no DB) for the shared side: `rewindStateOf` on a payload with no `backTakes` has no `backTakes` key (`"backTakes" in state` is `false`), junk (`{ count: -1 }`, `"x"`) is dropped; `rewindStateWith` keeps it when every loaded story row id ≤ `throughId`, drops it when a newer `main` row is loaded, keeps it when the newer row is on another channel, drops it when `back` is refused (e.g. the newest person line is a branch copy, `metadata.copyOf`).
Every new `it` that opens a DB needs a `60_000` timeout (the file uses 120_000; either is fine).

## Run
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sessions/rewind.int.test.ts src/lib/shared/sessions/rewind.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-H-w1-<n>.log 2>&1; echo exit=$?'`
(If `systemd-run` is refused, `timeout 900` with the same NODE_OPTIONS.) Never pipe vitest into `head`. Read the log with `tail`/`grep`.
Then `npx prettier --check` on each file you changed.

## Files owned (edit only these)
`src/lib/server/sessions/rewind.ts` · `src/lib/server/sessions/rewind.int.test.ts` · `src/lib/server/pipelines/routines/moments.ts` (ReplayedLine and the one push line only) · `src/lib/shared/sessions/rewind.ts`.

## Files readable
Anything. `src/lib/server/sessions/turnYield.ts` (turnYieldOf, creatingRunOf), `src/lib/shared/sessions/rewind.test.ts` (must stay green, do not edit).

## Out of scope — never build
Any change to what a turn is (`history.back`, one-message-per-press, two steps, relabelling). `src/lib/server/sockets/sessions.ts` (another lane is editing it now). `src/app.d.ts`, `+page.svelte`, Header/FullscreenExit, the SDK (worker 2). NOMENCLATURE.md, docs.

## Stop and ask (in your final message) when
A name beyond the ones above is needed; a test you were told must pass unchanged fails and the fix would change the unit; anything needs a file outside Files owned; a migration or stored-data change seems needed (it should not: nothing new is stored).

## Rules that apply (from CLAUDE.md, quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never seed a row at a hardcoded id."
- "It is a **session**, never a *chat*."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "An int test that opens a DB inside an `it` needs a 60 s timeout." "Never hand a DOM node to an assertion."

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build.)

## Report (your final message)
Changed files with a one-line summary each · the red-first failures you saw · test command(s) and pass/fail counts · prettier result · anything stopped · Noticed, not done.
