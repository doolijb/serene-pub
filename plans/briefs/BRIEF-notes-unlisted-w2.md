# BRIEF — notes-unlisted worker 2 — client: Session notes drawn only when written, collapsed; notes never named or counted as a lorebook

Supervisor: lane `notes-unlisted` (`plans/briefs/BRIEF-notes-unlisted.md`). Report to
`plans/REPORT-notes-unlisted-w2.md`. Repo: `/home/jody/github/serene-pub`. Use absolute paths. Worker 1 builds the
server half at the same time against the same wire types; you build the client against those types and never edit
server files.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane needs no `sdk:build` at all: do not run one.)

## Words

A session's **notes** (code: its **own book**; retired word *phantom*, never reintroduce it) is the `lorebooks` row
with `session_id` set; on the wire `sessionId != null`. A **surfaced book** is a real lorebook: never treat it as
notes. A **lorebook** in copy means a real book only.

## Owner rulings (2026-11-13) this work applies

- "My main complaint is now we are listing phantom lorebooks everywhere."
- "Phantom lorebooks shouldn't get a name, that are properties of a session until the user decides to surface it."
  So a notes book is **never shown by its stored `name`**; where it must be named it is *‹session's current name›'s
  notes*, via the helper below.
- The Lorebooks view's **Session notes** section: "Only notes with something in them, collapsed" — name each row by
  the session's current name, start the section collapsed.
- docs: notes "are never in a picker".
- Owner 2026-11-05: "the cast panel and a message's name open the cast member page in its book" — so a notes book
  must stay openable by id even when its row is not drawn.

## Already built by the supervisor (build against these exactly; do not edit them)

- `src/lib/shared/lorebooks/sessionNotes.ts`: `sessionNotesName(sessionName: string | null | undefined): string` →
  `"‹trimmed name›'s notes"`, else `"Session notes"` (= `SESSION_NOTES_LABEL`).
- `src/lib/shared/sockets/types.ts`:
  - `Sockets.Lorebooks.SessionNotes.Response["books"][number]` has `sessionId`, `sessionName` (the session's current
    name, may be null) and new `notesWritten: boolean`. Every notes row is sent; only `notesWritten` rows are drawn.
  - `Sockets.Lorebooks.BindingsForCharacter.Response`: `lorebooks` never holds notes (server); `members` keeps notes
    members with new `ownBookSessionId: number | null` (set = a notes member) and `lorebookName` already
    *‹session›'s notes* for them.
