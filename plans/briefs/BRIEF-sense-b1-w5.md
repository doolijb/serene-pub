# BRIEF — `sense-b1-w5` — docs and the vocabulary ledger for held amendments

You are a `lane-worker` for lane `sense-b1` (supervisor: the agent that launched you). Repo
`/home/jody/github/serene-pub`; the SDK repo is `/home/jody/github/serene-pub-sdk` (you edit one guide there, as
text only). Use absolute paths. Return your report as your final message (no report file). A code worker (`w4`)
edits `ownBook.ts`, `imprints.ts`, `settle.ts`, sockets and one Svelte card at the same time: **edit only the files
below.** Other sessions edit `NOMENCLATURE.md` too: use the Edit tool with exact strings (never rewrite the file),
and re-read a section just before you edit it.

## What was built (the facts your text describes)

- **A held amendment** 🚧 (provisional name): a pipeline's change to an entry of the lorebook a session reads is no
  longer written into that lorebook. It is kept in the session's **own book** (on screen: **Session notes**) as an
  `entry_amendments` row naming the lorebook's entry, with `base` (what each changed field read when the session
  wrote it), `source_message_id` (the turn's message) and the session's story date (day grain) when the session
  reads at a moment, else no date. **A held amendment is exactly a row with `base IS NOT NULL`.** This happens
  **whatever the lorebook write mode is** (Full included). A change to an entry of the session's own notes is
  written as before. History days (`create-lore-entry` filing onto a day) still write through (a later lane).
  A change that would move a history entry's date is refused 🚧: *'‹entry›' keeps its date in the lorebook, and a
  session's change cannot move it — change it in the lorebook.*
- **Who reads it:** only that session (and a branch cut at or after the turn that made it). Another session of the
  same lorebook and the lorebook's own pages never see it. Retrieval ranks the entry by the lorebook's own text
  (its vector is the base text's, as with every amendment) and shows the session's changed text.
- **A turn owns it:** a swipe, a regenerate, Back and a delete of the turn take it back; Forward and a failed
  re-tell put it back.
- **Listed:** the session's **This session only** card (session panel) lists it beside the entries the session
  added: the entry, each changed field *before → after*. A change whose field the lorebook changed since is marked
  🚧 *‹Label› has changed in the lorebook since this session changed it.* and has no Apply button; an undated
  change that a dated lorebook change would hide is marked 🚧 *A dated change in the lorebook decides ‹label›
  here, so this change would not show.*
- **Applied:** **Apply to the lorebook** (the lorebook's owner only, as before) folds a clean change in: an
  undated change updates the entry; a dated one becomes a dated change on the session's line (the entry's earlier
  text stays true before that date). Each applied field leaves a change record (`lore_imprints`, `origin: 'apply'`,
  one `batch` per press, `cause` = who pressed, the session, the message) keeping before and after. A conflicted
  change stays held. Applying still ends **Forward**. After Apply, the change is the lorebook's: Back, a swipe or a
  delete of the turn no longer takes it, and every session reading the lorebook — a branch too — sees it.
- **Taken back:** a server function (`takeBackApply`) undoes one Apply press: each field goes back to its before,
  only while it still holds what Apply wrote, and the change returns to the session as held. It refuses in a
  sentence when the lorebook has moved on. **There is no button for it yet** (docs say nothing user-facing about
  taking back; the SDK guide and NOMENCLATURE may name the function as internal).
- **Settling** never strips an Apply's records (they keep `before`).
- **Internal names added** (record in NOMENCLATURE §25 as _(internal)_): `LineReading.holderBookId` (the session's
  own book, carried by `sessionReadingOf`); `LineAmendment` · `HeldAmendment` · `LineDatedRow` · `HeldDated` (the
  resolver's union, `held: { anchor }`); `holdLoreEntryChange` and `holderBookOf` (host); `RetractedState.
  heldAmendments`; `loadVocabulary(…, { holderBookId })` / `amendedNamesOf(…, holderBookId?)`; `IMPRINT_ORIGINS` ·
  `ImprintOrigin`; `takeBackApply`; `OverlayItem.kind` (`entry` · `entry-change`), `amendmentId`, `changes`,
  `conflict`; `sessions:applyOverlay` params `amendmentIds`, response `appliedChanges` · `stillHeld` · `batch`.
  Columns: `entry_amendments.source_message_id`, `.base`, `year` nullable (CHECK
  `entry_amendments_undated_check`); `lore_imprints.origin` (CHECK `lore_imprints_origin_check`), `.batch`,
  `.cause`. Migration `drizzle/0156_nappy_paladin.sql`.

## Goal

1. **`docs/lorebooks.md`** — "Bringing a session's changes into the lorebook" (~line 234) and the Session notes
   paragraph above it (~224): one short, plain paragraph saying a pipeline's change to an entry of the lorebook is
   kept with the session until it is applied, and what the card shows and what Apply does with it (the facts
   above, user-facing only). Fix any sentence there that now says a session's change is written into the lorebook
   it reads (for entries' changes). Keep the page's voice; sentence case; no filler.
2. **`docs/sessions.md`** — wherever it describes where a session's lorebook writes land, or "Where the session
   reads its lorebook": the same fact in one or two sentences, linking to the lorebooks section. Do not rewrite
   unrelated text.
3. **`/home/jody/github/serene-pub-sdk/guides/storage.md`** — "Where a lorebook write lands" (~line 52) and the
   Back exceptions (~64): a turn's change to an **existing entry** of the lorebook the session reads is kept in the
   own book as a held amendment, whatever the write mode, and reaches the lorebook only when its owner applies it;
   Back and a swipe take it with its turn until then; after Apply it is the lorebook's. Adjust the table cell
   "Reaches other sessions" for the Lorebook column only as far as that is now true (a change to an existing entry
   reaches other sessions at Apply). Everything else about links, rooms, new entries and stats is unchanged — do
   not reword it. Text only: no code, no build.
4. **`NOMENCLATURE.md`**:
   - read §1 Governing rules, §23 Retired words, §24 Naming something new first;
   - add a **held amendment** 🚧 row (provisional, unruled ★B1-1) in the same section as **amendment** (§8, ~line
     375; or beside **lore imprint** in §9 if that reads better — say which): purpose, why it exists, what it owns
     (a session's change to a lorebook entry, until Apply), what it does not (it is not the lorebook's — Apply is the
     only door; not a line amendment; not a session imprint). Say what it is **not**: ⚠ not a ruleset's *held entry*
     (`HeldEntry`), not a change *held for review*, not a **kept** imprint. Never the bare word "held" as a name (R3);
   - amend the **amendment** row: an amendment is a date, except a held amendment, which may be undated;
   - amend the **lore imprint** row (§9, ~1754): `origin` (seven values; only `run` and `apply` written today),
     `batch`, `cause`; an `apply` record is never taken by a turn and never compacted by settling;
   - amend the **own book** row's mention of the **This session only** card (~3848) if it says only "what it added";
   - add one §25 subsection in the newest style (a dated `###` heading with a `| Was | Is | Why/where |` table, as
     "### one undo rule: a turn replaced or leaving — 2026-11-11" ~line 3713): heading `### held amendments: a
     session's change to a lorebook entry waits for Apply — 2026-11-11 (owner rulings S3 "Only Apply settles",
     Stage B 1–2 (b) fold; PLAN-sensible-engine §5.9 step 4; lane sense-b1)`, with rows for the behaviour change, the
     new term, the columns, and the internal names above.
5. **Copy list.** Every sentence you add to `docs/` and the SDK guide is provisional 🚧 copy: list each one verbatim
   in your report.

## Files owned

`docs/lorebooks.md`, `docs/sessions.md`, `/home/jody/github/serene-pub-sdk/guides/storage.md`, `NOMENCLATURE.md`.

## Files readable

Anything. Useful: `plans/DESIGN-own-book-write-path-2026-11-11.md` (D1, D3, D6, D8, the Challenger round),
`plans/PLAN-sensible-engine-2026-11-11.md` §1.3 and §5.8–5.9, `STYLE-GUIDE.md` §10 Writing,
`docs/lorebook-time.md` (how amendments are explained to users — keep the words consistent).

## Out of scope

Any code, test or schema file; other docs pages (list any page that now says something false under **Noticed, not
done**: e.g. `docs/lorebook-time.md`, `docs/session-actions.md`); generated docs; the SDK's code or `INTEGRATING.md`.

## Stop and ask (in your report, then stop) when

- a doc would need to describe a behaviour not in "What was built" (ask; do not invent);
- a NOMENCLATURE rule (R1–R6, §24) blocks the term "held amendment" beyond what ★B1-1 already flags — say why and
  propose one alternative, but still write the row as 🚧 provisional with the design's word.

## Done means

The four files edited as above; the copy list; `npx prettier --check` is **not** run on Markdown here (the repo
does not format these pages). No other file changed.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not run `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo (most of the SDK repo is uncommitted). Never `kill -9`
  anything. Never run npm at the SDK repo root.
- It is a **session**, never a *chat*. Every session has a lorebook (its own book, or the one it reads): never
  write "no lorebook". Members never see model plumbing.
- STYLE-GUIDE §10: sentence case; a button says what happens; one name per thing; help is one sentence; no filler.
- **No reference to any other project or product** in any file in either repo.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.

## Report (your final message)

Each file and section changed; the NOMENCLATURE rows added or amended (with their section); the §25 subsection's
rows; every provisional sentence verbatim; anything that stopped you; **Noticed, not done**.
