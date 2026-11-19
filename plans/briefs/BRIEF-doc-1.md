# BRIEF — lane `doc-1` — the docs say what the app does (programme 0.7)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, `CLAUDE.md` (Principles,
standing rulings), `STYLE-GUIDE.md` copy rules, `NOMENCLATURE.md` §1 and §23 (retired words).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write`. Never commit. **No
tests, no builds, no `tsc`, no `npm run check` in this lane** (other lanes are running them; docs are compiled by
`npm run build`, which the lead runs at the phase boundary). Edit `docs/*.md` only: no code, no generated files
(`src/lib/generated/`), no SDK files.

## Owner

Programme 0.7 (2026-11-15): "each `docs/*.md` page checked against its feature; false statements fixed (two
found on 2026-11-15: locked settings, Tone 'Before you start')." Standing: a session, never a chat (outside
chat-completions wire vocabulary); members never see model plumbing; update the docs in the same change when
behaviour moves.

## Build

For every page in `docs/` (split the pages between at most 2 workers by area; each worker takes whole pages):

1. Read the page. For each **checkable statement of behaviour** (a default, a limit, a number, what a button
   does, who may do it, where a control lives and what it is called, what happens on import / delete / upgrade),
   find the code that decides it (archex tools or grep first; read line ranges) and compare. Labels and
   sentences quoted in a page must match the UI string exactly.
2. Classify each mismatch:
   - **the page is wrong** and the code is plainly intended → fix the sentence (smallest edit that makes it
     true; keep the page's voice; no new sections, no feature tours);
   - **the code looks wrong** (the page states the intended behaviour, e.g. it matches a ruling or a
     NOMENCLATURE row) → do not edit either; report it as a possible defect with file:line;
   - **cannot tell** → report, edit nothing.
3. Also fix on sight, in docs only: a retired word (§23), "chat" used for a session, a dead link between docs
   pages, a control named differently in two pages (use the UI's string).

Pages other lanes are editing today: `docs/pipelines.md`, `docs/lorebooks.md`, `docs/sessions.md`,
`docs/connections.md`, `docs/system-settings.md`. Re-read the exact paragraph right before each edit and make
single-sentence edits; never rewrite a section. Recent work the pages should already reflect (verify, do not
assume): the Turn line lists background runs with Stop; re-run actions wait while a run is in progress;
`knownToSpeaker` on lore reads; dated values print as structured `date` / `dateDelta`; the admin switch **Turn
off step time limits**; a locked setting is hidden today (programme 2.4 will change that: leave the page saying
what the code does now).

Depth over breadth is not wanted here: every page gets a pass; a page too long to finish is reported as
"checked to line N".

## Stop and ask when

A fix would need more than a sentence or two; a page describes a feature that does not exist at all (report;
do not delete the section); two pages contradict each other and the code supports neither.

## Report

Final message = the report (lead saves `plans/REPORT-doc-1-<date>.md`): per page, statements checked (count),
sentences fixed (old → new, one line each, with the code's file:line); **possible code defects** (page says X,
code does Y, file:line, which one a ruling supports); cannot-tell items; pages not finished. Under about 900 words.
