# BRIEF — perf-F-w5 — redo the icon-map edits without the prettier churn

You are a `lane-worker`; the lead is acting supervisor for this follow-up to lane `perf-F`. Repository root
`/home/jody/github/serene-pub`. Read `plans/briefs/BRIEF-perf-F-w2.md` (the original icon brief) and the step-4
section of `plans/REPORT-perf-F-2026-11-13.md` first.

## The defect

Worker w2 ran `npx prettier --write` on the 20 converted icon files and reformatted unrelated lines: ~747 insertions
and ~286 deletions where the icon edits themselves are a few lines per file. The lead checked: none of these 20 files
carried another session's uncommitted edits before w2 (they were absent from the tree's modified list at session
start), so restoring each from HEAD loses nothing but w2's own work, which you will redo.

The 20 files: `src/lib/client/admin/AdminView.svelte`, `admin/sections/history/{Page,IdPage}.svelte`,
`admin/sections/defaults/Page.svelte`, `admin/sections/overview/Page.svelte`, `admin/sections/pipelines/SlugPage.svelte`,
`components/shell/JumpOverlay.svelte`, `components/connections/{DownloadsView,ConnectionCard,ConnectionRow,ManagedConnectionView,ModelRow,JobsGrid,OnnxEndpointView,DefaultsLedger,connectionTypeIcon.ts}`,
`components/sidebars/{ConnectionsSidebar,ConnectionServicePicker}.svelte`, `components/loadouts/{LoadoutsLedger,LoadoutsGrid}.svelte`.
NOT in scope: `routes/+layout.svelte` (one named import; check its diff is only that), the new
`shell/adminNavIcons.ts` + test (keep as is), and every other file in the tree.

## Do, per file, in this order

1. Save the current diff for reference: `git diff -- <file> > /tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perf-F-w5-<basename>.diff`.
   Read it and note the semantic edit: the `import * as Icons` → named imports, the explicit `X_ICONS` map, and the
   `Icons[...]` → map lookup with its fallback.
2. Restore the file's HEAD bytes with `git show HEAD:<file> > <file>` (**never** `git checkout`, `git restore` or
   `git stash`). Confirm `git diff --quiet -- <file>` is now silent.
3. Re-apply only the semantic edit from step 1, by hand (Edit tool), matching the file's existing formatting style.
   Do **not** run `prettier --write`. `npx prettier --check <file>` will likely fail as it did at HEAD; that is
   expected and acceptable — report it, do not fix it.
4. `git diff --numstat -- <file>` should now be roughly the size of the icon edit (tens of lines at most). If it is
   not, you re-introduced churn: redo the file.

## Done means

`npx tsc --noEmit -p .` filtered to these files clean (Svelte files: `npx svelte-check --threshold error` only if it
finishes within 3 minutes; otherwise skip and say so); `npx vitest run src/lib/client/shell/adminNavIcons.test.ts`
green (never piped into head); `grep -rn "Icons\[" <the 20 files>` returns nothing; `git diff --numstat` for the 20
files totals well under 200 changed lines. Report to `plans/REPORT-perf-F-w5.md`: per-file numstat before and after,
anything that would not restore cleanly, Noticed-not-done.

## Rules (verbatim)

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash`, `git checkout` or `git restore` in any form. `git show HEAD:<file> > <file>` is the only restore you may use, and only on the 20 files above.
- Never run `prettier --write`. Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name.
- Never pipe vitest into `head`.
