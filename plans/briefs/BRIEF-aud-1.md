# BRIEF — build lane `aud-1` — five defects from the audit of untouched areas (programme 0.8)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/REPORT-audit-untouched-areas-2026-11-16.md` (findings 2–6; **re-verify each before fixing**; finding 1
waits for the owner and finding 7 is not built), `STYLE-GUIDE.md` copy rules for any message shown.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write`. Never commit. Tests
only as `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/aud-1-<n>.log 2>&1"`,
one run at a time (other lanes run tests: wait until no vitest is up, an `until` loop on `ps`). Type checks with
`NODE_OPTIONS=--max-old-space-size=10240`. The SDK is not touched. No migration. No full run, no `npm run build`.

## Build (each with a test that fails before and passes after)

2. **Network page Copy link:** no unguarded `navigator.clipboard` (standing ruling: browser code runs on
   plain-http LAN addresses); use the guarded pattern of `SupportReportCard.svelte` and the existing "could not
   reach the clipboard" message; nothing new in copy.
3. **Plugin user settings:** a reply clears only the draft and the error of the plugin it answers; a failed save
   keeps its typed values and its error on screen; "Settings saved" is said only of what saved. Keep one
   listener per event family, each `socket.off` with its handler.
4. **Deleting managed rows from Admin › Models › Connections** releases the manager the same way the
   Connections view's own Remove does: the last `audiocpp_managed` row switches audio.cpp off; the last KoboldCPP
   managed row counts `koboldcpp_managed_image` too. Reuse the existing switch-off calls; no second writer.
5. **`samplingConfigs:usedBy` is admin-only**, like its sibling handlers; update the comment that says otherwise
   to the rule; confirm no member-facing view calls it (grep), and report if one does instead of gating it.
6. **`docs/connections.md` ~582:** the managed reload wait is up to 30 minutes while KoboldCPP is running.

## Files owned

The files the report names for findings 2–6 and their tests. Not `src/lib/server/sockets/sessions.ts` or its
`sessions.*.ts` modules; not `pipelines/runtime/bindings.*`, `host.*` (other lanes).

## Stop and ask when

CLAUDE.md §Decisions applies; a fix needs new wording a user sees beyond an existing message; a finding turns out
false (report it, change nothing).

## Done means

The new tests and the touched files' existing tests green in the capped form; `tsc` 0 errors; `npm run check`
0 errors.

## Report

Final message = the report (lead saves `plans/REPORT-aud-1-<date>.md`): per finding, the fix, the test, files;
**Noticed, not done**. Under about 400 words.
