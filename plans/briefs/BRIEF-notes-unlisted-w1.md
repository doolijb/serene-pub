# BRIEF — notes-unlisted worker 1 — server: a session's notes are never listed, counted or named as a lorebook

Supervisor: lane `notes-unlisted` (`plans/briefs/BRIEF-notes-unlisted.md`). Report to
`plans/REPORT-notes-unlisted-w1.md`. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane needs no `sdk:build` at all: do not run one.)

## Words

A session's **notes** (code: its **own book**; retired word *phantom*, never reintroduce it) is the `lorebooks` row
with `session_id` set. A **surfaced book** (`surfaced_from_session_id`) is a real lorebook: never treat it as notes.
A **lorebook** in copy means a real book only (`session_id IS NULL`).

## Owner rulings (2026-11-13) this work applies

- "My main complaint is now we are listing phantom lorebooks everywhere."
- "Phantom lorebooks shouldn't get a name, that are properties of a session until the user decides to surface it."
  So a notes book is **never shown by its stored `lorebooks.name`**. Where it must be named it is *‹session's current
  name›'s notes*. The stored column is left as it is: no migration, no boot pass, no write to `lorebooks.name`.
- The Lorebooks view's **Session notes** section: "Only notes with something in them, collapsed".

## Already built by the supervisor (build against these exactly; do not edit them)

- `src/lib/shared/lorebooks/sessionNotes.ts`: `sessionNotesName(sessionName: string | null | undefined): string` →
  `"‹trimmed name›'s notes"`, else `"Session notes"`.
- `src/lib/shared/sockets/types.ts`:
  - `Sockets.Lorebooks.SessionNotes.Response["books"][number].notesWritten: boolean` (new, required).
  - `Sockets.Lorebooks.BindingsForCharacter.Response["members"][number].ownBookSessionId: number | null` (new,
    required); `lorebookName` for a notes member is `sessionNotesName(<session's current name>)`.
- `src/lib/shared/characters/characterRows.ts` `CharacterRowReach`: new `notesCount?: number`, and the doc of
  `lorebookCount` / `lorebook` now says the rule below. Read it.

## Files owned (the only files you may edit or create)

- NEW `src/lib/server/lorebooks/notesShown.ts` and NEW `src/lib/server/lorebooks/notesShown.int.test.ts`.
- `src/lib/server/sockets/lorebooks.ts` — ONLY `buildLorebooksList`'s `sessionNotes` branch (~l.540–590), the
  `lorebooks:bindingsForCharacter` handler (~l.1950–2045) and the queue label in `queueImportedBook` / its callers in
  this file (~l.5380–5400) if a notes book can reach it. Nothing else in this 5,800-line file.
- `src/lib/server/sockets/import.ts` — ONLY `findLorebookId` (~l.848–862).
- `src/lib/server/sockets/tags.ts` — ONLY the related lorebooks read (~l.246–266).
- `src/lib/server/sockets/narrativeGraph.ts` — ONLY the `lorebookLabel: lorebook.name` line (~l.1092) and the queue
  labels in `afterCastTagRewrite` (~l.3576–3590), plus the minimum select change those need.
- `src/lib/server/sockets/scenes.ts` — ONLY the two `lorebookLabel: lorebook.name` lines (~l.1670, ~l.1916) plus the
  minimum select change they need.
- `src/lib/server/embedding/indexingActivity.ts` (the `lorebookLabel: book.name`, ~l.130).
- `src/lib/server/notifications/activity.ts` (read it; change only if it names a book itself rather than using
  `activity.lorebookLabel`).
- `src/lib/server/admin/castLiftNotes.ts` (its `lorebookName`, ~l.32).
- `src/lib/server/sessions/sweptRelationships.ts` — ONLY the `lorebookLabel: book?.name ?? "Lorebook"` line (~l.160)
  plus the minimum select change it needs.
- `src/lib/server/rulesets/pubRulesets.ts` — ONLY `playedBy` (~l.513–518).
- `src/lib/server/rulesets/versions.ts` — read only, unless its refusal sentence calls a notes book a lorebook; then
  reword that sentence only and say so. Do NOT change its count.
