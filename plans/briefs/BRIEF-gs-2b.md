# BRIEF — build lane `gs-2b` — Edit session for a guest: the participants list, read-only, and nothing else (owner ruling G1)

Repo `/home/jody/github/serene-pub` (app). Supervisor: read `.claude/guides/multi-agent.md`, then row D61
(G1) in `plans/DISCUSS-LATER.md`, `plans/INVENTORY-guest-and-member-surfaces-2026-11-16.md` §2,
`plans/REPORT-gs-2a-2026-11-16.md`, `plans/REPORT-gs-3a-2026-11-17.md` (the guest's seat controls and the two
switches), the "Cold review corrections" of `plans/briefs/BRIEF-gs-2.md` (objection 5: `sessions:get` is shared
with the session page and is **not** stripped), `docs/group-sessions.md`, `docs/sessions.md`,
`STYLE-GUIDE.md` (tabs; absent, never disabled; read-only in words), `NOMENCLATURE.md` rows **guest**,
**session owner**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash / checkout / restore`; `npx prettier --check` only, never `--write`. Never commit. No
migration. Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2b-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.
Lane `gs-2c` (the notes closed to a guest) may run at the same time in `lorebooks/ownBook.ts`,
`utils/ownedBook.ts`, the composer's Lore pane and the session page's notes entry points: do not edit those;
re-read `EditSessionForm.svelte` right before editing (both lanes touch it: you own the tabs, it owns notes
links).

## Owner (2026-11-16)

G1: "The session page, plus the full participants list read-only". "Guests can only see the session detail
view, and manage cast/cards they own." Standing: enforce at the server; absent, never disabled.

## Build

1. **What a guest sees when they open Edit session:** one view, the **participants list**: every seat, the
   character or persona on it, and who plays it, read-only for other people's seats; their **own** seat
   controls exactly as lane `gs-3a` left them (add / remove / bench their own, take a card-less cast member,
   subject to the owner's two switches, with that lane's words when a switch is off). No tab strip if only one
   view remains. Nothing else of Edit session is rendered for a guest: no Settings tab, no Visibility panel,
   no tags, no session actions list, no layout controls, no benched-seats management of others, no Guests
   card's owner controls (a guest may see who the guests are as part of the participants list if the list
   already shows people; report what it shows of other people: keep it to name and avatar).
2. **At the server, close the Edit-session-only events to a guest** (each: a guest before → after, tested on
   the serialised reply): `sessions:pipelineCards`, `sessions:functions`, `sessions:accountVisibility`,
   `sessions:genres`, `sessions:storyClock`, `sessions:view` (verify this list against the form's loaders: add
   any other read or write only Edit session's non-participant tabs use; **do not** change `sessions:get`,
   which the session page shares, nor anything the session page itself needs: list what the page needs so it
   is provably untouched). Writes from those tabs (`sessions:update` fields other than a guest's own seats:
   name, tags, description, genre fields, visibility, preset, layout): a guest's values are refused or dropped
   in the handler's existing manner (find how `sessions:update` treats a non-owner's non-seat fields today and
   make it a refusal in words if it silently drops something a guest's UI could send).
3. **The session page's entry to Edit session for a guest** is labelled for what it opens (if the control says
   "Edit session" or "Settings", a guest's reads as the participants view: ★ label, e.g. **Participants**;
   find the existing label a guest sees and the cheapest honest change).
4. **Docs and names:** `docs/group-sessions.md` (what a guest can open), `docs/sessions.md` (the tabs: the
   owner's), `NOMENCLATURE.md` (the **guest** row: built; §25).

## Tests

Server: each closed event as a guest and as the owner. Client DOM: a guest's Edit session renders the
participants view only (assert the absence of each other tab's landmark), others' seats have no change
controls, their own do; the owner's form unchanged (every tab present). Re-pin tests that pin a guest seeing a
read-only Settings / Visibility tab (old → new). `tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`EditSessionForm.svelte` (the tab strip and what renders for a guest; not the notes links), the session page's
entry control for Edit session, the handlers named in item 2 (`sockets/sessions.*.ts`), their tests, the docs.

## Stop and ask when

CLAUDE.md §Decisions applies; the participants list cannot render without a read this lane closes; the session
page needs one of the closed events; a guest would lose a seat control lane `gs-3a` gave them.

## Report

Final message = the report (lead saves `plans/REPORT-gs-2b-<date>.md`): what a guest's Edit session shows;
the events closed (table); what the session page needs and that it is untouched; the label (★); tests
re-pinned (old → new); **Noticed, not done**. Under about 500 words.

## Cold review corrections (2026-11-17) — these rule over the text above

**Order: this lane runs first; `gs-2c` (the notes) runs after it lands.** Strike "may run at the same time".
This lane owns `editSessionGuestOwnNotesReading.dom.test.svelte.ts` (it tests a guest's Settings-tab
`SessionLorebookReading`, `EditSessionForm.svelte` 2878–2898, which this lane removes for a guest): re-pin it
to "a guest's Edit session has no Settings tab and sends no `lorebooks:lines` request".

1. **Item 2, the events, corrected. Close only `sessions:pipelineCards`** (it checks session access at
   `sockets/sessions.pipelines.ts:542`: the owner only). **Do not close:**
   - `sessions:view`: the session page uses it (`sessionPageData.svelte.ts` 217–241, the page route) and so
     does the Participants tab's envoy list (`EditSessionForm.svelte` 2234–2245);
   - `sessions:genres`: a pub-wide list of offered genres, not a session read (`sessions.pipelines.ts`
     107–121); the shell and the page's navigation ask for it, and a guest's own seat sections are worked out
     from it (`EditSessionForm.svelte` 330–347);
   - `sessions:storyClock`: feeds the Chronicle widget on the page (`pageAsks.ts:163`);
   - `sessions:functions`: already answers a guest with an empty list (`sessions.pipelines.ts` 1420–1426):
     pin, no change;
   - `sessions:accountVisibility`: the guest's view of **their own** exposure
     (`sockets/sessions.participants.ts` 832–841: "so they understand the consequence before contributing"):
     it stays, and where it is shown to a guest today stays shown inside the participants view (report where;
     if it lives on the Visibility tab, move that one guest-facing line into the participants view rather than
     drop it: ★).
   List view, genres, storyClock, functions under "the session page needs, untouched".
2. **A guest's non-seat fields stay dropped, not refused.** Every Save sends the whole session
   (`EditSessionForm.svelte` 1404–1406) and dropping a guest's non-seat fields is deliberate and documented
   (`sockets/sessions.update.ts` 276–281): keep it. Add a test: a guest's seat-only Save still lands and their
   non-seat values change nothing. With only the participants view rendered, a guest's form should send only
   what that view edits where that is a small change; do not restructure Save.
