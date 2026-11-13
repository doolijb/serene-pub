# BRIEF s27-S3W-w3 — cast, attendance, state, collects, turn picks and the cast-member door read seat identity

Worker for lane **s27-S3W** (supervisor: Opus). App `/home/jody/github/serene-pub`. You type; you decide nothing outside this brief. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`; don't run one.)
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Why (the stage, in brief)
Seat-cast programme, stage S3: **consumers stop building refs or keys from card ids and read host-filled identity instead**, so they work on today's card-keyed data **and** on S4's member-keyed data. Rules from the lane contract (quoted):
1. "**Host fills, consumers read.** … fall back to today's card form only when a field is absent." SDK `castMemberId` = **the seat's cast member** (the payload seat row's `castMemberId`). `cardId` = the member's **active card on the timeline**.
2. "**Look up, never parse.** A consumer that needs the `state.cast.byId` entry for a ref finds the entry whose `ref` (or `castMemberId`) matches; it never parses a card id out of a ref or a key, and never does `Number(key)`."
3. "**Tests on both shapes:** every switched consumer gets a test on today's data (output unchanged) and on S4-shaped data (member refs `seated-member:<id>`, `player-seat:<id>` for carded player seats, member-keyed `byId`)." S4-shaped data = seat rows carrying a host `ref` (`seated-member:<castMemberId>` on character seats, `player-seat:<seatId>` on every player seat), `byId` entries carrying `ref`/`castMemberId`/`cardId` under member keys, and **colliding ids** (card 7 is one person, cast member 7 another).
4. "**No stored key changes, no migration, no removal.**"
5. "**Every session has a lorebook** — never write 'no book'" (nor "no lorebook", "bookless").
CLAUDE.md: browser code runs on plain-http LAN addresses and phones — **no `crypto.randomUUID`, no `navigator.clipboard`**; `$state(new Set())`/`new Map()` is not reactive — use `SvelteSet`/`SvelteMap` if you ever need one (you shouldn't); it is a **session**, never a *chat*. Existing tests in your files stay green **unchanged**; a test you must edit is a finding — say why in your report.

## The helpers you build on (already written, by w1 — read it first)
`src/lib/client/components/sessionPage/projections/seatIdentity.ts`: `seatRefOf(seat, form)` (host `ref`, else ⏳ today's `character:<card>` / `player-seat:<id>`), `seatOfCastMember(session, castMemberId, prefer?)`, `seatOfRef(session, ref)`, `seatOfMessage`, `messageRefOf`, `castEntryOf(byId, ref)` (entry by `ref`, then by `seated-member:<castMemberId>`, ⏳ today's key only while no entry carries a `ref`), `castEntryOfMember(byId, castMemberId)`, types `PayloadSeat`, `SeatsPayload`, `SeatFound`. Use them; never write a second lookup. Do not edit `seatIdentity.ts` (if it lacks something you need, report it).

## Files owned (edit only these hunks/files)
- `src/lib/client/components/sessionPage/projections/characters.ts` (+ `characters.test.ts`)
- `src/lib/client/components/sessionPage/projections/attendance.ts` (+ `attendance.test.ts`)
- `src/lib/client/components/sessionPage/projections/sessionState.ts` (+ `sessionState.test.ts`)
- `src/lib/client/components/sessionPage/collects.ts` (`holdsOf` only) (+ `collects.test.ts`)
- `src/lib/client/components/sessionPage/pressRouting.svelte.ts` (the `collectCast` hunk ~565–585 only)
- `src/lib/client/components/sessionPage/turnControls.ts` (+ `turnControls.test.ts`) and `turnFlow.svelte.ts` (the `onPickSpeaker` hunk only)
- `src/lib/client/components/sessionPage/requests/seatMemberOf.ts` and `src/routes/sessions/[id]/+page.svelte` (the `openSeatMemberSheet` / `castMemberOf` lines ~546–551 only)
- `src/lib/client/components/sessionPage/sessionPageProjections.ts`: **only** `characterForRefIn` (~136–160) and the dossier `castKey` seat lines (~559–567)
All files are dirty with other lanes' uncommitted work: edit by hunk, never reformat, never `prettier --write` an existing file.

## 1. `projections/characters.ts` (`characters.v1`)
- `CharactersSourceSession` seat rows (both tables) gain optional `id`, `characterId`/`personaId`, `castMemberId` (persona rows lack it today), `ref`, `cardId` — structural, as `PayloadSeat`.
- `Seat` carries the payload seat row and its form. `memberOf` returns `ref: seatRefOf(seatRow, form)` (falls back to today's `character:<card id>` — identical today; keep a final `?? \`character:${id}\`` only for a row with no seat fields at all, e.g. a test fixture with only `character`), `castMemberId: seatRow.castMemberId ?? null`, and `cardId` **only when the payload row carries `cardId`** (`...(seatRow.cardId !== undefined ? { cardId: seatRow.cardId } : {})`) — the client has no active-card fact of its own; the SDK says absent = not known. `characterId` stays the held card (⏳).
- `pinOf`: the found seat's `ref` the same way, not `character:${seat.card.id}`.
- Tests: today's payload → `ref` `character:<id>` exactly as now, `castMemberId` from the seat, no `cardId`; S4 payload (seat `ref: "seated-member:31"`, `castMemberId: 31`, `cardId: 7`, card id 7, and a second seat whose card is 31 and member 7) → refs, ids and pins name the right person. Check the existing tests' expectations: if any uses `toEqual` on a whole member and now fails only because `castMemberId: null` appears, that is an edited test — prefer adding `castMemberId` only when the seat row has the key (`"castMemberId" in seatRow`) so today's fixtures without it stay byte-identical; report which you chose.

