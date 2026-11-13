# BRIEF — worker `sense-doc-w2` — six code comments made true

Supervisor: lane `sense-doc`. **Comment text only.** Not one character of code outside a comment may change. Repos:
`/home/jody/github/serene-pub` and (two docblocks) `/home/jody/github/serene-pub-sdk`. Use absolute paths.

## Goal

Rewrite six stale comments so each says what the code does now. The supervisor has read the code; the facts you need
are below, with file:line. Re-read each cited line before writing; if a fact below is wrong against the code, stop,
leave that comment alone, and say so in your report.

## Files owned (comment text only, and only the comment named)

1. `src/lib/server/db/schema.ts` — the docblock on `lorebookBranchId` (about lines 2708–2722).
2. `src/lib/server/sessions/coreAnnex.ts` — the file header (lines 1–40).
3. `src/lib/shared/lorebooks/lineReading.ts` — the docblock on `Line.sessionCuts` (about lines 101–107).
4. `src/lib/server/state/durable.ts` — the file header (lines 1–48): its "No lorebook" section and the words "no book"
   / "the session's notes" in the "Where, and whether" section.
5. `../serene-pub-sdk/contracts/src/outlets.ts` — the `cause` in-port docblock of *Advance story clock* (about line
   1524–1539): one phrase.
6. `../serene-pub-sdk/contracts/src/tasks.ts` — the `clock-step@1` docblock (about lines 4845–4857): one sentence.

## The facts, per comment

1. **schema.ts `lorebookBranchId`.** Stale: "retrieval reads the book as of NOW on this branch, which is the current
   state of that line's story. Reading as of a past date is the author's tool, not the model's (ruling 4 parks the
   pinned-session case)." True now: a session reads its line at its own story clock — `sessionReadingOf`
   (`src/lib/server/state/reading.ts` ~312–355) builds the reading from this column, the session's clock
   (`momentOf(session)`), and, when the session has no clock of its own, the line's present (`linePresentOf`); a branch
   session's reading also carries its session cuts. Retrieval reads entries through that reading: a row on the line,
   and a dated row (a history entry) only when dated at or before the earlier of the reading's moment and its step's
   fork cut (`entryOnReadingSql`, `src/lib/server/state/entriesOnReading.ts` ~60–72). Replace the stale paragraph
   with those facts (name the two functions). Keep the first line and the `set null` paragraph as they are.
2. **coreAnnex.ts header.** Stale: "Core keeps five pieces" (the list has six: `turnOrder`, `turnTally`, `laneReads`,
   `rulesetDecks`, `rulesetConversions`, `seatBenches` — the array `CORE_RUNTIME_KEYS` at ~52–59). Stale: point 2
   "never retracted: when Back, Forward or a branch's `annexAt` lands a `core` document, these keys keep the values
   they hold NOW (`TIMELESS.core` in `annexChanges.ts`)". True now: the annex's own undo never rolls these keys back —
   `TIMELESS.core` (`sessions/annexChanges.ts` ~58) keeps their present values when Back, Forward or a branch's
   `annexAt` lands a `core` document. But the two logs `rulesetConversions` and `seatBenches` are edited by the state
   retraction: Back (`retractStateAnchoredTo`, `state/write.ts` ~890–943) takes out the records anchored to the
   messages it removes and puts each record's `from` back; Forward (`restoreRetractedState`, `state/write.ts`
   ~1350–1390) appends them again and re-applies `to`. Rewrite: "six pieces", and point 2 to say both. The other
   points stay. Also the "(`annexVersions` … was a runtime key here for a day (M2a a8); since M2b it is the column …
   and this migration's data upgrade moved any stored value there.)" paragraph is dated narrative: reduce it to the
   present rule (`annexVersions` is the column `sessions.annex_versions`, `sessions/annexVersions.ts`, not a key
   here) — check `src/lib/shared/conformance/commentHistory.ratchet.json` for this file's count before and after.
