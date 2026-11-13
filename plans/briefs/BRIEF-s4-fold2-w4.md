# BRIEF s4-fold2-w4 — copy, docs links and the canon rows for the fold (2026-11-08)

Supervisor: lane `s4-fold2`. Report back in your final message (the supervisor saves it). Repo: `/home/jody/github/serene-pub`. Docs and canon only, plus one copy constant and one code comment.

## Background

Lane s4-fold built the fold (`lorebooks/foldInParent.ts`, UI **Merge ‹book› into these notes**) and queued its NOMENCLATURE rows; this lane (s4-fold2) holds `NOMENCLATURE.md` and merges them. This lane also made a session that reads its own notes alone on a line (after a merge) **write** on that line, dated at its clock, made branching such a session copy its line into the branch's notes, made the story clock / story date / graph Extend / line change answer for it, and made a fold of a branch whose ancestors hold member overlays work. Read `plans/REPORT-s4-fold-2026-11-08.md` in full (its "NOMENCLATURE rows queued" paragraph is your list) and `plans/briefs/BRIEF-s4-fold2.md`.

## Goal

1. **Copy (★s4-fold-4, lead decision — exact text):** `src/lib/shared/lorebooks/sessionNotes.ts` `SHARE_REFUSALS.attached` →
   `"This session reads a lorebook, so its notes are shared to that lorebook, or that lorebook is merged into them."`
   Grep tests for the old literal (`with a copy of it`) and update any that hard-code it (the ones that use the constant need nothing). No other copy changes.
