# BRIEF — lane `s4-seat`, worker w4 — card-less seats on the client: names, faces, who may act, Pick who speaks (2026-11-08)

Supervisor: lane `s4-seat` (wave 4 of seat-cast S4; the flip is ON). Repo `/home/jody/github/serene-pub`. Report in your final message (no report file).

## Context (quoted by the supervisor; never reinterpret)

- Owner 2026-11-05: "Everything in session is cast → active card." A seat shows its member over the member's active card; a **card-less** member shows only its own name, nickname and face.
- Owner 2026-11-05 ★S2b-1 "Still theo": the person who seated a cast member acts for that seat (`session_characters.seated_by_user_id`).
- ★S3W-1 / ★S3W-3 (owner 2026-11-05): a card-less player seat is treated like any seat (its ref `player-seat:<id>`; named by its seat name and portrait).
- Server work already done in this lane: **card-less character seats** exist — a `session_characters` row with `character_id` NULL, `envoy_slug` NULL, `cast_member_id` set; its ref is `seated-member:<castMemberId>`; its lines are written with `character_id` NULL and `cast_member_id` = the member (`metadata.speaker = "seated-member:<id>"`).
- ⚠ **Card ids and member ids share one id range** — a wrong-person read is silent. Never look a member id up in a card-keyed map (`castNames`, `castFaces`, `castSpriteSets`, `spriteSetOverrides` are keyed by **card** id), never compare a member id with a card id.
- Lane f-client (done) built `seatOfMessage` (`client/components/sessionPage/projections/seatIdentity.ts` ~187: narrator line → nothing; a stamped `metadata.speaker` naming a seat wins; else the line's form + its `castMemberId`; card column last), `messageRefOf`, and 🚧 `participantForRefIn(session, ref)` (`sessionPageProjections.ts` ~136: by `seatOfRef`, never card id; carded player seat by the header's persona rule; card-less player seat by `seatName` + seat portrait). Its queue to this lane: "`utils/messageSpeaker.ts` ~121/~149 looks up a seat only with `personaId`/`characterId`, so a card-less character line gets no name/face; name it from `seatOfMessage`. Also `canControlMessageAs` (`sessionPageProjections.ts` ~150) mirrors the server's `canActOnMessage` — move with the seat lane."
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`. `$state(new Set())`/`new Map()` is not reactive — `SvelteSet`/`SvelteMap`. Views never call `toaster`/`notify` for socket results; `socket.off(event)` always with the handler.

## Goal

1. **Wire (server → client): 🚧 `cardlessSeatShown`** on the `sessions:get` session payload (supervisor's decision; marked ★ for the owner with "rec keep"): `Record<castMemberId, { name: string; nickname: string | null; faceMediaId: number | null }>` — one entry per seat of either table, live or departed, that holds **no card** and has a `cast_member_id`, read as its member on the session's reading (`membersAsRead(db, ids, { sessionId })`: `name`, `nickname`, `faceMediaId`). Keyed by **member** id; never merged into the card-keyed maps.
   - Server: `src/lib/server/sockets/sessions.ts` `withSessionExtras` (~5466–5600) — **only that function**. Also make sure the host-filled identity block there gives a card-less **character** seat row its `ref` (`hostSeatRefOf` → `seated-member:<id>`), `castMemberId`, and `cardId: null` (today it handles only card-less player seats — check). An empty map when there are none; on a read failure `{}` (as the neighbours do).
   - Types: `src/lib/shared/sockets/types.ts` — the `sessions:get` session shape (beside `castNames` ~4800) gains `cardlessSeatShown?` with one JSDoc sentence: "🚧 Seats that hold no card, shown as their cast member (name, nickname, face), by cast member id — never by card id (plan §34.2)." ⚠ Another lane (s4-cp) may be editing the `Sockets.Characters` namespace of this file at the same time; touch nothing there or in `Sockets.Characters.Page`. If `sessions:list` rows share the type, leave the list path alone (absent = none).
2. **`src/lib/client/utils/messageSpeaker.ts`** (~121, ~149): a line whose seat (`seatOfMessage`) is a card-less character seat (no `character`, has `castMemberId`) is named and faced from `session.cardlessSeatShown[castMemberId]` (face → the same avatar path the card's face takes; find how `castFaces` media ids become an image); a departed one falls back to `removedName`. Also a line with `characterId` null, `personaId` null and a `castMemberId` (a card-less character line) must reach that branch — today the function branches on `msg.personaId` / `msg.characterId` only. Card-less player seats keep their seat-name rule; if one has no seat name but a `castMemberId`, use its `cardlessSeatShown` entry.
3. **`participantForRefIn`** (`sessionPageProjections.ts` ~136): a `seated-member:<id>` ref whose seat holds no card → name/face from `cardlessSeatShown[id]`.
4. **`canControlMessageAs`** (`sessionPageProjections.ts` ~212) mirrors the server's `canActOnMessage` (`src/lib/server/messages/permissions.ts` ~172 — read it, don't edit it) for card-less lines: whoever may act for a card-less character seat on the server (its seater — check the server rule exactly) may act on its lines on the client. Mirror, don't invent.
5. **Pick who speaks** — `src/lib/client/components/sessionPage/PickSpeakerModal.svelte` + `turnFlow.svelte.ts` `onPickSpeaker` (~339): the modal lists every live character seat that has a card **or** a `cardlessSeatShown` entry (name, nickname, face, and the summary line only when there is a card — a card-less row shows no summary text rather than a new sentence), and calls `onPickSpeaker(ref: string)` with the seat's host-filled `ref` (`seatRefOf(seat, "character")` — check `seatIdentity.ts`); `turnFlow`'s `onPickSpeaker(ref)` fires `fireTurn(socket, sessionId, { ref })` directly and the ⏳ card lookup comment goes. Search matches the shown name/nickname for card-less rows. No new copy, no layout change: a card-less row looks like a carded row without the summary.
   ⚠ The `Avatar` component takes a card (`char=`); find how other views draw a face from a media id for a seat with no card (f-client's `participantForRefIn` / seat portraits) and reuse that.

## Files owned (edit only these)

`src/lib/server/sockets/sessions.ts` (**only** `withSessionExtras`), `src/lib/shared/sockets/types.ts` (only the one field), `src/lib/client/utils/messageSpeaker.ts`, `src/lib/client/components/sessionPage/sessionPageProjections.ts` (`participantForRefIn`, `canControlMessageAs` and private helpers they need), `src/lib/client/components/sessionPage/PickSpeakerModal.svelte`, `src/lib/client/components/sessionPage/turnFlow.svelte.ts` (`onPickSpeaker` only), and tests next to them: `messageSpeaker.test.ts`, `sessionPageProjections.*.test.ts`, a DOM test for PickSpeakerModal if one exists (find it), a server int test for `cardlessSeatShown` (new, e.g. `src/lib/server/sockets/sessions.cardlessSeatShown.int.test.ts`).

## Files readable

Everything. Key: `seatIdentity.ts`, `sessionPageProjections.ts` 1–300, `messageSpeaker.ts` whole, `server/messages/permissions.ts` ~150–260, `sockets/sessions.ts` 5466–5620, `sessions/seats.cardless.int.test.ts` (how to make a card-less seat in a test), `STYLE-GUIDE.md` §component patterns only if you touch markup beyond the list filter.

## Out of scope (never built here)

The **seating pickers** (StartSessionForm / EditSessionForm / CharacterSelectModal offering card-less members) — the supervisor holds that as a ★. Docs. Server readers other than `withSessionExtras`. NOMENCLATURE (queue rows). `sessions:list` rows.

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a ★ is unruled; you need new user-visible copy or a layout change; a new exported name beyond `cardlessSeatShown`; a change outside your files (describe it exactly).

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a fixed id. No migration. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- It is a **session**, never a chat.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)
- Prettier: `npx prettier --check` changed files; only `--write` lines you changed — never reformat a whole file. `sockets/sessions.ts` and `types.ts` are huge: hand-format your hunks.
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests (Done means)

Capped, logged (DOM tests in the same capped scope; a failing `assert` on a happy-dom element has OOM-killed VS Code — keep DOM runs to the files you touch):

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-w4-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-w4-tests.log"
```

