# BRIEF — worker `gs-3a3b-2-w2` — client: **Played by** moves a seat between a person's Personas group and the AI-played group

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-3a3b-2`. SDK repo is read-only.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: no SDK edit.)

The repo is staged by the lead: run **no git command that changes the index or the working tree** (`git diff` / `git status` are fine). Never run prettier with `--write` and never pipe its output into a file. No `npm run build`, no full test run, no migration.

## Goal

The server now moves a seat both ways through `sessions:update { seatMoves }` (owner only):
`seatMoves?: Array<{ playerSeatId: number } | { characterSeatId: number; toUserId: number }>` (`src/lib/shared/sockets/types.ts` ~7355; read it). Give the owner the control in **Edit session › Participants**: the existing **Played by** Select gains the cross-kind choices, a confirmation built into the page, and the form sends the move.

## Files owned (edit only these)

`src/lib/client/components/sessionForms/EditSessionForm.svelte` (the "Played by" block ~612–787 and the save payload ~1735–1800 only), `SessionPersonas.svelte`, `SessionCharacters.svelte`, `seatGroups.ts`, `editSessionForm.ts` (the `PlayedByChoice` type only), new tests: `src/lib/client/components/sessionForms/editSessionSeatMoves.dom.test.svelte.ts`, `src/lib/client/components/sessionForms/seatGroups.test.ts` (add cases), new `src/lib/client/components/sessionPage/projections/seatIdentity.seatMove.test.ts`. If a reusable piece is clearly needed (e.g. a small `SeatMoveConfirm.svelte` beside the seat components), you may create it in `sessionForms/`; name it in your report. Nothing else. Other lanes are editing other parts of `EditSessionForm.svelte`'s neighbourhood: change only the lines named.

## What the server allows (offer exactly this; nothing more)

- Only the **session's owner** moves; a guest viewer sees no move choice anywhere.
- **Persona row → the AI-played group** (`{ playerSeatId }`): a saved, in-play player seat that has a card or a cast member: the owner's own carded personas, **any guest's persona with their own card** (S2: "Guest cast members can still be moved to the ai playable seats by the owner freely, even personas"), and a card-less seat that has a cast member (`castMemberId` on the saved row). A named seat with neither card nor member: no move choice (the server refuses it).
- **AI-played row → a person's Personas group** (`{ characterSeatId, toUserId }`, `characterSeatId` = the saved `session_characters.id`, not the card id): a saved, in-play, non-envoy character seat holding **the owner's own card** or **a card-less cast member** → to the owner or any saved guest who plays; a seat holding **a guest's own card** → only back to **that guest**. Never another card.
- Not while the card or member already has a live seat of the other kind (★K-2): if the form's saved session shows one, do not offer the move for that row.

## The choices (words are ★ provisional; use exactly these)

- On a **persona row** (owner's view): add **No one** (value: a sentinel such as `"ai"`, never a user id) after the existing options. It reads like the AI-played rows' **No one** ("the story plays it"). For a guest's own carded persona, which today shows no **Played by**, show one with two options: the guest (current, by name) and **No one**.
- On an **AI-played row** (owner's view): keep the existing options exactly (**No one** = the owner as seater, the story plays it; each guest = the in-place handover). Add, after them, one move choice per person allowed above, labelled **‹Name› as a persona** (**You as a persona** for the owner). For a guest's own card (today no **Played by**), show one with: the guest by name (current) and **‹Guest› as a persona**.
- Picking a move choice does not change anything yet: it opens the confirmation (below). Picking any non-move choice clears a drafted move of that row.

## The confirmation (built into the page; never `confirm()`, `alert()` or a toast)

Under the row's Select (`basis-full`, wraps at 400 px), a small region with `role="group"` and an accessible name that includes the seat (e.g. "Move ‹name›"), holding one sentence and two buttons:
- to the AI: *‹Name› moves to the characters the story plays when you save. Its earlier lines stay as they are.*
- to a person: *‹Name› moves to ‹Person›'s personas when you save. Its earlier lines stay as they are.* (*your personas* for the owner.)
- buttons **Move** (tonal, `preset-tonal-primary btn-sm`; the form's Save stays the one filled primary; accessible name "Move ‹name›") and **Cancel** (tonal surface; "Cancel moving ‹name›"). **Move** records the move in a draft held until **Save** (a `SvelteMap`, keyed like `handoverDraft`, never `$state(new Map())`) and clears any handover drafted for that row; **Cancel** returns the Select to the value it had before the pick, and drafts nothing. Focus after either goes back to the row's Select.
- After **Move**, the row keeps showing the picked move choice in its Select and one quiet line *Moves on Save* (`text-surface-600-400 text-xs`). The row stays in its group until the save (the form closes on save and re-reads the session, which shows the seat in its new group; check that it does, and say so).

## The payload

The save sends `seatMoves` only when a move is drafted: `{ playerSeatId }` for a persona row, `{ characterSeatId, toUserId }` for an AI-played row. **Leave `personaIds`, `characterIds` and `castMemberIds` as the form builds them today**: the door's rule (`src/lib/server/sockets/sessions.update.ts` ~906–917, read it) ignores the moved card or member in the lists of the same save, so the lists need no change. No `seatHandovers` entry is sent for a row that has a move. The draft clears where `handoverDraft.clear()` runs (~2109).

## Unchanged

The drag rules of the seat groups (a drop into another group is still refused: the move is by **Played by** only); every existing **Played by** option, label and handover; the guest's view; benching.

## Rules (quoted)

- STYLE-GUIDE §1.8 "Sentence case, plain verbs. Labels are sentence case. Buttons say what happens."; §1.10 "Filled `primary` is the region's one next action (… a form's Save)"; §1.3 "A view is complete at 400px"; §1.6 "Nothing scrolls sideways."
- CLAUDE.md: views never call `toaster`; `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`; browser code: no `crypto.randomUUID`, no `navigator.clipboard`; `socket.off(event)` always with the handler.
- Comments state the rule, never history. `src/lib/shared/conformance/commentHistory.test.ts` must pass on your files.
- Accessible names include the seat (the Select already reads "Played by, ‹name›").
- The walk in a real browser (`plans/REPORT-walk-2-2026-11-17.md`) found the drag library's real event order matters: do not touch `handleSeatDrag` or the dnd zones.

## Tests

1. `editSessionSeatMoves.dom.test.svelte.ts` (copy the setup of `editSessionSeatGroups.dom.test.svelte.ts`): the owner's carded persona offers **No one**; a guest's carded persona offers the guest and **No one**; a named seat with no card and no member offers no **No one**; a card-less member's player seat offers **No one**; an AI-played row of the owner's card offers **No one**, each guest, **You as a persona**, each **‹Guest› as a persona**; a guest's card on an AI-played row offers only the guest and **‹Guest› as a persona**; a guest viewer sees no move choice; picking a move shows the confirmation with the exact sentence and nothing is drafted; **Cancel** restores the Select and the save sends no `seatMoves`; **Move** then **Save** sends exactly `seatMoves: [{ playerSeatId }]` or `[{ characterSeatId, toUserId }]` and no `seatHandovers` for that row; accessible names of the group and buttons include the seat; a ★K-2 row (card with both seats live) offers no move.
2. `seatGroups.test.ts`: any pure helper you add (e.g. the payload builder) with cases.
3. `seatIdentity.seatMove.test.ts`: after an AI → person move the payload holds the departed character seat (`removedAt` set, `ref` `seated-member:<M>`) and a live player seat (`ref` `player-seat:<P>`, same `castMemberId`): `seatOfMessage` for an assistant line stamped `seated-member:<M>` returns the character seat; a user line stamped `player-seat:<P>` returns the player seat; and the person → AI mirror (an old user line stamped `player-seat:<X>` of a removed player seat returns that player seat, not the live character seat). Read `src/lib/client/components/sessionPage/projections/seatIdentity.ts` 55–215 first. If a case fails, stop and report it (do not fix that file).

Run, one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a3b-2-<n>.log 2>&1"` with `<n>` from 30 to 49 (always at least one path; never pipe vitest into `head`). Done means green: your three test files, and the existing `editSessionSeatGroups.dom.test.svelte.ts`, `editSessionGuestSeats.dom.test.svelte.ts`, `editSessionGuestView.dom.test.svelte.ts`, `editSessionPlayerSeats.dom.test.svelte.ts`, `editSessionSeatsForPeople.dom.test.svelte.ts`, `editSessionSaveParity.dom.test.svelte.ts`, `editSessionBench.dom.test.svelte.ts`, `src/lib/shared/conformance/commentHistory.test.ts`. List any existing test whose expectation you had to change and why (none should). Then `NODE_OPTIONS=--max-old-space-size=10240 npm run check` once: 0 errors in your files (report the total line).

## Stop and ask (in your report) when

A choice the server allows cannot be shown without changing an existing option or label; a new label or sentence beyond those above seems needed; the form does not re-read the session after a save; anything outside the owned files must change.

## Report

Final message: changed files, every visible word you added, the payload as sent (one example of each shape), tests with counts and log numbers, `npm run check` total, Noticed-not-done. Under ~500 words.
