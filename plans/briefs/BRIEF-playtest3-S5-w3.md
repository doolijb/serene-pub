# BRIEF playtest3-S5-w3 — SDK: `ConversationSceneV1` carries the causes; the scene divider shows them

Lane `playtest3-S5` · worker 3 · supervisor reads your final hand-back (put the full report there; do not write a report file). Work in `/home/jody/github/serene-pub-sdk`.

## Ruling (owner, 2026-11-04 — final)
*"★S-4 → on the scene divider: scene rows carry `openedBecause` + `castCause`; `ConversationSceneV1` the same (optional); the divider shows them under its name and in the faces' title."*
The app side is built: scene rows carry `openedBecause?: string` (why it opened, in the scene cue chip's words — e.g. *the day changed*, or *the day changed · time passed*; absent for a scene a person opened) and `castCause?: string` (a whole sentence, e.g. *"Story keeps the open scene's cast up to date from its lines. Set How scenes begin to Manual to stop it."*; present only while the scene is open and its genre refreshes the cast).

## Build
1. `sdk/src/sessionDossier.ts`, `ConversationSceneV1` (~:101) ONLY: add after `cast?`, both optional, additive, each with a 🚧 doc line in the file's voice:
   - `openedBecause?: string` — *🚧 Why the scene began by itself, in its scene cue's words (`the day changed`); absent for a scene a person started.*
   - `castCause?: string` — *🚧 While it is open and its genre keeps its cast up to date from its lines: what does it and how to stop it, as one sentence. Absent otherwise.*
2. `core-catalog/components/shared/messages/SceneDivider.svelte`:
   - `openedBecause`: when present, one line **under the name**: a `<span data-widget-part="messages.scene-cause">` reading `Began by itself: ‹openedBecause›`, with `title="This scene began by itself because ‹openedBecause›. Set How scenes begin to Suggested or Manual to choose each scene yourself."`. Placed as the LAST child of `messages.scene-divider-body` (the body is `flex-wrap`; the host's sheet will give the part `flex-basis: 100%` — not yours). Read it the way the file reads other optional fields (`(scene as { openedBecause?: string }).openedBecause`, as `hasSummary` / `cast` are read today), so it compiles against an older dist too.
   - `castCause`: when present, appended to the faces' title (`messages.scene-faces`, today *"Who speaks in it: …"*) on a new line (`\n`), AND to the facts' title (`messages.scene-facts`), which is where the default sheet shows who is in it (the sheet hides the faces) — when there are no faces the facts' title is the cause alone. Nothing else in the divider changes.
3. Test — `sdk-tests/coreConversationScenes.test.ts`: one new test in the file's style (`scene({...})` fixtures, `mount(dossier(...))`, `view.query`, `try/finally unmount`, `{ timeout: 120_000 }`): a scene with `openedBecause: 'the day changed'` and `castCause: '…'` shows `Began by itself: the day changed` in `messages.scene-cause` and the cause in the faces' and the facts' `title`; a scene without either has no `messages.scene-cause` and its titles are unchanged. Assert on strings only — **never hand a DOM node to `assert`** (a failing assert on a happy-dom element has OOM-killed VS Code).
   Run only this file, from the sdk-tests package, in a capped scope:
   `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test coreConversationScenes.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S5-w3-<n>.log 2>&1; echo exit=$?'` then read the log (`# pass`, `# fail`, `not ok`).
   Expected and NOT yours to fix: `sdk-tests/widgetParts.test.ts` will fail until `guides/widgets.md` is regenerated for the new part — do not run the generator and do not edit `guides/` (the supervisor queues it).

## Files owned (re-read each immediately before editing — `sessionDossier.ts` and the test file already carry other lanes' uncommitted edits; keep them)
`sdk/src/sessionDossier.ts` (`ConversationSceneV1` only), `core-catalog/components/shared/messages/SceneDivider.svelte`, `sdk-tests/coreConversationScenes.test.ts`.
## NEVER touch
`sdk/src/widgets.ts` and `core-catalog/components/shared/messages/SessionMessage.svelte` (lane T2 is editing them right now), `guides/**`, `core-catalog/src/registry/**`, anything in the app repo.
## Out of scope
Any other dossier field; styling (CSS lives in the host); menus; the cue chip.
## Stop and ask when
A name beyond `openedBecause`, `castCause`, `messages.scene-cause`, or copy beyond the two strings above; anything outside the files owned.

## Rules (quoted)
- *"Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted."*
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git clean`.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — you do NOT run `sdk:build`; the test reads sources.
- Do what was asked, at the size asked; findings go under **Noticed, not done**. Never `prettier --write` a whole pre-existing file.

## Hand-back
Changed files with line ranges · exact command and pass/fail counts · decisions · stopped · noticed, not done.
