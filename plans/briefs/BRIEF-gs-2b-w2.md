# BRIEF — worker `gs-2b-w2` (server, tests, docs, names) — `sessions:pipelineCards` is the owner's; a guest's Edit session documented

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-2b`. Use absolute paths; your cwd resets between
commands.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`. Do not run one.) Both repos are staged: run **no** git command that changes the index or
working tree (no add, reset, checkout, restore, stash, commit). Never `prettier --write`. No migration, no new
socket event, no new setting. Inside `db.transaction(async (tx) => …)` use only `tx`.

## Goal (owner ruling G1, 2026-11-16)

Owner: *"The session page, plus the full participants list read-only."* *"Guests can only see the session detail
view, and manage cast/cards they own."* Standing: enforce at the server. A **guest** is a `session_guests` row
(`checkSessionAccess` → `isGuest`); an administrator in another person's session is a guest (G6).

Worker w1 is changing the client at the same time (`EditSessionForm.svelte`, the seat components, `Header.svelte`):
do not edit client files.

## Files owned (edit only these)

- `src/lib/server/sockets/sessions.pipelines.ts` — `sessionsPipelineCardsHandler` only (~line 526–551).
- New `src/lib/server/sockets/sessions.guestEditSession.int.test.ts`.
- `docs/sessions.md`, `docs/group-sessions.md` (small targeted edits; re-read each right before editing: other
  lanes edit these files too).
- `NOMENCLATURE.md`: the §9 **guest** row and one new §25 entry (re-read right before editing; small edit).

## Build

1. **Close `sessions:pipelineCards` to a guest.** Today it answers any member (`access.hasAccess`). Make it
   `access.hasAccess && access.isOwner`, a guest getting `{ sessionId, cards: [] }` with no error (the same manner as
   `sessions:pipelines` at ~1100, D58 + G6). Update its doc comment ("the owner's; a guest, administrators
   included, gets none (G1, 2026-11-16)"). Change no other handler.
   **Do not change** `sessions:get`, `sessions:view`, `sessions:genres`, `sessions:storyClock`, `sessions:functions`,
   `sessions:accountVisibility`, `sessions:update`: the session page and a guest's own seat sections need them.
   `sessions:update` keeps dropping a guest's non-seat fields silently; that is deliberate
   (`sessions.update.ts` ~276–290). Do not make it refuse.
2. **Test file** `sessions.guestEditSession.int.test.ts` (copy the harness of
   `src/lib/server/sockets/sessions.guestSeats.int.test.ts`: test DB mock, `socket(userId)`, `createTestUser`, a
   session with a guest row; `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`; temp dir prefix
   `serene-pub-vitest-guesteditsession-`). Assert on the **serialised** reply (`JSON.parse(JSON.stringify(res))`):
   - `sessions:pipelineCards`: guest → `cards: []`; an administrator who is a guest (`user: { isAdmin: true }`) →
     `cards: []`; the owner → equal to `listSessionPipelineCards(db, sessionId)` (non-empty if the bootstrapped
     pipelines expose a node to that session; say in your report whether it was). A stranger → `cards: []`.
   - Pins, unchanged (the session page needs them): a guest gets `sessions:view` answered for the session (no
     error), `sessions:genres` its list, `sessions:storyClock` answered (no access error), `sessions:functions`
     `functions: []`, `sessions:accountVisibility` `isGuest: true`. Find each handler's export in
     `src/lib/server/sockets/` and call its `.handler(socket, params, emitToUser)` as the harness does.
   - `sessions:update`: (a) a guest's seat-only Save with `session: { id }` and `characterIds` adding a card the guest
     owns lands (the seat exists after); (b) a guest's Save carrying a different `name`, `scenario`, `tags` and the
     same seat change: the seat lands and the session's name, scenario and tags are unchanged. The owner's Save of a
     new name still lands.
   Run, after the wait line, logs numbered:
   `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/sessions.guestEditSession.int.test.ts > plans/gs-2b-w2-<n>.log 2>&1"`
   Then once with `src/lib/server/sockets/sessions.guestSeats.int.test.ts` and
   `src/lib/server/pipelines/entities/bindings.int.test.ts` added. Never pipe vitest into `head`.
3. **Docs** (plain user-facing words, the files' existing voice; ★ copy is the supervisor's proposal):
   - `docs/sessions.md` § *Session settings* (~line 400): **Settings** at the top of the session is the owner's; a
     guest's reads **Participants** and opens the participants list. "The form has three tabs" → the owner's form;
     a guest's has no tabs (see Guests). § *Participants* (~407–415): a guest sees every seat and who plays it,
     read-only except their own seats (which they change as *What guests may seat* says); **Guests**: a guest sees
     the guests' names, nothing to add or remove; envoys read *In this session* / *Not in this session* for a guest.
     § *Privacy* (~512): a guest sees it at the foot of the participants list. ~583 *"Guests see the session's line
     and clock, its own notes' included, but can't change them."* → guests can't change them and Edit session
     doesn't show them to a guest (touch nothing else about the notes: another lane owns those). § *Guests* (~621):
     one sentence: in **Edit session** a guest sees only the participants list: every seat and who plays it, the
     guests' names, and what the session shows of their own data; nothing else of the session's settings.
   - `docs/group-sessions.md` ~line 20: one sentence to the same effect, linking to the sessions.md section.
4. **NOMENCLATURE.md** §9 **guest** row (~line 442): replace *"**Ruled, not yet built:** Edit session for a guest and
   the session notes."* with a **Built 2026-11-17 (lane gs-2b; G1)** clause: Edit session for a guest is the
   participants list alone (no tabs; others' seats read-only; their own seats as gs-3a left them; the guests'
   names; their own Privacy view at its foot); `sessions:pipelineCards` answers a guest `cards: []`; the header's
   entry reads **Participants** for a guest (🚧 copy). Keep *"**Ruled, not yet built:** the session notes."* §25:
   append one entry after the last line, in the existing style: `- **2026-11-17 (lane gs-2b — Edit session for a
   guest is the participants list; owner ruling G1, 2026-11-16 "The session page, plus the full participants list
   read-only"; 🚧 provisional copy, not ruled; no migration, no new event or name).** *changed* …` listing:
   `sessions:pipelineCards` (owner only; a guest gets `cards: []`); Edit session for a guest (no tab strip, no
   Settings or Privacy tab, no Name card; others' seats read-only; Privacy view at the foot of the participants
   list); a guest's Save sends `session: { id }` and the seat fields only; the header's **Session settings** reads
   **Participants** for a non-owner; the ★ sentences: the guest banner *"You're a guest in this session. You can
   change your own seats here; everything else is the session owner's."*, envoys *"In this session"* / *"Not in
   this session"*.

## Stop and ask (write it in your report and stop that item) when

A closed read turns out to be used by the session page (grep `sessions:pipelineCards` across `src/`: only
`PipelineCards.svelte`, used by `EditSessionForm.svelte` and `src/routes/document-view/sessions/[id]/edit/+page.svelte`
— report the latter, don't edit it); a test needs a production change other than item 1; a new name.

## Report (your final message, under 350 words)

Changed files; the event table (guest before → after, owner); tests run (log paths, pass counts); whether the
owner's cards were non-empty; Noticed, not done.