- `src/lib/shared/characters/characterRows.ts` `CharacterRowReach`: card rows' `lorebookCount` counts real lorebooks
  only; new `notesCount?: number` (card rows: distinct sessions' notes holding a member; absent/0 on member rows);
  `lorebook` is the one real book when `lorebookCount === 1`, else (card row) the one notes book when
  `lorebookCount === 0 && notesCount === 1`. Member rows are unchanged (their own book counts, notes included).

## Files owned (the only files you may edit or create)

- `src/lib/client/lorebooks/LorebooksWorkspace.svelte` — ONLY: the Session notes section (~l.3169–3194) and its
  filter `filteredSessionNotes` (~l.1577–1585); the opened book's title where it reads `book.name` (~l.2676–2681
  `PanelNavHeader` title/actionsLabel, the Duplicate prefill ~l.2978, `bookName={book.name}` passed to `BookSettings`
  ~l.2948, the sessionNotesMenu's Book settings title ~l.1426–1440 only if needed). Nothing else in this 3,300-line
  file.
- `src/lib/client/components/listItems/LorebookListItem.svelte` — the notes row's title (~l.121–146).
- `src/lib/client/lorebooks/BookSettings.svelte` — header (~l.283) and passing what `EditLorebookForm` needs.
- `src/lib/client/components/lorebookForms/EditLorebookForm.svelte` — for a notes book only: the **Name** field
  (~l.371) is not drawn, and the cover's `subject` (~l.367) uses the helper. A real book is unchanged.
- `src/lib/client/components/characterForms/CastLine.svelte`, `castBannerWords.ts`.
- `src/lib/client/components/modals/CharacterExportModal.svelte` (read; change only if it needs to).
- `src/lib/client/admin/sections/data/CastUpgradeCard.svelte` (read; it should draw the server's label as is).
- `src/lib/client/components/sidebars/characterRowsView.ts`.
- Tests: `castBannerWords.test.ts`, `castLine.dom.test.svelte.ts`, `castEditNote.dom.test.svelte.ts`,
  `castLineOffer.dom.test.svelte.ts`, `characterRowsView.test.ts`, `lorebooksWorkspace.noReadingVerbs.dom.test.ts`,
  `lorebookRowFitLine.dom.test.ts` (fixtures only), and NEW `src/lib/client/lorebooks/lorebooksWorkspace.sessionNotes.dom.test.ts`.

**Never touch:** any server file, `src/lib/shared/**`, `Layout.svelte`, `CharacterViewPanel.svelte`,
`CharacterForm.svelte`, `CastMemberForm.svelte`, any file under `../serene-pub-sdk`, `STYLE-GUIDE.md`, docs.

## Build

### 1. Session notes section (LorebooksWorkspace)

- Draw only rows with `notesWritten`. Unwritten rows stay in `sessionNotes` (and so in `knownBooks`): a route to their
  id still opens the book. Never filter `sessionNotes` itself.
- The section starts **collapsed** on every load. Its heading is a disclosure: an `h3` holding a
  `<button type="button" aria-expanded aria-controls>` with a `ChevronRight` (collapsed) / `ChevronDown` (open) glyph,
  the words `SESSION_NOTES_LABEL`, and the count of drawn rows as muted trailing text — the **folder header** recipe of
  STYLE-GUIDE §6.4 at `ListGroupLabel`'s size (quoted below). Inline in the workspace; no new component. Expanded state
  is component `$state` only: no server write, no `localStorage` (the supervisor decided; it is listed as a ★).
- Search (`bookSearch`): matches the row's **session's current name** (`sessionName`) and the description, never the
  stored `name`. While the search is non-empty and matches a drawn row, the section shows **open** (without changing
  the remembered collapsed state), so search finds rows inside it and opens it. Unwritten rows never show, even under
  search.
- The row's title (`LorebookListItem`, when `sessionNotesOf` is set): the session's current name,
  `sessionName?.trim() || "Untitled session"` — never `lorebook.name`. Add what `sessionNotesOf` needs (it is the row
  itself at the call site).

### 2. The opened notes book's title

Wherever the opened book is named by `book.name` in the owned lines: for a notes book (`bookIsSessionNotes`) use
`sessionNotesName(<that row's sessionName>)`; a real book unchanged. Book settings header: `Book settings ·
‹sessionNotesName(...)›`. The Duplicate prefill for a notes book uses `sessionNotesName(sessionName)` where the stored
name was. Do **not** change whether a notes book can be deleted or duplicated from Book settings; only its words.
The notes menu's Book settings title says "Name, cover, rules, calendar and clock": for notes, since Name is no longer
drawn, use "Cover, rules, calendar and clock" (🚧 copy, the supervisor lists it as a ★).

### 3. The card editor's cast line (`castBannerWords.ts`, `CastLine.svelte`)

Add `ownBookSessionId?: number | null` to `CastBannerMember`.
- `castBannerWords` (the lead *In N lorebooks:*, *Represents N cast members in N lorebooks.*, the retells line) and the
  CastLine's book links and `CardUpdateOffer`s: **leave notes members out** (`ownBookSessionId != null`). A card whose
  only members are in notes draws no cast line.
- `castEditParts` / `castEditWords` (the sentence *Editing this changes ‹name› in ‹book› …*): **keep** notes members
  (P1: an automatic effect shows its cause); their book part shows the server's `lorebookName` (*‹session›'s notes*),
  and opens that member as today.
- Tests: `castBannerWords.test.ts` — notes members don't count in lead/represents/retells; the editing sentence still
  names *Rainy night's notes*. `castLine.dom.test.svelte.ts` / `castLineOffer.dom.test.svelte.ts` — a notes member
  behind its card draws no update offer and no link on the line.

### 4. Characters view reach line (`characterRowsView.ts` `reachLine`)

- `lorebookCount === 0`: `notesCount` 0/absent → *Not in a lorebook yet*; `lorebook?.sessionId != null` → today's
  notes line; `notesCount >= 2` → 🚧 `In the notes of ${n} sessions`.
- `lorebookCount === 1`: as today (a member row in notes has `lorebook.sessionId` set → the notes line).
- The notes line: `In ${sessionNotesName(lorebook.sessionName)}` when the name is set (identical words to today:
  *In Rainy night's notes*), else today's *In a session's notes*.
- `≥ 2`: *In N lorebooks*, as today. Tests in `characterRowsView.test.ts` for each case.

### 5. Export dialog, Admin › Data

`CharacterExportModal` reads `lorebooks`, which the server now sends without notes: confirm no client change is needed.
`CastUpgradeCard` draws the server's `lorebookName` (worker 1 makes it *‹session›'s notes*): confirm; change nothing
unless it builds its own name.

### 6. Reachability (report only)

Find and report (file:line) how a person reaches an unwritten session's notes now: the session's details / edit form /
cast panel / a message's name. Do not add a path.

### DOM test (`lorebooksWorkspace.sessionNotes.dom.test.ts`)

Model it on `lorebooksWorkspace.noReadingVerbs.dom.test.ts`. Cases: written rows draw under a collapsed heading
(`aria-expanded="false"`, rows absent) and open on click; an unwritten row never draws; the row title is the current
`sessionName`, not the stored `name`; a search for the session name shows the section open with the matching row; a
route to an unwritten notes book's id opens it (the book title reads *‹session›'s notes*).