2. **Doc links** (queued by lane s4-tidy): `docs/lorebooks.md:164` "opens it in [Character cards](./characters.md)" → "opens it in [Characters](./characters.md)"; `docs/sessions.md:142` "…opens their card in the [Character cards](./characters.md) view" → "…in the [Characters](./characters.md) view"; `docs/sessions.md:721` "- [Character cards](./characters.md) and [Personas]…" → "- [Characters](./characters.md) and [Personas]…". **Keep** `sessions.md:20` (the picker's group heading **Character cards**) and `lorebooks.md:249,290` (the item, *character cards*). Line numbers may have moved — match the text.
3. **Docs, one sentence each, behaviour that moved** (house style: plain, second person where the file uses it, bold for UI labels, no "chat", never say a session has "no lorebook" — say its lorebook is its own notes):
   - `docs/lorebooks.md` Merge bullet (~237, "…on the same line and at the same date it was reading."): add that what the session writes afterwards (its lore, its people's changes, the values it records) lands on that same line, dated at its clock, and that a **Branch from here** of it keeps that line in the branch's notes.
   - `docs/sessions.md` §"Where the session reads its lorebook" (~512–520): it says the Line and Story clock settings appear "For a session that reads a lorebook". Do **not** promise a setting the screen doesn't show (the edit form shows Line / Story clock only for an attached book — that UI gap is the supervisor's ★). If a sentence there would now be false, fix it minimally; otherwise leave the section alone and say so.
4. **Comment wording** in `src/lib/server/sockets/state.ts` (comments only, no code): ~1119 "a crawl with no attached book names its rooms from them" and ~1310–1314 "⏳ A session with a lorebook of its own lists none" — reword so neither frames a session as lacking a lorebook (say: a session whose lorebook is its own notes / a session that reads an attached lorebook). Keep meaning exactly.
5. **NOMENCLATURE.md** (you hold it this wave). Read first: §"Maintaining it" + **§1 Governing rules** (R1–R6), **§24 Naming something new**, the §24 "Session data vocabulary" table (~1715–1760, where **surfaced book** sits at ~1739 and the **Share as a lorebook · Share to ‹book› · Clone with changes and attach** row at ~1740), §23 Retired words (format of a retired row, ~1420–1634), and §25 Change ledger (both its table rows ~3380–3405 and its dated bullet list ~3740–3760 — follow the s4 lanes' format exactly). Then merge every row queued in `REPORT-s4-fold` ("NOMENCLATURE rows queued"):
   - a new §24 row 🚧 **fold** · **Merge ‹book› into these notes** · `foldInParent` — charter (purpose / why / owns / not), per P6: purpose, a session that reads a book makes the story its own; why, owner ★B-1/★B-2/★bk-fold-1…5 (2026-11-08) and ★27-10's "overlays can have their parent merged in place"; owns, the one-transaction copy of the attached book into the notes, the read guard, `FOLD_REFUSALS`; not, **Share as a lorebook** / **Share to ‹book›**, graph merge, the seat merge rule or `scenes:merge` (R1: code says *fold*, UI says *Merge*). Include 🚧 `sessions:foldInParent`, `Sockets.Sessions.FoldInParent`, `FOLD_LABEL`, `FOLD_CONFIRM`, `FOLD_DONE`, `FOLD_REFUSALS`, the notes-member fold rule (★bk-fold-3) and the overlay carry rule (own overlays, and — built by this lane — the session's ancestors' member overlays carried for the folding session only, ancestors' rows never written);
   - 🚧 `reseatOnto` (writes `cast_member_id` only; §33.3's dropped hand-off meaning not revived) and 🚧 `repointSpeakerStamps` — rows or clauses where the seat / speaker-stamp vocabulary lives (grep);
   - 🚧 `rekeySessionRefs`, `SeatRefTranslator`, `SeatPick`, `SeatRefsTally`, `memberMoveTranslator`, and amend the existing `seat-keys` row (~3389: the steps are translator-driven now; the boot pass passes a card-form translator);
   - 🚧 `LineReading.onOwnBook` + the **own-notes reading rule** (replaces pr-6 B "null with no attached book"): a session whose lorebook is its own notes reads them on its line (`lorebook_branch_id`) at its moment (clock, else the line's present), like any book (★bk-fold-1). **Add this lane's part to that row:** writes land where it reads — on its line, dated as an attached book's write (cast versions `characters/versions.ts`, captures `state/durable.ts`, lore writes `host.ts`), on the notes' main exactly as before; `copyOwnBookToBranch` copies the line chain and its entries/amendments into the branch's notes and the branch stands on the copy; the story clock read, the session links' story date, graph Extend and `sessionLinePatch` answer from the own reading;
   - §23 retired rows: **Clone with changes and attach**, `sessions:cloneWithChanges`, `cloneWithChanges`, `SHARE_LABELS/CONFIRMS.cloneWithChanges`, `SHARE_REFUSALS.noBook` — why: replaced by the fold (★B-1, 2026-11-08) and the ★bk-lock-1 wording;
   - row edits: surfaced book (~1739: "The fold … is held back … and has no row" → it's built, see the fold row); the Share verbs row (~1740: drop Clone with changes and attach and `sessions:cloneWithChanges`, add **Merge ‹book› into these notes** as the third verb for an overlay); the §25 table row ~3124 (Clone → Merge, or leave as history if that table records past renames — follow the table's own meaning); §28 ~3617 own book verbs (Clone → Merge); and the s4-bk-fold ledger bullet's "The fold itself is **not built**" stays as history (don't rewrite history bullets);
   - §25: one table row and one dated bullet for lane s4-fold ("2026-11-08 (lane s4-fold; ★bk-fold-1…5, ★B-1, ★B-2, ★bk-lock-1; plan §34.3): …") and one dated bullet for lane s4-fold2 ("2026-11-08 (lane s4-fold2; ★bk-fold-1, ★s4-fold-1/2/4): own-notes writes on the session's line; branching carries the line; folding a branch whose ancestors hold member overlays; story clock / story date / graph / line change for own notes; `SHARE_REFUSALS.attached` reworded. No new names (private helpers only). Merged by lane s4-fold2.").
   Grep before writing each name (R1/§24.2); mark every new name 🚧; don't invent any name not listed here — if one seems needed, stop and report.
6. Run `npm run docs:build` and confirm the generated lorebooks page no longer has the Clone paragraph (grep `src/lib/generated/docs/pages` for "Clone with changes" — the pr-6 release notes page keeps it as history; that's correct). Report the exit and any warning.

## Files owned (edit only these)

`src/lib/shared/lorebooks/sessionNotes.ts` (`SHARE_REFUSALS.attached` only), `docs/lorebooks.md`, `docs/sessions.md`, `src/lib/server/sockets/state.ts` (the two comments only), `NOMENCLATURE.md`, `src/lib/generated/docs/**` (via `docs:build` only), any test that hard-codes the old `attached` literal.

## Out of scope

Any code change beyond the constant and the comments; other docs files; other copy (★s4-fold-3 copy stays as built); STYLE-GUIDE.

## Stop and ask (in your report) when

A name would be new beyond the list; a doc sentence would promise UI the screen doesn't show; a §25 format question you can't settle from the file's own examples.

## Rules your work depends on (quoted)

- NOMENCLATURE §1: "**R1 — One word, one meaning.** Where a word is already load-bearing in one place, the _other_ use renames." "**R6** … 🚧 **Provisional** — designed but not built, so the words may still move …" "Anything unmarked is permanent and should be treated as expensive to change."
- §24: "1. Pick a **distinctive** word (R2) … 2. Grep for it first … 3. If it collides, either pick another or **rename the other use in the same change** … 5. Say what it is **not**, in the declaration, if a near-neighbour exists. 6. UI labels are prose and need not match internal names — but must not _contradict_ them."
- CLAUDE.md P6: "Everything that exists states its purpose, why it exists, what it owns and what it does not (and who does) — in its NOMENCLATURE row."
- CLAUDE.md: "When you add or rename a term, record it in **§25 Change ledger** in the same change." "§23 Retired words: never reintroduce one."
- Memory rule "There is ALWAYS a lorebook": never write copy that frames a session as having no lorebook; say own notes / own book / attached book.
- "It is a **session**, never a *chat*."
- NOMENCLATURE is 14.5k tokens: read it by section (`sed -n`), never whole.
- Scratch files in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/` named `s4-fold2-w4-*`. If you run a test, use the capped form: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold2-w4-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold2-w4-tests.log'` (never pipe vitest into `head`).

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (No `sdk:build` expected.)
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so. (Don't run prettier on NOMENCLATURE.md or docs/*.md.)
- Another Claude session owns image generation: never touch `pipelines/runtime/dispatchImage.ts`, `imageGen/**`, `localModels/matting.ts`, `KoboldCppManagedAdapter.ts`.

## Done means

Copy changed and its tests green (`src/lib/server/lorebooks/ownBook.int.test.ts` at least); three links fixed; the two doc sentences; the comments; every queued row merged with a §25 entry; `docs:build` clean.

## Report (final message)

Each NOMENCLATURE row added/edited/retired with its section and line; docs lines changed (quote the new sentences — they are ★ copy for the owner's batch); tests run; `docs:build` result; stops; **Noticed, not done**.
