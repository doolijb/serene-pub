# BRIEF s27-S3C — the app's server fills the identity fields and opens its gates (seat-cast S3)

Lane-supervisor (fresh, Opus). Read `plans/briefs/BRIEF-s27-S3-common.md` first. Lane id **s27-S3C**. Two workers at most. App `/home/jody/github/serene-pub`. Concurrent: **s27-S3W** (every `src/lib/client/**` file and `src/routes/**`), **s27-S3G** (SDK repo core-catalog), **mundi-27a** (`../mundi-sp`) — don't edit theirs.

## Items
1. **Gates accept `seated-member:`** and translate with `storedSeatRef` before they store or compare: `pipelines/runtime/host.ts` (~3442 AI-view speaker before `aiHolds`; ~7189 `namedRef` stored as `metadata.speaker`; ~9882 form addressee; the configure-stat and retire halt sentences ~8539/~8609 name `seated-member:<id>` — ★S3-1 copy, built as recommended, flagged), `sockets/sessions.ts` fireTurn (~10112–10123 `isParticipantRef` and `sameEntry`), `sockets/pipelines.ts` `portrayalLinesOf` (~2827/2839), and every `parsed.kind === "character"` site (grep: `portrayals.ts`, `fireAction.ts`, `bindings.ts`, `speakerRotation.ts`, `runTurn.ts`, `tools/coreTools.ts`, `prompt/adventureContext.ts`, `ranking/keyProposal.ts`, `speech/resolveVoice.ts`, `sockets/jump.ts`, `auth/actingPerson.ts`).
2. **Stored-audience writes through the door** (so S3 stores no mixed audiences): `host.ts` ~2067–2141 and ~8688/~8808, `sessions/creationModes.ts` ~260–313, `sessions/annexChanges.ts` ~217, `lorebooks/annex.ts` ~241–246.
3. **Host-filled fields:**
   - `state/resolve.ts` `cast.byId` entries (~1597–1640): `ref` (the seat's emitted ref today: `character:<cardId>` / `player-seat:<id>`), `castMemberId` (= `seatMemberId`), `cardId` (the member's active card); the `session-state@1` owner rows in `sockets/state.ts` (~608) and wherever `SessionStateOwnerV1` is built: `ref` + `castMemberId`.
   - The `session_cast` read's seat rows in `host.ts` (`sessionCharacters[]`/`sessionPersonas[]`: `ref`, `castMemberId`, `cardId`).
   - `MessageV1.castMemberId` and the lane `latest` (the message projection the host and sockets hand widgets — find where `MessageV1` rows are built server-side), `TurnHistoryMessage.castMemberId` / `TurnMessage.castMemberId` on rows core passes to `openAnchorFor`, `spokenRefsSince`, `roundRobinOrder`; pass a `refOfMember` lookup (castMemberId → seat ref) where core runs them (`speakerRotation.ts`, `bindings.ts`, `pipelines/prompt/contentProcessors.ts` ~162/~317).
   - `sprites/choices.ts` / `sprite-choices@1`: `castMemberId` (★S3-4 cascade already built in S2).
   - `ConversationCastV1` rows (`ref`, `castMemberId`) where the server builds them.
4. **Scene Portraits server side:** whatever server code reads `chosenImages` or answers `set-chosen-image` accepts `memberRef` (`seated-member:`) beside ⏳ `characterRef` (the client door is W's).
5. **Tests** per the common contract (both shapes): each gate with a `seated-member:` ref stores the card form; each filled field present and correct (incl. a dated active card ≠ the held card); turn order with `refOfMember` on S4-shaped history and unchanged on today's.

## Files owned
`src/lib/server/**` sites above (by file or named hunk), `src/lib/shared/sockets/types.ts` (additive), tests, `NOMENCLATURE.md` §25.
