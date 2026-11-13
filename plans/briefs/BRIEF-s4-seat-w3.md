# BRIEF — lane `s4-seat`, worker w3 — card-less seats: the seat filters, faces, voice, sprites, gate, hand edits (2026-11-08)

Supervisor: lane `s4-seat` (wave 4 of seat-cast S4; the flip is ON — `state/memberForm.ts` `memberFormSwitch = { on: true }`). Repo `/home/jody/github/serene-pub`. Report in your final message (no report file).

## Context (quoted by the supervisor; never reinterpret)

- Owner 2026-11-05: "Everything in session is cast → active card." A seat reads its member over the member's active card; a **card-less** member reads only its own fields (`cast/memberAsRead.ts` `MemberAsRead`, `cardless: true`; its art: `faceMediaId`, `spriteSets`/`spriteSetsFrom: "member"`, `timbre`/`voiceFrom`).
- Owner 2026-11-05 ★S2b-1 "Still theo": the seater (`session_characters.seated_by_user_id`) acts for the seat — for a card-less seat there is no card owner to fall back on.
- Worker w1 (done) made **card-less character seats** writable: a `session_characters` row with `character_id` NULL, `envoy_slug` NULL, `cast_member_id` set; addressed `seated-member:<castMemberId>`, stat owner `{ kind: "seated_member", id: <castMemberId> }`; `sessions/seats.ts` `seatOf` finds it by `seated-member:`.
- Plan §34.2: "Every `isNotNull(characterId)` filter (`seatedCast.ts:129`, … `rowProjection.ts:574`, `portrayals.ts:401`, `conversations/gate.ts:192`, `state/handEdits.ts:230`) → 'not an envoy, and has a member or a card'; voices-in-use (`resolveVoice.ts:298`), sprite choice (`sprites/choices.ts:121-150`) … by member."
- **The seat filter** = `and(isNull(cs.envoySlug), or(isNotNull(cs.characterId), isNotNull(cs.castMemberId)))`, written inline (no new exported helper).
- ⚠ **Card ids and member ids share one id range** — a wrong-person read is silent. Never put a member id where a card id is read; never invent a card id; keep them in separately named fields; never compare one to the other.
- A read-only diagnosis gave these per-site calls (verify each against the code; decide inside them and name your choice):

