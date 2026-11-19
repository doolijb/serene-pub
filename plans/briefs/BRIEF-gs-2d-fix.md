# BRIEF — worker task `gs-2d-fix` — finish hiding notes openers for a guest: the Places widget, administrators, two missing tests

Repos `/home/jody/github/serene-pub-sdk` (edit it there; never `git checkout / restore / stash` in it) and
`/home/jody/github/serene-pub`. Read first: `plans/briefs/BRIEF-gs-2d.md` (the task this finishes) and the
app's `CLAUDE.md` hard rules. Memory note that applies: **a widget manifest change needs a cache refresh**:
find how a manifest's `reads` reaches a running install (boot's catalogue sync / registry rows) and what
re-pins when a registry row changes (registry hash tests carry "(was …)").

Owner, 2026-11-16: "A guest neither opens nor edits the notes"; "In another person's session an administrator
is a guest".

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only, **never `--write`**; no migration (if a stored registry row must change for
existing installs, find the existing boot pass that republishes shipped declarations and confirm it covers
this: "0.6 is in users' hands": a second boot changes nothing; if it does not cover it, stop and report).
`npm run sdk:build` from the app root only after `pgrep -af "vite"` shows no dev / preview server (the Svelte
language server's esbuild does not count) and no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`). SDK tests:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/gs-2d-fix-<n>.log 2>&1"`
(four known failures); app tests the same capped way with `npx vitest run --maxWorkers=3 <paths>` (always at
least one path). No other lane is editing.

## Do

1. **The Places widget must know the viewer.** `core-catalog/src/registry/widgets.ts:1437` declares the
   `places` widget with `reads: ['settings']`, so `viewer` comes back empty and the guest gate task `gs-2d`
   wrote in `components/shared/places/PlacesWidget.svelte` never fires. Declare `reads: ['settings', 'viewer']`
   (check how sibling widgets that read the viewer declare it and follow them exactly). Rebuild, re-pin any
   registry / catalogue hash with "(was …)", and make sure an existing install picks the new declaration up on
   boot through the existing republish pass (test or cite the pass and its test).
2. **An administrator in someone else's session is a guest for these widgets too.** Task `gs-2d` gated Messages
   on `dossier.isOwner` and Places / Chronicle on `viewer.isGuest`; it reported that an administrator viewing
   someone else's session still sees the openers in Places and Chronicle. Find how `viewer.isGuest` is filled
   (app side: the widget host's viewer object) and what it is for an administrator who is in the session as a
   guest. The gate these two widgets need is "not the session's owner": if the viewer object carries an
   owner fact (`isOwner`, or the session owner's id), use it; if `isGuest` is simply wrong for an administrator
   guest, fix it where it is filled (app) so it means "in this session and not its owner", and list every other
   reader of `viewer.isGuest` to show none breaks. Do not add a new published field unless neither is possible
   (then stop and report).
3. **Tests:** a Places mount as a guest (place names are text; no *Open in lorebook* / *Open entry*) and as the
   owner (unchanged); a Chronicle mount as a guest (the four openers absent) and as the owner; an
   administrator-guest case for each. Then rerun `src/lib/client/**/remoteChronicle.dom.test.ts` and
   `remotePlaces.dom.test.ts` (find them): two cases there failed during `gs-2d`'s edits
   (`remoteChronicle.dom.test.ts:306`, `remotePlaces.dom.test.ts:265`): they must pass, re-pinned old → new only
   if they pinned a guest seeing an opener.
4. Full capped `npm run sdk:test` after the last SDK edit: report failing tests by name.

## Report (under 300 words)

What changed (file:line); how an existing install gets the new declaration; what `viewer.isGuest` meant and
means; tests and counts with log names; anything you stopped on.
