# BRIEF — worker `gs-3a2-w2` (client): the participants area grouped by person, the "Played by" control, S3's line, the switches' new condition

Repo `/home/jody/github/serene-pub` (app). The SDK repo is read-only. Supervisor: lane `gs-3a2`. Worker 1 already built the server half (read it, don't change it): `sessions:update` now takes `seatHandovers?: Array<{ characterId?; castMemberId?; playerSeatId?; toUserId }>` (`src/lib/shared/sockets/types.ts`, in `Sockets.Sessions.Update.Params`), checked by `resolveSeatHandovers` (`src/lib/server/sessions/guestSeats.ts`) — read that function: it is the exact set of moves the client may offer.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`: do not run one.)

Also: run **no git command** that changes the index or the working tree. Never `prettier --write` (not even on one file). No server edit. It is a **session**, never a *chat*.

## Rules your work depends on (quoted)

- CLAUDE.md: "views register listeners for local state and never call `toaster`"; "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`"; "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler"; "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- STYLE-GUIDE §1: "**A view is complete at 400px.** … Width changes the arrangement, never the feature set." "**Nothing scrolls sideways.**" "**Sentence case, plain verbs.**" Read-only is said in words, and a control a person may not use is **absent, never disabled**. Muted text is `text-surface-600-400`.
- The project's select pattern is `src/lib/client/components/inputs/Select.svelte` (a Combobox with listbox ARIA; `label`, `options: {value,label}[]`, `value`, `onValueChange`). Use it; never a native `<select>`, never a Menu.
- Owner 2026-11-17: S1 "One persona seat group per user. The owner can seat anyone they want to whoever they want as long as it's something they can see. The guest can seat to themselves when allowed, with cards they are allowed." S2 "the owner re-assigns only seats holding their own cards or card-less cast members". S3: "say nothing beside a seat no person plays". S4: the two guest switches show only when the session has guests.
- The lane's cold review (verbatim, governs):
  > A **player seat** (`session_personas`) is played by its `user_id`. A **character seat** (`session_characters`) is AI-voiced and its person is its seater (`seated_by_user_id`). "No person plays it" = **a character seat seated by the session's owner**. … S3's line: the walk's D4 comes from `SessionCharacters.svelte` 158–159 passing the **card's owner** to `seatPlayerWords`; the seater already reaches the client (`SessionBenchedSeats.svelte:217`, `saved.seatedByUserId`): pass the seater, and show no line when the seater is the session's owner. **No new payload fact.**
  > **Groups.** One group per person holds that person's **player seats** only. Character seats stay one AI-played group; a character seat seated by a guest … shows there with the existing "‹name›'s character" line.
  > **Same-kind moves only.** … **Cross-kind moves (a person's player seat ↔ the AI-played group) are NOT built.**
  > **Layout rules.** Benched seats stay in the one **Benched** section, each labelled with its person. Player-seat order stays the one session-wide `position`: groups are a grouping of that order, reordering inside a group keeps the other groups' relative order, and dragging between groups is not offered (the move control is the Listbox). An empty group shows only where the genre lets that person add a persona. The guest switches show when the session has a guest **saved or pending in the form** ("Ready to add"), so a first guest needs one Save.

## Files owned (edit only these)

`src/lib/client/components/sessionForms/EditSessionForm.svelte`, `SessionPersonas.svelte`, `SessionCharacters.svelte`, `SessionBenchedSeats.svelte`, `BenchedSeatRow.svelte` (only if a meta line needs it), `editSessionForm.ts` (types only), a new `seatGroups.ts` + `seatGroups.test.ts` in the same folder (pure helpers), a new DOM test `editSessionSeatGroups.dom.test.svelte.ts`, and existing `editSession*.dom.test.svelte.ts` files only where an expectation this task changes needs re-pinning (list each old → new). Lane `ap-1` is live in `SessionViewPanel.svelte`: never touch it.

## Build

1. **People.** In the form: `ownerId = session.userId`; the session's **people** = the owner, then the **saved** guests (`session.sessionGuests`, in `selectedGuests` order), never a pending one. `personName(userId)`: "You" for the viewer; the owner, for a guest viewer, by `accountVisibility?.viewers` (`role === "owner"`, `username`), fallback "The session's owner"; a guest by `displayName || username`; fallback "Someone else". Extend `seatPlayerWords` to name the owner the same way (it falls back to "A player's character" for the owner today: walk D4, gs-2b noticed). A watcher is a `sessionGuests` row with `isPlayer === false`.
2. **The draft.** A `SvelteMap<string, number>` of handovers keyed `character:<cardId>` · `member:<castMemberId>` · `player:<playerSeatId>` → `toUserId`, cleared where the form reloads the session (where `originalData = undefined`). Each seat's shown person reads the draft first, then the saved row (`saved.seatedByUserId` for a character seat; `saved.userId ?? card owner` for a player seat), then the viewer for an unsaved row. Put the draft into the `data` object (and both its type literals) as `seatHandovers` (only entries that differ from the saved person, sorted by key) so the unsaved-changes compare sees it, and send it on Save as `seatHandovers` only when non-empty (destructure it out of `data` like `castMemberIds`). Nothing is written before Save, like every other participant change.
3. **Player seats grouped by person** (`SessionPersonas.svelte`, one card, heading stays **Personas**). Inside it, one group per person in the people order, then any other player id found on a seat (named by `personName`). A group shows when it holds a seat (carded persona or card-less named seat), or when it is the **viewer's own** group and the viewer may add a persona there (today's **Add a persona** condition, `canChangeCarded`); other people's empty groups do not show (no add-for-someone control exists in this build). Each group: an `h4` with the person's name (`text-surface-600-400 mb-1 text-xs`, as the Benched card's **Characters** / **Players** headings), then its carded rows, then its card-less named seats, then (own group only) **Add a persona**. Rows keep today's content and controls; a carded row's player is its saved `userId ?? card owner`.
   - **Order:** `selectedPersonas` stays the one session-wide order. Up / down move a row past the nearest row **of the same group** in that order (swap the two positions), disabled at the group's ends; every other row keeps its position. Pure helper in `seatGroups.ts`, unit-tested.
   - **Drag:** one dndzone per group. When only one person holds player seats, that group's zone keeps `type: "player-seat"` (drag to and from **Benched** works exactly as today). With two or more groups holding seats, each zone's type is `player-seat:<userId>`: drag reorders inside a group only, and benching is by the **Bench** button. A group zone's finalize fills that group's slots of `selectedPersonas` with the zone's new order (pure helper `fillGroupSlots`, unit-tested); with one group it equals today's `selectedPersonas = items`.
4. **The character seats** (`SessionCharacters.svelte`) stay one group. Second line of a row (carded and card-less member rows; member rows get a second line, which they lack today): when the seat's person (seater, draft first) is a person other than the session's owner → `seatPlayerWords(seater)` for every viewer; when it is the owner (no person plays it) → the owner sees `characterSummary(c)` on a carded row (as today) and nothing on a member row; a guest sees **nothing** (S3). Stop passing the card's owner (`c.userId`) to `seatPlayerWords`.
5. **"Played by"** (★ label): an `inputs/Select.svelte` on its own full-width line at the foot of a **saved, in-play** row (`basis-full` inside the row's wrapping flex), only where `resolveSeatHandovers` would allow a change; absent everywhere else. Value = the person's user id as a string; `onValueChange` writes the draft.
   - Owner viewer, character seat holding the **owner's own card** (`c.userId === ownerId`) or a card-less member: options **No one** (value `ownerId`; ★ label) then each saved guest who is a player, by name.
   - Owner viewer, **card-less named player seat**: options **You** then each saved guest who is a player.
   - Guest viewer, card-less member row, with **Guests can take cast members** on (saved switch, `canTakeCast`): when its seater is the owner (take) or the guest (hand back): options **No one** and **You**.
   - Never on a carded player seat, a guest's own card, an envoy, a pending row, or a benched row.
6. **Benched** (`SessionBenchedSeats.svelte`): one section as today; each row's meta line names its person: persona and named player rows → `seatPlayerWords(player)` for every viewer (player = saved `userId ?? card owner`); character and member rows → step 4's rule. Use the seater, never the card's owner. Change no control.
7. **The switches' condition** (EditSessionForm ~2685): also require `selectedGuests.length > 0` (saved or pending in the form). Absent otherwise.

## Tests

New `editSessionSeatGroups.dom.test.svelte.ts` (copy the mount and socket-stub pattern of `editSessionGuestSeats.dom.test.svelte.ts` / `editSessionPlayerSeats.dom.test.svelte.ts`):
- owner + guest G1 each with a persona → two groups headed **You** and G1's name, in that order; a guest viewer sees **You** and the owner's username (from `sessions:accountVisibility`) and has controls only in their own group;
- a guest viewer: no line beside an owner-seated carded character or member row; "‹G1›'s character" beside a G1-seated member row, for the owner and for G2;
- owner's **Played by** on a card-less member row offers No one + G1 + G2, not a watcher W; absent on G1's own carded character, on a carded persona, on a pending row and on a benched row; present on a card-less named player seat with You + guests; picking G1 then Save emits `sessions:update` with `seatHandovers: [{ castMemberId, toUserId: G1 }]`; with no pick, Save sends no `seatHandovers`;
- guest viewer: **Played by** on an in-play owner-seated card-less member with take cast members on (No one, You); absent with it off; absent on a benched one and on a member G2 seated;
- the switches absent with no guest; present with a saved guest; present after adding a pending guest in the form;
- `seatGroups.test.ts`: up / down within a group leave the other group's rows in their positions; `fillGroupSlots` keeps foreign rows in place.
Re-run the existing `editSessionGuestSeats`, `editSessionPlayerSeats`, `editSessionGuestView`, `editSessionBench`, `editSessionCastMembers`, `editSessionSaveParity` DOM tests; re-pin only what this task changed (list old → new).

Run tests **only** as, one at a time, always with paths:

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a2-w2-<n>.log 2>&1"
```

Never pipe vitest into `head`. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/gs-3a2-w2-tsc.log 2>&1` and `NODE_OPTIONS=--max-old-space-size=10240 npm run check > plans/gs-3a2-w2-check.log 2>&1`; report errors in your files. `npx prettier --check` on each file you touched (report; don't fix lines you didn't write).

## Stop and ask (write it in your report and stop that part) when

A rule above needs a server change or a file not listed; a control would not fit at 400 px without dropping it; you would add a label or sentence not written above (the labels here are **Played by**, **No one**, **You**, "The session's owner", "Someone else").

## Report

Your final message: changed files; what a group shows for the owner and for a guest; where **Played by** appears; each existing expectation re-pinned (old → new); tests run with log paths and counts; tsc / check / prettier; Noticed, not done. Under about 450 words.
