# BRIEF s27-S3K-w1 — SDK grammar, owner kinds, turn-order readers (seat-cast S3)

Lane **s27-S3K**, worker **w1** (Sonnet). Supervisor: the s27-S3K lane-supervisor. SDK repo `/home/jody/github/serene-pub-sdk`; the app is `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.
**You do not run `sdk:build` at all** — the supervisor does. Most of the SDK repo is uncommitted work by others: edit only the hunks below, never reformat a whole file, never revert anything you did not write.

## Background (why)
Sessions are moving from seating **cards** to seating **cast members** (a `lorebook_bindings` row; "cast member id"). Stage S3 **adds** the new SDK names; nothing is removed or renamed away. Old forms stay, marked ⏳ "removed in S5" (owner ruling 2026-11-05: removal in S5, after the flip). In S3 the host (core, another lane) still emits the card forms (`character:<cardId>`); it fills new identity fields so readers can stop building refs from card ids. Owner ruling ★S3-3: "a message carries `castMemberId` only (not a `speaker` ref) … readers resolve the ref themselves (through the cast entry whose `castMemberId` matches), falling back to the card."

## Goal — exactly these changes

### 1. Grammar — `sdk/src/participants.ts`
- `ParticipantRef` gains 🚧 `` `seated-member:${string}` `` (same `${string}` id as its siblings: "Ids are opaque to the SDK"). `ParsedParticipantRef` gains `{ kind: 'seated-member'; id: string }`.
- `parseParticipantRef`: `seated-member` joins the `user | character | player-seat` id case (same `ID` regex, same "no readable id" sentence). Both refusal sentences name it: the no-colon one lists `… character:<id>, seated-member:<id>, player-seat:<id>, envoy:<slug>`; the bad-kind one lists `(user, character, seated-member, player-seat, envoy)`.
- `formatParticipantRef` formats it. `isParticipantRef` / `canonicalParticipantRef` follow automatically — check.
- Doc comments: the `ParticipantRef` doc says what `seated-member:<id>` is — 🚧 a seated **cast member**, by its cast member id (the host's `lorebook_bindings.id`), the seat-cast programme's ref for a seat; and that `character:<id>` (a seat by its card) is ⏳ removed in S5 of the seat-cast programme. `aiHolds`'s doc lists `seated-member:` beside `character:`/`envoy:`. Mark every new word 🚧 and every old form ⏳ in the docs you touch.
- `SessionCastV1` (~385–430): each `sessionCharacters[]` row and each `sessionPersonas[]` row gains three **optional** host-filled fields (optional so a host that predates S3, and the app until its lane fills them, still type-checks):
  - `ref?: ParticipantRef` — the seat's participant reference as the host fills it (today `character:<cardId>` for a seat with a card, `player-seat:<seatId>` for a card-less player seat; a reader matches on it and never builds it);
  - `castMemberId?: number | null` — the seat's cast member (null while the seat has none);
  - `cardId?: number | null` — the member's **active card on the timeline** (null when card-less).
  Update the interface's head doc: it no longer "adds no fields" — say 🚧 S3 adds the host-filled identity (`ref`, `castMemberId`, `cardId`) on each seat row. Do NOT touch `envoys`.

### 2. Owner kinds — `sdk/src/turnLock.ts`
- `TurnOwner.kind` gains 🚧 `'seated_member'` (its `id` is the cast member id); doc `session_cast` (id = the card) as ⏳ removed in S5.
- `TurnMessage` gains 🚧 optional `castMemberId?: number | null` — the speaker's cast member (the member behind `speakerId`), when the asker knows.
- `openAnchorFor`: for a `seated_member` owner, match `messages[i].castMemberId === owner.id` (never `speakerId` — card ids and member ids share one number range, so comparing them would silently pick the wrong person). `session_cast` keeps matching `speakerId`. `isAnchorOpen` needs no change beyond that — check.

### 3. Turn-order readers — `sdk/src/turnOrder.ts`
- `TurnHistoryMessage` gains 🚧 optional `castMemberId?: number | null` — the speaker's cast member (the host's `cast_member_id` on the row).
- `senderRefOf(m, refOfMember?)`, `spokenRefsSince(messages, refOfMember?)`, `roundRobinOrder(candidates, messages, refOfMember?)` gain ONE optional trailing parameter, typed inline (no new exported type name): `refOfMember?: (castMemberId: number) => ParticipantRef | null | undefined` — the cast lookup: a cast member id → the seat's `ref` (as the cast entry whose `castMemberId` matches carries it). `roundRobinOrder` only passes it through to `spokenRefsSince`.
- Rules (the lookup changes **identity only**, never whether a row counts):
  - `senderRefOf`: compute today's answer first (persona → `character:<personaId>`; else a `player-seat:` speaker; else null). If today's answer is null → null (an assistant row never becomes a sender). Otherwise, if `m.castMemberId != null` and `refOfMember` is given and returns a non-empty ref → return that; else today's answer. Add `'castMemberId'` to the `Pick` (it is optional, so existing callers still compile). Return type widens to `ParticipantRef | null`.
  - `spokenRefsSince`, on each assistant row: if `m.castMemberId != null` and the lookup returns a ref → add it; else if `m.characterId != null` → `character:<characterId>` (today). Envoy `speaker` refs unchanged. The opening user row: `senderRefOf(turns[at]!, refOfMember)`.
  - Without a lookup, every output is byte-identical to today.
- Docs: say 🚧 what the lookup is and that without it the card form is read (⏳ until S5); list `seated-member:<id>` among the refs `spokenRefsSince` returns.

### 4. Tests (SDK, `node:test` + `assert/strict`, like the neighbours)
- `sdk-tests/participants.test.ts`, describe 'the grammar': add `['seated-member:9', { kind: 'seated-member', id: '9' }]` to the round-trip cases (rename that test's title to include seated-member); add `'seated-member:'` and `'seated-member:a b'` to the refusals; assert `parseParticipantRef('seated-member: ')` throws `/no readable id/`; update the existing `'persona:3'` assertion's regex to the new kind list `(user, character, seated-member, player-seat, envoy)`; assert `canonicalParticipantRef(' seated-member:9 ')` is `seated-member:9` (import it if exported; check `sdk/src/index.ts`).
- `sdk-tests/roundRobin.test.ts`: a new `describe('round robin · cast member ids (seat-cast S3)', …)` with (a) **today's shape** — the same histories with no `castMemberId` and no lookup give exactly today's refs (and with a lookup given but rows lacking `castMemberId`, still today's); (b) **S4 shape** — candidates `seated-member:101`, `seated-member:102`, a carded player seat `player-seat:7`; history rows carry `castMemberId` (assistant rows `characterId` + `castMemberId`, a card-less member's reply with `characterId: null` + `castMemberId`, the user row `personaId: 5` + `castMemberId: 900`); the lookup maps 101→`seated-member:101`, 102→`seated-member:102`, 900→`player-seat:7`; assert `spokenRefsSince` returns the member refs and `player-seat:7` (never `character:`), `roundRobinOrder` skips them; `senderRefOf` on that user row → `player-seat:7`; on an assistant row → null; a lookup that misses (returns undefined) falls back to `character:<id>`.
- New file `sdk-tests/seatedMemberOwner.test.ts`: `openAnchorFor` / `isAnchorOpen` with a `{ kind: 'seated_member', id: 42 }` owner over messages whose `speakerId` (card ids) collides numerically with 42 on a different row — it matches by `castMemberId` only; `session_cast` still matches `speakerId`; a `seated_member` owner with no matching row → null, and `null` is open. Head comment: what is pinned and why (one paragraph, like `roundRobin.test.ts`).

## Files owned (edit only these)
`/home/jody/github/serene-pub-sdk/sdk/src/participants.ts`, `/home/jody/github/serene-pub-sdk/sdk/src/turnLock.ts`, `/home/jody/github/serene-pub-sdk/sdk/src/turnOrder.ts`, `/home/jody/github/serene-pub-sdk/sdk-tests/participants.test.ts`, `/home/jody/github/serene-pub-sdk/sdk-tests/roundRobin.test.ts`, `/home/jody/github/serene-pub-sdk/sdk-tests/seatedMemberOwner.test.ts` (new).

## Files readable
Anything in both repos. Another worker (w2) is editing `sdk/src/widgets.ts`, `sdk/src/sessionDossier.ts`, `sdk/src/shapes.ts`, `sdk/src/events.ts`, `sdk/src/attributes.ts`, `contracts/src/**`, `INTEGRATING.md` at the same time — never touch those.

## Out of scope
Removing or renaming any old name (S5). core-catalog (another lane). The app. Any new exported type, helper or option beyond the above (e.g. a helper that builds the lookup from a cast — note it under Noticed instead).

## Rules (quoted from CLAUDE.md and NOMENCLATURE)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."
- "Say each assumption when you make it; one that would change the result is a question."
- NOMENCLATURE R1 "One word, one meaning." R3 "Qualify, never abbreviate to the bare noun." R6 "Mark vocabulary that is not permanent … ⏳ Transitional — real today, expires on a known event … 🚧 Provisional — designed but not built, so the words may still move."
- "No @2 bumps before 0.7" — `@1` ids evolve in place; never add an `@2`.
- It is a **session**, never a *chat*.
- Targeted tests only; never pipe a test runner into `head`/`tail -f` mid-run (write to a file, then read it).

## Stop and ask (in your report, then stop that item) when
A name not listed here seems needed; a change would break an existing test's expectation beyond the `persona:3` regex above; anything outside the files owned.

## Done means
From `/home/jody/github/serene-pub-sdk/sdk-tests`:
- `npx tsx --test participants.test.ts roundRobin.test.ts seatedMemberOwner.test.ts turnOrder.test.ts coreTurnOrder.test.ts attributes.test.ts > <scratch>/s27-S3K-w1-tests.txt 2>&1` all pass (use the scratchpad dir `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/`);
- `npx tsc --noEmit -p /home/jody/github/serene-pub-sdk/sdk-tests` clean (it was clean before; if it fails only in w2's files, say so and do not touch them);
- `npx prettier --check` on each file you changed.

## Report
Your final message: changed files with one line each, the exact signatures you landed (`senderRefOf`, `spokenRefsSince`, `roundRobinOrder`, `TurnMessage`, `TurnOwner`, `ParticipantRef`, the `SessionCastV1` row fields), tests run with pass/fail counts, assumptions, Noticed-not-done. Start it with `# REPORT s27-S3K-w1`.
