# BRIEF — build lane `copy-at-start` — a session on a lorebook that isn't its owner's starts on its own copy

> **WITHDRAWN 2026-11-13, never built.** The cold review showed the premise is wrong: a lorebook shared with the
> player cannot be attached at all (`checkLorebookOwnership`, `sockets/sessions.ts` ~251; the start form sends it
> through `new-world`, a copy, `StartSessionForm.svelte` ~256–268; owner 2026-11-09 "Own: start on; shared: copy");
> pub-wide books do not exist (owner 2026-11-05); a starter is already copied into the notes. The only book a
> session reads without owning is a live plugin-provided book of book kind, already ruled a starter on 2026-11-05
> (`feedback_plugin_books_are_starters`; not fully built: it can still be attached). Also found: seats are made in
> a second transaction after create (~1673) from source member ids; a lorebook cannot be attached after creation
> (`bookChangeRefusal` ~6667); `foldInParent` opens its own transaction. Kept as a record only.

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `docs/lorebooks.md` ~239–262 (Your
session's own notes; Bringing a session's changes into the lorebook; the three verbs, **Merge ‹book› into these
notes**), the header of `src/lib/server/lorebooks/foldInParent.ts` (1–110) and `foldInParent` (~1685 on),
`plans/REPORT-notes-unlisted-2026-11-13.md` ("Written notes", exactly), CLAUDE.md Hard rules, Principles, Standing
rulings, NOMENCLATURE §1, §23, §24, §25, STYLE-GUIDE.md copy rules. Line numbers are from a look on 2026-11-13:
re-read before editing.

Words. A **build lane** is this stream of work. A session's **notes** (its *own book*) is the `lorebooks` row with
`session_id` set. The **attached lorebook** is `sessions.lorebook_id`. A session's notes **sit on top of** the
attached lorebook when both exist (`overlay_of`). Say **copy**, never *clone*, in names and copy.

## Rulings that bind (owner, 2026-11-13)

- Asked whether a session's note may be filed under an entry of the lorebook it reads (a different book), the
  owner answered: "would be better at that point to just go ahead and clone the source book at the start then?"
  The lead proposed: only for a lorebook the session keeps notes on top of because it is not the player's own
  (shared, pub-wide, provided); the session then reads only its notes; it stops following the source; existing
  sessions stay as they are; notes that hold only the copy stay out of the **Session notes** section until the
  session writes something. Owner: **"Let's do it"**.
- Earlier the same day: "We should pull back on how frequently we use own notes. Use the lorebook if it's a
  surfaced one. Use own notes if it's a shared or template"; "My main complaint is now we are listing phantom
  lorebooks everywhere"; notes have no name of their own.
- Standing (★27-10, 2026-11-05): "All sessions have a lorebook, [own book] or overlay. No exceptions so SDK data
  storage API is predictable. No swapping lorebooks. But [own books] can be surfaced and overlays can have their
  parent merged in place." This lane runs that merge at the start for one case; it does not change the ruling.
- **Not in this lane:** a session on the player's **own** lorebook (any write setting, scenes that end by
  themselves or not) starts and writes exactly as today.

## What is true today (look, 2026-11-13; verify)

- `sessions:create` (`src/lib/server/sockets/sessions.ts` ~990–1640): one `db.transaction` inserts the session and
  its notes (`insertOwnBook(..., overlayOf: row.lorebookId)`, ~1595). **A starter lorebook is already copied into
  the notes there** (`bookFromKit`, ~1607, "overlaying nothing") and a starter can never be attached (~270,
  ~994): nothing to build for starters. `creationMode === "new-world"` copies the chosen world into a real
  lorebook named "‹name› (copy)" (~1551–1563): leave it.
- Seats decide where a seat's member lands by `attachedMintable` (`sessions/seats.ts` ~256–269): the attached
  book is the session owner's and not a marked (plugin-provided) book (`plugins/providedMarks.ts` `markedBook`).
  When it is not mintable, members land in the notes. **That same test is this lane's trigger.**
- `foldInParent(db, {sessionId, userId})` (the **Merge** verb; `sockets/ownBooks.ts` ~45) opens its own
  transaction, copies with `copyLorebookTables(t, parent.id, ownId, {keepTurnTies: true})`
  (`lorebooks/tableRegistry.ts`; entry vectors travel), folds notes members into the copies, carries the line and
  date, sets `sessions.lorebook_id` null and `overlay_of` null, and guards by comparing the session's reads before
  and after.
- `writtenNotesOf` (`lorebooks/notesShown.ts`) calls notes written when they hold anything beyond the base
  versions of members a seat points at; a copied book would make every such session's notes read as written.
- `sessions.ts` ~6513 suggests an update can also set `lorebookId` after creation. Check whether a lorebook can
  be attached to a session after it is made.

## The rule to build

When a session is created reading a lorebook that fails the `attachedMintable` test (not the session owner's, or
a marked book), the whole lorebook is copied into the session's notes **with the session or not at all**, and the
session is born reading only its notes: `sessions.lorebook_id` null, the notes' `overlay_of` null, on the line
and at the date the session would have read. Seats made for the session resolve to the copied members (one Nell,
not two). The source lorebook is not written. Sessions that already exist are not touched: no migration, no boot
pass, no setting. From then on the session behaves as any session whose notes are its whole lorebook.

## Build

