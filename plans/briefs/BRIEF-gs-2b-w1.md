# BRIEF — worker `gs-2b-w1` (client) — a guest's Edit session is the participants list and nothing else

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-2b`. Use absolute paths; your cwd resets between
commands.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`. Do not run one.) Both repos are staged: run **no** git command that changes the index or
working tree (no add, reset, checkout, restore, stash, commit). Never `prettier --write`. No migration, no new
socket event, no new setting.

## Goal (owner ruling G1, 2026-11-16)

Owner: *"The session page, plus the full participants list read-only."* *"Guests can only see the session detail
view, and manage cast/cards they own."* Standing: **absent, never disabled**; a read-only value is shown **as words,
never as a disabled control** (STYLE-GUIDE §6.11: "A read-only value is shown as words, never as a disabled tick.").

A **guest** is `isGuest` in `EditSessionForm.svelte` (`session.userId !== userCtx.user?.id`). The **owner's form must
stay exactly as it is** (every tab, every control): gate every change on `isGuest`.

## Files owned (edit only these)

- `src/lib/client/components/sessionForms/EditSessionForm.svelte` — the tab strip and what renders for a guest.
  **Do not touch** the notes links / notes entry points (lane `gs-2c` owns those later) beyond what item 6 says.
- `src/lib/client/components/sessionForms/SessionCharacters.svelte`, `SessionPersonas.svelte`,
  `SessionBenchedSeats.svelte` (per-seat read-only for a guest; owner unchanged).
