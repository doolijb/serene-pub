# BRIEF — `sense-sumset` worker 4 — docs, NOMENCLATURE and four SDK doc comments

You are a `lane-worker` in build lane `sense-sumset` (Serene Pub; app repo `/home/jody/github/serene-pub`, SDK repo
`/home/jody/github/serene-pub-sdk`). Your supervisor read the rules; the ones your work depends on are quoted here.
Line numbers are from 2026-11-13: re-read before editing. Report as your final message (changed files with a
one-line summary each, checks run, decisions, **Noticed, not done**).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This lane runs **no** `sdk:build`: the SDK edits are comments; the next build carries them.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the SDK
  repo is uncommitted). It is a **session**, never a *chat* (Chat is only a genre's name). Every session has a
  lorebook: never write "no lorebook". **No reference to any other project or product** in any file. "Compile" is a
  history-entry word (scenes → a history entry) and is never used for scene summaries.
- Comments state the rule, not the story (`src/lib/shared/conformance/commentHistory.test.ts` fails on "no longer",
  "used to", "deliberately not" in code comments). Docs describe behaviour as it is, not its history.
- STYLE-GUIDE §10: sentence case; one name per thing; help is one sentence.
- NOMENCLATURE "Maintaining it": a change that adds or renames a term updates NOMENCLATURE in the same change; mark
  anything impermanent 🚧 (R6). R1 one word one meaning; R3 qualify, never the bare noun (*summary mode*, *routine's
  mode*, never bare *mode*).
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**.
- No app tests need running for docs; if you touch any `.ts` file run
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/shared/conformance/commentHistory.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/sense-sumset-w4.log 2>&1"`
  only if no other worker is running tests (ask nothing; just run it once at the end) — the SDK comments are outside
  that test, so you likely need none.

## The rule as built (write the docs from this)

- A session **has the routine** when its effective registrations hold *Summarize finished scenes*
  (`core:spec/scene-summaries`): Story's **Living** and **Rule Based**, the **Lair**, the **Dungeon Crawler**. Story
  **Minimal** drops it; **Chat** and the **Guide** never have it. A routine set **Off** still counts as had.
- In such a session the **Scenes** settings show no **Summaries** select. In its place one line: *Summaries are
  written by the Summarize finished scenes routine (Full).* (or Review / Off), followed by *Change it under
  Routines.* for the owner (a member, who sees the card greyed and has no Routines group, does not get that
  sentence). The routine's mode alone decides what is summarized by itself: **Full** saves, **Review** waits for
  you, **Off** runs nothing by itself.
- In such a session a scene's close drafts nothing by itself, and **Summarize** (divider, Chronicle row),
  **Summarize all (N)** and **Close and summarize** are always offered to the owner, whatever the routine's mode:
  "Off stops only the automatic run" (owner, 2026-11-13). The Chronicle and the divider show no "runs when it
  closes" note there.
- A session **without** the routine keeps **Summaries** exactly as before: **On request** (default), **On close**,
  **Never** (Never offers no Summarize and refuses Summarize all).
- **The one-time conversion.** A session that has the routine and had saved **Never** gets the routine set to
  **Off**; one that had saved **On close** gets **Review**; the saved Summaries value is then removed. A routine
  mode the owner had already chosen for that session is kept. It happens once, at the next start of the app, and
  also at once when a session's preset changes to one that runs the routine (e.g. Minimal → Living): such a session
  never changes by itself at a later restart.
- Server side, `sessions:update` drops a `summary` sent in `sceneSettings` for such a session.
- A **branch** copies the session's settings but not its own routine modes, so a branch of a session whose routine
  is Off starts on its preset's mode (true of every routine; open ★, document only if a doc already discusses
  branch routine modes — otherwise leave it out).

Names built (all 🚧): `SessionSceneContext.summaryRoutine` (`"off" | "review" | "full" | null`, server
`sessions/sceneSettings.ts`; null when the session has no such routine; when it has one, `settings.summary` reads
`onRequest`; on a resolver error it reads `onRequest` with `summaryRoutine: null` and warns); the existing
`sessionRoutineMode` (`pipelines/routines/sessionRoutines.ts`) is what it asks; `convertSummariesSetting(db,
sessionId)` and `summariesToRoutine(db)` with `SummariesToRoutineReport` in new `sessions/summariesToRoutine.ts`;
the boot startup task **`summaries-to-routine`** (⚠ not the startup task `scene-summaries`, which reconciles derelict
summaries; not the routine `core:spec/scene-summaries`); the form line's attribute `data-scene-summaries-routine`.
No new setting, column, table, migration, event, or published SDK name. The SDK's `SceneSummaryMode` keeps its
three values.

