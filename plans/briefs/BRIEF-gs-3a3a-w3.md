# BRIEF gs-3a3a-w3 — the client readers of a player seat's person, and the owner seats someone in Edit session

Repo `/home/jody/github/serene-pub` (app). The SDK repo `../serene-pub-sdk` is **read-only**: no edit, no build.
Supervisor: lane `gs-3a3a`. Report: your final message, under ~500 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: don't run one.)

Also: run **no git command that changes the index or the working tree**. Never `prettier --write`, never pipe prettier's output into a file. No migration, no `npm run build`, no full test run.

## Rulings (owner, 2026-11-17, quoted) and the rule

- PS1: "If the card owner is the session owner, seat the card as a cast member, keep the card connected. There's no reason to make it cardless just because a guest is using it. You're over thinking it."
- S1: "One persona seat group per user. The owner can seat anyone they want to whoever they want as long as it's something they can see. The guest can seat to themselves when allowed, with cards they are allowed."
- S2: the owner re-assigns only seats holding their own cards or card-less cast members; a guest's card is never handed to another person.
- **One rule: the person of a player seat is `session_personas.user_id`** (the session payload's `sessionPersonas[].userId`); a row with `userId` null reads its card's owner (`persona.userId`).

The server side is built (lane worker w1): `sessions:update` accepts
`playerSeatsFor?: { toUserId: number; characterId?: number; castMemberId?: number; seatName?: string }[]` (exactly one of the three; the session's owner only; the person is the owner or a guest who plays; `characterId` must be the owner's own card; a card or member a live player seat holds is refused; the server skips a card named here in the `personaIds` add loop, so the card may stay in `personaIds`), and `seatHandovers [{ playerSeatId, toUserId }]` now accepts a **carded** player seat whose card is the session owner's (still refused for a guest's card). Read `src/lib/shared/sockets/types.ts` (`playerSeatsFor`) and `src/lib/server/sessions/guestSeats.ts` (`resolvePlayerSeatsFor`, `resolveSeatHandovers`) to match.

## Project rules (quoted)

- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · "Sockets: … views register listeners for local state and never call `toaster`." · "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." · "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." · "It is a **session**, never a *chat*." · "Do what was asked, at the size asked. Findings … under **Noticed, not done**."
- STYLE-GUIDE §6.1: "One primary button per surface … Secondary actions are tonal." §9: "Every interactive element is a real `button`, `a` or input with an accessible name; icon-only buttons carry `aria-label`." "Targets are 44px on touch." §10: "Sentence case everywhere." "A button says what happens." "Labels are nouns, hints are sentences." "No filler."
- Comments state the rule, never the history.
- Skeleton components: before using one, `grep -n "^# <Component>" AI-TEMP/skeleton-llms-svelte.txt` and read that section only. Prefer the project's existing `../inputs/Select.svelte` (it has `accessibleName`).

## Files owned (only these, only the named parts)

All under `src/lib/client/components/`:
- `sessionPage/sessionPageData.svelte.ts` — **only** `userPersonasInSession` (~600–606).
- `sessionPage/sessionPageProjections.ts` — **only** `canControlMessageAs`'s carded branch (~265–276). Another lane has uncommitted edits in this file: re-read right before editing, touch only that line.
- `sessionPage/projections/attendance.ts` — `personaOwnersOf` (~56) and the head comment (~12).
- `sessionForms/SessionPersonas.svelte`, `sessionForms/EditSessionForm.svelte` (seat parts only), `sessionForms/seatGroups.ts`, `sessionForms/editSessionForm.ts` (types only if needed).
- Tests: `sessionPage/projections/attendance.test.ts`, `sessionPage/sessionPageProjections.cardless.test.ts` (or a new `sessionPageProjections.personaSeat.test.ts`), new `sessionForms/editSessionSeatsForPeople.dom.test.svelte.ts`.
Not yours: every server file, `shared/`, docs, NOMENCLATURE, other components (`SessionCharacters.svelte`, `SessionBenchedSeats.svelte`, modals, `Select.svelte`). If you need one, stop and say so.

## Task A — the client readers (before → after)

