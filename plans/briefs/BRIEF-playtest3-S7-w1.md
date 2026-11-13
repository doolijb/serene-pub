# BRIEF playtest3-S7-w1 — a by-date compile creates nothing on any refusal

Lane `playtest3-S7`, worker 1. Supervisor checks your diff against this brief. Report back in your final message (changed files, the exact test command, pass/fail counts, anything you could not do).

## Goal
In `src/lib/server/sockets/scenes.ts`, `sceneCompileHandler` (starts ~line 1078; the `ByDate` branch is the `else` of `if (asked && typeof asked === "object" && "historyEntryId" in asked)`, ~1123–1210). Today a by-date ask creates the dated history entry (`historyEntryOfDate(…, { create: true })` inside `db.transaction`, ~1189) and only THEN falls into the entry path, which can still refuse — leaving an empty dated entry behind. Make every refusal happen before anything is created:

1. **Target and sampling ahead of the branch, for both asks.** Move the block that resolves the compile's model — the `resolveStepConfigs` / `SUMMARIZE_HISTORY_SPEC_ID` dynamic imports, `synthCfg`, `resolveCapabilityTarget(...)`, `if (!target.ok) return refuse(target.problem.message)`, `compileConnection`, the `if (!target.sampling) return refuse("The Reply loadout has no sampling config, …")` refusal and `compileSampling` (~1317–1369) — to just after the `refuse` helper is defined and before `let params: Sockets.Scenes.Compile.ByEntry`. Move it whole, with its comments (keep the comment text; you may add one sentence saying it runs before the by-date branch so a refused compile creates nothing). Leave nothing of it behind at the old place; `compileConnection`, `compileSampling`, `synthCfg` are used later unchanged. Do NOT change the refusal strings.
2. **The waiting-scenes check inside the transaction, under the lock.** The `waiting` query + filter (~1155–1185) moves inside the existing `db.transaction(async (tx) => { await lockBookCalendar(tx, lorebookId!) … })`, after `lockBookCalendar` and before `historyEntryOfDate`, and queries through **`tx`** (`tx.query.scenes.findMany`, same `where`, same filter). When nothing waits, the transaction callback returns `null` (no throw, nothing created) and, after the `try/catch`, the handler does `return refuse("No scenes of that day are waiting to be compiled.")` — same string. Type `resolved` as `{ historyEntryId: number; created: boolean } | null`. Keep the existing `catch (e: any) { return refuse(e?.message || "That date could not be compiled into.", e) }` as is. Update the comment above it ("A stale press must never leave an empty entry…") to say the check runs under the book's calendar lock so a concurrent Apply cannot file those scenes between the check and the creation.
3. **The line check is satisfied by construction for a by-date ask** — add a short comment in the by-date branch (near the `historyEntryOfDate` call) saying so: `historyEntryOfDate` returns only an entry `rowReadsOnLine` passes for the asked line, or one it creates on that line's own branch (`branchId: askedBranchId`), which the line always reads; so the entry path's *That history entry is not on the line you are reading.* cannot fire after a creation. Do not remove the entry path's line check (the `ByEntry` ask needs it).
4. **The already-in-progress refusal** (`activityStore.startCompile` throws *A compile of this entry is already in progress for this line and moment.*, ~1397) needs no move: a compile can only be in progress for an entry that already exists, and when the day's entry exists `historyEntryOfDate` finds it (`created: false`) and nothing is made. Add one comment line near the by-date `historyEntryOfDate` call saying so. The test below proves it.

Nothing else in the handler changes. No other handler in `scenes.ts` changes.