- `src/lib/client/components/Header.svelte` (the session page's entry into Edit session).
- DOM tests under `src/lib/client/components/sessionForms/editSession*.dom.test.svelte.ts` and
  `src/lib/client/components/headerFurl.dom.test.ts` (or a new `src/lib/client/components/headerGuestEntry.dom.test.ts`).

Readable: anything. Not yours: every server file, docs, NOMENCLATURE (worker w2 has those), `SessionsSidebar.svelte`,
`SessionVisibilityPanel.svelte` (render it, don't edit it), the document-view routes.

## Build

1. **No tabs for a guest.** In `EditSessionForm.svelte`: for a guest, do not render `PanelTabStrip`, the Settings
   tabpanel (`#session-panel-settings`) or the Privacy tabpanel (`#session-panel-visibility`) at all (`{#if
   !isGuest}`: absent, not hidden). The participants content always shows for a guest, whatever `initialTab` /
   `activeSessionTab` say (an opener may still pass `"settings"`); for a guest it is not a `role="tabpanel"` (no tab
   labels it) — keep its id. Owner: unchanged.
2. **Above the tabs, for a guest:** no **Name** card (the panel header already shows the session's name). The guest
   banner (currently *"You're a guest in this session. You can manage characters and personas below — guests and
   session settings (name, scenario, lorebook, tags, etc.) can only be changed by the session owner."*) becomes ★:
   *"You're a guest in this session. You can change your own seats here; everything else is the session owner's."*
3. **Privacy for a guest moves into the participants view** (★): a guest's own exposure (`sessions:accountVisibility`,
   drawn by `SessionVisibilityPanel`) stays shown — render `<SessionVisibilityPanel {accountVisibility} />` at the
   foot of the participants content for a guest only, and ask `sessions:accountVisibility` for a guest when the
   session loads (the existing `$effect` near line 1964 asks it only when `activeSessionTab === "visibility"`; add
   `|| isGuest`). Do not edit `SessionVisibilityPanel.svelte`.
4. **Guests card, for a guest:** keep the list of guests (name + the existing user icon: name and avatar only), drop
   **Add guests** and each row's remove ×. The owner's switches are already owner-only. Owner: unchanged.
5. **Envoys, for a guest:** the envoy `Switch` (today `disabled={isGuest}`) becomes words for a guest (★): *"In this
   session"* when seated, *"Not in this session"* otherwise; the card's sentence *"Switch one on to include it."* is
   not shown to a guest. Owner: unchanged.
6. **No notes reading for a guest.** With the Settings tab gone a guest mounts no `SessionLorebookReading`. Also the
   form's own `ownTime.listen(socket, id)` `$effect` (near line 615) must not run for a guest (it emits
   `lorebooks:lines`): return early when `isGuest`. Check with the re-pinned test below that a guest's form emits no
   `lorebooks:lines` at all. Change nothing else about notes.
7. **Others' seats read-only for a guest; their own seats keep lane gs-3a's controls exactly.** A guest's own seat:
   - carded character: `c.userId === me` (an unsaved "Ready to add" row is always the guest's own add);
   - card-less cast member: no saved seat yet, or the saved seat's `seatedByUserId === me`
     (`savedMemberSeat(m.id)?.seatedByUserId`; `sessions:get` sends the full row);
   - carded persona: `p.userId === me`;
   - card-less player seat: the existing `mine` (`seat.userId === me`).
   The owner owns every seat (`!isGuest || …`, the existing `mine` pattern; pass `isGuest` and `userCtx` to
   `SessionCharacters` as the other two already take them). On a row that is not the guest's: no move up/down, no
   grip, no **Bench**, no remove ×, no **Bring back**, no ⋯ menu items; a player seat's name is **text**, not a
   disabled input. On the guest's own rows: exactly what gs-3a left (`canChangeCarded` / `canChangeCastSeats` still
   freeze them when the owner's switch is off). **Drag** reorders and benches any row, so for a guest set
   `dragDisabled` true in each zone (their own rows keep the up/down and Bench/Bring back buttons). **Add a
   character / Add a persona** unchanged.
   Who plays a seat, for a guest: a carded persona row's second line reads `seatPlayerWords(p.userId)` (the existing
   words: *Your character* / *‹name›'s character* / *A player's character*) in place of the description, guest only
   (★). Pass `seatPlayerWords` where needed.
8. **Save, for a guest, sends only what this view edits** (small change, do not restructure Save): in `handleSave`,
   for a guest `updateSession.session` is `{ id: session.id }` and `tags` / `playerLabel` / `sceneSettings` are not
   sent; seat fields (`characterIds`, `personaIds`, `characterPositions`, `castMemberIds`, `playerSeatChanges`,
   `seatName`… whatever the participants view sets) go as today. Make sure the story-clock confirm branch
   (`STORY_CLOCK_KEYS.every((k) => k in sent)`) cannot fire for a guest. Background: the server drops a guest's
   non-seat fields on purpose (`sockets/sessions.update.ts` ~276–290); w2 tests that a guest's seat-only Save with
   `session: { id }` lands.
9. **Header entry** (`Header.svelte`): `openSessionCtx.isOwner` exists. For a non-owner, the header button and the
   narrow menu item read **Participants** (★; `aria-label`/`title` "Participants", visible label "Participants",
   icon `Icons.UsersRound`) and open Edit session on `sessionTab = "participants"`; the owner's stays **Session
   settings** / **Settings** on `"settings"`. Update the doc comment.

## Tests (Done means)

- New DOM test file `src/lib/client/components/sessionForms/editSessionGuestView.dom.test.svelte.ts` (copy the
  harness of `editSessionGuestSeats.dom.test.svelte.ts`): a guest's form has no tablist and none of: Settings /
  Privacy tab, `#session-panel-settings`, `#session-panel-visibility`, the Name field `#sessionName`, scenario,
  tags, Add guests, a guest row's remove ×; it shows the participants content and the Privacy panel's *"What this
  session sees of your data"*; on another person's seat no Bench / remove / move / grip and a player seat's name is
  text; on the guest's own seat the Bench button is present; envoys read in words; an `initialTab: "settings"` guest
  still sees the participants content; a guest Save emits `sessions:update` whose `session` is exactly `{ id }` and
  has no `tags` key. The owner's form: tablist with Participants, Settings, Privacy; Name field; Add guests.
- Header: a non-owner sees **Participants** and pressing it sets `digest.sessionTab = "participants"`; the owner
  sees **Session settings** → `"settings"`.
- **Re-pin** (old → new, list each in your report): `editSessionGuestOwnNotesReading.dom.test.svelte.ts` → *"a
  guest's Edit session has no Settings tab and sends no `lorebooks:lines` request"*;
  `editSessionLorebookLine.dom.test.svelte.ts` :164, :169 (guest sees the book's name) → a guest has no lorebook
  line; `editSessionPlayerSeats.dom.test.svelte.ts` :153 (disabled input on another's seat) → text;
  `editSessionGuestSeats.dom.test.svelte.ts` where a guest's controls on someone else's seat are asserted; any
  other guest case in `editSessionAdvanced`, `editSessionHowStrict`, `editSessionSaveParity`, `editSessionBench`,
  `editSessionCastMembers` that breaks. Never weaken an owner assertion.
- Run, one run at a time, each after the wait line, logs numbered:
  `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2b-w1-<n>.log 2>&1"`
  First your new file + the re-pinned ones, then every `src/lib/client/components/sessionForms/editSession*.dom.test.svelte.ts`
  plus the header test. Never pipe vitest into `head`.
- `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 errors;
  `NODE_OPTIONS=--max-old-space-size=10240 npm run check` → 0 errors in your files. `npx prettier --check` your files.

## Stop and ask (write it in your report and stop that item) when

A guest would lose a seat control on their **own** seat that gs-3a gave them; the participants list needs a read
the server closes (`sessions:pipelineCards` is the only one closed); a change needs a new name, setting, event or a
file not listed above; any copy beyond the ★ sentences above.

## Report (your final message, under 400 words)

Changed files; each ★ as built; tests run (log paths, pass counts); re-pins old → new; anything you could not do;
Noticed, not done.
