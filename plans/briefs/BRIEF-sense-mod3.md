# BRIEF — lane `sense-mod3` — three fixes from the scope review of `sense-mod`

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-sense-mod-2026-11-11.md`, `plans/REPORT-sense-mod2-2026-11-11.md`, `plans/briefs/BRIEF-sense-mod.md`
(the goal these fixes serve), STYLE-GUIDE (a muted status line on a card), CLAUDE.md Hard rules (inside
`db.transaction(async (tx) => …)` use only `tx`). A scope reviewer read the lanes' code; these three findings are
accepted. Re-read each cited line before changing it. Small: do it yourself or with one worker.

## Goal

1. **The reason a model was unloaded is on the card a person sees.** The lead's brief pointed at the wrong
   component. The sentence renders only in `src/lib/client/components/koboldcppManager/KoboldCppPerfTab.svelte`
   (about 372–376), which is mounted behind the **Details** toggle (closed by default; shown only while perf
   figures exist). The card people see is the "Loaded model" line with **Unload** in
   `src/lib/client/components/connections/ManagedConnectionView.svelte` (about 1024–1048). Add one muted line
   under that loaded line carrying the last co-load decision's sentence, absent when there is none. That view
   already listens to `koboldcpp:subprocessStatus` (about 638): no new listener, no new event, no toast. Keep the
   line in Details too, or remove it there, whichever leaves one clear place; say which. Update
   `docs/connections.md` if it says "under **Details**".
2. **The first-model fill can never overwrite a choice.** `src/lib/server/koboldcpp/fillReplyOnArrival.ts`
   (`fillReplyIfEmpty`, about 27–70) reads "is Reply empty" and writes several awaits later; a person's **Use in
   Reply** (`connections:setDefault`, `src/lib/server/sockets/connections.ts` about 1220–1230) can land between
   them and be overwritten. Close the gap: do the emptiness read and the write in one transaction using only
   `tx`, or re-read the default immediately before the write and skip when it is no longer empty (choose the one
   the existing `setCapabilityDefault` supports without changing its other callers; name the choice). Add a test
   that a default set between the read and the write survives, and one that two fills fired at once set exactly
   one model.
3. **One spelling of the Managed address on screen.**
   `src/lib/client/components/koboldcppManager/KoboldCppSettingsTab.svelte` (about 738) builds
   `http://localhost:{port}` by hand, while `src/routes/document-view/koboldcpp/+page.svelte` shows the stored
   address. Until a writer lines the column up with the port (an imported 0.5.3 row is repaired only at the next
   spawn), the settings tab shows an address the app is not using. Show the stored address there too.

## Files owned

`src/lib/client/components/connections/ManagedConnectionView.svelte` (that one line),
`src/lib/client/components/koboldcppManager/KoboldCppPerfTab.svelte`, `KoboldCppSettingsTab.svelte` (the Managed
Server URL line), `src/lib/server/koboldcpp/fillReplyOnArrival.ts` and its test,
`src/lib/server/connections/capabilityDefaults.ts` only if item 2 needs a transaction-taking form of an existing
function, the tests beside these, `docs/connections.md` (sentences made untrue).

## Out of scope

External mode. In particular the reviewer noticed that `koboldcpp:setManagedPort` and the binary-install write
(`src/lib/server/sockets/koboldcpp.ts` about 1988 and 2239) rewrite the address without checking the mode, as they
did before these lanes: **do not change it**; it is an open ★ for the owner. Also out: any new control, setting,
event or migration; NOMENCLATURE.md.

## Done means

Tests that fail before and pass after for each item; capped run of only those files.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-sense-mod3-2026-11-11.md`).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` in either repo. Never `kill -9` a dev
  server. `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`.
  Browser code runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