Must pass, each its own `it`:
- server: `sessions:get` (or `withSessionExtras` through the handler) for a session with a card-less seat carries `cardlessSeatShown[M] = { name, nickname, faceMediaId }`, and that seat row's `ref` is `seated-member:<M>` with `cardId` null; a carded seat adds nothing to it;
- client: a card-less character line (`characterId` null, `castMemberId` M) gets M's name and face from `cardlessSeatShown`; a card 7 vs member 7 collision fixture never crosses (a card-keyed `castNames[7]` does not name member 7's line, and `cardlessSeatShown[7]` does not name card 7's line);
- `participantForRefIn(session, "seated-member:<M>")` for a card-less seat → M's name/face;
- `canControlMessageAs` on a card-less line: the seater may, another player may not (mirroring the server rule you read);
- PickSpeaker: a card-less seat is listed and pressing it calls `onPickSpeaker("seated-member:<M>")`; a carded seat calls with its host-filled ref.
Re-run the existing tests of every file you touched (≤10 files per batch). `npx tsc --noEmit -p .` then `npm run check` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`, logs `$SP/s4-seat-w4-tsc.log`, `$SP/s4-seat-w4-check.log`) — no new errors (baseline: tsc 0, check 0 errors / 8 warnings).

## Report (final message)

Changed files; decisions (named); tests + counts + log paths; tsc + check; stopped-and-asked; Noticed, not done; NOMENCLATURE rows to queue (draft).
