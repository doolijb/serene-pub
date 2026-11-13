# BRIEF shelf-C — docs, STYLE-GUIDE and NOMENCLATURE for the Tidy shelf (A1)

You are a `lane-supervisor`. Read `.claude/guides/multi-agent.md` first. Plan: `plans/PLAN-models-tidy-shelf-2026-11-08.md` — your items are **§3, items 11–13**. The owner rulings at the top of the plan are final.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The three documents describe what lanes A and B built, exactly as built. Your sources of truth are the two lane reports — `plans/REPORT-shelf-A-2026-11-08.md` and `plans/REPORT-shelf-B-2026-11-08.md`, their **For shelf-C** sections and the lead's rulings in each — checked against the code itself (the files each report lists). Where a report and the code disagree, the code wins and you say so in your report.

## Files owned (the only files you or your workers may edit)

- `docs/connections.md` — §§ The Models view, Models top to bottom, The models list, Get a model, Downloads (and any other line in the file that the change makes false, e.g. "four rows", "FLAT")
- `STYLE-GUIDE.md` — §6.3 (sentence-menu pattern; the filter popout's second, non-narrowing radio group; an icon button with a count) and §6.4 (a list group header with a size total; the finder model page as an in-pane level if it belongs there rather than §6.3)
- `NOMENCLATURE.md` — §10 rows (Models view, models list, model row, model finder · Get a model, quant picker; new rows **group by**, the fold, **Can't be used right now**, **finder model page** 🚧, `models:hubCard` 🚧, and *fit bar* only if it earns a row) and the **§25 Change ledger** (one entry per new or amended term, dated 2026-11-08, citing this plan)

## Rules

- NOMENCLATURE: read §1 (R1–R6) and §24 before writing a row; follow the existing row format in §10 (bold term, built date and plan, code paths, UI labels, ⚠ not-to-confuse notes). Mark 🚧 provisional vocabulary as the reports do. Never reintroduce a §23 retired word. The terms *What it's for* (`MODEL_PURPOSES`, :748) and *runtime* (:705) keep their meanings: the rows must say the group-by options are **What it can do** and **Connection** and why.
- docs: user-facing, plain, second person, present tense, matching the file's existing voice; bold for controls, italics for on-screen sentences; no file paths or code names. Admin-only facts stay stated as such.
- STYLE-GUIDE: state each rule with its date (2026-11-08) and where it applies, in the guide's existing voice; never invent a class string — copy the ones in the reports and confirm them in the code.
- Do not edit code, tests or any other file. Anything wrong in code goes in **Noticed, not done**.
- ★B-2 (a *Base model* fact) is open with the owner: document the facts strip as built (without it).

## Out of scope

Code. Other docs pages. Unrelated stale rows (note them, don't fix them).

## Stop and ask when

CLAUDE.md §Decisions applies, a ★ is unruled, a name not in the reports would be needed, or a report and the code disagree in a way that changes behaviour.

## Done means

All three files updated; `npx prettier --check docs/connections.md STYLE-GUIDE.md NOMENCLATURE.md` reports no new failures (compare against a formatted copy of HEAD if a file already failed); a `scope-reviewer` run on your diff against this brief, its objections answered once.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Report

Return it as your final message (the harness refuses report files from subagents); the lead saves it to `plans/REPORT-shelf-C-2026-11-08.md`. Sections: changed files with the sections touched, open ★, report/code disagreements found, **Noticed, not done**.