## Tests — add to `src/lib/server/sockets/scenes.compileLine.int.test.ts`, in `describe("scenes:compile by date", …)` (~921)
Follow the file's existing style (`seedBook`, `unfiledOn`, `historyEntriesOf`, `byDate(w, over)`, `compiled`, 60_000 timeouts on every DB test).
- **Mock for the target.** Next to the existing `vi.mock` blocks at the top, add a pass-through mock of `$lib/server/connections/capabilityTarget` with a test-controlled override, like `failReceipt`:
  ```ts
  /** Set by the by-date refusal tests: rewrites the resolved compile target once. */
  let targetOverride: ((real: any) => any) | null = null
  vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
  	const actual = await importOriginal<any>()
  	return {
  		...actual,
  		resolveCapabilityTarget: vi.fn(async (...args: any[]) => {
  			const real = await actual.resolveCapabilityTarget(...args)
  			const override = targetOverride
  			targetOverride = null
  			return override ? override(real) : real
  		})
  	}
  })
  ```
- **Gate for the in-progress case.** Let the existing `compileScenesForEntry` mock await an optional test-controlled promise (`let holdCompile: Promise<void> | null = null`; `if (holdCompile) await holdCompile` before returning). Default null, so every existing test is unchanged.
- Test A — *no `text->text` target: refused, and no entry is made*: an unfiled scene of the asked day, no entry of that day; `targetOverride = () => ({ ok: false, problem: { kind: "unset", capability: "text->text", message: "No model is chosen for text." } })` (use whatever `kind` value the `CapabilityTargetResult` problem type accepts — read `capabilityTarget.ts`); the press rejects with that message; `historyEntriesOf` count unchanged; the only event is `scenes:compile:error`; `compiled` is empty.
- Test B — *a missing sampling: refused, and no entry is made*: same seed; `targetOverride = (real) => ({ ...real, sampling: null })`; rejects with `"The Reply loadout has no sampling config"`; count unchanged; nothing compiled.
- Test C — *a compile already in progress: refused, and no second entry*: no entry of the day; set `holdCompile` to a promise you release later; fire the first by-date press WITHOUT awaiting (keep the promise); `await vi.waitFor` until `historyEntriesOf` has before+1 and `compileActivity(owner, made.id)?.status === "running"`; the second identical by-date press rejects with `"already in progress"`; `historyEntriesOf` is still before+1 (exactly one entry of that day); release the gate, `await` the first press, set `holdCompile = null`, and remove the activity (`activityStore.remove(id)`) so later tests are clean.
- All existing tests in the file must stay green.

Run (capped; never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/scenes.compileLine.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S7-w1.log 2>&1; echo exit=$?'` then read the log. Then `npx prettier --check` on both files (report the result; do not `--write` — if a check fails only on lines you touched, fix those lines by hand).

## Files owned (the only files you may edit)
- `src/lib/server/sockets/scenes.ts` — `sceneCompileHandler` only.
- `src/lib/server/sockets/scenes.compileLine.int.test.ts`
Re-read each file immediately before every edit (another agent may have touched it). Use Edit, never Write, on existing files.

## Files readable
Everything. Useful: `src/lib/server/scenes/historyEntryOfDate.ts`, `src/lib/server/scenes/unfiledScenesByEntry.ts`, `src/lib/server/connections/capabilityTarget.ts`, `src/lib/server/utils/activityStore.ts` (`startCompile`).

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."
- "Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24." — this task adds NO new error string, event, setting or exported name. Reuse the existing refusal sentences exactly. Test-local variables (`targetOverride`, `holdCompile`) are fine.
- "An int test that opens a DB inside an `it` gets a 60 s timeout."
- "It is a **session**, never a *chat*."
- Do what was asked, at the size asked. Anything else you notice goes in your report under **Noticed, not done**, never fixed in passing.

## Out of scope
Changing the compile prompt or the review; creating the entry at Apply; any setting; `historyEntryOfDate.ts`, `unfiledScenesByEntry.ts`, `liveScenes.ts`, `NOMENCLATURE.md`, any other file.

## Stop and report (do not decide) when
Moving a refusal ahead would need duplicating a query the entry path already does; a new name seems needed; anything outside the files above would have to change.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No SDK build is needed for this task.)
- Never `git checkout`, `git restore` or `git clean` in either repo. Never a full `npm test`, `npm run check`, or project-wide `tsc`.
