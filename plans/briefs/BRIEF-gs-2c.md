# BRIEF — build lane `gs-2c` — a guest neither opens nor edits the session's notes (owner ruling G2)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then row D61 (G2) in `plans/DISCUSS-LATER.md`,
`plans/INVENTORY-seats-and-notes-access-2026-11-16.md` **Part B** (the classified list this lane works from:
re-verify every file:line), `plans/REPORT-gs-3a-2026-11-17.md` (`sessions:castToTake`: a guest's seat choosing
no longer reads the notes), `plans/REPORT-gs-2a-2026-11-16.md`, `docs/lorebooks.md` (the session's own notes),
`docs/group-sessions.md`, `NOMENCLATURE.md` rows **guest**, **session owner**, **notes**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash / checkout / restore`; `npx prettier --check` only, never `--write`. Never commit. No
migration. Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2c-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.

## Owner (2026-11-16)

G2: "A guest neither opens nor edits the notes". "Guests can only see the session detail view, and manage
cast/cards they own." G4: "Keep: any guest may take a card-less cast member's seat". Standing: enforce at the
server; a control a person may not use is absent, never disabled; play still writes lore through pipelines
whoever speaks.

## The rule to build

The session's own notes are the **session owner's** lorebook. A guest of the session has **no access** to them
as a lorebook: no read, no write, through any lorebook, entry, cast, link, knowledge, time, graph, scene or
redline event. What a guest sees of the notes is only what **play shows** on the session page and what the
session-scoped reads give them (`sessions:castToTake`, their own seat's sheet).

## Build

1. **One change at the source.** `ownBookAccessFor` (`src/lib/server/lorebooks/ownBook.ts` ~609) grants a guest
   read and write of the session's notes; it is reached through `lorebookAccessFor` and `findOwnedBook`
   (`utils/ownedBook.ts` 53–64, 105–108) from about 111 call sites. Make it answer for a guest exactly as for a
   lorebook the person has nothing to do with (the existing "not found" / "no access" result those helpers
   already produce), so every **W** and **R-workspace** site in the inventory's table closes without touching
   each handler. Then walk the table and confirm each row (event → guest before → guest after), fixing only a
   site that bypasses the helper.
2. **Reads a guest needs to play keep working, by their own session-scoped rule, not by notes access:**
   - seat choosing: a guest's picker already uses `sessions:castToTake` (lane `gs-3a`); `lorebooks:bindingList`
     on the notes is closed to a guest: verify nothing a guest's UI still calls it;
   - `lorebooks:memberOfSeat` (a guest's read-only sheet of the seat they play): unchanged
     (`opensInBook` false): pin;
   - media and cast-member reads (`media/access.ts:144`, `cast/memberAccess.ts:60`) fall back to "a session
     that seats it": faces and sprites of **seated** members keep working for a guest; pictures of unseated
     notes members close (correct: a guest does not browse the notes): pin both;
   - `state:set` for a guest's own sheet edits uses its own session check (`sockets/state.ts:146`): unchanged,
     pin;
   - the push at `sessions.shared.ts:1475` (relist to the caller): make sure a guest is not sent the notes'
     binding list by it.
3. **The ambiguous sites, decided:**
   - the composer's **Lore pane** (`entries:list` via `pageAsks.ts` 368–383, `lorebooks:lines`): it reads the
     notes; for a guest the pane (or its notes part) is **absent**; if the same pane also reads an attached
     lorebook the guest may read by that lorebook's own sharing rules, that part stays (report which case
     exists);
   - `personMay` (`auth/actingPerson.ts:142`; applet doors acting for a person: `appletSessions.ts:77`,
     `appletLibrary.ts:329`): an applet acting for a guest gets what the guest gets: nothing of the notes;
   - private conversations attaching or reading the notes (`conversations/gate.ts:110`, `store.ts:1412`): the
     owner's only.
4. **Runs are untouched:** pipeline writes pass the session owner's id (`host.loreWrites.ts` 1048, 1103;
   `scenes.ts` 3010): prove with a test that a guest's turn still writes lore to the notes and that the scene
   routines still run on a guest's line.
5. **The client:** every way a guest could open the notes is absent (the session's lorebook / notes buttons,
   Timeline / Chronicle / Lives views that read the notes, "open in lorebook" links on cast or lore widgets,
   redline and review badges, Apply / Take back, the Lore pane's notes part): list each and where. A widget
   that **shows** lore from the notes to everyone in play (a place card, Who's here, stats) is play showing it:
   keep, and list which widgets those are and which server read feeds them (it must not be one this lane
   closes; if it is, give that widget's read a session-scoped rule and say so).
6. **Docs and names:** `docs/lorebooks.md` (the notes are the session owner's; what a guest sees of them),
   `docs/group-sessions.md`, `NOMENCLATURE.md` (the **guest** row; §25).

## Tests

Re-pin the tests that pin a guest's access to the notes (inventory: `entries.earmark.int.test.ts:361`,
`lorebooks.memberOfSeat.int.test.ts` 231 / 242, `lorebooks/ownBook.int.test.ts:388`,
`state/worldScope.int.test.ts:516`, `editSessionGuestOwnNotesReading.dom.test.svelte.ts:173`,
`cast/memberAccess.int.test.ts:95`, `media/access.cardCascade.int.test.ts:172`): old → new, never weakened.
New: for one event of each class in each socket file of the table, a guest is refused with nothing of the
notes in the serialised reply; the owner unchanged; item 2's play reads; item 4. Client DOM for item 5.
`tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`src/lib/server/lorebooks/ownBook.ts` (`ownBookAccessFor` and its callers' handling only),
`utils/ownedBook.ts`, any handler found to bypass the helper, `sockets/sessions.shared.ts` (~1475),
the session page's and Edit session's entry points to the notes for a guest, the composer's Lore pane for a
guest, their tests, the docs. Not this lane: Edit session's tabs for a guest (`gs-2b`), seats.

## Stop and ask when

CLAUDE.md §Decisions applies; a session-page widget a guest needs to play reads the notes through the helper
and has no session-scoped alternative (name it and propose the read); closing the helper breaks the **owner**
anywhere; an attached lorebook's own sharing rule is affected (it must not be: this lane is the notes only).

## Report

Final message = the report (lead saves `plans/REPORT-gs-2c-<date>.md`): the one change; the table (file →
events → class → guest after); play reads kept and how; the ambiguous sites as built; client entry points
removed; tests re-pinned (old → new); **Noticed, not done**. Under about 600 words.

## Cold review corrections (2026-11-17) — these rule over the text above

**Order: this lane runs after `gs-2b` has landed** (a guest's Edit session then has no Settings tab, so no
guest UI asks the notes for `lorebooks:lines`). `editSessionGuestOwnNotesReading.dom.test.svelte.ts` is
`gs-2b`'s.

1. **The one line:** `isSessionMember` (`lorebooks/ownBook.ts` 623–641) returns `session.userId === userId`.
   `lorebookAccessFor` turns false into null (`utils/ownedBook.ts` 107–109); an attached lorebook gets
   `undefined` there, so its own sharing rules are untouched.
2. **Two sites do their own check and must be closed by hand:**
   - `storyBookSql` (`src/lib/server/cast/characterRows.ts` 124–138, and the `sessionId` filter at 309–320)
     repeats the owner-or-guest rule and lists the notes' members in a guest's Characters view under "In my
     stories" (pinned by `characterRows.int.test.ts` 242–245): the owner only;
   - `entries:setMarks` (`sockets/entries.ts:1590`) checks inline and lets any administrator in, notes
     included, against the notes' own "no administrator exception" (`ownBook.ts` 604–607) and G6: the notes'
     owner only.
3. **Re-pins, complete the list first.** Worker 1 starts by grepping the tests for `sessionGuests` together
   with the notes (about 40 files) and lists every hit in its report before changing code. Known beyond the
   brief's list: `sockets/entryKnowledge.door.int.test.ts:544` (the error becomes "Lorebook not found."),
   `sockets/entries.redlines.int.test.ts` 255–260, 386, 462, `cast/characterRows.int.test.ts:242`.
4. **Item 3's "composer Lore pane" no longer exists:** it became the Chronicle's `history-entries` request,
   which is already owner-only on the client (`sessionPage/requests/historyEntries.ts` 13–16, 254–255,
   262–264): pin the guest's empty answer at the **server** too (a guest calling the underlying read gets
   nothing of the notes); build no UI.
5. **Confirmed safe, pin and move on:** members nobody seats never speak (`docs/lorebook-cast.md:22`) and a
   removed seat keeps its row, so the seated fallback (`media/access.ts` 153–209) keeps every speaker's face
   for a guest; a guest's own sheet edits use `state:set`'s session check (`sockets/state.ts:146`) and stats
   writes check who owns the book (`state/write.ts` 2106–2163); `sessions:get` and the page's loaders do not
   call the book helpers for a guest.
6. **Noticed, not this lane:** an administrator who is a guest still reads an **attached** lorebook through the
   lorebook's administrator exception (`ownedBook.ts` 110–123): report, do not change.
7. Workers: 1 the server (the line, the two sites, every re-pin), then 2 the client entry points and docs.
