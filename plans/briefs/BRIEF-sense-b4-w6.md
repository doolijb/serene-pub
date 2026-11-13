# BRIEF — build lane `sense-b4`, worker 6 — docs, the SDK guide and JSDoc, NOMENCLATURE

You are a `lane-worker`. Supervisor: build lane `sense-b4` (`plans/briefs/BRIEF-sense-b4.md`, readable). This
brief is your contract. Words: a **build lane** is this stream of work; a **channel** is a session's message
channel. Never write bare "lane" for a channel.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What was built (true now; write only this)

1. **The rule.** For a session that reads an attached lorebook **and whose scenes end by themselves** — it runs the
   *Find where scenes begin* routine (not switched Off) and its scene mode is **Automatic** (Story's Living and Rule
   Based presets, the Lair and the Dungeon Crawler ship that way; Story's Minimal preset and Chat do not) — a
   pipeline's **new entry, place (room), history day or link** is kept in the session's **own notes** (code: own
   book) **whatever the lorebook's write setting, Full included**, exactly as under Review changes, Off and on
   someone else's lorebook. The session reads its notes with the lorebook (notes first) at once: its places list,
   the map, retrieval, keyword match, the names list, the Lair's room flows. Nobody else sees them. They reach the
   lorebook only by **Apply**: by itself when a scene closes (and when a waiting summary is saved, and at Close out)
   if the session's owner owns the lorebook and its write setting is **Full**; otherwise by the lorebook owner's
   press on the "This session only" card. A member's session on someone else's lorebook keeps them until the
   lorebook's owner applies them.
2. **Every other session writes exactly as before:** under Full it writes new entries, places, history days and
   links straight to the lorebook (Chat, a plugin genre with no scenes routine, a session whose routine is Off or
   whose scene mode is Suggested or Manual).
3. **A turn owns them** (swipe, regenerate, Back, delete take them; Forward brings them back) until applied.
4. **Settle:** for such a session a summary written with `sources` no longer moves the settle line ("Back stops
   at …"); Apply does ("Only Apply settles", owner). Other sessions: unchanged.
5. **Lines (branches):** a branch session riding its parent's line gets its own line from its **first Apply**
   (pressed or automatic), not from its first such write; the fork happens inside the Apply, so an Apply with
   nothing to apply forks nothing. Other writers still fork on their first write as before (a cast version, a
   value, a summary's save, a person's own entry, a scene compile). **A branch's changes now reach its own line by
   themselves** as scenes close (automatic Apply no longer skips a branch).
6. **Unchanged:** stat values, timeline captures, cast versions and the lorebook annex route as before; while a new
   history day waits in the notes, those are still dated by the lorebook's latest day (★, accepted). Ruleset ties
   and rules fields for a room that lives in the notes are written in the notes (they follow the row).
7. **Results:** `create-lore-entry`, `update-lore-entry` and `link-lore-entries` results for such a session carry
   `route: "own-book"` and the own book's `lorebookId` (values only; the shape is unchanged).
8. Not built (do not promise): how a pipeline chooses to update an entry or add a child instead of duplicating (a
   later build lane).

## Edit (each in place, the smallest true change; keep the documents' voice)

- `docs/lorebooks.md`: ~203 the **Full** bullet ("sessions write to the lorebook as they play" is no longer true for
  sessions whose scenes end by themselves); ~209 ("What a session writes to the lorebook lands on its line");
  ~213 *Changes from a replaced reply*; ~220 (the paragraph ending "Under **Review changes** and **Off** a session
  writes to its own notes instead …"); ~224–226 *Your session's own notes* (who writes there: add sessions whose
  scenes end by themselves; "This changes nothing under **Full**, nor …" is no longer true for them). Check the
  section *Bringing a session's changes into the lorebook* and fix any sentence the build made false (a branch
  applying by itself).
- `docs/lorebook-time.md` ~176–178: a branch session's line is made by its first Apply, not its first write, for
  these kinds; list what still forks on first write.
- `docs/session-actions.md`: read it; fix any row or cell the build made false (the table ~130–140 and anything
  about Full writing through or about branches); say "none" if nothing.
- SDK `../serene-pub-sdk/guides/storage.md` ~49–66 and ~82–88 (and any "Full" cell or "own-book route" paragraph
  the build made false).
- SDK `../serene-pub-sdk/INTEGRATING.md` ~1411: `create-lore-entry@1` with a history `entryType` files onto the
  day's one entry **of the session's own book** for a session whose scenes end by themselves (merged onto the
  lorebook's day at Apply); otherwise as written.
- SDK `../serene-pub-sdk/contracts/src/outlets.ts` — **JSDoc only, no code, no type change** — near ~1840, ~1905,
  ~2031 (the create, update and link outlets): say where the write lands for such a session.
- `NOMENCLATURE.md`: the **own book** row (§24 area, ~1788) and the **held amendment** row (~377: "a history day …
  still writes through under **Full**") — make them true; add a §25 change-ledger section after the sense-scn one
  (end of §25, ~3759–3766), titled like its neighbours: `### The flip: where scenes end by themselves, the own book
  takes a pipeline's writes — 2026-11-12 (owner rulings 2026-11-12; lane sense-b4)` with a Was | Is | Why/where
  table: the rule; settle by `sources` gone for such sessions; Apply forks a branch's line; automatic Apply for a
  branch; ties follow the row; and the new internal names 🚧 `scenesEndByThemselves` (`lorebooks/ownBook.ts`,
  exported), the `scenesEndByThemselves` field on host-internal `sessionLoreWriteTo`'s result, `annexWriteBookOf`
  (`host.ts`), `Routing.ownBookId` (`rulesets/ties.ts`); "No new table, column, migration, setting or published
  name". Before writing a name, read NOMENCLATURE §1 (R1–R6) and §24; mark provisional names 🚧. **Do not** touch
  §23 retired words, other sections, or `docs/genres.md`.

Every new or changed user-facing sentence is **provisional copy**: list each one verbatim in your report.

## Rules for the words

- It is a **session**, never a *chat* (the genre named Chat is a name). Every session has a lorebook: never write
  "no lorebook". The interface word for the own book is **Session notes** / "the session's notes"; code docs and
  NOMENCLATURE may say "own book".
- Never "lane" for a channel. Never a reference to another project or product.
- Plain sentences a player can follow; no plan ids, no build-lane names in `docs/` (NOMENCLATURE §25 may name the
  build lane, as its neighbours do).
- Don't describe code that was not built; don't promise later work.

## Files owned (edit only these)

`docs/lorebooks.md`, `docs/lorebook-time.md`, `docs/session-actions.md`, `NOMENCLATURE.md` (the two rows and the new
§25 section only), `../serene-pub-sdk/guides/storage.md`, `../serene-pub-sdk/INTEGRATING.md` (~1411 only),
`../serene-pub-sdk/contracts/src/outlets.ts` (JSDoc only).

## Checks

- `npx prettier --check` on each `.md` you changed if the repo formats Markdown (report the result; if it failed
  before your edit, say so). For `outlets.ts`, run nothing at the SDK root: no npm there, no build. Do **not** run
  `npm run sdk:build`. Confirm `outlets.ts` still parses by eye (JSDoc only).
- No tests to run.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — and in this build lane: **do not run `npm run sdk:build` at all.**
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the SDK
  repo is uncommitted). Never `kill -9` anything.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Other sessions are editing these repos: never touch their files or their sections.

## Report (your final message)

Per file: what changed, and every new or changed user-facing sentence verbatim; the NOMENCLATURE rows and §25
section as written; **Noticed, not done** (sentences elsewhere you found false but did not own).