- `src/lib/server/cast/characterRows.ts` (`buildRows`'s `reachOfBooks`, ~l.455–510, and its two calls ~l.651, ~l.689).
- Tests of these: `src/lib/server/cast/characterRows.int.test.ts`, `src/lib/server/rulesets/pubRulesets.int.test.ts`,
  `src/lib/server/sockets/lorebooks.memberName.int.test.ts`, and NEW `src/lib/server/sockets/lorebooks.notesUnlisted.int.test.ts`.

**Never touch** (another session's lanes are editing them right now): `src/lib/server/sockets/entries.ts`,
`src/lib/server/sockets/sessions.ts`, `src/lib/server/db/schema.ts`, `Layout.svelte`, `src/lib/server/startup/index.ts`,
`src/lib/server/utils/llmQueue.ts`, `runtime/dispatch.ts`, `src/lib/server/plugins/*`, `src/lib/server/media/*`, any file
under `../serene-pub-sdk`, `src/lib/shared/sockets/types.ts`, `sessionNotes.ts`, any client file. No migration.

## Files readable

`docs/lorebooks.md` ~l.237–270 (Your session's own notes), `src/lib/server/lorebooks/ownBook.ts`,
`src/lib/server/sessions/seats.ts` (`seatCast`, `seatBookOf` ~l.240–300, how a seat mints a member into notes),
`src/lib/server/db/schema.ts` (read only), `src/lib/server/sockets/sessions.seatCast.int.test.ts` (fixtures),
`src/lib/server/cast/characterRows.int.test.ts` (fixtures).

## Build

### 1. `notesShown.ts` (new module; header comment: what it is, why, what it owns, what it does not)

- 🚧 `bookShownName(db: Db, book: { name: string; sessionId: number | null }): Promise<string>` — a real book's
  `name`; a notes book's `sessionNotesName(<sessions.name now>)`. One query only when `sessionId` is set.
- 🚧 `bookShownNames(db, books: readonly { id: number; name: string; sessionId: number | null }[]): Promise<Map<number, string>>`
  — the same, batched (one `inArray` query on `sessions`), for lists.
- 🚧 `writtenNotesOf(db, lorebookIds: readonly number[]): Promise<Set<number>>` — the ids whose notes are **written**.
  One grouped query per table over all ids (`inArray` / `EXISTS`), never a query per book. Returns an empty set for [].

**The rule (cold review, binding — "list notes unless they are empty"):** a notes book is *unwritten* (absent from the
set) only when it holds nothing beyond seated characters' members' base versions. It is **written** when ANY of:

- a `lorebook_entries` row in it (any entry type: places and history days are entries; archived ones count too);
- an `entry_amendments` or `cast_amendments` row with its `lorebook_id` (held changes and dated changes);
- a `narrative_relationships` row with its `lorebook_id` (links, relationships);
- a `scenes` row with its `lorebook_id`;
- a world value kept in it: find where the notes keep world-scope values (candidates: `lorebooks.annex`,
  `attribute_values`, place values — read `docs/lorebooks.md` "Your session's own notes" and the code that writes
  them) and count a non-empty one;
- `lorebooks.extra_json.ruleFed` present;
- its story clock set (any `story_clock_*` column not null);
- a cast member (`lorebook_bindings` row in it) that **no seat points at** (`seats.cast_member_id` is the only stored
  fact; there is no origin column);
- a cast member with any **non-base** `character_versions` row (find in `seats.ts` / the minting code what the base
  version a seat mints looks like; anything beyond it counts).

Then go through **every** table that references `lorebooks.id` (`bindingMergeLogs bindingSuggestions castAmendments
castPresences characters characterVersions dismissedDuplicatePairs entryAmendments lorebookBindings lorebookBranches
lorebookEntries lorebookShares lorebookTags loreImprints loreSources narrativeRelationships scenes sessions`) and
decide for each: does seating a character write it into notes? If not, a row in it means the session (or a person)
wrote something there, so it counts as written — unless it is plainly bookkeeping (e.g. `sessions.lorebook_id`,
`lorebook_tags`) — say which you counted and why, one line each, in your report. If the rule cannot be decided from
stored facts, stop and report rather than guess.

Tests (`notesShown.int.test.ts`, open the DB per file, 60 s timeouts on DB tests): seat members land in notes only
when the attached book is not the owner's own or is a marked book (`seats.ts` ~l.256–269), so fixtures use a
**notes-only session** (no attached lorebook) or a session reading **someone else's** book. Cases: notes with only
seated characters' members → unwritten; then each of: an entry, a place, a history day, a scene with a summary, a held
change (amendment), a link, a set clock, a cast member no seat points at → written. `bookShownName` after a session
rename returns the new name's notes; a real book returns its name; a surfaced book returns its own name.

### 2. `lorebooks:sessionNotes` (`buildLorebooksList(userId, "sessionNotes")`)

Every row is still sent (the Lorebooks view opens only books it knows, so a dropped row could not be opened). Add
`notesWritten: writtenSet.has(row.id)` to each row. Nothing else in the response changes. Test in
`lorebooks.notesUnlisted.int.test.ts`: an unwritten notes book is in `books` with `notesWritten: false`; a written one
with `true`; `sessionName` is the session's current name after a rename.

### 3. `lorebooks:bindingsForCharacter`

Select `sessionId` with the binding's lorebook. `lorebooks` (the export dialog's *Include a lorebook* candidates):
**leave notes books out**. `members`: **keep** notes members (the card editor's sentence names them: P1, an automatic
effect shows its cause), each with `ownBookSessionId: <the notes' session id>` and `lorebookName:
sessionNotesName(<session's current name>)` (use `bookShownNames`); real books get `ownBookSessionId: null` and their
own name. Test: a card seated in a notes-only session and also in a real lorebook → `lorebooks` holds only the real
book; `members` holds both, the notes one with its session id and *‹session›'s notes*, renamed session → new name.

Then find out and **report** what the card editor's "update to card vN" offer (`CardUpdateOffer`, fed by
`behindCard`) did for a notes member, and where that member is updated from once the cast line drops notes offers:
the cast member page inside the notes has its own offer (`src/lib/client/lorebooks/cast/CastMemberForm.svelte`
~l.1627, opened from the session's cast panel or a message's name). Confirm by reading; say file:line.

### 4. Names in Activity and queues

Each `lorebookLabel:` / queue label listed under Files owned uses `bookShownName` (select `sessionId` beside `name`;
the session's name is read at the time the activity starts). `castLiftNotes.ts`'s `lorebookName` likewise
(`bookShownNames` for the batch). `notifications/activity.ts` composes from `activity.lorebookLabel`: confirm and
leave it unless it reads a name itself. Test at least two sites (e.g. `indexingActivity` and `castLiftNotes`) name a
notes book *‹new session name›'s notes* after a rename; if a site has no reachable test seam, say so.

### 5. Importer — `findLorebookId`

The match by name never matches a notes book: add `isNull(schema.lorebooks.sessionId)` to the `findFirst`. Test if an
import test seam exists (look for an existing `import*.int.test.ts`); else state why not and keep the change one line.

### 6. Tags — related data

The tag's related lorebooks leave notes books out (select `sessionId`, filter `sessionId == null`).

### 7. Admin › Rulesets *Played by* — `playedBy`

The lorebook count is real lorebooks only (`isNull(lorebooks.sessionId)`); a session counts once (in `sessions`).
Test in `pubRulesets.int.test.ts`: one session with its notes on the ruleset → `{ sessions: 1, lorebooks: 0 }`.

### 8. Characters view — `cast/characterRows.ts`

Card rows (the `reachOfBooks(members.map(...))` call ~l.651): `lorebookCount` counts **real lorebooks only**;
`notesCount` = distinct notes books holding a member; `lorebook` = the one real book when `lorebookCount === 1`, else
the one notes book when `lorebookCount === 0 && notesCount === 1`, else null. Member rows (~l.689): **unchanged**
(`lorebookCount` counts their own book, notes included; `notesCount: 0`), so a card-less notes member listed with
**In my stories** keeps its *In ‹session›'s notes* line and its door. Tests in `characterRows.int.test.ts`: card in one
real book + one notes → count 1, notesCount 1, lorebook the real one; card only in one notes → count 0, notesCount 1,
lorebook the notes (sessionId set, sessionName current); card only in two sessions' notes → count 0, notesCount 2,
lorebook null; update existing expectations that relied on notes counting.

## Rules quoted (CLAUDE.md, binding)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "Never `kill -9` the dev server: PGlite's WAL corrupts."
- P2: "A module owns its data and every write to it." This work only reads.
- NOMENCLATURE R3: "Qualify, never abbreviate to the bare noun." §24: "Grep for it first — across `src`, the SDK, and
  the schema." The new names above were grepped by the supervisor; add no other exported name without listing it.
- "It is a **session**, never a *chat*." Comments state the rule, not the story.

## Tests — how to run (binding)

Only inside a capped scope, from the repo root, with full paths, one run at a time:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > /home/jody/github/serene-pub/plans/notes-unlisted-w1-<n>.log 2>&1"`

Before each run: `ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep`. If any vitest is running (another
worker of this lane or another session), wait a few minutes and check again; never loop on `pgrep -f`. Never pipe
vitest into `head`. A failure in a file you did not touch: note it and move on. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"` — report errors in your
files only. `npx prettier --check <each file you edited>`.

## Done means

`notesShown.int.test.ts`, `lorebooks.notesUnlisted.int.test.ts`, `characterRows.int.test.ts`,
`pubRulesets.int.test.ts`, `lorebooks.memberName.int.test.ts`, `lorebooks.memberShownVersion.int.test.ts` pass; tsc
clean in your files; prettier clean.

## Stop and ask (in your report, then stop that item) when

A notes member's only path to something would be removed; the "written" rule cannot be decided from stored facts; a
fix needs a file outside Files owned; you would add a name, setting, event, flag or migration not listed here.

## Report (`plans/REPORT-notes-unlisted-w1.md`)

Changed files with line ranges; the written rule exactly as built, table by table with the one-line reason; where a
notes member is updated from now (file:line); every copy string you wrote, verbatim; tests run with counts and the log
paths; tsc/prettier results; **Noticed, not done** (e.g. other places that show a notes book's stored name).
