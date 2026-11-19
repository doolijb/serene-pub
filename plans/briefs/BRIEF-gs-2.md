# BRIEF — build lane `gs-2` — what a guest sees and reaches in a session (owner rulings G1, G2, G5, G6)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then row D61 in `plans/DISCUSS-LATER.md` (ruled), the "Rulings page, second
round" block in `plans/PLAN-programme-2026-11-15.md`, `plans/INVENTORY-guest-and-member-surfaces-2026-11-16.md`
(the map of this lane: **re-verify every file:line**), `plans/REPORT-gs-1-2026-11-16.md` (the prompts part,
built: `pipelineReaderOf`, the G6 pins), `docs/group-sessions.md`, `docs/sessions.md`, `docs/lorebooks.md`
(the session's own notes), `STYLE-GUIDE.md` (read-only in words; absent, never disabled), `NOMENCLATURE.md` §1,
§24 and rows **session owner**, **guest**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash / checkout / restore`; `npx prettier --check` only, never `--write`. Never commit. **No
migration.** Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.
Lane `tm-1` is editing `pipelines/runtime/host.read.sessionCast.ts`, `pipelines/prompt/assemble.ts`,
`scenes/earlierScenes.ts`, `state/statTrail.ts`, `lorebooks/loreMatch.ts`, `tools/coreTools.ts`, SDK Dungeon
Crawler files: do not edit those; re-read any file right before editing.

## Owner (2026-11-16, rulings page, second round)

G1: "The session page, plus the full participants list read-only". G2: "A guest neither opens nor edits the
notes". G5: "The session's owner and administrators only". G6: "In another person's session an administrator is
a guest". Earlier the same day: "Guests can only see the session detail view, and manage cast/cards they own."
Standing: enforce at the server, not by hiding in the client; a control a person may not use is absent, never
disabled; one socket listener per event family; views never toast.

**Not this lane (lane `gs-3`, briefed separately):** who may add, take or be given a seat, the two new session
settings, shared cards (G3, G4). Here a guest's seat management stays exactly as it is today.

## Build (server first; then the client stops asking and stops showing)

1. **An administrator in another person's session is a guest (G6).** One server answer for "who is this person
   in this session": owner, or guest (everyone else, administrators included). Apply it wherever the session
   decides what to send or accept: `viewerFor` (`sockets/pipelines.ts`; lane `gs-1`'s `pipelineReaderOf`) so
   that **from a session they do not own an administrator gets what a guest gets and writes nothing through
   that session** (today their write lands at configuration scope: that path is closed when the request
   carries another person's `sessionId`; the admin Pipelines screens, which send no session, are untouched);
   `sessions:pipelines`; the client's `isGuest` (already "not the owner": verify every place that adds
   `&& !isAdmin` after `gs-1` and remove it). Re-pin lane `gs-1`'s three G6 tests (old → new: an administrator
   in someone else's session is refused like a guest; nothing stored at either scope).
2. **What a guest may open of Edit session (G1).** A guest gets the **participants list, read-only** (every
   seat and who plays it; no control to change another's seat; their own seat management as today), and
   nothing else of Edit session: no Settings tab content, no Visibility panel of the owner's, no layout
   editing, no session actions list, no benched-seat controls, no tags editing: each **absent**. Enforce at the
   server for every `sessions:*` / `sessionAdmin:*` read and write the inventory's §2 table marks as reaching a
   guest today (list each: event → before → after); the client then renders only the participants view for a
   guest (find the cheapest honest form: the Participants tab alone, with the others not rendered). The
   session page itself (messages, the cast as play shows it, their own turn controls, the widgets the layout
   places) is unchanged. If "read-only participants" needs a new read shape, reuse the one the tab already
   reads and strip what a guest may not see (other people's private card fields: say what the list shows of
   someone else's character today and keep it to name, avatar and who plays it).
3. **A guest neither opens nor edits the session's notes (G2).** `lorebooks/ownBook.ts` ~602–621 gives a guest
   read and write of the session's own notes. Close both at the server for every lorebook read and write
   event addressed to a session's notes (entries, links, cast, knowledge, time, settings, graphs, Apply / Take
   back: find them through the access function they share and fix it **there**), answering as for a lorebook
   the person cannot see. What play writes through pipelines still lands in the notes whoever is speaking
   (runs act as the session, not as the guest: verify with a test of a guest's turn writing lore). The client
   removes a guest's ways into the notes (the session's lorebook / notes buttons, the Timeline / Chronicle
   views that read the notes, lore lookups on the session page: list each; absent, never disabled). A widget on
   the session page that shows lore from the notes to everyone in play (e.g. a place card) is **play showing
   it**, not opening the notes: keep, and list which widgets those are.
4. **Prompt details (G5).** `sessions:promptTokenCount` (`sockets/sessions.messages.ts` ~2089–2115; its
   administrator check is commented out) and any sibling that returns a compiled prompt or its parts: the
   session's owner and administrators **acting in their own session** only (an administrator in someone else's
   session is a guest: item 1). A guest is refused in the handler's existing manner and the control is absent
   for them. Check the run inspector, receipts and "explain" surfaces for the same rule (lane `gs-1`'s review
   found them already admin-only: verify, pin).
5. **Docs and names:** `docs/group-sessions.md` (what a guest sees and can do, in one list), `docs/sessions.md`,
   `docs/lorebooks.md` (the notes: the owner's), `docs/users-and-accounts.md` (an administrator in someone
   else's session); `NOMENCLATURE.md`: the **guest** row loses its 🚧 for the parts ruled here, with its
   charter (sees, may do, may not, who does instead); §25.

## Tests

Server, as a guest and as an administrator-who-is-not-the-owner, against every event changed: refused or
stripped, with the reply's serialised form asserted to hold none of what was closed; the owner unchanged; a
guest's own seat management unchanged; a guest's turn still writes lore to the notes through the pipeline;
the participants read for a guest. Client DOM: a guest's Edit session shows the participants list only, with no
change controls on others' seats; no notes entry points; no Prompt details control. `tsc` 0; `npm run check` 0
errors in lane files.

## Files owned

`src/lib/server/utils/sessionAccess.ts` (the role answer), `sockets/pipelines.ts` (`viewerFor` only),
`sockets/sessions.*.ts` handlers that serve Edit session reads and writes, `sockets/sessions.messages.ts`
(Prompt details), `lorebooks/ownBook.ts` (the notes' access function only), the lorebook sockets' shared
access check, `EditSessionForm.svelte` and the session page's entry points for a guest, their tests, the docs.
Lane `gs-3` will own seat management (`sockets/sessions.update.ts` seat paths, the participants controls):
leave those as they are.

## Stop and ask when

CLAUDE.md §Decisions applies; closing the notes to a guest breaks something a guest needs to **play** (name
it); a session-page widget would have to be removed for guests; the participants list cannot be made read-only
for a guest without touching seat management (then stop on that part and report what `gs-3` must carry);
anything needs a migration.

## Report

Final message = the report (lead saves `plans/REPORT-gs-2-<date>.md`): a table (surface / event → guest before
→ guest after → enforced where); the administrator rule and the re-pinned G6 tests (old → new); what a guest
still sees of lore through play; sentences and names (★); **Noticed, not done**. Under about 650 words.

## Cold review corrections (2026-11-16) — these rule over the text above

**The lane is cut in three. This brief now builds `gs-2a` only: G6 (item 1) and G5 (item 4), server and
client.** Items 2 (Edit session for a guest, `gs-2b`, after the seats lane `gs-3`) and 3 (the notes, `gs-2c`,
which starts from a list of every call site of the notes' access function) are **not** built here: do not edit
`lorebooks/ownBook.ts`, `utils/ownedBook.ts`, or the Edit session tabs beyond the `isAdmin` conditions named
below. Logs `plans/gs-2a-<n>.log`; report `REPORT-gs-2a-<date>.md`.

### G6, corrected
- **Three answers, as today:** `utils/sessionAccess.ts` 31–44 gives **owner**, **guest** (a `session_guests`
  row) or **no access**. There is no administrator bypass and none is added: an administrator who is neither
  the owner nor a guest of a session has no access to it, as today. "An administrator is a guest" means: where
  a handler lets a member in through `checkSessionAccess` and then adds **`|| isAdmin`**, that addition goes,
  so an administrator who is a guest of the session gets exactly a guest's answer:
  `sockets/sessions.pipelines.ts:1101`, `sockets/sessions.messages.ts:2413`, `sockets/pipelines.ts` 131–169
  (`viewerFor` and `readerFor` / `pipelineReaderOf`: with another person's `sessionId` an administrator is
  refused like a guest and **writes nothing**, at either scope), the `"admin"` provenance at
  `sessions.pipelines.ts:404` (say what it marks and what it becomes), and the client's
  `EditSessionForm.svelte` 580, 631, 3023. Find any other `checkSessionAccess … || isAdmin` and list it.
- **Not touched: administrator tools that take a `sessionId` only as a filter.** `receiptsAdminOnly`
  (`sockets/pipelines.ts` 672–683: the run inspector, R55 "for every user's runs"), `pipelines:eventMap`
  (5930–5956; `EventIdPage.svelte` 76–90 sends it a session), the admin session list, diagnostics, the support
  report. The line is: **inside the session's own screens** an administrator is the owner or a guest like
  anyone; **the administrator screens** keep reading across sessions. Strike "the admin Pipelines screens,
  which send no session".
- `annexInspect` (`annexInspect.ts:121`: any administrator into any session's annex, mounted in Edit session):
  under G6 it is the owner's in their own session and absent for a guest, administrators included; if an
  administrator screen also uses it, that use stays. Report what it is and what you did.
- Re-pin lane `gs-1`'s G6 tests (old → new).

### G5, corrected: the compiled prompt of a reply
- `sessions:promptTokenCount` already strips the prompt text for a guest and its **counts feed the guest's
  over-limit warning in the composer** (`composerFlow.svelte.ts` 99–101, 217–227): do **not** refuse it. Change
  only who gets the text (`sessions.messages.ts` ~2413): the session's **owner**.
- **The real leak is `debugMeta`:** full `session_messages` rows go to every member through
  `sessions:messagesPage` (`sessions.messages.ts` 108–110, a bare `.select()`) and the first page of
  `sessions:get` (`sockets/sessions.ts` ~1004). Strip `debugMeta` (the compiled prompt and its parts) from the
  rows sent to anyone who is not the session's owner, in both reads and in any live push that carries a
  message row (find them: message created / updated events), at the one place the row is shaped for the wire
  if there is one. Nothing else about a message row changes for a guest. Assert on the serialised payloads.
- **The owner must be able to open Prompt details:** the client gate is `isAdmin` only
  (`client/.../requests/promptDetails.ts:32`): it becomes "the session's owner".
- **The two rulings read together (lead's reading, recorded as D64 for the owner to see):** G5 says "The
  session's owner and administrators only", G6 says "In another person's session an administrator is a
  guest". Built: inside a session, Prompt details is the **owner's**; an administrator reads any reply's run,
  prompt included, from the **administrator** run inspector (R55), not from inside someone else's session.

### Files owned (replaces the list above)
`sockets/sessions.pipelines.ts` (1101, 404), `sockets/sessions.messages.ts` (Prompt details, the messages page
shaping), `sockets/sessions.ts` (the first page's message rows only), the message push shaping,
`sockets/pipelines.ts` (`viewerFor` / `readerFor` only), `annexInspect.ts`, the client's `promptDetails.ts`
gate, `EditSessionForm.svelte` (the three `isAdmin` conditions only), their tests, `docs/group-sessions.md`,
`docs/users-and-accounts.md`, `docs/sessions.md` (one sentence each), `NOMENCLATURE.md` §25.

### Stop and ask (adds)
A guest's session page needs something from `debugMeta` to render (name it); a message push shares its payload
between the owner and guests and cannot be shaped per recipient without a new event.
