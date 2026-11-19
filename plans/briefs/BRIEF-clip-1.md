# BRIEF — build lane `clip-1` — one guarded copy-to-clipboard helper (programme 0.8b)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, `STYLE-GUIDE.md` copy
rules, `plans/REPORT-aud-1-2026-11-16.md` ("Noticed, not done").

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write` (nor a scratch-copy
equivalent). Never commit. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/clip-1-<n>.log 2>&1"`,
one run at a time; wait for other lanes with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No SDK change, no full run, no build.

## Standing ruling

"Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`"
(meaning: never unguarded; on plain http `navigator.clipboard` is undefined).

## Build

1. One helper in the client's shared utilities (find the right home: where other small browser helpers live;
   name 🚧 `copyText(text): Promise<boolean>`), holding the guarded pattern that exists today in
   `SupportReportCard.svelte` (~92–111) and `admin/sections/network/Page.svelte` (`writeClipboard`): use
   `navigator.clipboard` only in a secure context where it exists, else the `execCommand("copy")` fallback,
   returning whether it worked; never throws.
2. Every browser copy goes through it: grep the whole client (`src/lib/client`, `src/routes`) and the SDK's
   components (`../serene-pub-sdk/core-catalog/components`, read-only: report SDK sites, do not edit them) for
   `navigator.clipboard` and `execCommand("copy")`. Known: `SupportReportCard.svelte`, `network/Page.svelte`,
   `InvitePanel.svelte:147` and `TotpSettings.svelte:97` (unguarded today), `UserForm.svelte`,
   `VersionsPanel.svelte`, `VoiceTryout.svelte`, `prompts/IdPage.svelte`, `users/UserChangeForm.svelte`.
   Each call site keeps its own existing success and failure messages and its own way of showing them (views
   do not call `toaster`; use what the site uses today). A site with **no** failure message today (the two
   unguarded ones) uses the existing sentence *Could not reach the clipboard. Select the text and copy it.*
   only if the text is visible and selectable on that screen; otherwise stop on that site and report (new
   wording is the owner's).
3. A guard test (pattern: the repo's other source-scanning conformance tests, e.g. under
   `src/lib/shared/conformance/`): no `navigator.clipboard` outside the helper's file in browser code.
4. Delete `JobSheetSampling.svelte` if nothing imports it (verify with grep across `src/`; report what you
   checked). Nothing else is deleted.

## Tests

The helper (secure with clipboard, insecure, clipboard throwing, `execCommand` failing); the guard; the touched
components' existing tests; `network/copyLink.dom.test.svelte.ts` still green.

## Report

Final message = the report (lead saves `plans/REPORT-clip-1-<date>.md`): the helper's home and name; every site
changed; sites stopped; SDK sites found; tests; **Noticed, not done**. Under about 300 words.