1. `userPersonasInSession` (the composer's speak-as list): `cp.persona?.userId === me && !cp.removedAt` → `(cp.userId ?? cp.persona?.userId) === me && !cp.removedAt` (a carded seat; keep the rest).
2. `canControlMessageAs`, carded branch (~275): `.some((cp) => cp.persona?.userId === me)` → `.some((cp) => (cp.userId ?? cp.persona?.userId) === me)`.
3. `personaOwnersOf` (Who's here, ~56): `const userId = seat.persona?.userId` → `seat.userId ?? seat.persona?.userId`; fix the head comment ("Who writes as whom is the persona card's owner") to the one rule. Check the source type carries `userId` on a seat (the card-less branch already reads `seat.userId`).
Unit tests: the owner's card seated with `userId` = guest → the guest's (speak-as / can control / `"<guest>:<card>"`), not the owner's; `userId` null → the card's owner (unchanged).

## Task B — Edit session › Participants › Personas, for the session's owner

Read first: `SessionPersonas.svelte` (all), and in `EditSessionForm.svelte`: `savedPersonaSeat`/`savedPlayerSeat` (~584–591), the people helpers and `playedByChoice`/`setPlayedBy` (~593–730), `handleAddPersona`/`handleRemovePersona` (~1213–1245), the save builder (~1585–1720, `seatHandovers`, `sharedCardSeats`), the reset (~2027, `handoverDraft.clear()`), the `SessionPersonas` mount (~2836–2866) and the `PersonaSelectModal` mount (~3565). `seatGroups.ts` (pure helpers). Existing DOM tests to copy: `editSessionSeatGroups.dom.test.svelte.ts`, `editSessionSharedCards.dom.test.svelte.ts`.

1. **Groups.** For the owner (`!isGuest`) a group shows for the owner (today's rule) and for **every saved guest who plays** (`savedPlayerGuests`), even when empty, now that it has an add control. A guest's view is unchanged (their own group only when empty). Pass the list as a new prop (e.g. `addFor: number[]`).
2. **Add a persona, for that person.** The owner's **Add a persona** button appears in each group they see; in another person's group its accessible name is "Add a persona for ‹personName›" (★). It opens the existing `PersonaSelectModal` (the owner's own cards) remembering whose group asked (`onAddPersona(who)`). A card picked for someone else becomes a pending row in **that** group: keep a `SvelteMap<number, number>` card id → person for unsaved rows; `personaPlayer(p)` reads it for an unsaved row (today: always the viewer), and for a saved row reads the handover draft first (`handoverDraft.get(\`player:${saved.id}\`)`), then `saved.userId ?? p.userId`. Removing the pending row drops its entry; the reset clears the map.
3. **A card-less member or a named seat, for a person** (owner only, in each group they see, the owner's own included):
   - a `Select` labelled **Add a cast member** (★; `accessibleName` "Add a cast member for ‹personName›"), offered only when there are options: the book's card-less members (`bookMembers` with `cardId == null`) not held by any seat in the form (character seats `selectedMembers`/`benchedMembers`, saved live player seats' `castMemberId`, and pending rows). Picking one adds a pending row (its name, "Ready to add", Remove) in that group.
   - a text input (accessible name **New seat name**, placeholder "Name a new seat", ★) with a tonal button **Add a seat** (★), disabled while the name is blank; adds a pending named row.
   Hold these pending rows in one `$state` array (`{ key, toUserId, castMemberId? , seatName?, name }`, key `member:<id>` or `name:<n>` from a counter, never `crypto.randomUUID`).
4. **Save** sends `playerSeatsFor` only when non-empty and only for the owner: one entry per pending card in the map whose person is not the owner (`{ characterId, toUserId }`) and one per pending card-less row (`{ castMemberId, toUserId }` / `{ seatName, toUserId }`). Count the pending card-less rows wherever the form already counts `sharedCardSeats` of kind `player` toward persona totals (~496–503), if it does.
5. **Played by on a carded persona row.** For the owner, a saved in-play persona row whose card is the owner's (`p.userId === ownerId`) shows the same **Played by** `Select` the named seats show, through `playedByChoice("player", saved.id)` / `setPlayedBy("player", saved.id, …)` (key `player:<seatId>`, already turned into `{ playerSeatId }` by `handoverSeatOf`). A guest's carded persona shows none. After a pick the row shows in the chosen person's group (it reads the draft, as named seats do).
6. **The guest's view** of the owner's card seated for them: it shows in their own group with no bench, remove or reorder control (today's `mine` reads the card's owner, which is what we want: the guest cannot remove the owner's card). Leave it; test it.
7. No toast in the view; no new socket listener.

## Tests

- Unit tests of Task A (above).
- DOM `editSessionSeatsForPeople.dom.test.svelte.ts`: the owner sees an empty group for a guest who plays and none for a watcher; **Add a persona for Bo** → pick a card → the row is in Bo's group, "Ready to add"; Save sends `playerSeatsFor: [{ characterId, toUserId: bo }]`; the cast-member Select and the named seat each add a pending row and an entry; **Played by** shows on the owner's saved carded persona and not on a guest's; picking Bo sends `seatHandovers: [{ playerSeatId, toUserId: bo }]` and moves the row into Bo's group; the guest's view of the owner's card seated for them has no bench/remove control.
- Then one run of: your new/changed test files plus `sessionForms/editSessionSeatGroups.dom.test.svelte.ts`, `editSessionGuestSeats.dom.test.svelte.ts`, `editSessionGuestView.dom.test.svelte.ts`, `editSessionPlayerSeats.dom.test.svelte.ts`, `editSessionSharedCards.dom.test.svelte.ts`, `editSessionSaveParity.dom.test.svelte.ts`, `editSessionBench.dom.test.svelte.ts`, `editSessionCastMembers.dom.test.svelte.ts`, `sessionPage/projections/attendance.test.ts`, `sessionPage/sessionPageProjections.cardless.test.ts`.
  `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a3a-w3-<n>.log 2>&1"` — one run at a time, always at least one path, never pipe vitest into `head`. (A failing assert on a happy-dom element has OOM-killed VS Code: keep the cap.)
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` and `NODE_OPTIONS=--max-old-space-size=10240 npm run check`: 0 errors **in your files** (lanes `wt-1a`/`ap-2a` may have errors in theirs).
- If an existing test's expectation changes, don't edit it: report which and why.

## Report

Files changed; each reader before → after; the new controls with their labels and accessible names (all ★); what Save sends; tests (log path, counts); tsc/check for your files; prettier `--check` (report only); **Noticed, not done**.
