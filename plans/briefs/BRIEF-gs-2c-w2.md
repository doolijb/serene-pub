# BRIEF — `gs-2c` worker 2 — the client: a guest has no way to open the session's notes; docs; one run test

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-2c`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This brief needs no `sdk:build`: do not run one, and edit nothing in `../serene-pub-sdk`.)

Both repos are staged by the lead: run **no git command that changes the index or the working tree** (no add, reset, checkout, restore, stash, commit). `git diff` / `git status` are fine.

## Goal

Owner ruling G2 (2026-11-16): *"A guest neither opens nor edits the notes."* Standing: *"a control a person may not use is absent, never disabled"*; *"play still writes lore through pipelines whoever speaks."* Worker 1 has closed the server: every lorebook / entry / cast / link / time / graph / scene / redline event refuses a session guest on the session's own notes (a `lorebooks` row with `session_id`; the page knows it as `ownBookId`), `entries:sessionEntries` answers a guest `ownerOnly` on a notes-only session, and `sessions:overlayItems` / `sessions:appliedBatches` answer a non-owner the empty shape. Your job: the host-side client entry points, the docs, and one server test of a guest's turn.

## Build

1. **`SeatBringBackNote`'s lorebook link** (`src/lib/client/components/sessionForms/EditSessionForm.svelte` `castMemberHref` ~1181–1191, mounted through `SessionCharacters.svelte` 221 / 278 and `SessionPersonas.svelte` 196 / 250; the component is `SeatBringBackNote.svelte`). For a guest (`isGuest`, ~587) the link is **absent** when the book it would open is the session's notes (`bookId === session.ownBookId`, i.e. `sessionBookOf` fell back to the own book). An attached lorebook's link stays as it is (its own sharing rules decide; do not change them). Change only `castMemberHref`; the sentence stays.
2. **The page's `open-lore` answer** (`src/lib/client/components/sessionPage/requests/index.ts` ~403 → `requests/openLore.ts`). Core's widgets that ask it for the notes live in the SDK (`SceneDivider` scene name, history date markers, day marks, "Next: date", "Start a new entry", Places "Open in lorebook" / "Open entry") and stay drawn for a guest (the SDK is not this lane's: the supervisor queues making them absent). Here, at the host: when the viewer is not the session's owner (`d.isSessionOwner()`, already a dep, ~190, wired in `src/routes/sessions/[id]/+page.svelte` ~650) and the target is the session's notes (the asked `lorebookId` equals the page's own book id, or no `lorebookId` was given and the page would open the own book: read `showLore` at `+page.svelte` ~693 and the lorebooks digest to see what a missing id opens), refuse: throw `new Error("the session's notes are the session owner's")` (the precedent is `requests/promptDetails.ts:35`, a lowercase reason the widget shows as *Not done: …*), and do not open the panel. Add the deps `answerOpenLore` needs (the owner check and the own book id) through the existing deps pattern. A guest asking for an attached lorebook still opens it. Update `openLore.ts`'s header ("Nothing is refused") to say what is refused.
3. **The summarize modal** (`requests/summarize.ts`, IDX `summarize`, `SummarizeLoreModal.svelte` asks `entries:list` / `lorebooks:bindingList` on the notes and saves to them). Find whether a guest can reach it today (the message menu's *Select for summary* is gated `conv.dossier?.writes.lore && … && conv.select.offered` in the SDK's `MessageControls.svelte`: trace what sets `select.offered` for a guest on the host). If a guest can reach it **on the notes**, refuse it at the host the same way as item 2, with `"the session's notes are the session owner's"`, before any selection or modal opens. If a guest cannot reach it, change nothing and report how it is gated.
4. **Verify only, change nothing** (report each with file:line): no guest path still asks `lorebooks:bindingList` on the notes (`scenesFlow.svelte.ts` 107–111, `sessionPageInbox.svelte.ts` 296–302 are gated by `ownLorebookId`; `EditSessionForm.svelte` 885–919 uses `sessions:castToTake` for a guest); `history-entries` (`requests/historyEntries.ts` 249–264) asks nothing of the notes for a guest; the entry-management widget's `session-entries` request passes the server's `ownerOnly` through for a guest (`requests/sessionEntries.ts`); `ActivitySidebar.svelte` 269–280 (a scene-summary card's `open-lore`, no owner check, unlike the graph and indexing cards beside it): can a guest ever receive that activity? Report; fix only if a guest receives it, by the same owner check the neighbouring cards use.
5. **Docs** (rewrite in place; describe behaviour, no history):
   - `docs/lorebooks.md` §"Your session's own notes": the bullet *"Only the session's owner and guests can see them."* → the session's owner alone opens and changes them; a guest sees only what play shows of them on the session page (the place card, Who's here, scene dividers, sheets, the story clock), and their turns still write to them. In §"Bringing a session's changes into the lorebook", *"Everyone in the session sees the card"* → only the session's owner sees the **This session only** card.
   - `docs/sessions.md`: line ~177 (a message name: for a cast member of the session's notes a guest gets the read-only sheet); ~532 and ~542 (a guest's click on a scene name or a history date in a session whose lorebook is its notes does not open the notes: it says *Not done: the session's notes are the session owner's*); ~623 §Guests (add: a guest doesn't open or change the session's notes).
   - `docs/group-sessions.md` ~20: one sentence: the session's notes are the owner's; a guest's turns still write to them.
   - `NOMENCLATURE.md` §9 **guest** row: replace *"**Ruled, not yet built:** the session notes."* with a *"**Built 2026-11-17 (lane gs-2c; G2):**"* sentence: no access to the session's notes as a lorebook (every lorebook, entry, cast, link, time, graph, scene and redline event refuses; `entries:sessionEntries` answers `ownerOnly`; the **This session only** lists come empty); what play shows stays; runs write as the session owner. Add one §25 Change ledger entry for lane gs-2c in the format of the entries around it (owner quote G2, no new names; the 🚧 provisional refusal reason `"the session's notes are the session owner's"`). Read the **guest**, **session owner** and **notes** rows and §25's last entries first; follow their form. Do not touch other rows.
6. **A guest's turn still writes lore to the notes** (server test; worker 1 could not drive it). New `src/lib/server/pipelines/runtime/host.guestTurnNotes.int.test.ts`, modelled on `host.entryDefaults.int.test.ts` (`createHost(db, { sessionId, userId, runId })` then `host.commit`): a session with **no attached lorebook** (its notes are its lorebook; find how tests make the own book: `grep -rn "ownBookFor\|ensureOwnBook" src/lib/server --include=*.int.test.ts`), a guest (`session_guests` row), a host created with the **guest's** `userId`; commit one lore entry; assert it lands in the session's notes (`lorebook_id` = the own book). Twin: the owner's run does the same. If the run path refuses the guest, stop and report it (do not change runtime code).

## Tests

- DOM / unit: `SeatBringBackNote` link absent for a guest on the notes, present for the owner, present for a guest on an attached book (extend `editSessionGuestView.dom.test.svelte.ts` or a new `editSessionGuestNotesLink.dom.test.svelte.ts`; copy fixtures from `editSessionGuestSeats.dom.test.svelte.ts`); `open-lore` refused for a guest on the notes (the panel never opens), allowed for the owner, allowed for a guest on an attached book (a unit test beside `requests/openLore.ts`, following the other `requests/*.test.ts`); item 3's guard if built.
- Item 6's int file. An int test that opens a DB inside an `it` needs a 60 s timeout under load.

Runs, one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2c-w2-<n>.log 2>&1"`.
Run your new tests plus the neighbours of each file you change (`editSession*.dom`, `requests/*.test.ts` in `sessionPage/requests/`). Never pipe vitest into `head`; a failing assert on a happy-dom element has OOM-killed VS Code, so keep DOM runs to the files named. No full run, no `npm run build`. At the end: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors) and `NODE_OPTIONS=--max-old-space-size=10240 npm run check` (0 errors in your files). `npx prettier --check` your files (report, never `--write`).

## Rules your work depends on (CLAUDE.md / STYLE-GUIDE, quoted)

- "A control a person may not use is absent, never disabled" (owner, standing).
- "**Sockets:** one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." No new names, settings, events or flags; the one new string is the refusal reason above (provisional; the supervisor marks it ★).
- It is a **session**, never a *chat*.
- `docs/<area>.md`: "update it in the same change when behaviour moves." NOMENCLATURE: "When you add or rename a term, record it in §25 Change ledger in the same change."

## Files owned

`src/lib/client/components/sessionForms/EditSessionForm.svelte` (`castMemberHref` only), `src/lib/client/components/sessionPage/requests/index.ts`, `requests/openLore.ts`, `requests/summarize.ts` (only if item 3 builds), `src/routes/sessions/[id]/+page.svelte` (only the deps passed to `open-lore` / `summarize`), `src/lib/client/components/sidebars/ActivitySidebar.svelte` (only if item 4 finds a guest gets the card), your new tests, `docs/lorebooks.md`, `docs/sessions.md`, `docs/group-sessions.md`, `NOMENCLATURE.md` (the guest row and one §25 entry). **Not yours:** `SessionViewPanel.svelte`, `sockets/sessions.update.ts`, `src/routes/document-view/sessions/[id]/edit/+page.svelte`, any server file except item 6's new test, the SDK.

## Stop and report when

A guest needs a notes read to play that is now refused (name the widget and the read); a change would touch the SDK; a name, setting or event would be new; the owner's behaviour would change.

## Report

Final message (under ~600 words): each change with file:line; item 3 and item 4 findings; docs changed; tests run (log, pass/fail); Noticed, not done.
