# BRIEF mundi-27a-w2 — the pipelines and the frame read identity, not card ids (Mundi port, seat-cast S3)

Lane-worker (Sonnet). Supervisor: mundi-27a. **First read `/home/jody/github/serene-pub/plans/briefs/BRIEF-mundi-27a-common-rules.md` (the rules, quoted, the verbatim lines, and the frame's mirror contract) and `/home/jody/github/mundi-sp/src/engine/identity.ts` (the one door).** A second worker (w1) is switching `src/engine/**` (save, relationships, presence, phone), `src/genre/newGame.ts` and `src/world/deriveBook.ts` at the same time — don't touch those. `phoneLaneOf` / `avatarOfLane` in `src/engine/phone.ts` already take `(annex, x, state?, world?)`; call them, don't edit them.

## Goal
Every pipeline, node and frame site that builds `character:<id>`, reads `byId[String(m.characterId)]`, or joins a message's `characterId` to the avatars map reads the host's identity instead — output unchanged on today's data, right on S4-shaped data (a message with `castMemberId`, member-keyed `byId`, a v2 annex).

## Items (line numbers approximate)
1. **`src/pipelines/turns.ts`**
   - `presentResidents` (~103–110): a present resident's `ref` is `avatarRefOf(state, annex, avatar, world)`; a resident with no ref is left out (today: no avatar number → left out). Change the signature from `avatars: Record<string, number>` to what it needs (state + annex, or a resolver) and update its callers and tests.
   - The texted resident (~125–130): the lane's resident is `avatarOfLane(annex, landed.channel, input.state)`, its ref `avatarRefOf(...)`; a lane no avatar owns keeps today's answer through `cardRef(thread)` (⏳, comment why: a phone lane number is a card id in S3). The "their own reply asks nothing more" compare stays `landed.speaker === resident`.
   - `last` (~137): the newest row's speaker ref is `refOfEntry(speakerEntryOf(input.state, newest))`; the narrator test (`line === null && last === null`) must not change meaning — use `spokeAsCast(newest)` for "a resident spoke" so a speaker missing from the cast still counts as a resident's reply, as today.
2. **`src/pipelines/talkActions.ts`** `talkLineHandler` (~130–140): `lane` = `phoneLaneOf(annex, avatar, state)`, `characterId` = `avatarCardOf(state, annex, avatar)` (a card id port), `speakerRef` = `avatarRefOf(state, annex, avatar) ?? ''`. The handler has no state today: add a `state: S.json` in-port to `talkLineDefinition` and wire `state: $.state.main` at the `posted` stage (the only one whose `lane`/`characterId`/`speakerRef` reach `createMessage`, ~189/192); check the other `talkLineDefinition.v1(...)` calls still type-check. Name this decision in your report.
3. **`src/pipelines/scenes.ts`** `visitEndedHandler` (~49–58): who was talked with = the avatars `avatarOfSpeaker(input.state, input.annex, m, w)` of the non-user rows (add `castMemberId?: unknown` to its `Row`).
4. **`src/nodes/sceneBlocks.ts`** `recentLines` (~128–141): a character line's name is `speakerEntryOf(state, m)?.name` (a string), else `'?'`; `Row` gains `castMemberId`.
5. **`src/pipelines/judge.ts`** (~145–157): `nameOf(m)` the same way.
6. **`src/pipelines/diary.ts`** `dayLines` (~27–36) and `diaryPromptHandler` (~71): `nameOf` takes the row (not a card id); `name` is `nameOf(r)` when `spokeAsCast(r)`, else `''`; `narrator` is `r.role !== 'user' && !spokeAsCast(r)`. Update `dayLines`' callers and tests.
7. **The frame (`ui/src`)** — it has no state and no cast; it reads `host.annex.mundi.save` (`avatars`, `hud.cast` rows — see the mirror contract) and `host.messages` (`MessageV1`, which now has optional `castMemberId`).
   - `ui/src/core/store.ts`: next to `annexAvatars()`, the frame's one door — `cardIdOfAvatar(avatar)` (v1 annex: the number it keeps; v2: the `hud.cast` row with that `avatar`, its `cardId`; else null) and `avatarOfMessage(m)` (a `castMemberId` → the `hud.cast` row carrying it, or in a v2 annex the avatar whose number it is; else ⏳ `characterId` → in v1 the avatar whose number it is, in v2 the row whose `cardId` it is). Reuse `annexVersionOf` from `src/engine/identity.ts` if the frame's build (`ui/build.mjs`, esbuild) bundles it cleanly; otherwise a local one-liner with a comment pointing at it.
   - `ui/src/log.ts` `avatarOf` (~65) → `avatarOfMessage`.
   - `ui/src/library.ts` `characterIdOf` (~86–90) → `cardIdOfAvatar(avatar)`, then the existing fallback (a speaker of that name in the log; `characterId` is a card id port) — `open-character` still takes a card id.
   - `ui/src/phone/state.ts` `laneOf` / `laneAskOf` (~74–86) → `cardIdOfAvatar` (phone lanes stay `phone:<cardId>`); `ui/src/phone/contacts.ts` ~121 only if its comment or call needs it.
8. **Tests** (both shapes, per the rules file): extend `test/pipelines/{turns,talkActions,scenes,judge,diary}.test.ts`, `test/nodes/sceneBlocks.test.ts`, and the frame tests that cover the log, the library hand-off and the phone lanes (`test/ui/*.dom.test.ts` / `test/ui/*.test.ts` — find them). Existing assertions stay green unchanged (today's shape); each switched site gains an S4-shaped case: member-keyed `byId` (`ref: 'seated-member:501'`, `castMemberId: 501`, `cardId: 41`, `id: 0`), messages carrying `castMemberId` (and one card-less speaker: `characterId: null`, `castMemberId: 502`), a v2 annex, hud rows carrying `castMemberId`/`cardId`.

## Files owned
`src/pipelines/turns.ts`, `src/pipelines/talkActions.ts`, `src/pipelines/scenes.ts`, `src/pipelines/judge.ts`, `src/pipelines/diary.ts`, `src/nodes/sceneBlocks.ts`, `ui/src/core/store.ts`, `ui/src/log.ts`, `ui/src/library.ts`, `ui/src/phone/state.ts`, `ui/src/phone/contacts.ts`, and their tests under `test/pipelines`, `test/nodes`, `test/ui`.

## Files readable
Everything in `/home/jody/github/mundi-sp`; the SDK types under `/home/jody/github/serene-pub-sdk/sdk/src/{participants,widgets}.ts` (read only).

## Out of scope
w1's files (`src/engine/**`, `src/genre/**`, `src/world/**`; `identity.ts` is the supervisor's — report a needed change, don't make it). The annex v2 writer and save upgrade (S4). Phone lane form. Building the frame bundle (`npm run build:ui`) — the supervisor packages. CHANGELOG.

## Stop and ask when
CLAUDE.md §Decisions applies; a new name, port or stored field beyond the talk line's `state` in-port and the mirror's two fields; a test that pinned today's output must change (quote it and why).

## Done means
`npx vitest run test/pipelines test/nodes test/ui` green; `npx tsc --noEmit -p tsconfig.check.json` clean (if it fails only in w1's files mid-edit, say so). Then run the whole port suite once (`npx vitest run`) and report the count.

## Report
`/home/jody/github/serene-pub/plans/REPORT-mundi-27a-w2-2026-11-05.md`: per site, what it now reads (file → helper/field); changed files; tests run with counts; open ★; Noticed, not done.
