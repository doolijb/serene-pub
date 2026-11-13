# BRIEF — s4-follow-b-w2 (2026-11-09): one Add characters picker, guest reading, save parity

Supervisor: lane s4-follow-b. You are a lane-worker. Report back in your final message (the harness refuses report files): changed files, tests run and results, open questions, Noticed-not-done.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build` for this task.)

## Owner words this rests on (quote, never reinterpret)

- "List cast members first, list cards not in the cast second in the same picker." · "Merge cards and cast members who are the same individual." · "Don't think we need to announce cast members without cards this way, not having a card doesn't make them 2nd class." · "unrelated cards add someone new to the story" (2026-11-09).
- "Make sure the save behavior is the same for card or cardless." (2026-11-09, on s4-seat-live-2)
- ★s4-verify-2 approved: guests see the own-notes Line / Story clock **read-only** in the edit form, as they do for an attached book (#139).
- Approved, keep as built: ★s4-seat-live-1 — the Edit picker is multi-select only when the book has unseated card-less members.
- Memory rule "There is ALWAYS a lorebook": never write copy or code that frames a session as having no lorebook; say own book / notes.

## Goal A — one picker (`src/lib/client/components/modals/CharacterSelectModal.svelte`)

Today: a card list, then (multi mode only) a second group under the book's name with the muted line *Cast members with no character card.* and a conditional **Character cards** heading.

Build:
1. `PickMember` gains `cardId: number | null` (the member's linked card, `CastMemberRow.characterId`). Replace `cardlessMembers(rows)` with `castPickMembers(rows)` that returns **every** non-overlay row (`overlayOf == null`) — carded and card-less — with the same name rule (`ownNickname || name || "Unnamed character"`) and `faceMediaId`. Update both forms' imports. (Grep first: only the two forms and the modal's test use it.)
2. Grouping, whenever `castMembers` has anyone to offer (in single mode too):
   - **First group**, labelled `castGroupLabel` (the book's name; `ListGroupLabel`), no extra line: one row per individual.
     - A member with `cardId` whose card is among the offered `characters` (not excluded): ONE row that picks the **card id** (exactly as picking the card does today: `toggle(cardId)` in multi mode, `onSelect(card)` in single mode). Draw it with the card's row data but the member's shown name (`{ ...card, name: member.name, nickname: undefined }`), so it reads as the cast member. That card is then **not** repeated in the second group.
     - A card-less member (`cardId == null`): a row that toggles the member id (multi mode only — single mode can't return a member; leave card-less members out in single mode, as today).
     - A carded member whose card is excluded (already chosen) or not in `characters` (someone else's card): not offered (as today). Note it under Noticed.
     - Card-less and carded rows look identical (same `CharacterPickRow`, same `kind`). Drop the line *Cast members with no character card.* and the **Character cards** heading.
   - **Second group**: the offered cards not merged above. Heading (★ proposal — build it): `Your other characters`; under it, a muted line in the same style the old line used (`text-surface-600-400 px-3 pb-1 text-xs`): `Picking one adds someone new to the story.`
   - With no cast row to offer: one flat list, exactly as today (no headings).
   - Search filters both groups through `pickRowMatches`. Tick order and `selectedLimit` behave as today across both groups. `onMultiSelect(ids, castMemberIds)` unchanged: carded picks in `ids`, card-less in `castMemberIds`.
3. `StartSessionForm.svelte` (only the picker wiring around lines ~895–925 and ~3067): pass all members; `selectedMembers` / `membersToOffer` / `flow.keepCastMembersIn` must keep to **card-less** members (`cardId == null`) — carded picks travel as card ids, as today. Still only for `flow.mode === "new"` (not New world).
4. `EditSessionForm.svelte` picker wiring (~755–830, ~3386): same; `membersToOffer` (which decides multi mode, ★s4-seat-live-1) counts card-less unseated members only; `handleAddMany` unchanged in contract.

## Goal B — guest reading (`EditSessionForm.svelte`)

The server answers a guest: `lorebooks:lines` checks `assertReadableBook` → `lorebookAccessFor`, which returns `"owner"` for any session member on a session's own notes (`ownBookAccessFor`). So:
- `ownReadingBookId` (~line 521): drop the `!isGuest` condition; fix its comment (a guest reads the lines read-only).
- The own-notes `<SessionLorebookReading lorebookId={ownReadingBookId} …>` (~2778): add `readOnly={isGuest}`, like the attached-book one above it.
- Save: the own-notes reading travels only for the owner — make the `_reading` condition (~664) `(_lorebookId === null && showOwnReading && !isGuest)` (the server ignores it from a guest anyway; don't send it).
- Do not touch the read-only **book-name line** (`savedLorebookName` and its markup): lane s4-follow-a owns that line.

## Goal C — save parity, card vs card-less seats (`EditSessionForm.svelte`)

Audit of today (supervisor's read): a card seat's remove asks first (`confirmRemoveCharacter` → `ActionConfirm`), a card-less seat's remove (`handleRemoveMember`) doesn't; a card seat has the enabled switch (`activeDraft`, committed on Save by `commitParticipantChanges` → `sessions:setCastSeatEnabled { sessionId, characterId, enabled }`), a card-less seat has none; an unsaved card row says *Ready to add*, an unsaved card-less row says nothing. Fix, all on **Save** (nothing writes at once):
1. Card-less remove asks first with the **same** `ActionConfirm` and the same words the card remove uses (add `removeType = "member"`; `handleRemoveConfirm` routes it to `handleRemoveMember`).
2. Card-less rows get the same enabled `Switch` markup as card rows (same classes, title, icons, disabled-until-saved title *"Save the session to enable or disable this character"*), held in a separate draft keyed by **member id** (`memberActiveDraft: Record<number, boolean>`; never mix member ids into `activeDraft`, which is keyed by card id — the two id ranges overlap). Saved value: the live `session.sessionCharacters` row with `castMemberId === m.id` and `characterId == null`, its `isActive`. On Save, `commitParticipantChanges` also emits, per changed member, `sessions:setCastSeatEnabled { sessionId, castMemberId, enabled }` (no `characterId`), counted in `participantWritesInFlight` like the card ones. Lane s4-follow-a is adding `castMemberId` to that handler and to its `Params` type right now; **do not cast around a missing type** — if tsc errors on `castMemberId` there, leave it and list it as "waiting on s4-follow-a". Check the reply handler that counts answers doesn't assume `characterId`; if it does, make it accept either. Include the member draft in the form's dirty check and in the discard/reset path wherever `activeDraft` is (e.g. ~1308).
3. An unsaved card-less row shows *Ready to add* exactly as card rows do (same markup), in place of the switch.
4. Undo parity: confirm that discarding (close without saving) restores both the card list and the card-less list and both drafts. Fix whichever doesn't.
Reordering card-less rows is NOT in scope (note it).

## Files owned (only these)

`src/lib/client/components/modals/CharacterSelectModal.svelte`, `src/lib/client/components/sessionForms/StartSessionForm.svelte` (picker wiring only), `src/lib/client/components/sessionForms/EditSessionForm.svelte` (picker wiring, guest reading, save parity — NOT the book-name line), and new tests beside them. You may update `CharacterSelectModal.castMembers.dom.test.ts` (it asserts the old lines).

## Files readable

Anything. Read `CharacterPickRow.svelte`, `components/panels/ListGroupLabel.svelte`, the existing DOM tests `editSessionCastMembers.dom.test.svelte.ts` and `editSessionOwnNotesReading.dom.test.svelte.ts` (model new tests on them; don't edit `editSessionLorebookLine.dom.test.svelte.ts`, follow-a's area), `src/lib/shared/sockets/types.ts` `CastMemberRow`.

## Rules (quoted)

- STYLE-GUIDE §6.4: "A **group label** is `ListGroupLabel` … an `h3` at 12px muted … sentence case … Never a rule or a hairline above or below it."
- STYLE-GUIDE §10: "Sentence case everywhere" · "Help is one sentence." · "One name per thing … the thing you open is a session, never a chat".
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." · Browser code: "no `crypto.randomUUID`, no `navigator.clipboard`." · Sockets: views "never call `toaster`".
- Prettier: run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file (these forms are 3,000+ lines; a whole-file write would reflow other lanes' markup). If a file fails only on lines you didn't touch, leave it and say so.
- Read line ranges; the forms are huge — never read them whole.

## Stop and ask (in your report) when

A new name beyond `castPickMembers`, `memberActiveDraft`, `removeType "member"` is needed; any copy beyond the two strings above; the merge needs a server read that doesn't exist; a fix needs another file.

## Tests (done means)

Capped scope, logged (never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-follow-b-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-follow-b-w2-tests.log'`

