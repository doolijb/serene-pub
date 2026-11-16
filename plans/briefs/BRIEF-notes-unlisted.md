# BRIEF — build lane `notes-unlisted` — a session's notes are never listed, counted or named as a lorebook

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `docs/lorebooks.md` ~237–260 (Your
session's own notes), `src/lib/shared/lorebooks/sessionNotes.ts`, CLAUDE.md Hard rules, Principles, Standing
rulings, NOMENCLATURE §1, §23, §24, §25, STYLE-GUIDE.md copy rules. Line numbers below are from a survey on
2026-11-13: re-read before editing.

Words. A **build lane** is this stream of work. A session's **notes** (its *own book*; older code says *phantom
lorebook*) is the `lorebooks` row with `session_id` set. A **surfaced book** (`surfaced_from_session_id`) is a real
lorebook and is not touched here.

## Rulings that bind (owner, 2026-11-13)

- "My main complaint is now we are listing phantom lorebooks everywhere."
- "Phantom lorebooks shouldn't get a name, that are properties of a season [session] until the user decides to
  surface it." Lead's reading: a notes book is never shown by its stored `lorebooks.name`; where it must be named it
  is *‹session's current name›'s notes*; it gets a name of its own only through **Share as a lorebook**. The stored
  column is left as it is (no migration, no boot pass).
- Fix all four leaks: character pages and export; counts; names in Activity; the importer's name match.
- The Lorebooks view's **Session notes** section: "Only notes with something in them, collapsed" — list a
  session's notes only when they hold something the session wrote (the cast members made for seated characters do
  not count), name each row by the session's current name, start the section collapsed.
- Standing (docs): notes "are never in a picker".
- **Not ruled and not in this lane:** where a session writes (own notes or the lorebook). Do not touch routing.

## What is true today (survey, 2026-11-13)

- Stored name = the session's name at creation or "Untitled session" (`lorebooks/ownBook.ts` ~64, ~212;
  `sockets/sessions.ts` ~1595–1610); never updated on rename. No display helper; `SESSION_NOTES_LABEL` = "Session
  notes" (`shared/lorebooks/sessionNotes.ts` ~17); the Characters reach line says *In ‹session›'s notes*
  (`client/components/sidebars/characterRowsView.ts` ~16–19).
- Since 2026-11-12 every seated character has a cast member in its session's notes (`sessions/seats.ts`), so any
  cast-membership read without a notes filter lists notes books.
- Already filtered (leave alone): `lorebooks:list`, jump, applet library, starter kits, attach, start/edit/
  summarize pickers.

## Corrections from the cold review (2026-11-13) — these override anything below that disagrees

1. **The server never drops a notes row.** The Lorebooks view opens only books it knows
   (`LorebooksWorkspace.svelte` ~227, ~316, ~2309), and the cast panel, a message's name (owner 2026-11-05: "the
   cast panel and a message's name open the cast member page in its book") and card-less rows open the member
   page inside the notes; the card-update offer that stays is on that page (`CastMemberForm.svelte` ~1627). So
   `lorebooks:sessionNotes` keeps sending every row and adds a flag (🚧 name per §24) saying whether the notes hold
   anything; **only the section's drawing hides unflagged rows**. Test: a hidden notes book still opens by id.
2. **The rule is inverted: list notes unless they are empty.** Empty means nothing beyond seated members' base
   versions: no entry, amendment, relationship or link, world value, scene, `extra_json.ruleFed`, non-base cast
   version, set clock, and no cast member that no seat points at (`seats.cast_member_id` is the only stored fact;
   there is no origin column). Seat members land in notes only when the attached book is not the owner's own or
   is a marked book (`seats.ts` ~256–269): fixtures use a notes-only session or someone else's book.
