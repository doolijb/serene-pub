# BRIEF — worker task `gs-2d` — session-page controls that open the notes are absent for a guest (SDK shared widgets)

Repos `/home/jody/github/serene-pub-sdk` (edit it there; never `git checkout / restore / stash` in it) and
`/home/jody/github/serene-pub` (tests, docs). Read first: `plans/REPORT-gs-2c-2026-11-17.md` (★1 and the
client section: `requests/openLore.ts` / `summarize.ts` now refuse a non-owner asking for the notes),
`STYLE-GUIDE.md` ("absent, never disabled"), the app's `CLAUDE.md` hard rules ("Linked package = second
Svelte": SDK components follow the SDK's own component rules; a component kit never imports rulesets).

Owner, 2026-11-16: "A guest neither opens nor edits the notes"; "Guests can only see the session detail view".

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only, **never `--write`**; no migration. Never `npm test` / `npm run build` at the SDK
root: `npm run sdk:build` from the app root after checking no dev / preview server (`pgrep -af "vite"`; the
Svelte language server's esbuild does not count) and no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`); SDK tests as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/gs-2d-<n>.log 2>&1"`
(four known failures: derive-don't-spell ×2, untagged exports, guide vocabulary); app tests the same capped way
with `npx vitest run --maxWorkers=3 <paths>` (always pass at least one path). A worker task `gs-2c-fix` is
editing app server files (`sockets/scenes.ts`, `cast/memberAccess.ts`, `utils/activityStore.ts`,
`ActivitySidebar.svelte`, `lorebooks/ownBook.ts`): no overlap; it does not build the SDK.

## The problem

A guest's session page still shows controls that used to open the session's notes; pressed, they now answer
"Not done" or do nothing. All in `core-catalog/components/shared/`:
- `messages/SceneDivider.svelte` 223–231: the scene name is an "Open scene in lorebook" button on every divider
  when the viewer cannot edit; 318–327: *Start a new entry* (`startsEntry` is not gated by owner,
  `messages/SessionContainer.svelte` 238–243);
- `messages/SessionContainer.svelte` 531 (history date marker), 587–590 (day marks), 812–820 (*Next: date*);
- `places/PlacesWidget.svelte` 127, 179, 277 (*Open in lorebook* / *Open entry*);
- `messages/MessageControls.svelte` 317–330 (*Select for summary*).

## Do

1. Each of those controls is **absent** for a viewer who is not the session's owner when its target is the
   session's notes: the text it carried (a scene's name, a date, a place's name) stays, as plain text. The
   widgets already receive the session dossier: use `dossier.isOwner` (`sdk/src/sessionDossier.ts:236`). For
   the owner: unchanged.
2. **Notes or an attached lorebook?** A guest may open an **attached** lorebook only by that lorebook's own
   sharing rules, which a widget cannot know. Decide from what the widget has: if it can tell that the target
   is the session's notes, hide only then; if it cannot tell the two apart without a new dossier field, hide
   the control for every non-owner (a guest opening lore from the page is not part of "the session detail
   view") and say so in the report (★): do **not** add a dossier field.
3. Find any other control in `core-catalog/components/shared/` that opens a lorebook, an entry, a scene in the
   lorebook, the Timeline / Chronicle, or starts a summary / compile, and apply the same rule (list each:
   file:line → what it opened → now).
4. Tests: the SDK's component tests for each widget (find the existing ones; add cases: owner sees the control,
   a non-owner sees plain text and no button); the app's DOM tests that mount these widgets for a guest, if any
   pin the old buttons (old → new). `sdk:build`, the full capped `npm run sdk:test`, and the app tests you touch.
5. Docs: `docs/group-sessions.md` (what a guest can press on the session page) if a sentence becomes false;
   `NOMENCLATURE.md` §25 one line.

## Report (under 300 words)

The table (control → file:line → owner / guest after); how notes vs attached lorebook was decided (★); other
controls found; SDK suite result with failing tests by name; app tests and counts with log names; anything not
done.