1. `CharacterSelectModal.castMembers.dom.test.ts` (update) + new cases: cast group first under the book's name; a member and its card are one row and picking it returns the card id; a card-less row looks like a carded one and returns the member id; neither old line is drawn; second group heading + line drawn only when both groups have rows; no headings without cast; single mode offers carded members first and no card-less ones.
2. New `editSessionGuestOwnNotesReading.dom.test.svelte.ts`: a guest on an own-notes session with lines sees the Line / Story clock read-only; Save sends no reading fields.
3. New `editSessionSaveParity.dom.test.svelte.ts`: card and card-less remove both ask first; both switches wait for Save; Save emits `sessions:setCastSeatEnabled` with `characterId` for the card and `castMemberId` for the card-less seat; unsaved rows both say *Ready to add*; discard restores both.
4. Re-run existing: `editSessionCastMembers.dom.test.svelte.ts`, `editSessionOwnNotesReading.dom.test.svelte.ts`, `editSessionPlayerSeats.dom.test.svelte.ts`, `noCharacterVisibility.test.ts`, `createSession.test.ts`.
Report `npx tsc --noEmit -p .` errors in your files (12G scope: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npx tsc --noEmit -p . > <scratchpad>/s4-follow-b-w2-tsc.log 2>&1'`). Another worker runs tsc too; if one is already running (`pgrep -af "tsc --noEmit"`), wait for it rather than starting a second.

## Report

Final message: changed files; tests + results; tsc errors (and which wait on s4-follow-a); copy used; open questions; Noticed, not done.
