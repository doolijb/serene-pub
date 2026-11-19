# BRIEF — worker task `gs-2b-fix` — scope-review fixes to lane `gs-2b` (Edit session for a guest)

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-gs-2b-2026-11-17.md`, `STYLE-GUIDE.md` (absent,
never disabled; headings; one sentence). Re-verify every file:line.

Owner, 2026-11-16: "The session page, plus the full participants list read-only"; "Guests can only see the
session detail view, and manage cast/cards they own." Enforce at the server.

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only, never `--write`; no migration; no SDK edit. Inside `db.transaction` only `tx`.
Comments state the rule, not the story. Lane `gs-2c` (the notes closed to a guest) is editing
`lorebooks/ownBook.ts`, `cast/characterRows.ts`, `sockets/entries.ts`, notes entry points on the session page,
`SeatBringBackNote.svelte`'s lorebook link and many guest tests; task `kn-6-fix` is editing
`sockets/sessions.overlay.ts`, `SessionViewPanel.svelte`, `lorebooks/entryKnowledge.ts`: do not touch those;
re-read `EditSessionForm.svelte` and the seat components right before each edit, small targeted edits. Tests
only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2b-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .` and `npm run check`.

## Fixes

1. **A guest cannot reorder seats.** `src/lib/server/sockets/sessions.update.ts` 902–922 writes `position` from
   `characterPositions[id] ?? i` for every card already seated, whoever owns it, and 1133–1149 does the same
   for personas (`.set({ position: i })`): a guest's Save reorders everyone, which changes turn order for the
   session. In both loops skip the position update on **existing** rows when the caller is not the session's
   owner (a guest's own newly added seat takes the next free position, as an add already does: verify). The
   client: a guest's up / down buttons go the same way the grip went (`SessionCharacters.svelte` 161–189,
   `SessionPersonas.svelte` 143–168): absent for a guest. `docs/sessions.md` ~409 stays true ("read-only except
   their own seats") and gains nothing about order unless needed. Tests: a guest's `characterPositions` and
   persona order change nothing for existing seats (server, asserted on the stored positions); the owner's
   reorder unchanged; DOM: no move controls for a guest.
2. **The document-view edit route shows a guest the participants view, not the whole form.**
   `src/routes/document-view/sessions/[id]/edit/+page.svelte` renders the full form with disabled controls for
   a guest (93, 410, 607–630), reached from `document-view/sessions/[id]/+page.svelte:683` ("Edit session") and
   `document-view/sessions/+page.svelte:88`. For a guest that route renders the same participants-only view
   the dock form gives (reuse `EditSessionForm`'s guest rendering or its seat components; do not write a third
   layout), nothing disabled, and the two openers are labelled **Participants** for a non-owner. The Sessions
   sidebar's **Edit** (`SessionsSidebar.svelte:1043`: row menu and detail) reads **Participants** for a
   non-owner too. DOM tests for each.
3. **The guest view has a heading and no repeated sentence.** With the tab strip gone
   (`EditSessionForm.svelte` 2389–2397) the guest's view has no heading or label: give the participants region
   `aria-label="Participants"` (or a visible heading if the panel's own title pattern has one); wrap the moved
   `SessionVisibilityPanel` in a card section with an `<h3>` **Privacy** (the existing tab label); its first
   line "You are a guest in this session." (`SessionVisibilityPanel.svelte` 49–53) repeats the new banner
   (~2305): show that line only where the banner is not shown (the owner's Privacy tab never shows it; say what
   you did).
4. **Other people's characters show no card text to a guest.** A character row's second line is
   `characterSummary(c)`, the card's description (`SessionCharacters.svelte` 152–156; benched rows via `meta=`
   in `SessionBenchedSeats.svelte`); persona rows already show `seatPlayerWords`. For a guest, on a card that
   is not theirs: `seatPlayerWords` (who plays it), as personas do; on their own card: unchanged. The owner:
   unchanged. DOM test.
5. **The "changes nothing" test covers every dropped field.**
   `src/lib/server/sockets/sessions.guestEditSession.int.test.ts` 232–249 checks only name, scenario and tags:
   add genre fields, `playerLabel`, `sceneSettings`, `guestsBringOwn` / `guestsTakeCast`, and the positions
   case from fix 1.

Append a "Scope review and fix task" section to `plans/REPORT-gs-2b-2026-11-17.md` (the review's table of what
the server refuses, drops and accepted; these fixes; ★ also: a guest's Envoys line drops "Switch one on to
include it.").

## Report (under 300 words)

Per fix: what changed (file:line); labels and sentences (★); tests and counts with log names; `tsc` /
`npm run check`; anything not done.