## Rules quoted (binding)

- STYLE-GUIDE §6.4: "A list that can be grouped (character folders) groups with a **folder header**: a 32px row with a
  `Folder`/`FolderOpen` glyph, a 13px medium name, a 12px muted count … The header is a `<button aria-expanded>` that
  collapses the group … A filter that empties a group hides its header rather than showing an empty one." and "A
  **group label** is `ListGroupLabel` … an `h3` at 12px muted, `px-3 pt-4 pb-1`, sentence case, with optional trailing
  muted text (a count when passed …)". Use the group label's look with the folder header's button and chevron.
- STYLE-GUIDE §1.8: "Sentence case, plain verbs." §1.10: muted text is surface/ink, never filled primary.
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
  "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." "views register
  listeners for local state and never call `toaster`." "Browser code runs on plain-http LAN addresses and phones: no
  `crypto.randomUUID`, no `navigator.clipboard`."
- "It is a **session**, never a *chat*." Comments state the rule, not the story. NOMENCLATURE R3: qualify, never the
  bare noun. Add no exported name beyond `ownBookSessionId` on `CastBannerMember` without listing it.

## Tests — how to run (binding)

Only inside a capped scope, from the repo root, with full paths, one run at a time:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > /home/jody/github/serene-pub/plans/notes-unlisted-w2-<n>.log 2>&1"`

Before each run: `ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep`. If any vitest is running (worker 1
of this lane or another session), wait a few minutes and check again; never loop on `pgrep -f`. Never pipe vitest into
`head`. A failing `assert` on a happy-dom element has OOM-killed VS Code: keep DOM assertions on small strings. A
failure in a file you did not touch: note it and move on. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"` and
`npx prettier --check <each file you edited>`.

## Done means

The test files listed under Files owned pass; tsc clean in your files; prettier clean.

## Stop and ask (in your report, then stop that item) when

A notes member's only path to something would be removed; a fix needs a file outside Files owned; you would add a
name, setting, event or flag not listed here; a copy choice not given here.

## Report (`plans/REPORT-notes-unlisted-w2.md`)

Changed files with line ranges; every copy string you wrote or changed, verbatim; the reachability path (file:line);
tests run with counts and log paths; tsc/prettier results; **Noticed, not done** (other client places that show a
notes book's stored name or count it as a lorebook).
