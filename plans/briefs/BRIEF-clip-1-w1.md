# BRIEF — worker `clip-1-w1` — one guarded copy helper, every copy routed through it

Repo `/home/jody/github/serene-pub`. Supervisor: lane `clip-1`. You cannot spawn agents.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout` / `restore`; never `prettier --write` (nor a scratch-copy equivalent); no SDK change; no `sdk:build`, no full test run, no build. Never pipe vitest into `head`.

## Goal

The standing ruling (CLAUDE.md): *"Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`"* — meaning never unguarded: on plain http `navigator.clipboard` is undefined. Two components already carry an identical private guarded `writeClipboard`. Lift it into one shared helper and route every browser copy through it.

## Files owned (edit only these)

New:
- `src/lib/client/utils/copyText.ts`
- `src/lib/client/utils/copyText.dom.test.ts`

Edit:
- `src/lib/client/components/admin/pub/SupportReportCard.svelte`
- `src/lib/client/admin/sections/network/Page.svelte`
- `src/lib/client/components/userForms/InvitePanel.svelte`
- `src/lib/client/components/settingsTabs/TotpSettings.svelte`
- `src/lib/client/components/userForms/UserForm.svelte`
- `src/lib/client/components/pipelines/workspace/VersionsPanel.svelte`
- `src/lib/client/components/speech/VoiceTryout.svelte`
- `src/lib/client/components/speech/VoiceTryout.dom.test.svelte.ts` (only the clipboard test's setup)
- `src/lib/client/admin/sections/prompts/IdPage.svelte`
- `src/lib/client/admin/sections/users/UserChangeForm.svelte`
- `src/lib/client/components/pipelines/inspector/RunInspector.svelte` (two functions)
- `src/lib/client/components/pipelines/PipelineConfigOptions.svelte`
- `src/routes/pipelines/library/+page.svelte`
- `src/lib/shared/conformance/secureContext.test.ts` (add one test)

Delete:
- `src/lib/client/components/connections/JobSheetSampling.svelte` (the supervisor verified nothing in `src/` or the SDK references it). `rm` the file; nothing else is deleted.

Several of these files carry other lanes' uncommitted edits. Change only the copy code described here; touch nothing else in them.

## Files readable

Anything. `src/lib/client/admin/sections/network/copyLink.dom.test.svelte.ts` shows how tests stub `navigator`, `isSecureContext` and `document.execCommand` (happy-dom defines neither `isSecureContext` nor `execCommand`).

## 1. The helper — `src/lib/client/utils/copyText.ts`

Export exactly one function, `copyText(text: string): Promise<boolean>` (name is 🚧 provisional; do not choose another). Body = the existing `writeClipboard` from `SupportReportCard.svelte` (~lines 92–116), with two hardenings so it **never throws**:
- the `navigator.clipboard.writeText` branch only when `navigator.clipboard` exists **and** `window.isSecureContext` is true; if it throws, fall through to the selection copy;
- the selection copy (hidden readonly `textarea`, `select()`, `document.execCommand("copy")`) runs entirely inside try/catch, with the textarea removed in a `finally` (only if it was appended), and returns whether `execCommand` returned true; any throw (including `execCommand` missing) returns `false`.

A short JSDoc in present tense stating the rule: `navigator.clipboard` exists only in a secure context, a LAN address over http is not one, so this falls back to a selection copy; resolves true when the text reached the clipboard, never throws. Comments state the rule, not the story: no "used to", "previously", "no longer", no anecdotes (a conformance ratchet counts those).

## 2. The helper's test — `src/lib/client/utils/copyText.dom.test.ts`

Four cases at least, restoring globals in `afterEach` (`vi.unstubAllGlobals()`, `delete (document as any).execCommand`):
1. secure context with clipboard → `writeText` called with the text, resolves `true`, `execCommand` not called;
2. insecure context (`isSecureContext` false) with clipboard present → `writeText` not called, `execCommand("copy")` used, resolves its result (`true`);
3. clipboard `writeText` rejects in a secure context → falls back to `execCommand`, resolves `true` when it returns true;
4. `execCommand` returns false → `false`; `execCommand` throws (or is missing) → `false`, never rejects. Also assert no textarea is left in `document.body`.

## 3. Route every copy through it

At each site: `import { copyText } from "$lib/client/utils/copyText"`, replace the `navigator.clipboard.writeText(x)` try/catch with `if (await copyText(x)) { <existing success> } else { <existing failure> }`. **Each site keeps its own existing success and failure messages, word for word, and its own way of showing them** (`notify.*`, inline state). Do not add `toaster` anywhere; do not reword anything.

- `SupportReportCard.svelte`, `network/Page.svelte`: delete the private `writeClipboard` (and its comment); `copy()` / `copyLink()` call `copyText` instead. Messages unchanged.
- `InvitePanel.svelte` `copyLink()` and `TotpSettings.svelte` `copyCodes()`: today unguarded with **no** failure message. The link (`<code>{link}</code>`) and the codes (`<li>{rc}</li>`) are visible and selectable on screen, so the failure branch is exactly
  `notify.error({ title: "Could not reach the clipboard. Select the text and copy it." })`
  (the existing sentence, same shape as `network/Page.svelte`). Success stays as today (`"Invite link copied"`, `"Recovery codes copied"`).
- `UserForm.svelte` `copyPassphrase()`: keep the `copiedPassphrase` timer and both notify calls exactly; drop the `catch (error)`.
- `VersionsPanel.svelte` `copyHash`: success `"Hash copied"`, failure `"Clipboard unavailable"` — unchanged.
- `VoiceTryout.svelte` `copySeed`: success path sets `copied` + timer as today; failure path `editingSeed = true` (keep its one-line comment). In `VoiceTryout.dom.test.svelte.ts`, the test "the seed shows as a person chip and Copy confirms inline, no toast" defines `navigator.clipboard` but happy-dom has no `isSecureContext`; add a secure-context stub to that test (e.g. `vi.stubGlobal("isSecureContext", true)` with cleanup, or `Object.defineProperty(window, "isSecureContext", { value: true, configurable: true })` removed after) so it still exercises the clipboard path. Change nothing else in that test file.
- `IdPage.svelte` `copyArchived`, `UserChangeForm.svelte` `copy`, `RunInspector.svelte` `copyOutput` and `copy`, `PipelineConfigOptions.svelte` `copyArchived`, `routes/pipelines/library/+page.svelte` `copyArchived`: same mechanical swap; messages unchanged. In `RunInspector.copyOutput` keep the `JSON.stringify(selected?.raw?.output ?? null, null, 2)` argument. In `PipelineConfigOptions.copyArchived` keep its existing in-branch comment with the failure branch.

## 4. The guard — `src/lib/shared/conformance/secureContext.test.ts`

Add a second `test` inside the existing `describe`, reusing its `BROWSER_REACHABLE`, `sourceFiles` and `code()` helpers: no browser-reachable file mentions `/\bnavigator\s*\.\s*clipboard\b/` except `src/lib/client/utils/copyText.ts` (exempt by its relative path). Failure message: `navigator.clipboard is undefined on plain-http LAN addresses; use copyText from $lib/client/utils/copyText`. Extend the file's top JSDoc by one short present-tense paragraph saying the same rule covers `navigator.clipboard`. Test files are already skipped by `sourceFiles`.

After your edits, `grep -rn "navigator.clipboard" src/lib/client src/lib/shared src/routes` must list only `copyText.ts` and test files.

## Stop and ask when

A site's existing message would have to change, a site turns up that this brief does not list, a new name beyond `copyText` seems needed, or a test fails for a reason outside the clipboard code. Report it; do not decide.

## Done means

1. `npx prettier --check` passes on every file you touched or created.
2. Wait for other lanes' vitest first: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Then, one run, exactly:
   `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/utils/copyText.dom.test.ts src/lib/shared/conformance/secureContext.test.ts src/lib/client/admin/sections/network/copyLink.dom.test.svelte.ts src/lib/client/components/speech/VoiceTryout.dom.test.svelte.ts src/lib/shared/conformance/commentHistory.test.ts > plans/clip-1-1.log 2>&1"`
   All green. If you must rerun, wait again and use `plans/clip-1-2.log`, and so on.

## Report

Return as your final message (under ~250 words): files changed/created/deleted; each site with the function changed; the test command and its pass/fail counts; anything stopped; Noticed, not done.
