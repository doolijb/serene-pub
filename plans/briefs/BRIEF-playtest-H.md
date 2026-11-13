# BRIEF playtest-H — Back: the three latent bugs and the "Back takes" count (item 6, latent 1–3 + count)

Lane id `playtest-H` · wave 2 · report `plans/REPORT-playtest-H-2026-11-04.md`

## Goal
Plan lines 351–390. Build the **Always** list only:
1. **Double press:** an in-flight flag on `rewindPresses` (`src/lib/client/components/sessionPage/requests/rewindTurn.ts:30-35`), cleared on the `sessions:rewindTurn` reply or error.
2. **People, not speakers:** add `userId` to `ReplayedLine` (`pipelines/routines/moments.ts:224, 230-237`) and make the "table of players" rule (`server/sessions/rewind.ts:263-265`) count distinct people, so one person switching persona mid-round doesn't widen the unit.
3. **Run sweep:** `unitRuns` (`rewind.ts:413-427`) is bounded by `id >= firstId`. Do NOT filter to `action='created'`: the docstring (`:412`) includes rewriting runs on purpose, and their changes must still be taken back.
4. **Count:** `backTakes: {count, names[]}` on `RewindState` (`src/lib/shared/sessions/rewind.ts:37-43`), filled in `rewindStateOf`, shown in `Header.svelte` and `FullscreenExit.svelte` as *"Back: your line and 3 replies (Ash, Birch, the narrator)"* — a title/aria description on the existing button, no new control. If it needs the SDK's `ConversationRewindV1`/`rewindStripState`, that is a pin bump: do it, note it, and run the SDK's own test file for it.
Docs: `docs/sessions.md:232-249` — one sentence that the button says what Back will take. (Lane H owns `docs/sessions.md` this wave.)

## Files owned
`src/lib/server/sessions/rewind.ts`, `rewind.int.test.ts`; `src/lib/server/pipelines/routines/moments.ts` (ReplayedLine only); `src/lib/shared/sessions/rewind.ts`; `src/lib/client/components/sessionPage/requests/rewindTurn.ts`, `rewindTurn.test.ts`; `src/lib/client/components/Header.svelte`, `FullscreenExit.svelte` (+ a DOM test for the count); SDK: only the conversation rewind-strip files if step 4 needs them (+ their sdk-tests file); `docs/sessions.md`.

## Files readable
Anything. Especially NOMENCLATURE §9 Session (line 405) and §24's **turn unit** note; `docs/sessions.md:232-249`; `docs/genre-story.md:56`; `rewind.int.test.ts:571-597` (the unit as ruled 2026-10-24 — it must keep passing unchanged).

## Out of scope
§0-A and every unit change (`history.back`, one-message-per-press, two steps, relabelling *Back one turn*): the unit Back takes stays exactly the whole exchange; ★6a, ★6b; `src/lib/server/sockets/sessions.ts` (lane A owns it this wave — queue any needed line in the report with exact text); `core-catalog/src/registry/genres.ts`.

## Done means
Green: `rewind.int.test.ts` (existing tests unchanged + persona switch mid-round takes only the newest exchange; an `updated`-only run doesn't widen the unit; `rewindStateOf.backTakes` equals `rewindUnitIds`), `rewindTurn.test.ts` (double press sends one emit), the Header DOM test (count text present), the SDK test file if touched. Then the report.

## Standing rules for every playtest lane (verbatim from the lead)

- **Plan:** `plans/PLAN-story-playtest-fixes-2026-11-03.md`. Read the §Summary, §0, your item sections (line ranges below), and §"Build plan". Read `.claude/guides/multi-agent.md` first, then the NOMENCLATURE, STYLE-GUIDE and `docs/<area>.md` sections your files trigger (CLAUDE.md §Authoritative documents), and quote the lines that matter into every worker brief.
- **Scope is the ready-now set only.** The owner's go (2026-11-04) covers only the steps named under **Goal** below. Every §0 reversal and every ★ in the plan is UNRULED and stays unbuilt, even where the plan recommends an answer; the only exception is ★1a's default, which the owner's go named. If a step turns out to need an unruled ★, a new user-facing setting, a new flag, a migration, or a file outside **Files owned**, stop that step, finish the rest, and put it in the report under **Stopped, needs owner**.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 (line 29) and §24 (line 1579), then the group section for your area. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** (term · meaning · section · ⚠ what it is not); the lead writes the §25 ledger row. §23 retired words are never reintroduced. Copy follows STYLE-GUIDE §10 (line 2170): sentence case, plain words, it is a *session*, never a *chat*.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration and stops the step.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts; views never call `toaster`. An event in `SCOPED_EVENTS` must carry its scope key in the payload or `emitToUser` sends nothing. `socket.off(event)` always with the handler. `$state(new Set())`/`Map` is not reactive: `SvelteSet`/`SvelteMap`. `crypto.randomUUID` and `navigator.clipboard` are banned in browser code.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-<lane-id>-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Run only the targeted test files named under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole; the lead runs one grouped verification at the end. Run vitest inside a capped scope and log to a file named with your lane id in the scratchpad dir `/tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/`:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > <scratchpad>/<lane-id>-<n>.log 2>&1; echo exit=$?'` (if `systemd-run` is refused, use `timeout 900` with the same NODE_OPTIONS). Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Never hand a DOM node to an assertion (`x === null` compared to `true`, not `assert.equal(node, null)`).
  SDK tests: run the single file through the runner in `../serene-pub-sdk/sdk-tests/package.json` (check it first), never the SDK root `npm test`/`npm run build`.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk` (the app resolves `@serene-pub/*` by `file:` link). If an app test needs the rebuilt dist: `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-dist.lock npm run sdk:build` from the app root, only after the dev-server check below. Never `git checkout`/`restore`/`stash` in the SDK repo: most of it is uncommitted.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path below: Changed files (both repos) · Tests run, with the exact command and pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (edits to files you don't own, with file:line and the exact text) · Noticed, not done. Under 1,200 words.
