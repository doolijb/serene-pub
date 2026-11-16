# BRIEF — `sense-sumset` worker 3 — the Scenes form: the routine names what decides

You are a `lane-worker` in build lane `sense-sumset` (Serene Pub, app repo `/home/jody/github/serene-pub`). Your
supervisor read the rules; the ones your work depends on are quoted here. Line numbers are from 2026-11-13:
re-read before editing. Report as your final message (changed files, tests run with results, decisions you made,
anything you could not do, **Noticed, not done**).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This lane runs **no** `sdk:build` at all.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`.
  Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`. It is
  a **session**, never a *chat*. Every session has a lorebook. No reference to any other project or product in code,
  comments, tests or docs. "Compile" is never used for scene summaries.
- Comments state the rule, not the story: `src/lib/shared/conformance/commentHistory.test.ts` fails on phrases such
  as "no longer", "used to", "deliberately not", "now" as history.
- Sockets: views register listeners for local state and never call `toaster`.
- STYLE-GUIDE §10 Writing: "Sentence case everywhere." "Labels are nouns, hints are sentences." "One name per thing,
  across the whole flow: the thing you open is a session, never a chat." §9: every interactive element has an
  accessible name; nothing is hover-only.
- Run only your targeted test files, one run at a time, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > <log> 2>&1"`
  with the log under `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/sense-sumset-w3-*.log`.
  Another worker may be running a test: never start two runs yourself. **A failing `assert` on a happy-dom element
  has OOM-killed VS Code**: keep DOM assertions on strings/booleans you pull out first (`expect(el?.textContent ?? "")`,
  `expect(!!el).toBe(true)`), never `expect(element)`. Never pipe vitest into `head`. Do not start a dev server.
  `npx prettier --check <file>` on each file you changed.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.

## The owner's rulings

- 2026-11-12: where the *Summarize finished scenes* routine exists, "show only Full / Review / Off"; the session's
  **Summaries** setting (On close / On request / Never) is replaced by the routine's mode; Chat and Story Minimal
  keep Summaries.
- 2026-11-13: "Off stops only the automatic run" — the Summarize buttons stay under Off.
- A session **has the routine** when `sessions:routines` lists a routine whose `pipeline` is
  `core:spec/scene-summaries` (any mode, Off included).
- The server already drops `summary` from `sessions:update`'s `sceneSettings` for such a session (worker 2), and
  the scene context reads `onRequest` for it (worker 1).

## Goal — `src/lib/client/components/sessionForms/SessionSceneSettings.svelte`

1. The component already reads `sessions:routines` (~60–76) for the scenes routine. In the **same** callback, also
   keep the *Summarize finished scenes* routine when present: its `name` (as the server sends it; it is the
   routine's display name, *Summarize finished scenes* in core) and its `mode` (`"off" | "review" | "full"`), or
   null when the list has none. Same `requestWithInterest` call; no second listener. Until the reply arrives (or
   with no `sessionId`), treat it as "no routine" (the select shows exactly as today).
2. When the session has the routine, the **Summaries** `Select` and its help line (~287–304) are not shown. In
   their place, one `<p class="text-surface-600-400 text-xs">` with a `data-scene-summaries-routine` attribute:
   🚧 provisional copy, verbatim:
   - `Summaries are written by the ‹name› routine (‹Full | Review | Off›).` — mode words exactly **Full**,
     **Review**, **Off** (a small local map; the server's `ROUTINE_MODE_LABELS` in `sessions/settingsForm.ts` ~99 is
     not exported to the client and must not be imported).
   - followed by ` Change it under Routines.` **only when the card is not `disabled`** (a member sees the Scenes
     card disabled and has no Routines group: `EditSessionForm.svelte` ~3335–3344 passes `disabled={isGuest}`).
   The routine's own control stays where it is (the Routines group in `SessionSettingsForm`). Do not add a second
   control, a link, or mix the two save models.
3. When the session has the routine, `set()` must not carry a meaningful `summary` choice: the override it writes
   may still contain `summary` (the server drops it), so no change is needed there unless `followsGenre` / *Use the
   genre's settings* misbehave — check that they don't, and say so.
4. A session without the routine shows the select exactly as today, byte for byte in behaviour.
5. Update the component's header comment in one or two sentences (the rule, not the story).

Check, and say in the report, that the session-create flow never sends `sceneSettings` (only `sessions:update` writes
them, `EditSessionForm.svelte` ~1369–1400; `sockets/sessions.ts` ~6900): if it does, stop and report.

## Test — new `src/lib/client/components/sessionForms/sessionSceneSettings.dom.test.ts`

Precedent for mounting with a fake client socket and the interest layer:
`src/lib/client/components/sessionForms/sessionSettingsForm.dom.test.ts` (top ~40 lines) and
`seatMemberSheet.dom.test.ts`. Claims:
- with a `sessions:routines` reply listing `core:spec/scene-summaries` at `review`: no Summaries select, the line
  reads `Summaries are written by the Summarize finished scenes routine (Review). Change it under Routines.`;
- same, `disabled`: the line ends at `(Review).` with no *Change it under Routines.*;
- `off` reads `(Off)`;
- a reply without that routine (or before any reply): the Summaries select shows with its three options, as today.

## Files owned

`src/lib/client/components/sessionForms/SessionSceneSettings.svelte` and the new DOM test. Nothing else.

## Out of scope

`EditSessionForm.svelte`, `SessionSettingsForm.svelte`, any server file, the SDK, docs, the Chronicle and
conversation widgets, any new setting.

## Stop and ask when

You would need to edit any other file; the copy cannot be shown as written; the create flow sends `sceneSettings`.

## Done means

The new DOM test passes; `src/lib/shared/conformance/commentHistory.test.ts` shows no hit in your files. Do **not**
run `npm run check` / `svelte-check` (the supervisor runs it once at the end); be careful with types in the
component instead. Report the commands and counts.