## Goal — edits

1. `docs/sessions.md`: ~497 (the divider's **Summarize** "not offered when the session's summaries are **Never**" —
   qualify: only in a session without *Summarize finished scenes*); ~520 the **Summaries** bullet (rewrite to the
   rule above: in a session with the routine, no Summaries setting — the routine's mode decides, Summarize always
   offered; without it, the three values as today; the one-time conversion in one or two sentences); ~521 the
   **Summarizing finished scenes** bullet (add that **Off** stops only the automatic run). Keep the page's voice.
2. `docs/summarization.md`: ~48 (the *On close* / *Never* sentence — qualify to sessions without the routine, and
   say that with the routine every one of these is offered and nothing is drafted at a close); ~58 remove
   "Nothing runs while **Summaries** is **Never**, or" (keep the Back/Forward clause); ~63 **Off**: runs nothing by
   itself; Summarize, Summarize all and Close and summarize stay. Add one short paragraph or bullet on what replaced
   Summaries and the conversion, if not already covered by the link to sessions.md.
3. `docs/session-layout.md` ~58 (Chronicle row): "**Close and summarize** (the latter when summaries are on
   request)" and "with the session's summaries set to **Never**, none is offered" — qualify for a session that runs
   *Summarize finished scenes* (always offered there). Minimal edit inside a long table cell.
4. `docs/genre-story.md` (~40–52, the routines table): one sentence that **Minimal** keeps the **Summaries** setting
   under **Scenes** (it does not run *Summarize finished scenes*), while Living and Rule Based set summaries through
   the routine's mode.
5. `NOMENCLATURE.md`:
   - the **scene summaries routine** row (§4, ~208): it **replaces the session's Summaries** where a session has it
     (owner rulings 2026-11-12 "Replace it", 2026-11-13 "Off stops only the automatic run", 2026-11-13 "a session
     saved as On close gets Routine set to Review"); add `summaryRoutine` and the conversion to what it relates to;
     fix *Does not own* ("a person's Summarize / Summarize all / On close") so it stays true.
   - the **scene settings** row (§25 area, ~2018, the `_(new)_` row naming `SessionSceneSettings.svelte`): the
     **Summaries** select shows only in a session without the routine; name `summaryRoutine` beside
     `sessionSceneContext (mayPlace)`.
   - the Chronicle row (~2029) "`scenes:processAll` … refused under *Never*": qualify (only in a session without the
     routine).
   - §25: a new subsection at the end of §25 (just before `## 26. Shell`), in the shape of the one at ~3770
     (`### <title> — 2026-11-13 (owner rulings …; lane sense-sumset)` then `| Was | Is | Why/where |`), with rows for
     the replaced Summaries (Was: the session's Summaries and the routine's mode both decided; Is: the routine's mode
     alone where the routine exists), `summaryRoutine`, the conversion names and startup task, the form line, and a
     final `| _(none)_ | No new table, column, migration, setting or published SDK name | |` row.
6. SDK doc comments — **one sentence each, comments only, no code**:
   `/home/jody/github/serene-pub-sdk/sdk/src/sceneSettings.ts` ~21–23 (the `summary` bullet),
   `sdk/src/descriptors.ts` ~1223–1232 (`scenes?` on the genre shape), `sdk/src/widgets.ts` ~2616–2619
   (`HistoryEntriesV1.summaryMode`), `sdk/src/sessionDossier.ts` ~256–261 (`sceneSummaryMode`): that a session
   running the *Summarize finished scenes* routine (`core:spec/scene-summaries`) reads `onRequest` whatever is
   declared or stored. Keep `@experimental` / `@ruling` tags as they are.

## Files owned

`docs/sessions.md`, `docs/summarization.md`, `docs/session-layout.md`, `docs/genre-story.md`, `NOMENCLATURE.md`
(the rows named and the new §25 subsection only), and the four SDK files named (doc comments only).

## Out of scope

Any code; any other doc; the SDK guides and `INTEGRATING.md` (list under Noticed if they should change); any rename.

## Stop and ask when

A doc would need to describe behaviour not in "The rule as built"; a NOMENCLATURE row conflicts with it; you would
need a new name.

## Done means

Every edit above made; `npx prettier --check` on each SDK `.ts` you touched (report pre-existing drift, do not
reformat); `git diff --stat` in both repos limited to your files. Report each change in one line.