## 2. `projections/attendance.ts`
- `personaRefs` become the seats' refs: `personaOwnersOf` carries each listed seat's ref beside the user and persona id (keep the string stable and space-joined; a ref holds `:`, so encode the triple safely, e.g. JSON, or split on the first two `:` only), and `projectAttendance` emits `seatRefOf(seat, "player")`. Keep **which** seats are listed exactly as now (a seat with a persona card and a card owner); a card-less player seat is not added (a change there is a ★, note it). `typing` still keys by persona id.
- `AttendeeV1.personaRefs` is typed `` `character:${number}`[] `` in the built SDK dist until lane G's widening is built (`sdk/src/widgets.ts` already says `ParticipantRef[]`): cast at the one site with a `// ⏳ the SDK dist widens to ParticipantRef[] (lane s27-S3G)` comment.
- Tests: today's → identical; S4 → `player-seat:<id>` refs from the seats' host refs.

## 3. `projections/sessionState.ts` `castOf` (~152–171)
- A `seated_member` owner (compare `(o.kind as string) === "seated_member"` — the app's `StateOwnerRow.kind` union lacks it until lane C widens it): its entry is `(cast ?? {})[o.key]` when present, else `castEntryOfMember(byId, o.id)`. `session_cast` and `player_seat` exactly as now.
- Test: a `seated_member` owner reads its member's entry from a member-keyed `byId` with a colliding card-keyed entry beside it; today's owners unchanged.

## 4. `collects.ts` `holdsOf` + `pressRouting.svelte.ts` `collectCast`
- `holdsOf(state, slotKey, ref)` takes the seat's **ref** (not a card id) and reads `castEntryOf(byId, ref)?.[slotKey]`. Update its doc (`state.cast.byId[<characterId>]` → the entry the ref names).
- `collectCast`: `const ref = seatRefOf(cc, "character")` (falling back to `character:${cc.character.id}` only if null), used for both the option's `ref` and `holdsOf`.
- `collects.test.ts`: existing `holdsOf` calls pass a card id — if they must change to pass `character:<id>`, that is an edited test: report it with the reason (signature now takes the ref; the expected values are unchanged). Add an S4 case (member-keyed `byId` with refs; colliding ids).

## 5. `turnControls.ts` + `turnFlow.svelte.ts`
- `fireTurn`'s pick becomes `{ ref: string } | { narrator: true }`; the emitted `entry.ref` is the given ref. The existing test's `{ characterId: 12 }` input becomes `{ ref: "character:12" }` with the **same expected emit** — report it as an edited test (input shape only).
- `onPickSpeaker(characterId)`: the ref is the seat holding that card — `seatOfRef`-style lookup is not right here (input is a card id); find the character seat with `characterId === characterId` in `session.sessionCharacters` (live first) and use `seatRefOf(seat, "character")`, falling back to `` `character:${characterId}` `` (⏳). Keep it a few lines; no new export.

## 6. The cast-member door (`seatMemberOf.ts`, `+page.svelte` ~546–551)
- `seatMemberOf(socket, sessionId, characterId)` and `askSeatMemberSheet({ sessionId, ref })` send `character:<characterId>` today. Make them send the seat's ref: give `seatMemberOf` a `ref: string` parameter instead of the card id (its reply matcher already echoes `ref`), and have the page resolve the ref from its session: the character seat holding that card, else the player seat voicing it (live first) → `seatRefOf(seat, form)`, ⏳ else `character:<characterId>`. Put that resolution in one small local function in the page (or in `seatMemberOf.ts` taking the session) — not a new shared export. `castMemberOf`/`openSeatMemberSheet` keep their `(characterId)` signatures (the `open-character` request names a card).
- Test: if `seatMemberOf` has no test, add a small one (it takes a socket stub) for today's and S4 refs.

## 7. `sessionPageProjections.ts` (two small hunks)
- `characterForRefIn`: use the seat `seatOfRef(session, ref)` finds and return **that seat's** card (`character` / `persona`) through `seatCardAsShown`, instead of re-finding a seat by card id; keep the ⏳ path for an unseated `character:<id>` exactly as `seatCardIdOfRef` keeps it (it returns undefined when no seat holds the card, as now).
- The dossier `castKey` (~559–567): add each seat's `ref` and `castMemberId` to its string (both tables), so lines re-project when the host fills or changes a seat ref.
- Tests: `sessionPageProjections.seatMember.test.ts` already covers `characterForRefIn` — run it unchanged; add an S4 case where card 7 and member 7 are different people.

## Tests
From the app root, each file named (never pipe into `head`):
`npx vitest run src/lib/client/components/sessionPage/projections/characters.test.ts src/lib/client/components/sessionPage/projections/attendance.test.ts src/lib/client/components/sessionPage/projections/sessionState.test.ts src/lib/client/components/sessionPage/collects.test.ts src/lib/client/components/sessionPage/turnControls.test.ts src/lib/client/components/sessionPage/requests/fireTurn.test.ts src/lib/client/components/sessionPage/sessionPageProjections.seatMember.test.ts src/lib/client/components/sessionPage/remoteAttendance.dom.test.ts src/lib/client/components/sessionPage/remoteScenePortraits.dom.test.ts src/lib/client/components/sessionPage/remoteStateWidgets.dom.test.ts src/lib/client/components/sessionPage/remoteTurnOrder.dom.test.ts src/lib/client/components/sessionPage/collectModal.dom.test.ts src/lib/client/components/sessionPage/requests/openCharacter.test.ts` plus any new test file you add.
Then `npx tsc --noEmit -p .` (errors in your files must be zero; list others' separately — the old `arrangeCanvas.dom` error is known) and `npx svelte-check --threshold error` is NOT needed (the lead runs `check`), but do make sure `+page.svelte` and `pressRouting.svelte.ts` still type-check: run `npx svelte-check --workspace /home/jody/github/serene-pub --threshold error 2>&1 | grep -E "sessions/\[id\]/\+page.svelte|pressRouting|turnFlow" ` and report what it prints (empty is good). `npx prettier --check` on any new file.

## Report (final message)
Changed files; each site → what it now reads; anything that still builds card form and why; tests run with counts (both shapes); every existing test you edited and why; tsc / svelte-check results; assumptions; Noticed, not done.
