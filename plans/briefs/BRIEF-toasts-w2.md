# BRIEF — lane `toasts`, worker 2 (2026-11-08): admin / lorebooks / contexts / utils / routes raw toasts → `notify`

## Goal
Every `toaster.error / .success / .info / .warning` call and every `toaster[kind](…)` call in
`src/lib/client/admin/**`, `src/lib/client/lorebooks/**`, `src/lib/client/contexts/**`, `src/lib/client/utils/**`
(except `notify.ts` and `toaster.ts`, read-only) and `src/routes/**` (≈50 files, ≈170 calls today) becomes a
`notify.<level>(…)` call, per the rules below. Includes `toaster[toast.kind]` in `lorebooks/LorebookActions.svelte:458,478`
and `contexts/characterImports.svelte.ts:71,98`, and the callback `welcomeNameSaver(socket, (t) => toaster.error(t))` in
`src/routes/+page.svelte:972`. `src/routes/+layout.svelte` keeps its `toaster` import for `<Toast.Group {toaster}>` (line ~451) — convert any other toaster calls in it, but keep that mount and import.

## Files owned
The directories above only (product files, plus the test files there that your change breaks — assertion edits only).

## Files readable
Everything. Another worker is editing `src/lib/client/components/**` at the same time — never touch it.

## Out of scope
Moving toasts into contexts; routing poll failures elsewhere; any new notify option/level/export; any copy change; any server/SDK file.

## Stop and report (don't guess)
A call needing an option notify lacks; a silent/fromPoll that isn't plain from the code; anything that would change copy.

## Done means
Your grep is clean (test files, notify.ts, toaster.ts and the +layout mount aside); prettier --check passes on every changed file; these tests pass (or fail only as before your change):
- `src/lib/client/admin/sections/rulesets/rulesetFit.dom.test.svelte.ts`
- `src/lib/client/admin/sections/plugins/pluginInstallHold.dom.test.svelte.ts`
- `src/lib/client/lorebooks/bookRulesFit.dom.test.svelte.ts`
- `src/lib/client/admin/sections/rulesets/rulesetAdmin.dom.test.svelte.ts`
- `src/lib/client/admin/sections/connections/comesWithApp.dom.test.svelte.ts`
- `src/lib/client/admin/sections/plugins/installPackage.dom.test.svelte.ts`
- `src/lib/client/lorebooks/lorebooksWorkspace.counts.dom.test.ts`
- `src/lib/client/admin/sections/rulesets/rulesetEditor.dom.test.svelte.ts`
- `src/lib/client/lorebooks/providedRow.dom.test.ts`
- `src/lib/client/admin/sections/connections/modelLeversSave.dom.test.svelte.ts`
- `src/lib/client/admin/sections/pipelines/recentRunsGenre.dom.test.svelte.ts`
- `src/lib/client/lorebooks/time/timeLensDrop.dom.test.svelte.ts`
- `src/lib/client/admin/sections/defaults/defaultsOffNeeded.dom.test.svelte.ts`
- `src/lib/client/lorebooks/loreRail.dom.test.ts`
- `src/lib/client/admin/sections/session-genres/genreAuthoring.dom.test.svelte.ts`
- `src/lib/client/lorebooks/sections/derivedEntryEditor.dom.test.svelte.ts`
- `src/lib/client/lorebooks/lenses/readOnlyLenses.dom.test.svelte.ts`
- `src/lib/client/lorebooks/sections/historyUnfiledGroup.dom.test.svelte.ts`
- `src/lib/client/lorebooks/crosstalk.dom.test.ts`
- `src/lib/client/lorebooks/lenses/libraryLayer.dom.test.svelte.ts`
- `src/lib/client/lorebooks/cast/castMemberForm.dom.test.ts`
- `src/lib/client/lorebooks/cast/memberPageVersions.dom.test.ts`
- `src/lib/client/lorebooks/cast/cardUpdateOffer.dom.test.ts`
- `src/lib/client/lorebooks/cast/memberPage.dom.test.ts`
- `src/lib/client/admin/sections/plugins/providedBooks.dom.test.svelte.ts`
- `src/lib/client/admin/sections/data/castUpgradeCard.dom.test.svelte.ts`
- `src/lib/client/admin/sections/starter-kits/starterKitsAdmin.dom.test.svelte.ts`
- `src/lib/client/admin/sections/defaults/defaultsStarConfirm.dom.test.svelte.ts`
- `src/lib/client/lorebooks/cast/presencesPanel.dom.test.ts`
- `src/lib/client/contexts/sessionOutcomes.dom.test.svelte.ts`
- `src/lib/client/lorebooks/lineConformance.screens.dom.test.ts`
- `src/lib/client/lorebooks/refusalsSaidOnce.dom.test.ts`
- `src/lib/client/lorebooks/lenses/lensMounts.dom.test.svelte.ts`
- `src/routes/document-view/connections/documentViewStarConfirm.dom.test.svelte.ts`
- `src/lib/client/lorebooks/cast/memberPageCard.dom.test.ts`
- `src/lib/client/contexts/characterImports.dom.test.svelte.ts`
- `src/lib/client/contexts/connections.dom.test.svelte.ts`
- `src/routes/document-view/ollama/ollamaPage.dom.test.svelte.ts`
- `src/routes/document-view/koboldcpp/koboldcppPage.dom.test.svelte.ts`

## Rules (quoted from the lane brief and the canon)

Owner ask (2026-11-08): "convert every single toast that's bypassing the central system."

## The canon you apply (STYLE-GUIDE.md §6.21, ruled 2026-10-24)

