# BRIEF shelf-B — Get a model: sentence line, finder model page, Hub card (Tidy shelf A1)

You are a `lane-supervisor`. Read `.claude/guides/multi-agent.md` first. Plan: `plans/PLAN-models-tidy-shelf-2026-11-08.md` — your items are **§2, items 8–10**. The owner rulings at the top of the plan are final; do not reopen them.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

**Get a model** asks its three choices as one sentence of menus, and a result's name opens a **finder model page** (facts, files table with fit bars, Download) inside the finder pane, fed by a new `models:hubCard` request that reuses the existing Hugging Face repo read.

## Files owned (the only files you or your workers may edit)

- `src/lib/client/components/connections/ModelFinderView.svelte`
- `src/lib/client/components/connections/finder.ts` and `finder.test.ts`, `finder.dom.test.svelte.ts`, `finderViews.ssr.test.ts`
- new `src/lib/client/components/connections/FinderModelPage.svelte` (+ a pure helper `.ts` and its test if needed)
- `src/lib/client/components/connections/QuantPicker.svelte` — only to share the files rows with the page
- `src/lib/server/connections/hfGgufQuants.ts` (+ its tests)
- a new socket handler for `models:hubCard` next to `src/lib/server/sockets/modelPresence.ts` (same registration pattern) + its test, and its registration line
- `src/lib/shared/sockets/types.ts` — the `models:hubCard` event types only, in one block; report the lines

## Files readable

Everything. Start with: `ModelFinderView.svelte` header (:1-80) and markup (:1103-1296, the For / Download to / landing rows and the results), `finder.ts` (`destinationsFor`, `pickDestination`, `landingNote`, `preselectedQuantIndex`, `quantFit`, `quantChoice`, `quantsNote`), `memoryTier.ts`, `QuantPicker.svelte`, `hfGgufQuants.ts:86-110` (`fetchHfRepoSiblings`, 10-min cache, same URL `https://huggingface.co/api/models/<repo>?blobs=true` whose response carries `cardData`, `gguf`, `downloads`, `lastModified`), `services/loginRateLimit.ts:12-13`, `sockets/koboldcpp.ts:1269` and `sockets/ollama.ts:749` (per-search limiter keys), `sockets/modelPresence.ts`, `docs/connections.md` § Get a model, STYLE-GUIDE §6.3 (popout of `role="radio"` rows; gold = next action only, one filled primary per region; nav header = back · title · primary · ⋯, Back drawn only when the level it returns to is off screen; Escape over an in-view level is Back) and §6.4, NOMENCLATURE §1, §10 (quant picker :715, recommended list :668) and §24.

## Rules to carry into worker briefs (quote them)

- Sentence: *[Chat] models for [KoboldCPP] · sized for [8 GB]*; each bracket a popover of radios; a part the door fixed is plain text; a disabled destination stays pickable with its reason on a line under the sentence; *Not sure* suppresses every fit hint. The rules in `finder.ts` stay; only the presentation changes.
- Finder model page: no UI label (title = model name); Back returns to results with query and scroll kept; facts strip shows only known facts (Parameters, Context, Licence, Languages, Downloads, Updated); presence line (D3); files table = quant picker rows + fit bar + radio, pre-selected by `preselectedQuantIndex`; footer = destination + landing folder + **Download ‹quant›** (the one gold button). One-file repo → one row; Ollama library name with no files → `quantsNote`. **Get** on a result row keeps today's inline quant picker.
- `models:hubCard { repo }` → `{ repo, card?: { license, languages, contextLength, baseModel, downloads, lastModified }, files?: sizes per sibling, error? }`. Asked **only when the page opens**. Card part cached **24 h** by repo; reuse `fetchHfRepoSiblings`' read (one HTTP call per repo, not two). Limiter key `models:hubCard`, via `loginRateLimit`, same allowance shape as the searches. Admin-only like the searches. Recommended rows use their list's facts and ask the card only when they name a Hub repo.
- Errors: inline on the page in a sentence, never a toast from the view. Event names and fields above are ruled; any other new name → stop and ask the lead.
- `SvelteMap`/`SvelteSet` for mutated collections. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. `socket.off(event)` always with the handler. The Hub search debounce (400 ms) and signature guard stay.
- Never pipe vitest into `head`. An int test opening a DB inside `it` needs a 60 s timeout.

## Out of scope

Everything in plan §1 and §3 (installed list, docs, STYLE-GUIDE, NOMENCLATURE — queue what they need in your report under **For shelf-C**). Runtime-last, Discover shelves, changes to destination rules, migrations.

## Stop and ask when

CLAUDE.md §Decisions applies, a ★ is unruled, a name is new, a file outside **Files owned** needs a change, or a migration seems needed.

## Done means

`npx vitest run` on `finder.test.ts`, `finder.dom.test.svelte.ts`, `finderViews.ssr.test.ts`, the `hfGgufQuants` tests and the new handler test, all green; `npx prettier --check` on every changed file; a `scope-reviewer` run on your diff against this brief, its objections answered once.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Another lane (`shelf-A`) is editing `ModelsListView.svelte`, `modelsList.ts`, `ModelRow.svelte`, `sidebars/ModelsSidebar.svelte` and `AudioCppManagedAdapter.ts` at the same time — never touch them.

## Report

`plans/REPORT-shelf-B-2026-11-08.md`: changed files, tests run with results, open ★, **For shelf-C** (doc/STYLE-GUIDE/NOMENCLATURE facts), **Noticed, not done**.