| Site | Today | Change |
|---|---|---|
| `cast/seatedCast.ts:129` `seatedCastOf` | `isNotNull(characterId)` | the seat filter; update the JSDoc ("character seats with a card" → with a member or a card); `asRead` already reads by `castMemberId` |
| `sessions/rowProjection.ts:545-577` `sessionsWithMemberWords` (`castFaces` source) | `isNotNull(characterId)` | a session with a live card-less seat is always a candidate; a card-less row never claims a card-keyed `castFaces`/`castNames` entry (those stay ⏳ keyed by card id) |
| `rowProjection.ts:141-150` message names | `cardNow.get(r.characterId)` | a row with `characterId` null and `castMemberId` set is named by the member as read (`membersAsRead`, on the session's reading) |
| `pipelines/runtime/portrayals.ts:446-459` `turnRefs` | `isNotNull(characterId)` | the seat filter (`isNull(envoySlug)` + member-or-card); refs via the existing `hostSeatRefOf`; `ownPresence` (~401) — check, likely unchanged |
| `conversations/gate.ts:172-206` | `innerJoin` characters; a cardless member → null | `leftJoin` + the seat filter; a card-less member reads its own fields (drop the `cardless ? null` branch — "Everything in session is cast → active card"; a card-less member *is* its own words) |
| `state/handEdits.ts:220-236, ~367, ~412` | `seaterOf` keyed by card; `characterOf(seated_member)` → undefined when card-less | add a private seater lookup keyed by `castMemberId`; `whose()` answers a `seated_member` owner with no card by its seat's seater |
| `state/seatRefs.ts` `storedOwnerOfSeat` (~243) | null for a card-less character seat | expected unchanged (only used with the flip off; `memberOwnerOfSeat` ~250 already answers) — confirm and say so; change only if a live path reaches it with the flip on |
| `speech/resolveVoice.ts:291-307` `usedVoiceSlugs` | skips seats without a card | count member-only seats (the member's timbre as read) |
| `speech/resolveVoice.ts:132-150` `speakerTimbre` | `seatOf` → `memberAsRead` | expected to work already — prove it with a test |
| `sprites/choices.ts:121-280` | `characterId` required; seat looked up as `character:`; recent lines by `characterId` | add an optional `castMemberId` input (exactly one of the two): the seat from `seated-member:<id>`, the member's own sprite sets only (no card fallback), recent lines by `session_messages.cast_member_id`; the owner key via the existing `loadSeatMap` + `memberFormOf` path |
| `pipelines/runtime/illustrateScene.ts:175-250` | `innerJoin` characters | `leftJoin` + `isNull(envoySlug)`; a card-less seat's likeness from its member (the existing `cardlessMembers` path — check) |

## Goal

Apply the table. For each site: the change, a comment only where the reason isn't obvious, and a test. Envoy seats must stay excluded everywhere they were.

## Files owned (edit only these)

`src/lib/server/cast/seatedCast.ts`, `src/lib/server/sessions/rowProjection.ts`, `src/lib/server/pipelines/runtime/portrayals.ts`, `src/lib/server/conversations/gate.ts`, `src/lib/server/state/handEdits.ts`, `src/lib/server/state/seatRefs.ts`, `src/lib/server/speech/resolveVoice.ts`, `src/lib/server/sprites/choices.ts`, `src/lib/server/pipelines/runtime/illustrateScene.ts`, and tests next to them (existing: `cast/seatedCast*.test.ts`, `sessions/rowProjection.*.int.test.ts`, `illustrateScene*.test.ts`, `state/handEdits*.test.ts`, `speech/*voice*.test.ts`, `sprites/choices*.test.ts`, `conversations/gate*.test.ts`, `portrayals*.test.ts` — find them; or new `*.cardless.int.test.ts` files beside each).

⚠ `pipelines/runtime/portrayals.ts` had a build fix (an `if` folded into an empty loop body broke esbuild — "Cannot use a declaration in a single-statement context"); keep braces on every loop body you touch.

## Files readable

Everything. Key: `sessions/seats.ts` (w1's card-less paths, `seatOf`), `sessions/seats.cardless.int.test.ts` (w1's harness for making a card-less seat), `cast/memberAsRead.ts`, `state/seatRefs.ts` (`loadSeatMap`, `memberFormOf`).

## Out of scope (never built here)

`runtime/host.ts` (incl. the host's `pick-sprite` call ~6702 and `session_cast` read), `runtime/dispatchSpeech.ts`, `state/resolve.ts` `sessionLinks` (card-less seats get no state link yet), `bindings.ts` (w2's — if `bindings.ts` pick-sprite should pass your new `castMemberId`, say so), `sockets/sessions.ts`, client, docs, NOMENCLATURE (queue rows). List every outside edit you find needed, exactly.

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a ★ is unruled; a new exported name beyond the `castMemberId` input on the sprite-choices function; a change outside your files.

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

Capped, logged:

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-w3-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-w3-tests.log"
```

Must pass, each its own `it` (a session with one carded seat, one card-less seat, one envoy seat):
- `seatedCastOf` lists the card-less seat (`cardId` null, `asRead` = the member) and not the envoy;
- a card-less line (`character_id` null, `cast_member_id` M) is named by M in the row projection; `sessionsWithMemberWords` includes a session that only has a card-less seat;
- `turnRefs` includes `seated-member:<M>` and not the envoy;
- the conversation gate reads the card-less member's own fields;
- hand edits: a `seated_member` owner M with no card is whose its seater is (a player who seated M edits per their latitude; another player is `not-theirs`);
- `usedVoiceSlugs` counts the card-less member's voice; `speakerTimbre` for `seated-member:<M>` returns M's timbre;
- sprite choices with `castMemberId: M` offer M's own sets only, and find recent lines by `cast_member_id`;
- illustrate scene draws the card-less seat's likeness from its member.
Re-run the existing tests of every file you touched, ≤10 files per batch. `npx tsc --noEmit -p .` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`, log `$SP/s4-seat-w3-tsc.log`) — no new errors.

## Report (final message)

Changed files; decisions (named) per table row; tests + counts + log paths; tsc; stopped-and-asked; outside-lane edits needed (exact); Noticed, not done; NOMENCLATURE rows to queue (draft).
