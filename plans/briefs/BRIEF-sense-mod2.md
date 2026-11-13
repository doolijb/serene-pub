# BRIEF — lane `sense-mod2` — two leftovers from `sense-mod`

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-sense-mod-2026-11-11.md` ("Queued for other owners"), STYLE-GUIDE (read-only fields in a settings
form), CLAUDE.md Hard rules. This is small: do it yourself or with one worker.

## Goal

1. **The document view's KoboldCpp page shows a Server URL field in every mode**
   (`src/routes/document-view/koboldcpp/+page.svelte`). In Managed mode the server now refuses a change to it ("In
   Managed mode the address follows the port. Change the port instead."), so the field is a control that cannot
   work. In Managed mode show it the way the sidebar's settings tab now does
   (`src/lib/client/components/koboldcppManager/KoboldCppSettingsTab.svelte`: a read-only line with the hint
   "Follows the port below."). External mode keeps its editable field. Reuse the settings tab's markup or component
   where the page can; do not write a third spelling of the address.
2. **A dead prop.** `src/lib/client/components/sidebars/ModelsSidebar.svelte` still passes `onChooseJobModel` to
   `SetupChatFlow`, which no longer uses it (marked ⏳ unused in
   `src/lib/client/components/connections/SetupChatFlow.svelte`). Stop passing it and remove the prop. If another
   caller still passes it, remove it there too and say where.

## Files owned

`src/routes/document-view/koboldcpp/+page.svelte`, `src/lib/client/components/sidebars/ModelsSidebar.svelte`,
`src/lib/client/components/connections/SetupChatFlow.svelte` (the prop only), any other caller of that prop (the
prop only), and the tests beside them.

## Out of scope

Everything else. No new control: the Done step's possible **Use ‹model› in Reply** button is an open ★ for the owner.

## Done means

A test that the document view's page shows no editable Server URL in Managed mode and still shows one in External
mode; `SetupChatFlow`'s tests still pass. Capped run:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-sense-mod2-2026-11-11.md`).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` in either repo. Inside
  `db.transaction(async (tx) => …)` use only `tx`. Every session has a lorebook (its own book, or an overlay):
  never write "no lorebook". Do what is asked, at the size asked.
