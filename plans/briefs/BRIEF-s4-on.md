# BRIEF — lane `s4-on` (end of the flip unit, waves 1–3) — turn the flip on, verify the whole tree, walk it

Read `plans/briefs/BRIEF-s4-common.md`, plan §34 (esp. §34.1, §34.5) and **every flip-unit report**: `plans/REPORT-s4-f-sdk-2026-11-08.md`, `-f-door-`, `-f-pass-`, `-f-client-`, `-f-emit-` (its **Q1–Q4** are your first job), plus `-cl-`, `-ner-`, `-bk-lock-`, `-chr-read-` for the NOMENCLATURE queue. Memory to read: `/home/jody/.claude/projects/-home-jody-github-serene-pub/memory/reference_isolated_dev_instance_recipe.md`, `feedback_background_agents_crash_vscode.md`, `feedback_never_sigkill_pglite_server.md`, `feedback_vite_ssr_reload_splits_server_singletons.md`.

## Goal, in order

1. **Apply f-emit's queued edits** exactly as its report states: **Q1** (`state/seatRefs.ts` door — `?? s` / `?? owner` when the translator can't answer; JSDocs), **Q2** (`sessions/fireTurn.ts` RESPOND branch — the patched copy is in the scratchpad path the report gives; diff it against the live file before using it, the live file may have moved), **Q3** (`pipelines/prompt/adventureContext.ts` `withinEarshot`/`holderOf` resolve the holder key from the `state.cast.byId` entry; off behaviour unchanged; add a test that a voice sees its own holder-only values with the switch on and off), **Q4** (SDK `participants.ts` ~424/~462 JSDoc wording as given).
2. **Turn on:** set `memberFormSwitch` to `{ on: true }` in `src/lib/server/state/memberForm.ts`; paste f-pass's startup hunk (verbatim in `plans/REPORT-s4-f-pass-2026-11-08.md`) into `src/lib/server/startup/index.ts` after `character-versions`, before `plugins`. Update the switch's JSDoc ("on from 2026-11-08; removed in S5"). Tests that set/restore the switch keep working.
3. **Grouped verification**, one after another, each capped and logged to your scratchpad with `echo exit=$?` appended:
   - `npx tsc --noEmit -p .` and `npm run check` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`)
   - `pgrep -af "vite dev"` → none → `npm run sdk:build`, then `npm run sdk:test` (known reds: K-2 `deriveDontSpell` speakMessage, `deriveDontSpell` ruled count 18 vs 17, surface F1 `CREATE_SESSION_PERSONA_*_MAX`, vocabulary `your-first-plugin.md` "run")
   - the full app suite: `systemd-run --user --scope -p MemoryMax=20G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=6144; npx svelte-kit sync && npx vitest run --maxWorkers=3 > s4-on-full.log 2>&1; echo test-exit=$? >> s4-on-full.log'` (never pipe into `head`)
   - `npm run build` (capped 12G)
   **Triage every failure:** caused by the flip or by an S4 lane → fix it (you may edit any file an S4 lane touched; list each fix); pre-existing or another programme's (e.g. `sessions.forms.int` R-b `askedRunId`, `wiring.test.ts` `core:oracle/speak@1`, `ModelRow.svelte`) → list with evidence (is it red at the same test before your edits? check by reasoning from the reports, or `git stash` is **forbidden** — never use it). Re-run the failing files after fixes.
4. **NOMENCLATURE merge:** you hold `NOMENCLATURE.md`. Merge every row queued in the f-door, f-pass, f-client, f-emit and chr-read reports (the lead already merged s4-ner, s4-bk-lock, s4-f-sdk and s4-cl). Mark rows 🚧 as queued; fix the stale rows f-door named (~l.3287, ~l.3297). Do **not** add ★f-emit-1's turn-candidate row (unruled) — leave a one-line ⏳ note that `castMemberId` rides on candidates pending the owner.
5. **Walk** (after the suite is green or triaged): boot an isolated dev instance per the recipe (own port, e.g. 5241; data dir in your scratchpad; never `~/.local/share/SerenePub`). First boot a **copy of a pre-flip database** if one exists in the scratchpads of earlier S4/cv walks (look for a `dev-data` dir under `/tmp/claude-1000/-home-jody-github-serene-pub/*/scratchpad/`; copy it, don't use it in place) so the `seat-keys` pass runs on real data — record its log line; then boot again and confirm the second boot logs nothing from `seat-keys`. With headless Playwright (MCP tools may be held by another session — fall back to a short Python/Node Playwright script if so): open a session with a carded character seat and a player seat; send a line; the reply comes from the right seat (name, face, turn line); Back and Forward; a stat edit on the character and on the player seat lands on the right one; the Who's here / attendance list; a Dungeon Crawler or Lair session takes a round if one exists in the data. Screenshots under `.playwright-mcp/s4-on-*.png`. Stop the instance with SIGTERM.

## Files owned

Q1–Q4 files; `state/memberForm.ts`; `startup/index.ts` (the hunk); `NOMENCLATURE.md`; and, for triage fixes only, any file an S4 lane touched (list each). Nothing else.

## Out of scope

Wave 4+ work (seat, st, cp, bk-fold, chr-view); ★f-emit-1's SDK JSDoc (unruled); any new behaviour.

## Stop and ask when

A failure needs a behaviour decision; the walk shows a wrong seat, lost value or wrong name that you can't trace to a flip bug; anything the common brief's Decisions covers.

## Report

`plans/REPORT-s4-on-2026-11-08.md` (or the whole text in your final message): Q1–Q4 applied; turn-on diff; each verification step's result (counts); every failure with its triage; the NOMENCLATURE rows merged; the walk (seat-keys log lines on first and second boot, what you checked, screenshots); open ★; Noticed, not done.