3. **The card editor's sentence keeps notes members** (P1: an automatic effect shows its cause): "Editing this
   changes ‹name› in ‹book› …" (`castBannerWords.ts` ~190–247) still counts members that follow the card, named
   with the helper (🚧 *in ‹session›'s notes*). Notes are left out only of the lead line, the lorebook count, the
   offers on the cast line and the export dialog. Carry the copy as an open ★.
4. **More stored-name places, now owned:** `BookSettings.svelte` (header ~283 uses the helper; for a notes book
   the **Name** field of `EditLorebookForm.svelte` ~23, ~371 is not drawn; the Duplicate prefill
   `LorebooksWorkspace.svelte` ~2978 uses the session's current name), `sessions/sweptRelationships.ts` ~160 (an
   Activity label), the vectorization queue labels in `narrativeGraph.ts` ~3581 and `sockets/lorebooks.ts` ~5391.
   The section's search matches the session's current name (~1577). `sockets/entries.ts` ~555 stays untouched:
   list it under Noticed. **Do not change** whether a notes book can be deleted from Book settings; report what
   `lorebooks:delete` does for one under Noticed.
5. **Characters view:** filter notes only out of the card rows' count (`characterRows.ts` ~651 call), never out
   of member rows (~689), so card-less notes members listed with **In my stories** keep their line and door. A
   card that is only in the notes of two or more sessions reads 🚧 *In the notes of N sessions* (open ★), never
   *Not in a lorebook yet*.

## Build

1. **One label helper** (shared, beside `SESSION_NOTES_LABEL`; 🚧 name per §24): given a session's current name
   (or none) → *‹name›'s notes*, else *Session notes*. Every place below that names a notes book uses it, with the
   session's **current** name read at the time (a server join on `sessions.name`), never `lorebooks.name`.
2. **Character pages and export** — `lorebooks:bindingsForCharacter` (`sockets/lorebooks.ts` ~1978–2030): notes
   books are left out of the list, the count, the "update to card vN" offers and the export dialog's *Include a
   lorebook* (`CastLine.svelte`, `castBannerWords.ts`, `CharacterViewPanel.svelte` ~356, `CharacterForm.svelte`
   ~2057, `CharacterExportModal.svelte` ~122). Check what the card-update offer did for a notes member and say in
   the report where that member is now updated from (it must not become unreachable: if the offer was the only
   way, stop and report).
3. **Counts** — Characters view *In N lorebooks* counts real lorebooks only, keeping the single *In ‹session›'s
   notes* line where it applies today (`cast/characterRows.ts` ~296, ~435–443, ~492–510). Admin › Rulesets *Played
   by* does not count a notes book as a lorebook (`rulesets/pubRulesets.ts` ~513–518); leave `rulesets/versions.ts`
   ~61 as it is unless its refusal sentence names a notes book as a lorebook, then reword only.
4. **Names** — Activity rows and notifications (`embedding/indexingActivity.ts` ~130, `sockets/narrativeGraph.ts`
   ~1092, `sockets/scenes.ts` ~1670, ~1916; `notifications/activity.ts`), Admin › Data cast-upgrade card
   (`server/admin/castLiftNotes.ts`, `CastUpgradeCard.svelte` ~78), the opened notes book's title in the Lorebooks
   view (`LorebooksWorkspace.svelte` ~316, ~1426–1440, ~1515, ~2676), tag related data (`sockets/tags.ts` ~246–266:
   leave notes out), and the `session-entries` widget data's `bookName` **only if** it can be done without editing
   `sockets/entries.ts` (another lane holds that file: otherwise list it under Noticed).
5. **Importer** — `sockets/import.ts` ~850–861: the match by name never matches a notes book.
6. **Session notes section** — server `sockets/lorebooks.ts` ~528–568: list a session's notes only when they hold
   something the session wrote: an entry, a place, a history day, a scene summary, a held change, or a cast member
   that is not merely a seat's (find the fact that tells a seat-made member from one the story made; if none
   exists, count cast members that have any story-written version or lore, and say which rule you built). Client
   `LorebooksWorkspace.svelte` ~3169–3194, `LorebookListItem.svelte` ~121–146: the row's title is the session's
   current name, the section starts collapsed and remembers nothing server-side (a per-viewer `localStorage`
   convenience in try/catch is fine), search still finds rows inside it and opens it. Notes left out stay
   reachable from their session (confirm the session's details menu path; `docs/genre-dungeon-crawler.md` ~243
   sends players to this section to compile history: make sure a Dungeon Crawler session's notes with history
   still list, and fix the doc sentence only if it becomes wrong).
7. **Docs and ledgers in the same change:** `docs/lorebooks.md` (Your session's own notes), `docs/characters.md`
   where it describes *In N lorebooks*, NOMENCLATURE rows and §25 for the helper and the rule.

## Files owned

`src/lib/shared/lorebooks/sessionNotes.ts`; `src/lib/server/sockets/lorebooks.ts` (the two handlers),
`sockets/import.ts` (the match), `sockets/tags.ts` (related data), `sockets/narrativeGraph.ts` and
`sockets/scenes.ts` (the label lines only), `embedding/indexingActivity.ts`, `notifications/activity.ts`,
`server/admin/castLiftNotes.ts`, `rulesets/pubRulesets.ts`, `cast/characterRows.ts`; client
`lorebooks/LorebooksWorkspace.svelte` (the section and the title), `components/**/LorebookListItem.svelte`,
`CastLine.svelte`, `castBannerWords.ts`, `CharacterExportModal.svelte`, `CastUpgradeCard.svelte`,
`sidebars/characterRowsView.ts`, `BookSettings.svelte`, `EditLorebookForm.svelte` (the Name field for notes only), `sessions/sweptRelationships.ts` (the label line); their tests; the docs above. **Not** `sockets/entries.ts`,
`sockets/sessions.ts`, `db/schema.ts`, `Layout.svelte`, `startup/index.ts`, any SDK file.

## Out of scope

Where a session writes; renaming or clearing the stored `lorebooks.name`; any migration, boot pass, setting or new
event; surfaced books; the share verbs; the session page; removing the Session notes section.

## Stop and ask when

A notes member's only path to something (card update, export) would be removed; the "something the session wrote"
rule cannot be decided from stored facts; a fix needs a file outside the owned list.

## Done means

Tests: `bindingsForCharacter` leaves out notes books and their offers; the Characters reach count ignores notes
and keeps the single-notes line; *Played by* counts a session once; each Activity/notification label names notes
by the session's current name after a rename; the importer does not reuse a notes book of the same name; the
section lists notes with an entry / place / history day / summary / held change, and not notes that hold only
seat-made cast members; the row shows the current session name; the section starts collapsed and search opens it.
Existing suites of the touched areas pass. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean;
`NODE_OPTIONS=--max-old-space-size=12288 npm run check` no new errors. Tests only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 …"`,
one run at a time; another session also runs tests and SDK builds on this checkout: before each run check
`ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` and wait a few minutes at most (never
`pgrep -f "vitest run"` in a loop: it matches itself). No `npm run sdk:build`. Never `git commit`, `stash`,
`checkout`, `restore`; never `kill -9`; never `prettier --write` a directory; never glob-delete under `/tmp`.
Comments state the rule, not the story. At most two workers at once.

## Report

**Return the full report as your final message** (saved by the lead as
`plans/REPORT-notes-unlisted-2026-11-13.md`): the rule as built per place; the helper's name; the "something the
session wrote" rule exactly; where a notes member is updated/exported from now; copy verbatim; changed files; tests
and results; open ★; **Noticed, not done**. Say plainly that nothing was looked at in a running app.
