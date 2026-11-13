# BRIEF s27-S3C-w2 — the host fills identity fields: `ref`, `castMemberId`, `cardId` (seat-cast S3, server)

Worker for lane **s27-S3C** (supervisor: lane-supervisor, Opus). App `/home/jody/github/serene-pub`. You are worker **w2**. Worker **w1** runs beside you in the same lane; it owns other hunks of `host.ts` and `sockets/sessions.ts` (listed under *Not yours*). Other lanes run in other files: never edit `src/lib/client/**`, `src/routes/**`, `../serene-pub-sdk/**`, `../mundi-sp/**`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You don't need an `sdk:build`: the SDK types already ship. Don't run one.)

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal
S3: **"Host fills, consumers read."** The SDK (already built, lane s27-S3K) added optional host-filled identity fields; the app's server must fill them, so widgets, scripts and Mundi stop building refs from card ids. Core keeps emitting the card form until S4: **no stored key changes, no emitted ref flips, no migration**.

The three fields, exactly (NOMENCLATURE §25 row, s27-S3K, quoted):
> 🚧 host-filled identity, every field **optional**: **`ref`** (the seat's participant reference — match on it, never build it), **`castMemberId`** (the seat's cast member) and **`cardId`** (the member's **active card on the timeline**, null when card-less — owner: "Everything in session is cast -> active card") … ⚠ The SDK's `castMemberId` is **the seat's** cast member — the app's `CastMemberLink.seatMemberId`, **not** `CastMemberLink.castMemberId` (the attached book's member); the host fills the SDK field from the seat (R5).

What to put in them in S3 (today's data):
- **`ref`** = the seat's emitted ref today: `character:<the card the seat holds>` for a character seat and for a **carded** player seat (a carded player seat is its card); `player-seat:<session_personas.id>` for a card-less player seat. (The same rule as `storedSeatRef` / `cardFormOfSeat` in `src/lib/server/state/seatRefs.ts` and `pipelines/prompt/seatCards.ts`.)
- **`castMemberId`** = the seat's stored `cast_member_id` (`session_characters.cast_member_id` / `session_personas.cast_member_id`; in `state/resolve.ts` that is `CastMemberLink.seatMemberId`) — null when not stored. **Never** `CastMemberLink.castMemberId`.
- **`cardId`** = the member's **active card on the timeline** at the session's reading: `MemberAsRead.activeCardId` from `membersAsRead(db, ids, { sessionId })` (`src/lib/server/cast/memberAsRead.ts`) — or, where the code already reads the seat's member through `seatMembersAsRead` (`pipelines/prompt/seatCards.ts`), that read's `activeCardId`. When the seat has no member read at all, the card the seat holds (today's answer); a card-less player seat with no member → null. A member read whose `activeCardId` is null → null. Read members in one batch per call, never per row.

## Items (line numbers approximate; grep, then re-read the hunk right before each edit)
1. **`src/lib/server/state/resolve.ts`** `cast.byId` entries (~1597–1645): each entry gains `ref`, `castMemberId`, `cardId`; card-less player seats too (`ref: player-seat:<id>`, `cardId` per the rule). Keys stay as they are (`byId[String(characterId)]`, `player_seat:<id>`). Check whether the `CastEntry` type (app-side or SDK) needs the optional fields added; if the type is the SDK's, it already has them (lane S3K) — don't edit the SDK. Check `links.playerSeats` carries the seat's member; add it to the links read if not (same file).
2. **`session-state@1` owner rows** — `src/lib/server/sockets/state.ts` ~594–630 (`owners`), and wherever else the server builds `SessionStateOwnerV1`/`StateOwnerRow` (grep `StateOwnerRow`, `SessionStateOwnerV1`): `session_cast` and `player_seat` owners gain `ref` + `castMemberId` (★S3-2, ruled). If `Sockets.State.StateOwnerRow` in `src/lib/shared/sockets/types.ts` lacks the fields, add them **additively** (optional, 🚧, one-line doc each). That file is shared: re-read right before the edit, touch only that type.
3. **The `session_cast` read's seat rows** — `src/lib/server/pipelines/runtime/host.ts` `case "session_cast"` (~4707–5200, the rows returned as `sessionCharacters` / `sessionPersonas` ~5174–5185): each row gains `ref`, `castMemberId`, `cardId`. `seatCardsAsRead` already reads the members (`seatMembersAsRead` gives the `MemberAsRead` per row — use it rather than a second read; you may call `seatMembersAsRead` and `seatCardAsRead` yourself if that avoids reading twice). Also every other server builder of `SessionCastV1` rows: `src/lib/server/sessions/settings.ts` `readCast` (~305), `src/lib/server/pipelines/runtime/dispatch.ts` (grep `sessionCharacters`, `sessionPersonas`, `loadAdapterSession`), `pipelines/speech/cueLines.ts` (~126, check whether it builds or only reads). Fill the same three fields where a builder hands rows to a pipeline or widget.
4. **Messages:**
   - `src/lib/server/sockets/sessions.ts` `sessions:channelLanes` hunk (~4100–4170): `latest.castMemberId` from `session_messages.cast_member_id` (add it to the select).
   - Find where the server hands message rows to the client/widgets (the socket message payloads in `sockets/sessions.ts` — grep `sessionMessages` selects that name `characterId: ` explicitly, and `messages/` projections like `messages/replyView.ts`, `messages/projectLegacy.ts`). If a projection selects columns explicitly and drops `castMemberId`, add it (additive). If rows go out whole (`select()` / `findMany` without `columns`), it is already there: say so. **Do not** edit `src/lib/client/**` or `src/lib/shared/widgets/**` (the client's `MessageV1` projection is lane W's); if the client side must map it, queue it for W in your report.
5. **Turn order and the lock:**
   - `src/lib/server/state/write.ts` `turnMessages` (~320): rows gain `castMemberId` (`schema.messages.castMemberId`) — `openAnchorFor` matches a `seated_member` owner on it alone.
   - `src/lib/server/pipelines/runtime/speakerRotation.ts`, `bindings.ts` (~4354 `senderRefOf`, the `spokenRefsSince`/`roundRobinOrder` calls), `pipelines/prompt/contentProcessors.ts` (~162, ~317): the history rows core builds for `senderRefOf`, `spokenRefsSince`, `roundRobinOrder` carry `castMemberId`, and core passes a **`refOfMember`** lookup (castMemberId → the seat's `ref`, built from the cast in hand — the `session_cast` read's rows with their new `ref`/`castMemberId`). SDK signatures (from `REPORT-s27-S3K`):
     - `senderRefOf(m, refOfMember?: (castMemberId: number) => ParticipantRef | null | undefined): ParticipantRef | null`
     - `spokenRefsSince(messages, refOfMember?)` → `Set<string>`; `roundRobinOrder(candidates, messages, refOfMember?)` → `TurnEntryV1[]`.
     - "It changes only **who** a row names, never whether the row counts. A missing lookup, or one that finds nothing, falls back to today's card form. With no lookup the output is byte-identical to today."
   - If the cast is not in hand at a call site, don't add a query per call: pass the lookup where the cast already is, and list the sites left without one.
   - One small lookup builder is allowed (e.g. in `speakerRotation.ts`, exported); it is a new exported name → name it qualified (R3), mark 🚧, and tell me its name and signature in your report (I write the §25 row).
   - The `parsed.kind === "character"` / `c.kind === "character"` sites in these two files (`bindings.ts` ~1548, ~1723, ~9463; `speakerRotation.ts` ~812): a `seated-member:` ref must be translated first (`storedSeatRef` from `state/seatRefs.ts` where a db + session are at hand; `cardFormRefInCast` from `pipelines/prompt/seatCards.ts` over a cast in hand) or handled — never parse a card id out of a member ref.
6. **`src/lib/server/sprites/choices.ts`** (`sprite-choices@1`, ★S3-4 ruled: "Cast member id, cascade to a card based on active card on the timeline and cast member configuration"): the payload gains `castMemberId` (the seat's member; ~145 already reads `seat?.castMemberId`). `characterId` stays the card the art comes from (⏳). The cascade itself was built in S2 — don't change it.
7. **`ConversationCastV1`** rows (`ref`, `castMemberId`): find whether the server builds them (`grep -rn "ConversationCast" src/lib/server`). If only the client does, report that and build nothing.

## Not yours (w1's hunks — never edit)
`host.ts` outside the `session_cast` case (the gates at ~879, ~2037–2145, ~2577, ~3439, ~7195–7640, ~8150, ~8525–8870, ~9890); `sockets/sessions.ts` fireTurn hunk (~9785–10270); `sockets/pipelines.ts`, `portrayals.ts`, `fireAction.ts`, `runTurn.ts`, `tools/coreTools.ts`, `adventureContext.ts`, `keyProposal.ts`, `speech/resolveVoice.ts`, `sockets/jump.ts`, `auth/actingPerson.ts`, `sessions/creationModes.ts`, `sessions/annexChanges.ts`, `lorebooks/annex.ts`, `NOMENCLATURE.md`.

## Files owned
`state/resolve.ts`, `state/write.ts` (the `turnMessages` hunk), `sockets/state.ts` (owner rows), `host.ts` `case "session_cast"` only, `sessions/settings.ts` (`readCast`), `pipelines/runtime/dispatch.ts` (cast rows), `pipelines/speech/cueLines.ts` (if it builds rows), `sockets/sessions.ts` `sessions:channelLanes` hunk + message-payload selects, `pipelines/runtime/speakerRotation.ts`, `pipelines/runtime/bindings.ts` (the named hunks), `pipelines/prompt/contentProcessors.ts`, `sprites/choices.ts`, `src/lib/shared/sockets/types.ts` (additive, the types named), and their test files (new test files beside them are fine). Every file is dirty with other lanes' uncommitted work: edit by hunk, never reformat, never `prettier --write`.

## Rules (quoted from CLAUDE.md and the S3 common brief)
- **Look up, never parse.** "A consumer that needs the `state.cast.byId` entry for a ref finds the entry whose `ref` (or `castMemberId`) matches; it never parses a card id out of a ref or a key, and never does `Number(key)`."
- **No stored key changes, no migration, no removal.** Keys stay `session_cast:<cardId>`, `byId[<cardId>]`, `player_seat:<id>`; refs stay card form.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- No static `$lib/server/db` import in modules tests mock (pass `db`). `defaults.ts` imports stay leaf.
- "`$state(new Set())` …" n/a (server). Sockets: "An event in `SCOPED_EVENTS` must carry its scope key in the payload" — don't drop `sessionId` from any payload you touch.
- **Every session has a lorebook** — never write "no book", "no lorebook", "bookless" in code, comments, tests or copy; say "a session whose lorebook is its own book".
- New exported names → qualified (R3), 🚧-marked, reported to me for §25. Anything users or plugin authors see that isn't ruled is a ★: stop and ask in your report.
- Targeted tests only; **never pipe vitest into `head`** (the SIGPIPE leaks PGlite temp dirs); int tests that open a DB inside an `it` need a 60 s timeout. Before your first run, `ls -d /tmp/serene-pub-vitest-* 2>/dev/null > <scratchpad>/s27-S3C-w2-tmp-before.txt`; after your runs, delete only new dirs your runs made, by name. Scratch files start with `s27-S3C-w2-`.

## Tests (both shapes)
- Each filled field present and correct on today's data: a character seat (`ref: character:<held card>`, `castMemberId` = the seat's stored member, `cardId` = held card when the member follows it), a carded player seat, a card-less player seat (`player-seat:<id>`, `cardId: null`), **a dated active card ≠ the held card** (a cast amendment that moves the member's card at the session's reading — find the S2b tests that do this: `grep -rln "activeCardId\|cast_amendments\|castAmendments" src/lib/server --include=*.int.test.ts`, e.g. `cast/memberAsRead.int.test.ts`, `messages/seatMemberNames.int.test.ts`, and reuse their fixtures) → `cardId` is the dated card, `ref` stays the held card.
- `castMemberId` is the seat's member, not the attached book's member, in a case where the two differ (if a fixture for that exists in the S2 tests; else say so).
- Turn order: `refOfMember` on **S4-shaped** history (rows with `castMemberId`, a lookup giving `seated-member:<id>` refs) names the member refs; on today's history (no lookup, or card-form refs) output is **unchanged**.
- `channelLanes` `latest.castMemberId`; `turnMessages` rows carry `castMemberId`; `sprite-choices` carries `castMemberId`.
- Existing tests in your files stay green **unchanged**; a test you must edit is a finding — say why, with old and new value.

Run with `npx vitest run <files>` (the app root), never the whole suite. Then `npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"` must show nothing (the old `arrangeCanvas.dom` error is known).

## Done means
Every item built or reported as nothing-to-do with evidence; targeted tests green; tsc clean on your files.

## Report
Write your report as your final message (no report file): changed files with hunk ranges, each field → where filled and from what, the new exported name(s) + signature, tests run with pass counts, existing tests you had to change (with why), sites left without `refOfMember` and why, ★, Queued for W/others, Noticed-not-done.