> A toast is raised through `src/lib/client/utils/notify.ts`, never the raw toaster: errors and warnings
> leave after 8s, success and info after 4s; a `source` key replaces the previous toast from the same source
> instead of stacking; a change the control already shows (a switch flipping, a mode or a theme changing) is
> `silent` and raises nothing; and a failure found by a background poll (`fromPoll`: an Ollama's version
> check or running-models list, a model sync nobody forced, another tab's broadcast) never toasts.

Read `src/lib/client/utils/notify.ts` (whole, ~90 lines) and `src/lib/client/utils/toaster.ts` first. Both
are READ-ONLY for you. `notify` exposes exactly `notify.error / .warning / .success / .info`, each taking
`NotifyOptions = { title: string; description?: string; source?: string; silent?: boolean; fromPoll?: boolean; duration?: number }`.

Import: `import { notify } from "$lib/client/utils/notify"`. Remove the `toaster` import from a file once it
has no remaining use (keep it only if the file still needs it — it should not, except `src/routes/+layout.svelte`'s
`<Toast.Group {toaster}>` mount).

## Rules for each call (from the lane brief, verbatim in substance)

1. **Default: a straight swap, same words, same level.** `toaster.error({ title, description })` →
   `notify.error({ title, description })`. Keep any `duration`. Change no title or description text — not
   a character, not punctuation.
2. **`source`:** add one when the call sits in a handler that can fire repeatedly for one thing — a socket
   `:error` / refusal / result listener, or a retried action. Name the speaker, not the sentence
   (`"socket:lorebooks:update:error"`, `"connections:sync"`). This only stops identical repeats stacking.
   Pattern: `"socket:<event name>"` for a socket listener (use the exact event string the listener is
   registered on); `"<area>:<action>"` for a retried action. One source per listener, not per call site.
3. **`silent` and `fromPoll`: never guess.** Apply one only when the code shows it plainly:
   `fromPoll` when the triggering emit is from an interval/poll/reconnect re-ask/other-tab broadcast
   (cite the emit's file:line); `silent` only for a success/info whose control already shows the new state.
   **Never `silent` or `fromPoll` on an error or warning raised by a user's press.** Every one you apply
   goes in your report's table (file:line, flag, one-line evidence). If unsure, plain swap and list it under ★.
4. **Options `notify` lacks** (`id`, `type: "loading"`, `action`, `closable`, `meta`, promise toasts,
   `toaster.dismiss/update/create`): a caller-supplied `id` maps to `source` when it is plainly a dedupe key.
   Anything else: **leave that call unconverted and report it** — do not widen `notify`'s API, do not
   edit `notify.ts`.
5. **Indirect callers:** `toaster[x.kind]({...})` becomes `notify[x.kind]({...})` when `kind` is typed as
   one of `"error" | "warning" | "success" | "info"` (check the type; if it can be anything else, report it).
   A toaster method passed as a callback (`(t) => toaster.error(t)`) becomes `(t) => notify.error(t)`; the
   object's type must fit `NotifyOptions` (`title` required) — if it doesn't type-check without changing a
   helper's public shape, report it instead of reshaping.
6. **Tests** that mock `$lib/client/utils/toaster` keep working (notify calls the same four methods on the
   same module). A test that asserts exact arguments may now see an extra `id: "notify:<source>"` — update
   the ASSERTION (e.g. `expect.objectContaining({...})` or add the id), never the product. A test that mocks
   only some toaster methods keeps working as before. Fix only tests your change broke, and only test files
   inside your own directories.
7. Don't touch the SDK repo (`../serene-pub-sdk`). Don't move toasts between files. Don't reword copy.
   Don't touch server code (`src/lib/server/**`). Don't refactor surrounding code. Don't move a toast out of
   a view into a context, even though CLAUDE.md says views never toast — that is out of scope; instead
   **tally it** (rule 8).
8. **Tally for the report:** list each `.svelte` view file (not a `contexts/` file) that toasts from inside a
   socket listener (`socket.on(...)`, `useInterest(...)`, `onSocket...`), with the count of such calls.

## How to work

- Edit with the Edit tool or careful scripted replacements; after a scripted pass, read each changed hunk.
  A sed that replaces `toaster.` with `notify.` blindly will also hit comments — comments that describe the
  raw toaster may be updated to say `notify` only where the comment is about the call you changed.
- Check: `grep -rnE "toaster\.(error|success|info|warning|create|dismiss|update|promise)|toaster\[" <your dirs>`
  must list nothing but test files (and, for worker 2, `notify.ts`/`toaster.ts` and the `+layout.svelte` mount).
- Run `npx prettier --write` on each file you changed, then `npx prettier --check` on all of them.
- Do NOT run `npx tsc`, `npm run check`, `npm test` or `npm run build` — the supervisor runs tsc/check.
- Tests: run the test files in your directories that mock or import toaster/notify (list in your brief), in a
  capped scope, logged to a file in the scratchpad, never piped into `head`:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > <log> 2>&1; echo test-exit=$? >> <log>'`
  Scratchpad (logs only): `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, name logs `toasts-w<n>-*.log`.
  A test that was already failing before your change (check by reading the failure — is it about a toast?)
  is reported, not fixed.

## Report (your final message)

Changed files (count + list); calls converted (count); calls left unconverted with file:line and why;
`source` keys added (count + list `file:line → key`); `silent`/`fromPoll` table (file:line, flag, evidence
incl. the emit's file:line); ★ uncertain cases; tests run (files, pass/fail counts, log path); test files you
edited and what assertion changed; the rule-8 tally; anything noticed but not done.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` anything.
