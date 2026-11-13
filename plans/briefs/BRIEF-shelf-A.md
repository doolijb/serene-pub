# BRIEF shelf-A — Models view installed list (Tidy shelf A1)

You are a `lane-supervisor`. Read `.claude/guides/multi-agent.md` first. Plan: `plans/PLAN-models-tidy-shelf-2026-11-08.md` — your items are **§1, items 1–7**. The owner rulings at the top of the plan are final; do not reopen them.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The Models view's list (rail **Models**) groups its rows, folds big service catalogues, shows audio.cpp sizes, tags Ollama rows, offers **Group by** (remembered per browser) and two new narrowings in its filter popout, and shows a **↓ n** downloads button while anything arrives.

## Files owned (the only files you or your workers may edit)

- `src/lib/client/components/connections/ModelsListView.svelte`
- `src/lib/client/components/connections/modelsList.ts` and `modelsList.test.ts`
- `src/lib/client/components/connections/ModelRow.svelte`
- `src/lib/client/components/sidebars/ModelsSidebar.svelte`
- new `src/lib/client/components/connections/modelsGroupBy.ts` and `modelsGroupBy.test.ts` (the remembered choice; mirror `memoryTier.ts`'s wrapped storage)
- `src/lib/server/connectionAdapters/AudioCppManagedAdapter.ts` — `modelsFromPackages` declares `facts: { sizeBytes, source: "file" }` only
- `src/lib/client/components/connections/modelsListView.ssr.test.ts` and any test file next to an owned file

## Files readable

Everything. Start with: `connectionGroups.ts` (labels :48,:53 — reuse, never retype), `useInMenu.ts` (:12-13 merged loadouts), `memoryTier.ts`, `downloads.svelte.ts`, `DownloadsTray.svelte`, `MattingModelRow.svelte`, `modelFacts.ts` (:72 additive rule, :86,:88), `audiocpp/packages.ts` (:404,:495), `finder.ts` `FINDER_SCOPES` and the capability label helpers, `docs/connections.md` §§ The Models view → Downloads, STYLE-GUIDE §6.3 (filter popout: `role="radio"` rows, checked row in the selected treatment, active narrowing = one dismissible chip, button `preset-pressed` while ON — never gold) and §6.4 (row = face + name + one meta line via `MetaLine`, facts joined by ` · `), NOMENCLATURE §1, §10 (model row :680, model facts :683, service chip :705, `MODEL_PURPOSES` :748) and §24.

## Rules to carry into worker briefs (quote them)

- Labels are ruled: Group by options **Where it lives** · **What it can do** · **Connection**; last group **Can't be used right now**; fold line *‹n› models · ‹k› in a loadout* · **Show**; in What it can do *+ ‹n› on ‹service›* · **Show**; downloads button title *Downloads*. Any other new user-facing string or exported name → stop and ask the lead.
- Fold: Services connection with > 12 models; exempt = models that sit in a loadout (a loadout's current pair names the model; merged loadouts skipped). Non-empty filter ignores folds. Until loadouts answer: fold with no exemptions, omit the loadout count.
- No new wire field on model rows. Sizes = `facts.sizeBytes ?? local.sizeBytes`.
- Pure logic lives in `.ts` files with unit tests; the Svelte files decide no sentences (existing pattern, `ModelsListView.svelte:22-23`).
- `$state(new Set())`/`new Map()` are not reactive on mutation — use `SvelteSet`/`SvelteMap`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. Views never call `toaster`. `socket.off(event)` always with the handler.
- Never pipe vitest into `head`. An int test opening a DB inside `it` needs a 60 s timeout.

## Out of scope

Everything in plan §2 and §3 (finder, docs, STYLE-GUIDE, NOMENCLATURE — queue what they need in your report under **For shelf-C**). Per-group doors, loadout lines, Speech/Transcription in the kind radios, a Downloads tab, migrations.

## Stop and ask when

CLAUDE.md §Decisions applies, a ★ is unruled, a name is new, a file outside **Files owned** needs a change, or a migration seems needed.

## Done means

`npx vitest run` on `modelsList.test.ts`, `modelsGroupBy.test.ts`, `modelsListView.ssr.test.ts`, and the audio.cpp adapter's existing tests, all green; `npx prettier --check` on every changed file; a `scope-reviewer` run on your diff against this brief, its objections answered once.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Another lane (`shelf-B`) is editing `ModelFinderView.svelte`, `finder.ts`, `QuantPicker.svelte`, `hfGgufQuants.ts` and `shared/sockets/types.ts` at the same time — never touch them.

## Report

`plans/REPORT-shelf-A-2026-11-08.md`: changed files, tests run with results, open ★, **For shelf-C** (doc/STYLE-GUIDE/NOMENCLATURE facts), **Noticed, not done**.
