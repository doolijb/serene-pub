# BRIEF m2e-D2-w4 — scope-review fixes: rename `personPress`, two doc comments (2026-11-04)

Worker for lane **m2e-D2**. Work from `/home/jody/github/serene-pub`, absolute paths only.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Goal
1. **Rename `personPress` → `fromPressDoor`** everywhere it occurs (grep `personPress` under `src/`): `src/lib/server/pipelines/runtime/fireAction.ts` (`FireActionRequest` field ~174–181 and its forward ~1030), `src/lib/server/pipelines/runtime/runTurn.ts` (`SpecRunRequest` ~268–269, `frameCauseOfRun` ~560–571), `src/lib/server/sockets/sessions.ts` (the two `personPress: true,` lines ~2606 and ~2861), `src/lib/server/pipelines/runtime/frameCauseOfRun.int.test.ts`. Why (NOMENCLATURE R1 *"One word, one meaning"*): the canon already defines **person's press** (NOMENCLATURE ~2292: a trusted person's event in a box within the press window; `stop`, `branch` and contributed actions are not gated). The flag means only "this fire arrived over the session's press door, `sessions:fireAction`" — which also carries a frame's own ungated fire and the progress card's re-fire. Rewrite the field's doc comment in `fireAction.ts` to say exactly that: 🚧 (M2e) this fire arrived over the session's press door (`sessions:fireAction`) — a person's press or the session view's own fire; never set by core's own fires (auto-advance, read-aloud, a run's child fire); the applet's frame-origin cause derives from it (`frameCauseOfRun`). Not the person gate's *person's press*, not `automatic`, not `ActingVia`. Keep runTurn's one-line doc pointing at it. Update `frameCauseOfRun`'s doc ("a fire over the session's press door" instead of "a person's press").
2. **Two doc comments** that still describe the old producer:
   - `src/lib/server/pipelines/runtime/host.ts:~221–223` (`HostScope.frameCause`): replace the first sentence with "The applet that draws this session, on a run that came through the session's press door (`frameCauseOfRun`)." Keep the rest.
   - `src/lib/server/pipelines/runtime/pluginBindings.ts:~191`: "The applet that draws the run's session, on a run that came through the session's press door (`frameCauseOfRun`); beside `user` on each hook call."
**`sockets/sessions.ts` and `runtime/host.ts` are shared files being edited by another programme right now: re-read the exact lines immediately before EACH edit, exact-string replacement only (the Edit tool), never `sed -i` over the file, never reformat, never `prettier --write`.**

## Run (only these)
`npx vitest run src/lib/server/pipelines/runtime/frameCauseOfRun.int.test.ts src/lib/server/pipelines/runtime/pluginBindings.int.test.ts` and `npx tsc --noEmit -p . > <scratch file under /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/m2e-D2-w4-tsc.log>`, then grep it for `fireAction|runTurn|sessions.ts|host.ts|pluginBindings|frameCauseOfRun`. Confirm `grep -rn personPress src/` returns nothing.

## Files owned
Only the five files named above. Nothing else.

## Rules
- *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**."*
- `fromPressDoor` is approved by the supervisor; any other new name: stop and report.

## Report
`plans/briefs/REPORT-m2e-D2-w4.md`: changed files, tests with counts, Noticed-not-done.