3. **lineReading.ts `Line.sessionCuts`.** Stale: "Only cast versions read it (`rowPassesSessionCut`); entries and
   values ride the line uncut (★CV-12)." True now: cast versions read it (`rowPassesSessionCut` here; its SQL mirror in
   `src/lib/server/state/lineSql.ts` ~125–141), and so do durable stat values: `rowsOnReading`
   (`src/lib/server/state/reading.ts` ~566–600) keeps a value row tied to an ancestor session's turn
   (`validFromMessageId`) only up to that cut's `through`. Entries ride the line uncut by session (they are cut by story
   date only, `entryOnReadingSql`). Keep the rest of the docblock (absent/empty meaning, who sets it).
4. **durable.ts header.** Stale: section "## No lorebook: the session's own notes (🚧 PLAN-rulesets §26)" with
   "Until 2026-10-16 a session with no world recorded nothing." Every session has a lorebook: the attached one, or its
   own book (`$lib/server/lorebooks/ownBook.ts`), a hidden lorebook it alone owns, shown on screen as **Session
   notes**. Retitle the section in the own-book vocabulary (e.g. "## A session with no attached book: its own book")
   and state the rule in the present: a session with no attached book records the world's values on its own book; the
   delete safeguard is the exception, since the own book goes with the session it records (check the delete branch
   ~139–181 for what it does with no attached book: it records nothing). In "Where, and whether": "Otherwise — no book,
   Review changes, Off, or someone else's book — the world's values land in the session's notes" → "no attached book"
   and "the session's own book"; "the notes being the overlay a review resolves" → "the own book being …". Drop the
   date narrative. Do not write "no lorebook" anywhere.
5. **outlets.ts `cause`.** "`'tick'` — a reply's fixed tick." → "`'tick'` — a reply's or a round's fixed tick." (Story's
   reply tick, and the round tick, `core-catalog/src/shared/roundTick.ts`.) Nothing else in that docblock.
6. **tasks.ts `clock-step@1` docblock.** "Chat's reply hands it nothing and reads its own parameters — **By** (0, the
   default, is off) and **Unit** — exposed as the session setting *Each reply advances the clock by …*." It is Story's
   reply (`core-catalog/src/genres/story/respond.ts` ~1463), and the round tick (`shared/roundTick.ts` ~43) does the
   same. → "Story's reply and the round tick hand it nothing and read their own parameters — **By** (0, the default,
   is off) and **Unit** — exposed as the session settings *Each reply advances the clock by …* and *Each round advances
   the clock by*." Nothing else.

Items 5 and 6 are JSDoc comments, outside any descriptor's `i18n`/`description` strings, so no hash moves. Confirm
that: if either text sits inside a string literal (a descriptor field), stop and report instead of editing.

## The rules your work depends on

- The comment-history check (`src/lib/shared/conformance/commentHistory.test.ts`): "A comment states the rule, not
  the story. 'Used to', 'previously', 'no longer', a migration number cited as history, a measurement, an anecdote …
  none of it is the invariant a future reader needs." A file's phrase-hit count may only go down
  (`commentHistory.ratchet.json`). Write present-tense rules.
- Every session has a lorebook (its own book, or an attached one): never write "no lorebook". It is a **session**,
  never a *chat* (in item 6 the genre is called **Chat** — but the fix removes that word anyway).
- No reference to any other project or product.

## Out of scope

Any code; any other comment, even a stale one you notice (list it under Noticed); any other file.

## Stop and ask when

A fact above does not match the code; a text in item 5 or 6 is inside a string literal; anything outside these six
comments.

## Done means

- `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 src/lib/shared/conformance/commentHistory.test.ts"`
  — your four app files must not appear among any failures (the test was already red on 9 other files; name what you
  see).
- `cd /home/jody/github/serene-pub && npx tsc --noEmit -p . 2>&1 | grep -E "schema.ts|coreAnnex.ts|lineReading.ts|durable.ts"`
  shows nothing (comments only, so nothing should). Skip if it needs more than an 8 GB heap; say so.
- `git -C <repo> diff --stat` on your six files, and `git diff` on each, show comment lines only — paste a one-line
  confirmation per file.
- `npx prettier --check <file>` on each changed file; report, don't reformat lines you didn't write.
- Your report (final message): each file, the old sentence and the new, the code file:line behind it, tests.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the SDK
  repo is uncommitted). Never pipe vitest into `head`. Do not start a dev server.
