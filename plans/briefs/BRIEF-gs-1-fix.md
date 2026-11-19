# BRIEF — worker task `gs-1-fix` — scope-review fixes to lane `gs-1` (who reads prompts)

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-gs-1-2026-11-16.md`, the "Cold review
corrections" section of `plans/briefs/BRIEF-gs-1.md` (correction 1: `Viewer.sessionId` stays owner-only; an
administrator who is not the session's owner writes at configuration scope). Re-verify every file:line.

Rules: never `git stash / checkout / restore`; `npx prettier --check` only; never commit; no migration; no SDK
edit. Comments state the rule, not the story. Lane `tm-1` is editing `pipelines/runtime/host.read.sessionCast.ts`,
`pipelines/prompt/assemble.ts`, `scenes/earlierScenes.ts`, `state/statTrail.ts`, `lorebooks/loreMatch.ts`,
`tools/coreTools.ts`: do not touch those. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-1-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .` (errors in `tm-1`'s files in flight are not yours: note them).

## Fixes

1. **The pins must pin the scope** (`src/lib/server/sockets/pipelines.promptReaders.int.test.ts`):
   - the administrator-in-someone-else's-session test (~366–392) asserts only `set.error` is undefined. After
     the write also assert: the session owner's view of that session does **not** show the value with
     `source: "session"` (nothing was stored on the session), and the administrator's configuration view shows
     the value at configuration level. Keep "G6" in the test name.
   - the guest-write test (~326–363) accepts any error (`toBeTruthy`): assert the exact refusal sentence the
     configuration scope gives a non-admin, and that nothing was stored (read back at both scopes).
   Tests only; if either new assertion fails, **stop and report** (that is a real defect, not yours to patch).
2. **A doc sentence that is now false** (`docs/sessions.md:464`): "The model, sampling, loadouts and prompts'
   wording are never a member's setting: only administrators see them." → "…are never a member's to change;
   only administrators see the model, sampling and loadouts, and a session's owner may read its prompts'
   wording."
3. **"Raise it" is absent for a non-admin, not dead.** `src/lib/client/lorebooks/GraphsWorkspace.svelte:1702`
   no longer opens the pipeline panel for a non-admin, but `src/lib/client/lorebooks/graphs/NodePanel.svelte`
   ~279 still shows the link. Make `onRaiseCeiling` optional in `NodePanel`, render the link only when it is
   passed, and pass it only for an administrator. Whatever sentence stands beside the link must still read
   correctly without it (check the surrounding copy; if the sentence promises a way to raise the ceiling, a
   non-admin's version says in words that an administrator sets it: reuse an existing sentence of that kind if
   one exists, else one short sentence, ★). A DOM test for `NodePanel` with and without the prop.
4. **Stale text:** `src/lib/server/sessions/settingsForm.ts` 38–39 (header says prompts are "never in the form,
   for anyone") states today's rule: the session's owner picks a prompt and may read its wording.
   `STYLE-GUIDE.md` ~2173 (§6.17): "a non-admin gets prompts only" gains "in their own session".
5. **Report and ledger:** append a "Scope review and fix task" section to `plans/REPORT-gs-1-2026-11-16.md`
   (the review found no leak and no write-side regression; these fixes; `src/lib/shared/sockets/types.ts` was
   edited for `fieldId`; the dialog gained an ungrouped list with the screen-reader copy "Prompts on offer",
   ★ provisional; `isPromptRow` and `humanizeFieldName` in `sessionSettingsForm.ts` are second copies of
   rules, noted, not refactored) and add "Prompts on offer" to the `gs-1` §25 entry in `NOMENCLATURE.md`.

## Tests

`sockets/pipelines.promptReaders.int.test.ts`, the new `NodePanel` DOM test, any existing `GraphsWorkspace` /
`NodePanel` tests. `tsc` 0 in your files.

## Report (under 250 words)

Per fix: what changed (file:line); whether the two strengthened pins passed first time; sentences (★); tests and
counts with log names; anything not done.
