# REPORT mundi-27a-w2 — pipelines and frame read identity (2026-11-05)

Status question relayed: none received.

## Per site: what it now reads
- `src/pipelines/turns.ts`
  - `presentResidents(g, w, state, annex)` (signature changed from `avatars`): ref = `avatarRefOf(state, annex, avatar, w)`; no ref -> left out.
  - Texted resident: `avatarOfLane(annex, channel, state)` -> `avatarRefOf`; no owner -> `cardRef(thread)` (⏳ comment: a phone lane number is a card id in S3). The own-reply compare is still `landed.speaker === resident`.
  - `last`: `refOfEntry(speakerEntryOf(state, newest))`, else (see decision 2) the ref of `avatarOfSpeaker` -> `avatarRefOf`, else `''`. `spokeAsCast(newest)` decides "a resident spoke", so the narrator test is unchanged. `PickMessage` gained `castMemberId`.
- `src/pipelines/talkActions.ts` `talkLineHandler`: `lane = phoneLaneOf(annex, avatar, state)`, `characterId = avatarCardOf(...)`, `speakerRef = avatarRefOf(...) ?? ''`. New in-port `state: S.json` on `talkLineDefinition`, wired `state: $.state.main` at `posted` only.
- `src/pipelines/scenes.ts` `visitEndedHandler`: talked-with = `avatarOfSpeaker(state, annex, m, w)` of the non-user rows. `Row` gained `castMemberId`.
- `src/nodes/sceneBlocks.ts` `recentLines`: `speakerEntryOf(state, m)?.name` (string), else `'?'`. `Row` gained `castMemberId`.
- `src/pipelines/judge.ts` `askVerdictPromptHandler`: `nameOf` the same way. `Row` gained `castMemberId`.
- `src/pipelines/diary.ts`: `dayLines(messages, start, nameOf: (row) => string)`; name = `nameOf(r)` when `spokeAsCast(r)`, else `''`; narrator = `r.role !== 'user' && !spokeAsCast(r)`. `diaryPromptHandler`'s `nameOf` = `speakerEntryOf(state, row)?.name`.
- Frame:
  - `ui/src/core/store.ts`: new `cardIdOfAvatar(avatar)` and `avatarOfMessage(m)` next to `annexAvatars()`. They read `host.annex.mundi.save.hud.cast` rows (`avatar`, `castMemberId`, `cardId`) and `annexVersionOf` imported from `src/engine/identity.ts`. The esbuild bundle was checked in the scratchpad and builds cleanly; `ui/mundi.js` was not touched.
  - `ui/src/log.ts` `avatarOf` -> `avatarOfMessage`.
  - `ui/src/library.ts` `characterIdOf` -> `cardIdOfAvatar`, then the existing log-speaker fallback.
  - `ui/src/phone/state.ts` `laneOf` / `laneAskOf` -> `cardIdOfAvatar`.
  - `ui/src/phone/contacts.ts` is unchanged (its call goes through `laneOf`).

## Decisions (named)
1. The talk line's `state` in-port is the only new port, as the brief allows.
2. `last` falls back through the avatar (`avatarOfSpeaker` -> `avatarRefOf`) when the cast has no entry for the row. The existing turns test "never the one who just spoke" runs on `byId: {}` with a v1 annex, and the brief's plain `refOfEntry(speakerEntryOf(...))` returned nothing there. The fallback goes through the identity door, so no `cardRef` is called at this site.
3. `avatarOfMessage` tries `castMemberId` first (the `hud.cast` row carrying it; in a v2 annex also the avatar whose number it is). If that finds nothing, it falls back to `characterId` (v1: the avatar whose number it is; v2: the row whose `cardId` it is).
4. In `cardIdOfAvatar`, v1 returns the number the annex keeps and never re-derives it from the row, matching `avatarCardOf`. v2 uses the row's `cardId`.
5. Assumption: `host.annex.mundi` is the annex document `{ version, save }` (`ui/src/host.ts` documents this), so the frame passes `mundi` to `annexVersionOf`.

## Pinned tests that changed (quoted, with reason)
- `test/pipelines/diary.test.ts`: the `dayLines` callback `(id) => (id === ID ? 'Mia' : '')` became `(row) => (row.characterId === ID ? 'Mia' : '')`. `nameOf` now takes the row, as the brief says.
- `test/pipelines/diary.test.ts`: the two state fixtures had `cast.byId['9'] = { name: 'Mia', ... }` with no `id`. The old code read the key, which the rules forbid ("look up, never parse"). I added `id: ID` to those fixture entries, as a real host fills it. Without it the prompt printed `: Hello, Alex.` and `diary-apply` made no bond changes. No assertion changed.
- Every other pre-existing assertion is untouched.

## Files changed
- Source: `src/pipelines/{turns,talkActions,scenes,judge,diary}.ts`, `src/nodes/sceneBlocks.ts`, `ui/src/core/store.ts`, `ui/src/log.ts`, `ui/src/library.ts`, `ui/src/phone/state.ts`.
- Tests:
  - `test/pipelines/{turns,talkActions,scenes,judge,diary}.test.ts`
  - `test/nodes/sceneBlocks.test.ts`
  - `test/ui/library.dom.test.ts` (v2 hand-off)
  - `test/ui/phone.dom.test.ts` (v2 lanes)
  - `test/ui/identity.test.ts` (new: the frame's door and `log.avatarOf`, both shapes)
- Each switched site has a case on today's data and an S4-shaped one: member-keyed `byId` with `ref: 'seated-member:501'`, `castMemberId: 501`, `cardId: 41`, `id: 0`; a card-less speaker (`characterId: null`, `castMemberId: 502`); a v2 annex; hud rows carrying `castMemberId` / `cardId`.

## Tests run
- `npx vitest run test/pipelines test/nodes test/ui`: green (pipelines + nodes 209, ui 122 at the last runs).
- `npx tsc --noEmit -p tsconfig.check.json`: clean.
- Whole port suite `npx vitest run`: 56 files, 658 / 658 passed (baseline 592; the run includes w1's concurrent edits).

## Open ★
None.

## Noticed, not done
- `src/engine/save.ts` `runEngine` still builds its name map from `d.cast?.byId?.[String(id)]` (w1's file). It is the same key-parse class, and the diary fixture failure above came from it.
- `npx prettier --check src/pipelines/turns.ts` warns on the file. I did not check whether it already warned before my edit, so I did not reformat.
- `ui/src/phone/contacts.ts` header comment still says "characterId from annex.mundi.save.avatars"; it is now the card id via `cardIdOfAvatar`. I left it: the brief says edit that file only if its comment or call needs it, and the comment is a historical "Changes:" line.
- `ui/mundi.js` / `ui/mundi.css` were not rebuilt (supervisor packages).
