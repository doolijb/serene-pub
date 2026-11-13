# BRIEF — `s4-f-client-w1` — seat identity, faces and turn readers read member form (2026-11-08)

Supervisor: lane `s4-f-client` (plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §34, the seat flip). You are one of two workers; w2 owns the state/owner/door/types files — don't touch them.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## Context — what the flip changes on the wire

The server is about to stop emitting card-form refs. Today every carded seat's host-filled `ref` (on `session.sessionCharacters[]` / `session.sessionPersonas[]` rows) is `character:<cardId>`; after the flip (lane s4-f-emit, beside you) it is:
- a character seat → `seated-member:<castMemberId>`
- a player seat (carded or not) → `player-seat:<seatId>`

Turn-order entries (`turnOrder.order[].ref`, `candidates[].ref`), `metadata.speaker`, `state.cast.byId` entries' `ref` follow the same forms. Card columns (`characterId`, `personaId` on seats and messages) still exist until S5 and card→seat lookups on them may stay. Message rows carry `castMemberId` (the speaker's seat member, stamped at write), `role` (`"user"` for a person's line, `"assistant"` for a character's), `characterId` / `personaId`, `metadata.speaker` (today `player-seat:<id>` on a card-less player seat's line).

**Both forms must work** until the lead turns the switch: live servers in between still send card form (`ref: "character:5"`). Build and test against member-form fixtures AND keep the existing card-form tests green.

In wave 4 (not yours) the seat lane adds **card-less character seats**: `characterId: null`, `castMemberId` set, `envoySlug` null, `ref: "seated-member:<id>"`; their lines have `role: "assistant"`, `characterId: null`, `personaId: null`, `castMemberId` set. Your `seatOfMessage` must already find them.

## Rules (quoted; each is binding)

- Owner ruling ★K-1 (2026-11-08): "`cast.byId` key `seated_member:<id>` (mirrors `player_seat:<id>`; a stale card-key reader finds nothing rather than the wrong person)." Lead's brief: "never parse a key — K-1 keys are opaque". Look a seat up by what it carries (`ref`, `castMemberId`, `cardId`), never parse an id out of a ref or key. Card ids and member ids share one number range — a wrong match is a silent wrong person; every fixture must make a card id and a member id collide on purpose (card 7 ≠ member 7), as `seatIdentity.test.ts` already does.
- Owner ruling ★S3W-1/★S3W-3 (2026-11-05, late): "in S4 a card-less player seat is treated like any other seat (lines grouped, face in scene dividers and clickable, listed in Attendance)." The S3W report's recommendation it rules: a card-less player seat's line carries `speaker.ref = player-seat:<id>`; `attendance.v1` lists card-less player seats.
- Owner ruling ★K-2 (2026-11-08): a member may hold a character seat AND a player seat ("a member holding both seats"); each seat is its own participant. Never resolve a person's line to the character seat because the member matches.
- Seat order (must mirror the server's `seatOf`, `sessions/seats.ts`): live before departed in either table, character before player, lowest position, lowest id. `seatsInOrder` in `seatIdentity.ts` already does this — keep using it.
- ⏳ marks a card-form fallback kept until S5; 🚧 marks provisional names. Keep both markers accurate in the comments you touch; fix any comment that says "card form until S4" / "emitted refs stay `character:<id>`" in your files.
- CLAUDE.md: browser code — no `crypto.randomUUID`, no `navigator.clipboard`. `$state(new Set())` is not reactive — use `SvelteSet`/`SvelteMap`. It is a **session**, never a chat.
- Decisions: decide implementation inside your files and name each choice in your report. **Do not** add a new exported name except the one listed below; do not add settings, events or payload fields; do not change user-visible copy. If something needs any of those, stop and say so in your report.

## Files owned (edit only these)

- `src/lib/client/components/sessionPage/projections/seatIdentity.ts` + `seatIdentity.test.ts`
- `src/lib/client/components/sessionPage/sessionPageProjections.ts` + `sessionPageProjections.seatMember.test.ts` + `sessionPageProjections.castNames.test.ts`
- `src/routes/sessions/[id]/+page.svelte`
- `src/lib/client/components/sessionPage/turnFlow.svelte.ts` (comment-level only, see 6)
- `src/lib/client/components/sessionPage/pressRouting.svelte.ts` (comment-level only, see 6)
- `src/lib/client/components/sessionPage/projections/characters.ts` (line ~354 only) + `characters.test.ts`
- `src/lib/client/components/sessionPage/roundWaiting.ts` + `roundWaiting.test.ts`
- `src/lib/client/components/sessionPage/projections/attendance.ts` + `attendance.test.ts`

Readable: anything. Especially `src/lib/client/utils/messageSpeaker.ts` (a caller of `seatOfMessage`; not yours — if it needs a change, report it), `src/lib/server/sockets/sessions.ts` ~5433–5476 (where seat `ref`/`cardId` are filled today), `src/lib/server/messages/store.ts` ~109–160 (the speaker stamp).

## Tasks

1. **`seatOfMessage(session, msg)`** — match a line to its seat by its stamp, so a card-less line works:
   - `SeatMessage` gains optional `role?: string | null` and `isNarratorResponse?: boolean | null` (structural; the page's message rows carry both).
   - A narrator line finds nothing.
   - The line's form: `personaId != null` → player; `characterId != null` → character; neither → `role === "user"` → player, any other role → character.
   - First, a stamped `metadata.speaker` that names a seat (`naming(...)` over every seat, both tables) — it names an exact seat. Then the seat of that form holding the line's `castMemberId` (`holding`). Then ⏳ the seat of that form on the line's card column (today's rule). An envoy's seat is never found (already filtered).
   - A member holding both seats: a `role: "user"` line with only `castMemberId` must find the **player** seat; an `"assistant"` line the **character** seat.
2. **`messageRefOf(session, msg)`** — the ref of the seat `seatOfMessage` finds (its `seatRefOf`), for every line, carded or not (★S3W-1: a card-less player line now carries `player-seat:<id>`); else ⏳ `character:<characterId>`, else `character:<personaId>`, else null. Update its JSDoc and the module header.
3. **`participantOf` gets a player-seat face** (f-sdk's queue: "`participantOf` (`routes/sessions/[id]/+page.svelte` ~867 via `seatCardIdOfRef`) and `NextCharacterBlock` need a `player-seat:<id>` face, so carded player seats keep their turn-line and `sp-avatar` avatars after the flip"). `NextCharacterBlock` no longer exists as a component: the conversation widget's turn line asks the page for faces through `participantOf` / `characterForRef`, so fixing those covers it.
   - Move the body of the page's `participantOf` into `sessionPageProjections.ts` as a pure, exported 🚧 **`participantForRefIn(session, ref)`** (mirrors `characterForRefIn`) → `{ name, avatarUrl } | null`; the page's `participantOf` becomes `(ref) => participantForRefIn(session, ref)`.
   - Rule: find the seat by `seatOfRef(session, ref)` (never by card id — a K-2 card sits in two seats). A **character seat** with a card: as today (`castNameOf` / `castFaceOf(session, cardId, {}) ?? avatarSrc(shown)`). A **player seat**: its name by the same rule `headerCastKeyOf` uses for persona rows (factor one module-private helper both call — do not copy it), its face `avatarSrc(seatCardAsShown(session, persona))`; a **card-less player seat** (★S3W-1, "face … clickable"): its `seatName`, and its seat portrait (`portraitMediaId`) as the face if the page has a URL rule for a media id (see how `messageSpeaker.ts` `withSeatPortrait`/`avatarSrc` turn `avatarMediaId` into a URL — reuse, don't invent), else null face. No seat → today's `characterForRefIn`-based fallback (null when nothing).
   - Use `participantForRefIn` for the scene-divider faces too (`castOf` in `projectConversationDossier`, ~line 690), so a card-less player seat gets its face there (★S3W-1 "face in scene dividers"); keep its `ref` from the seat (`seatRefOf`), ⏳ the member's linked card form only when no seat holds the member.
4. **Header "next" by ref.** `headerCastKeyOf(session, nextId)` lights a row by card id (`cc.character.id === nextId`), so a head that is a player seat on a card also in a character seat lights the wrong row. Change the second parameter to the head's ref (`turns.turnOrder?.order[0]?.ref ?? null`, still null when `!turns.shouldShowNextCharacterBlock`) and set `isNext` for a character row when its `key` (its seat ref) equals it. Persona rows keep `isNext: false` (no behaviour change there). Update the caller in `+page.svelte` and the castNames test.
5. **`roundWaiting.ts` `speakerOf`**: after the stamp and the `castMemberId` seat, find the seat whose `personaId` is the row's and use its `refOf` before the ⏳ `character:<personaId>` fallback (an unstamped old row must still match its seat's member-form ref).
6. **Card-form fallbacks that stay (⏳ until S5)** — make each comment say why, no behaviour change: `characters.ts` ~354, `pressRouting.svelte.ts` ~582, `turnFlow.svelte.ts` ~338–352 (`onPickSpeaker` — the pick names a card; PickSpeakerModal is the seat lane's in wave 4), `+page.svelte` `seatRefOfCard` (~601), `sessionPageProjections.ts` `seatCardIdOfRef` (~91; its doc's "Emitted refs stay `character:<id>`" is now false) and ~335, ~697.
7. **Attendance (★S3W-3)**: `personaOwnersOf` / `projectAttendance` list card-less player seats too (a live player seat with no persona but a `ref` and a `userId`): its ref goes into that person's `personaRefs`; `typing` stays computed from persona ids only. The cached string must stay unambiguous — pick an encoding where a missing persona id can never read as `0` (`Number("")` is `0` and passes `Number.isInteger`). The ⏳ `character:<personaId>` fallback stays for a card-form payload with no `ref`. Where does a card-less player seat's `userId` live on the payload row? Check `Sockets.Sessions.Get.Response` in `src/lib/shared/sockets/types.ts` (read only) and `messageSpeaker.ts`'s `sessionPersonas` shape (`userId`).

## Tests (Done means)

Add to the existing files, each with a card id that collides with a member id:
- `seatIdentity.test.ts`: member-form payloads — carded character line; carded persona line; **card-less character line** (`role: "assistant"`, no card columns, `castMemberId`); card-less player line (stamped and unstamped `role: "user"`); **a member holding both seats** (user line → player seat, assistant line → character seat); a **departed** seat (live wins; a line of a departed seat still finds it when it's the only one); narrator line → null. `messageRefOf` returns member-form refs for each, and `player-seat:<id>` for a card-less player line. Existing card-form tests stay green (update only the one that pins "a card-less line's stays null" — that is ★S3W-1, now ruled).
- `sessionPageProjections.seatMember.test.ts`: `participantForRefIn` gives a carded player seat (`player-seat:<id>`) its persona's name and face; a K-2 card (in both seats) gives each ref its own seat's name; a card-less player seat its seat name; a character seat as before.
- `sessionPageProjections.castNames.test.ts`: `headerCastKeyOf` `isNext` by ref.
- `roundWaiting.test.ts`, `attendance.test.ts`, `characters.test.ts`: green, plus a member-form case each (attendance: a card-less player seat listed).

Run, capped, logged to the scratchpad (never pipe vitest into `head`):

```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/client/components/sessionPage/projections/seatIdentity.test.ts src/lib/client/components/sessionPage/sessionPageProjections.seatMember.test.ts src/lib/client/components/sessionPage/sessionPageProjections.castNames.test.ts src/lib/client/components/sessionPage/roundWaiting.test.ts src/lib/client/components/sessionPage/projections/attendance.test.ts src/lib/client/components/sessionPage/projections/characters.test.ts src/lib/client/components/sessionPage/personLineSeat.test.ts src/lib/client/components/sessionPage/castReadIsOwners.test.ts src/lib/client/components/sessionPage/streamedSessionReads.test.ts src/lib/client/utils/messageSpeaker.test.ts --maxWorkers=2 > \$S/s4-f-client-w1-tests.log 2>&1; echo test-exit=\$? >> \$S/s4-f-client-w1-tests.log"
```

(Drop any path that doesn't exist; `castReadIsOwners`, `streamedSessionReads` and `personLineSeat` are source-read tests that may pin code text — keep them green.) Don't run tsc/check yourself; the supervisor does.

**Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo. Never edit a server file.

## Report

Return in your final message: changed files; every card-form site you changed and every one you deliberately left (file:line, why); each implementation choice; tests run with pass/fail counts; anything that needed a file you don't own (e.g. `messageSpeaker.ts`) under **Needs another file**; **Noticed, not done**.
