# BRIEF m2e-C-w3 — docs and vocabulary for M2e (NOMENCLATURE §25, STYLE-GUIDE, docs/)

Worker for lane **m2e-C** (client + docs) of build M2e, Serene Pub (`/home/jody/github/serene-pub`). Supervisor reads your report.
Everything below is RULED by the owner on 2026-11-04 and the UI is built; you write it down. Do not re-open a ruling.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Read first (by path, ranges only)
- `plans/PLAN-sdk-creation-seams-2026-10-30.md` §19 (`sed -n 376,394p`) — the rulings.
- `plans/briefs/REPORT-m2e-C-w1.md` and `plans/briefs/REPORT-m2e-C-w2.md` — what this lane built and its names.
- `plans/REPORT-m2e-D-2026-11-04.md` — lane D's contract (§1) and, if filled, its §4 row texts. Read it at the START and again right before
  writing NOMENCLATURE; use §4's row texts where present; for a D name with no §4 text yet, write the row from §1 and say so in your report.

## Goal
### 1. `NOMENCLATURE.md` — §25 Change ledger rows (all 🚧, dated 2026-11-04, "M2e (lane C)" or "M2e (lane D)" in the last column)
Format: the §25 table's three columns `| Was | Now (with **Charter:** purpose; why; owns; not) | When/where |`; copy the shape of the M2d rows at the
table's tail (around lines 3160–3178: `grep -n "M2d (lane C)" NOMENCLATURE.md`). **Append new rows at the very tail of the §25 table** (after the last
`| … |` row before the `⚠ **What the layering build left…` paragraph). **Re-read the tail with `sed -n` immediately before appending** — another
programme's lanes (story-playtest) also append §25 rows at the tail; never edit or reorder their rows; keep your hunk additive.
Rows to write:
- **disabled** (a provided book): hidden everywhere, kept intact — leaves the Lorebooks list, pickers and attach menus; rows stay; a session already reading
  it keeps reading it; upgrades still land. ⚠ not deleted; not the lore write mode _Off_; not an admin starter kit (which stays deletable). Owner:
  the server alone decides (one decider); the client draws what it is sent. Includes the mark (`lorebooks.extra_json.provided.disabled`, and
  `plugins.provided.disabled[slug]` for a book with no row yet — the tombstone `dismissed` became it), the lorebook row's `provided?: { disabled }`,
  `ProvidedBook.disabled`, `StarterKits.Card.provided`, `includeDisabled` (D's §1).
- The **Disable / Enable** events `plugins:disableProvidedBook` · `plugins:enableProvidedBook` (D's §1d) and the sentences: the switch's purpose
  titles _Hide this book everywhere without deleting it_ / _Show this book again_, the visible words _Enabled_ / _Disabled_, and the delete refusal
  `PROVIDED_BOOK_DELETE_REFUSAL` _"A lorebook that comes with the pub or a plugin can't be deleted; an administrator can disable it to hide it everywhere."_
  The plugin page's switch waits for Save (a change form); the Starter lorebooks page's switch acts when pressed (a changelist).
- **primer row** — core's primers imported as immutable lorebook rows through the provided-book sync (★M2e-1 "Primers too, as rows"); _Start from a
  starter lorebook_ reads them; a start is a clone (theirs, deletable). Use D's names from its report.
- Client helpers from w1/w2 reports (`isProvidedBook`, BookSettings `isProvided`, `booksOff`; `leaveDestination` + `AppletCardOrigin` + the
  history-state key `appletFrom` and `AppletCard`'s `from` prop; ★50's `otherRules` (proposed wire field, ⏳ until lane D sends it),
  `OtherRulesGroup`, `otherRulesFacetGroups`, `rememberOtherRules`/`otherRulesNameOf`, `otherRulesGroups` prop, the foreign door's 🚧 copy). Group
  them into as few rows as reads well (one per concept), each with its charter.
- **Leave's origin rule**: Leave/Esc go back where the applet was entered from — Apps when entered from Apps (while the Apps view is registered),
  Home from Home, Sessions otherwise (a cold load). No visible URL parameter (history state). ALSO edit the existing **applet** row (the one starting
  `| _(new)_ — a plugin's frame mounted only inside a session`): its text says "**Leave** / Esc go back to Sessions" and its ⚠ note says "Leave still
  returns to Sessions" — change those words to the origin rule, the smallest edit. This is our own row (M2c/M2d lanes of this programme).
- **The cause rule** in the applet row's charter (★N4 a, ruled 2026-11-04 "By cause"): append to that row's **Charter:** — "applet-API code runs only
  while its applet is open: reach granted to a call a mounted frame's request or a person's press in it caused; session-API code runs in the background".
  Plus a row for D's cause names (frame-origin cause, the refusal constant) from D's report §4, if present.
- **Advanced fold**: a derived settings form draws a field the deriver marks `advanced` under one closed `<details>` _Advanced · N settings_, last in
  its block; a form with none draws no fold. The trigger (★E-2): a user-facing field missing a description, group or reach — exactly the packager's
  `W_SETTING_UNDESCRIBED` predicate (one SDK-exported predicate, name from D's §4). ⚠ not a setting; not a lock; the client never hides a field the server sent.
- **The seeded Reply sampling config** (★47: a reasoning-off dialogue sampling config at 1024+ tokens, the Reply default on a fresh install) — name
  from D's report; if not there yet, say so and leave a placeholder row out (list it as pending in your report).
- **`declaredFieldRefusal`** (shared, `src/lib/shared/sessions/declaredFieldRefusal.ts`) — one sentence source for the server and `navigation.ts`.
Before writing any word, apply §24 (quoted below): grep it across `src`, `../serene-pub-sdk` and the schema; say what it is **not** where a neighbour exists.

### 2. `STYLE-GUIDE.md` (small additive edits; re-read each section right before editing)
- §6.11 Admin pages (line ~1401–1600): the **provided-book switch** — on the plugin page (a change form) it waits for Save like every switch there;
  on Admin › Starter lorebooks (a changelist) it acts when pressed; a native `role="switch"` checkbox named by the book, visible _Enabled_/_Disabled_,
  its purpose as `title`; a disabled book is marked in that list and nowhere else.
- §6.4 List rows and cards (~844): a provided book's row and Book settings offer **no Delete** (nothing replaces it); an admin starter kit keeps
  _Delete starter lorebook_.
- §6.17 Pipeline settings (~1939–1984), the bullet on _The session's derived settings_: one sentence for the Advanced fold's trigger (a field
  missing description, group or reach lands under _Advanced_, closed, last in its block; none → no fold).

### 3. `docs/` (user-facing behaviour; plain words, second person, the house voice of each file — read a few paragraphs first)
- `docs/plugins.md`: under **What a plugin can't do** (line ~28) the C5 sentence: what it may do outside a session (its app's permissions — the
  person's library, its per-person storage) works only while its app is open; what it does inside a session keeps working in the background like
  any session's. Provided books: an administrator **disables** one on the plugin's page instead of deleting it (hidden everywhere, kept; Enable shows
  it again); uninstall still asks keep/delete. Find the existing provided-books paragraph and fix any line that says a provided book can be deleted.
- `docs/lorebooks.md`: a plugin's provided book and the pub's own starter lorebooks: no Delete; an administrator disables one on the plugin page or
  in Admin › Starter lorebooks; admin starter kits are unchanged (Delete starter lorebook stays); starting from one makes your own copy, which you can
  delete. Also ★50: a book holding entries from rules it is not told by lists them under those rules' name in the rail (read-only for new entries) —
  ⚠ only once lane D sends it: write it, and mark nothing in prose (docs carry no 🚧), but say in your report that it depends on lane D.
- `docs/getting-around.md` (lines ~139 and ~181 mention Leave): Leave (and Esc) go back where you came from — the Apps view if you opened the game
  from Apps, Home if from Home, otherwise Sessions.
- The Advanced fold: if a docs page describes a session's settings form (`grep -n "Advanced" docs/sessions.md docs/system-settings.md docs/pipelines.md`),
  add one sentence there. `docs/sessions.md` is shared with another programme: re-read it immediately before editing, keep the hunk additive and
  small, never reformat.
- The new Reply sampling default: if a docs page lists sampling configs or the Reply default (`grep -n -i "sampling" docs/connect-a-model.md
  docs/connections.md docs/pipelines.md`), one sentence once D names it; else skip and say so.
- Keep every link valid: run `npm run docs:build` (it runs `scripts/build-docs.js`, which checks links) at the end and report its result.

## Files owned (only these may be edited)
`NOMENCLATURE.md`, `STYLE-GUIDE.md`, `docs/**`.
## Files readable
Everything. Never edit code, plans other than your report, or another lane's files.
## Out of scope
No CHANGELOG unless one exists for this programme already (check `grep -n "M2d" CHANGELOG.md`; if M2d has a line, add one M2e line beside it).
No rewriting of existing rows or sections beyond the edits named. No new docs pages.

## Rules you carry
- NOMENCLATURE §1 headlines: **R1** one word, one meaning · **R2** distinctive words for new concepts · **R3** qualify, never the bare noun · **R4**
  casual words are not type names · **R5** reconcile vocabularies at boundaries, never merge them · **R6** mark ⏳ transitional / 🚧 provisional.
- §24 (verbatim): "1. Pick a **distinctive** word (R2)… 2. Grep for it first — across `src`, the SDK, and the schema. 3. If it collides, either pick
  another or **rename the other use in the same change**. Never ship a second meaning. 4. Qualify it if the bare noun could ever stand alone (R3).
  5. Say what it is **not**, in the declaration, if a near-neighbour exists. 6. UI labels are prose and need not match internal names — but must not
  _contradict_ them."
- P6 Charters: "Everything that exists states its purpose, why it exists, what it owns and what it does not (and who does) — in its NOMENCLATURE row."
- "app" = Serene Pub; **applet** = the plugin-provided thing; the UI label is **Apps**; user docs may say "game"/"app" as the existing docs do
  (follow `docs/getting-around.md`'s own words). It is a **session**, never a *chat*. One installation is a **pub**.
- STYLE-GUIDE §10: sentence case; a button says what happens; help is one sentence; no filler.
- Re-read any file right before editing it; keep hunks additive and small; never reformat a file (no prettier on .md files you didn't create).
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need none.)
## Stop and ask when
A word collides (§24 step 3) — propose, don't rename; a ruling reads two ways; a needed edit is outside Files owned.
## Done means
The rows and edits above landed; `npm run docs:build` exits 0 (report its output tail); any hunk you saw in NOMENCLATURE/docs from another programme
noted (file + rough line) in your report.
## Report
Write `plans/briefs/REPORT-m2e-C-w3.md`: each edit (file:line), every row added (its first words), D names still pending, the docs:build result,
**Noticed, not done**.
