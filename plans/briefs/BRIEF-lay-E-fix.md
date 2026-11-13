# BRIEF lay-E-fix — keep moved Messages settings safe until their row converts (lead-supervised worker)

You are a lane-worker. Read `plans/briefs/BRIEF-lay-common.md` (rules apply to you — especially: EVERY test/tsc run inside the memory-capped `systemd-run` scope, one file per run; inside `db.transaction(async (tx) => …)` only `tx`; no top-level `await` in `src/lib/server/db/index.ts`; no migration) and `plans/REPORT-lay-E-2026-11-05.md` (what lay-E built). App = /home/jody/github/serene-pub.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."

## Why
CLAUDE.md: "0.6 is in users' hands" — an upgrade loses nothing. Two holes (lay-E scope review):
1. `convertPanelsToV2(db)` in `dbReady` skips pre-copy rows (`layout_copied_at IS NULL`, `sessionLayoutPanels.ts` ≈:350/:490); the prune `syncWidgetSettings(CORE_WIDGETS)` (`db/index.ts` ≈:787; `widgetSettings.ts` ≈:50–105) runs right after and deletes their `messages*` rows' moved keys before step 3 (startup task) can move them.
2. A row whose conversion FAILS in dbReady is logged "left as it was, retried next boot" (≈:501), but the prune deletes its moved keys at once.

## Lead decision
- `convertPanelsToV2` returns, in `PanelsV2Report`, a new `pending: Array<{ userId: number; sessionId: number }>` — every session row it skipped as pre-copy plus every session row that failed. (Presets: their moved keys live in the blob, which the prune never reads — nothing to spare.)
- `syncWidgetSettings(decls, opts?: { spare?: ReadonlyArray<{ userId: number; sessionId: number }> })`: for a `widget_settings` row whose (userId, sessionId) is in `spare` AND whose instance is a Messages copy (`widgetOfInstance(id) === 'messages'`), the prune keeps exactly the moved keys — `composer`, `otherTabsComposer`, `showActions`, `nextUp`, `composerPosition`, `showComposer`, `showMessages`, `showNudge` — and prunes everything else as today. Export the key list as one constant from `widgetSettings.ts` (or reuse an SDK export if one exists; check `@serene-pub/sdk` for the converter's key lists before adding).
- `db/index.ts`: pass `{ spare: report.pending }` from the `convertPanelsToV2` call to `syncWidgetSettings`. Nothing else in that file.
- Step 3 (startup task, `sessionLayoutPanels.ts` ≈:619–633) then moves the spared keys; the NEXT boot's prune (no longer spared) clears any leftovers. Fix the failure log line so it is true ("left as it was; its Messages settings are kept for the retry").
- **Narrow step 3's query**: it must not re-read `{}` / floor rows every boot once their settings moves are done. Select a `{}`/floor row only when one of its `messages*` `widget_settings` rows still holds a moved key (or another cheap, exact test you justify). v1-panels rows and rows step 1 just completed are selected as now.
- Delete the stale comment `layoutPanelsV2.boot.int.test.ts` ≈:112 ("Expected to fail until the call is added to index.ts.").

## Tests (int, 60 s timeouts, one file per capped run)
- `sessionLayoutPanels.int.test.ts`: the pre-copy test (≈:941–967) must model a real boot: convert (dbReady) → `syncWidgetSettings(CORE_WIDGETS, { spare: report.pending })` → task (steps 1–3); assert `messages: { composer: "quill" }` ends on the `composer` row. Add: a row forced to fail in dbReady keeps its moved keys through the prune and converts on the next boot (simulate the fix between boots). Add: a `{}` row whose moves are done is not re-selected (count of reads/updates on the second boot = 0 — the existing second-boot snapshot test must still pass).
- `widgetSettings.int.test.ts` (or a new unit test): spare keeps only the moved keys, only on Messages copies, only for the spared (user, session); everything else pruned as before.
- `layoutPanelsV2.boot.int.test.ts`: still green; extend its source check to assert `spare:` is passed.

## Files owned
`src/lib/server/db/sessionLayoutPanels.ts` (+`.int.test.ts`), `src/lib/server/db/widgetSettings.ts` (+its test), `src/lib/server/db/index.ts` (the call's argument only), `src/lib/server/db/layoutPanelsV2.boot.int.test.ts`.

## Done means
Those test files green in capped runs; `npx tsc --noEmit -p .` (capped, MemoryMax=12G, `--max-old-space-size=8192`) shows no error in your files. Final message = your report: changed files, tests + results, anything not done.
