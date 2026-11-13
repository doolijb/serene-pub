# BRIEF mundi-27a-w1 — the engine reads identity, not card ids (Mundi port, seat-cast S3)

Lane-worker (Sonnet). Supervisor: mundi-27a. **First read `/home/jody/github/serene-pub/plans/briefs/BRIEF-mundi-27a-common-rules.md` (the rules, quoted, and the verbatim lines) and `/home/jody/github/mundi-sp/src/engine/identity.ts` (the one door).** A second worker (w2) is switching `src/pipelines/**`, `src/nodes/**` and `ui/src/**` at the same time — don't touch those.

## Goal
Every engine-side site that builds a participant reference from a number, reads `byId[String(id)]`, or turns a `cast.byId` key into a card id reads the host's identity through `identity.ts` instead — output unchanged on today's data, right on S4-shaped data.

## Items (line numbers approximate)
1. **`src/engine/save.ts`**
   - `seatRefOf` (~173): delegate to `playerRefOf` (keep the exported name; `world.ts`, `relationships.ts` and tests import it). Delete the private `playerEntry` duplicate if `playerEntryOf` serves (keep `personaNameOf`/`personaNameKnown` behaviour).
   - `valueOf` (~180) and `hudValueOf` (~202): the cast holder is `avatarEntryOf(d, input.annex, avatar, input.world)`, not `d.cast.byId[String(…)]`. `hudValueOf` keeps reading the mirror by its key (the annex number — that is the mirror's own key, not a host key).
   - `hudOf` (~249): the skip `seatRef === \`character:${id}\`` becomes "the avatar's ref (`avatarRefOf`) is the player's `seatRef`". `hudOf` needs the state/annex/world to do that — change its signature as you judge (it has callers in `writesOf` and tests; check `ui/src` does not call it — if it does, tell the supervisor, don't edit ui). Each row gains `castMemberId` / `cardId` **only when the entry has the field** (the mirror contract in the rules file).
   - `writesOf` (~310): a cast change's owner is `avatarRefOf(...)`; when that is null, skip the change (today it would have written `character:undefined`). **The annex written back keeps the version it read** (`annexVersionOf(input.annex)`), never a hard-coded `1` over a v2 map — that is reading v2, not writing it. Update `MundiHud`'s doc of `cast` (keyed by the annex number; the two new fields).
   - `runEngine` (~355): names from `avatarEntryOf(...)?.name`.
   - The file-head comment (lines 8–13) describes where facts are found — update it to the host's fields (ref/castMemberId/cardId), ⏳ card form as the fallback.
2. **`src/engine/relationships.ts`** `newGameHandler` (~335–355): `names` via `avatarEntryOf(input.state, annexOf(avatars), a, w)` (or `entryByCard` — the avatars here are v1 card ids, the new game's own); the hero-age guard "the seat is one of the world's people" becomes: some avatar that is an example person (`exampleOfAvatar(w, a)`) whose `avatarRefOf` equals `seatRef` — not `tag.startsWith('character:')` and not `` `character:${id}` ``. Keep the comment's meaning (a key that is not an example tag is a card of the person's own).
3. **`src/genre/newGame.ts`**
   - `playerPersonaOf` (~38): the seat whose `refOfSeatRow(s)` equals `playerRefOf(state)`, else the first live one (today's fallback).
   - `avatarsOf` (~93–100): iterate `castEntries(state)`; the value is `cardOfEntry(e)` (v1 = card ids: the new game still writes v1); an entry with no card is left out (a card-less member waits for the v2 writer, S4 — comment it); the key is the example tag when the name matches an example, else `refOfEntry(e)` (today `character:<id>`, the same string as now). No `Number(id)`.
4. **`src/world/deriveBook.ts`** `avatarsOf` (~300–307): the same switch (examples only, value `cardOfEntry`). If the two `avatarsOf` can share one body without a cross-folder import cycle, say so in the report; don't merge them yourself unless it is trivial.
5. **`src/engine/presence.ts`** (~50): `characterId` is `avatarCardOf(input.state, input.annex, r.avatar, w)` (a card id port: stays a card id). Don't add fields to its output.
6. **`src/engine/phone.ts`** transcript handler (~195–205): pass `input.state` (and the world) to `phoneLaneOf` / `avatarOfLane`; `characterId` = `avatarCardOf(...)`; `speakerRef` = `avatarRefOf(...) ?? ''`. Drop `annexAvatars` imports that become unused.
7. **Tests** (both shapes, per the rules file):
   - New `test/engine/identity.test.ts`: every exported helper on (a) today's host (entries `{ id: 41, name }` keyed `'41'`, no fields; messages with `characterId` only), (b) an S3 host (`ref: 'character:41'`, `castMemberId: 501`, `cardId: 41`), (c) S4-shaped (keyed `'501'`, `ref: 'seated-member:501'`, `castMemberId: 501`, `cardId: 41`, `id` set to something that must NOT be used, e.g. `0`; a card-less member `cardId: null`; a carded player seat `who.user` with `ref: 'player-seat:3'`), plus annex v1 vs v2, an unknown v2 id re-resolved by an example tag (use the shipped modern world, `worldForPlay(shippedWorldRaw('modern')!)`, and one of its examples) and by a ref key.
   - Extend `test/engine/save.test.ts`, `test/engine/hud.test.ts`, `test/engine/relationships.test.ts`, `test/engine/presence.test.ts`, `test/engine/phone.test.ts`, `test/genre/newGame.test.ts`, `test/world/deriveBook.test.ts`: each switched site keeps its existing assertions green unchanged (today's shape) and gains an S4-shaped case (a change's owner is `seated-member:<id>`, the mirror rows carry the two fields, a v2 annex finds its people, the persona seat is matched by ref, the phone transcript's `speakerRef` is the member ref and its `characterId` the card).

## Files owned
`src/engine/save.ts`, `src/engine/relationships.ts`, `src/engine/presence.ts`, `src/engine/phone.ts`, `src/engine/world.ts` (only if a signature forces it), `src/genre/newGame.ts`, `src/world/deriveBook.ts`, `src/engine/identity.ts` (**bug fixes only, each named in your report**), and the test files above (new `test/engine/identity.test.ts`).

## Files readable
Everything in `/home/jody/github/mundi-sp`; the SDK types under `/home/jody/github/serene-pub-sdk/sdk/src/{participants,widgets}.ts` (read only).

## Out of scope
`src/pipelines/**`, `src/nodes/**`, `ui/**` (w2's). The annex v2 writer and save upgrade (S4). Phone lane form. CHANGELOG, packaging (the supervisor's). Any spec/port change.

## Stop and ask when
CLAUDE.md §Decisions applies; a new name, port or stored field beyond the mirror's two; a test that pinned today's output must change (quote it and why).

## Done means
`npx vitest run test/engine test/genre test/world` green; `npx tsc --noEmit -p tsconfig.check.json` clean (if it fails only in w2's files mid-edit, say so). Then run the whole port suite once (`npx vitest run`) and report the count.

## Report
`/home/jody/github/serene-pub/plans/REPORT-mundi-27a-w1-2026-11-05.md`: per site, what it now reads (file → helper/field); changed files; tests run with counts; any helper fix in `identity.ts`; open ★; Noticed, not done.
