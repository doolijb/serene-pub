# BRIEF m2e-C2 — client + docs follow-ups from the scope reviews of M2e (2026-11-04)

You are a `lane-supervisor` (a fresh agent; lane C's supervisor is finished — read its report, never resume it). Read `.claude/guides/multi-agent.md` first, then this brief, then `plans/REPORT-m2e-C-2026-11-04.md` and plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §19 + tail. Lane id **m2e-C2**. Small lane: one worker. A server lane (`m2e-D2`) runs in parallel on `src/lib/server/**`; never edit its files.

## Goal — four fixes
1. **A refused switch says why.** `src/lib/client/admin/sections/starter-kits/Page.svelte:80–87` hears `plugins:disableProvidedBook:error` / `enableProvidedBook:error` with `() => {}`, so a refusal is silent (STYLE-GUIDE §6.11: "A blocked action says why in one line beside it"). Show the error text as a one-line `role="alert"` beside the row, the way `cloneError` is shown on that page; clear it on the next successful re-send. Same on the plugin page (`admin/sections/plugins/IdPage.svelte`) if its switch's refusal is silent too. Remember: the domain context is the only toaster; a line beside the row is not a toast. Test in `starterKitsAdmin.dom.test.svelte.ts`.
2. **NOMENCLATURE charters.** (a) The `plugins.provided` row (~line 3156) still says it remembers a deleted book so it stays deleted and owns the dismissal marks; rewrite ONLY its purpose and owns clauses: ⏳ transitional — the boot pass turns each `dismissed` into the book's own disabled mark (`lorebooks.extra_json.provided.disabled`), which owns it now; the row keeps `failed`/`refused` outcomes. (b) The **starter lorebook** row (~line 386) still says primers are "read straight from the catalogue, immutable by construction" with "two sources" — amend to name the **primer row** (the §25 row ~3180) and keep `primer:<id>` only for API callers. Do not retire `dismissed` in §23 (owner's call; note it). Re-read NOMENCLATURE.md immediately before editing — another programme appends rows at its tail.
3. **The `AppletCard.svelte:53` cast** `as App.PageState` can go now that `src/app.d.ts` declares `appletFrom` (the lead added it). Drop it.
4. **Formatting churn.** `LorebookListItem.svelte` and `BookSettings.svelte` carry re-wrapped lines no item touched (the `sessionNotesOf` type, `kindChips`, badge class order, two `<div>` wraps, `onDuplicate`, the Export entry's indent; `BookSettings.svelte:321–325`). Prefer dropping the formatting-only hunks so the diff shows the `canDelete`/`isProvided` changes alone; if a hunk cannot be separated safely by hand, leave it and say in the report which hunks are deliberate.

## Files owned
`src/lib/client/**`, `src/routes/**` (not api), `NOMENCLATURE.md`, `STYLE-GUIDE.md`, `docs/**`.
## Out of scope
No server files; no new copy beyond the error line; no change to the switch's behaviour (the plugin page waits for Save, the Starter lorebooks page acts at once — both ruled by their pages' patterns); nothing for later.
## Rules (quote into the worker brief)
CLAUDE.md Principles/Decisions/Hard rules; NOMENCLATURE R1–R6, §24; STYLE-GUIDE §6.11 (admin pages), §9, §10; sockets: one domain context toasts, views never call `toaster`; `$state(new Set())` is not reactive; no `crypto.randomUUID`/`navigator.clipboard`; targeted tests only; never pipe vitest into `head`; delete only your own `/tmp/serene-pub-vitest-*` dirs by name.
Every implementation brief adds, verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
## Done means
`starterKitsAdmin.dom.test.svelte.ts`, the plugin page's test if one exists, `AppletCard.dom.test.ts`, `leaveDestination` test; `npx prettier --check` on the two de-churned files reports no NEW failure beyond what HEAD had. Report: `plans/REPORT-m2e-C2-2026-11-04.md` — changed files, tests, open ★, Noticed, not done.