1. **The copy at create.** Reuse the fold's copy (`copyLorebookTables` and what the fold does for line, date,
   calendar, clock and world values); do not write a second copier. Prefer running it inside the create
   transaction on `tx`. If the fold can only run in its own transaction after the session row commits, **stop and
   report** before building that. Decide (and report) whether to call `foldInParent`'s steps or a smaller path:
   the session is empty at create, so the member folding and the read guard may have nothing to do; keep the
   guard if it costs little. Order it so the seats the create makes point at the copies.
2. **Branches, chapters, later attach.** A branch of an existing session, and a `next-chapter`, keep following
   their source's shape: say what each does today when the source sits on top of a lorebook that isn't the
   owner's, and change nothing unless a new session would otherwise be born on top of such a book through
   `sessions:create`; then it copies as above. If a lorebook can be attached after creation, **do not build
   that path**: report it under Noticed with what it does.
3. **The record of where it came from** (🚧 names per §24; stored on the notes row's `extra_json`, no column):
   the source's uuid and its name at the time, and what the listing rule below needs. P1 ("every automatic action
   shows its cause"):
   - the start form, under the lorebook picker when the chosen book would be copied: 🚧 *This session plays on
     its own copy of ‹book›. Later changes to ‹book› won't reach it.*
   - the session's details where it shows its lorebook: 🚧 *Started on a copy of ‹book›.*
   Find the two components; these are the only UI additions. Both strings are open ★.
4. **Listing.** Notes that hold only the copy are not *written*: `writtenNotesOf` leaves them out until the
   session writes something (an entry, place, day, scene, link, value, change, a member no seat points at, a
   person's in-place edit), by a rule decided from stored facts (the record in 3 may carry what you need, e.g. a
   stamp; say exactly which rule you built). Prove it through the real `sessions:create` path, as
   `notesShown.realCreate.int.test.ts` does.
5. **What a member loses, said in the docs.** A session on a shared lorebook no longer keeps changes "until the
   lorebook's owner applies them", has no **This session only** card against that book and no **Share to ‹book›**.
   Update `docs/lorebooks.md` and `docs/sessions.md` where they describe a session on a lorebook you don't own
   (the sentences stay true for sessions made before this change: say so in one clause). NOMENCLATURE rows and §25.
6. **Measure.** In a test or a script, time the create of a session on a shared lorebook of about 2,000 entries
   with vectors, and report the number. No threshold; do not optimise.

## Files owned

`src/lib/server/sockets/sessions.ts` (**the create handler only**; another session works near this file: keep the
diff small and inside `sessions:create`), `src/lib/server/lorebooks/foldInParent.ts` (to expose or reuse its
steps), `lorebooks/ownBook.ts` and `lorebooks/notesShown.ts` (the rule in 4), `src/lib/shared/lorebooks/
sessionNotes.ts` (the record's type and the sentences), the start form's lorebook picker component and the session
details component (one line each), their tests, new tests, `docs/lorebooks.md`, `docs/sessions.md`,
`NOMENCLATURE.md`. **Not** `db/schema.ts`, `sockets/entries.ts`, `Layout.svelte`, `startup/index.ts`,
`runtime/dispatch.ts`, `lorebooks/tableRegistry.ts` (read only; if the copy needs a change there, stop and
report), any SDK file.

## Out of scope

Sessions on the player's own lorebook; where a session writes; the children build (a note filed under an entry);
`new-world`; attaching a lorebook after creation; converting existing sessions; any migration, boot pass, setting,
flag or new socket event; following the source's later changes; removing the overlay machinery.

## Stop and ask when

The copy cannot run with the session in one transaction; seats cannot be made to point at the copies; the listing
rule cannot be decided from stored facts without a column; a marked book turns out to be something a person edits
as their own; a fix needs a file outside the owned list.

## Done means

Tests (real `sessions:create`, through the socket handler): a session started on a lorebook shared with the
player has `lorebook_id` null, notes with `overlay_of` null holding every entry, place, cast member, line, calendar
and clock of the source, and reads what a session sitting on top of that book reads at the same line and date
(compare the two reads); the source's rows are byte-identical afterwards; a seat for a card the source has a
member for points at the copy and no second member exists; a later edit of the source does not reach the session;
a session on the player's own lorebook is created exactly as before (attached, `overlay_of` set, nothing copied);
a starter start is unchanged; a failed copy leaves no session row; such notes are not written until the session
writes one entry, then are; the two sentences show where specified (DOM tests). Existing suites of the touched
areas pass, incl. `lorebooks/notesShown*.int`, `sockets/lorebooks.notesUnlisted.int`, the fold's tests and the
session-create tests.
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean;
`NODE_OPTIONS=--max-old-space-size=12288 npm run check` no new errors. Tests only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > log 2>&1"`
from the repo root, one run at a time; another session also runs tests and SDK builds on this checkout: before
each run check `ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` and wait a few minutes at most
(never `pgrep -f "vitest run"` in a loop: it matches itself). An int test that opens a DB inside an `it` takes a
60 s timeout. No `npm run sdk:build`. Inside a transaction use only `tx`. Comments state the rule, not the story.
At most two workers at once.

Verbatim for every worker brief:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `kill -9`.

## Report

**Return the full report as your final message** (the lead saves it as
`plans/REPORT-copy-at-start-2026-11-13.md`): the rule as built; which path does the copy and why; what branches,
next chapters and a later attach do; the record's name and shape; the listing rule exactly; copy verbatim; the
measured time; changed files; tests and results; open ★; **Noticed, not done**. Say plainly that nothing was
looked at in a running app.
