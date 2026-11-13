# BRIEF — lane `s4-seat-live`, worker w1 — a card-less seat's turn: fire → reply → run scope → its own private lore (Q1–Q3) (2026-11-08)

Supervisor: lane `s4-seat-live` (seat-cast S4, wave 4 follow-up; **the flip is ON** — `src/lib/server/state/memberForm.ts` `memberFormSwitch = { on: true }`). Repo `/home/jody/github/serene-pub`. Report in your final message (no report file). Worker w2 runs beside you (session_cast read + promptFields + `build-template-context`); see "Shared files".

## Context (quoted by the supervisor; never reinterpret)

- Owner 2026-11-05: "Everything in session is cast → active card." A **card-less character seat** is a `session_characters` row with `character_id` NULL, `envoy_slug` NULL, `cast_member_id` set; its ref is `seated-member:<castMemberId>` (`hostSeatRefOf` in `pipelines/prompt/seatCards.ts` emits it). `seatOf(db, sessionId, ref)` (`sessions/seats.ts`) answers it with `cardId: null`, `castMemberId` set.
- Owner 2026-11-08 ★4: **"background member" = not seated in this session.** *Seated* = a **live** seat (`removed_at` null) of either table (`session_characters`, `session_personas`) holds the member.
- ⚠ **Card ids and member ids share one id range** — a wrong-person read is silent. Never put a member id where a card id is read, never compare one to the other, keep them in separately named fields.
- ⚠ **Today's bug you are fixing:** `sessions/fireTurn.ts` (~215–263) builds a plain `{ kind: "respond" }` when `seatOf(...).cardId` is null, so a card-less seat's turn runs **as the narrator** and sees the narrator's lore.
- The lore gate is ready (lane s4-seat w2): `pipelines/prompt/characterLore.ts` `isCharacterLoreEntryVisible(entry, session, currentCharacterId, currentCastMemberId = null)`; with optional `session.seatedMemberIds` (live member ids), background = not seated. Its persona branch reads `cp.castMemberId` off `session.sessionPersonas` — **the host drops that field today** (bug to fix below). Read the function before you start.
- Plugins never parse ref strings (owner modder rule 2026-11-08). Core may; prefer matching the host-filled `ref` / `castMemberId` over parsing.

## Goal (the supervisor's queue Q1–Q3, exactly)

1. **Q1 `src/lib/server/sessions/fireTurn.ts` `fireTurnEntry` RESPOND branch (~215–263):** a `seated-member:` entry whose seat has **no card** → `turn: { kind: "respond", speaker: ref }` (the member-form ref), not narrator. A seat with a card keeps `{ kind: "respond", characterId }`. One `seatOf` call, not two.
2. **Q2 `src/lib/server/utils/runReply.ts`:** `ReplyTurn` gains the variant `{ kind: "respond"; characterId?: null; speaker: \`seated-member:${number}\` }` (one JSDoc sentence; widen the existing envoy variant or add one — your call, name it). `routeFor` carries it as `speakerRef` (it already spreads `turn.speaker`). **Regenerate / swipe / extend** (`routeFor` ~248–286): a row with `characterId` null whose `metadata.speaker` is `seated-member:<id>` re-drives as that seat (`speakerRef`), exactly as an envoy row does today. Check `sideCharacterSeat` and the `speaker: null` branch (~555–570) still do the right thing.
3. **Q3 run scope + lore:**
   - `src/lib/server/pipelines/runtime/host.ts` `HostScope` (~183–260): 🚧 `currentCastMemberId?: number | null` — one JSDoc sentence ("the speaker of a card-less seat; set only when `currentCharacterId` is null — a member id, never a card id").
   - `src/lib/server/pipelines/runtime/runTurn.ts`: derive it once in `runTurnUnderHold` (~1808–1830) when `currentCharacterId` is null and the resolved `speaker` is a `seated-member:` ref whose seat has no card (`seatOf(...).castMemberId`); put it on `HostScope` (~902) and on the `sessionScope` input (~1948: `{ sessionId, currentCharacterId, currentCastMemberId }` — add the key only when non-null, so every other run's scope object is byte-identical). Thread it through `runSpec`'s request type the way `currentCharacterId` is threaded (find every hop). Check `storedSeatRef` (`state/seatRefs.ts:275`) passes a card-less `seated-member:` ref through unchanged with the switch on (it should); if it throws "Nobody … is seated as", say so.
   - `host.ts` `lorebook_entries` read: `loreVisibilitySubject` (~913–923) returns `{ card: number | null; member: number | null }` — a wired `speaker` that is `seated-member:<id>` naming a **card-less** seat → `{ card: null, member: id }` (the caller at ~4172 translates through `storedSeatRef`/`cardFormOfStored` first — keep that for carded seats; for a card-less one `cardFormOfStored` yields nothing). Unwired: `{ card: q.currentCharacterId ?? null, member: q.currentCastMemberId ?? null }`. `NO_SUCH_CHARACTER` stays `{ card: NO_SUCH_CHARACTER, member: null }`. Update every user of the subject (~4720 `visible`, ~4875 `farSubject`, any other) to pass both to `isCharacterLoreEntryVisible`.
   - `host.ts` `asSession` (~4413–4426): `sessionPersonas` map carries `castMemberId` and `removedAt` beside `persona` (keep today's row set — no new filter; the gate reads `castMemberId`); add `seatedMemberIds` = the `cast_member_id`s of this session's **live** seats in both tables (non-null, `removed_at` null). The character seats are already read just above (`seatRows`) — reuse that read if it carries `castMemberId`/`removedAt`, else add the columns to it. Name what you did.
   - `src/lib/server/pipelines/runtime/bindings.ts` lore lanes — each `ctx.read("lorebook_entries" | "graph_context" | …)` that passes `currentCharacterId: input?.scope?.currentCharacterId ?? null` (~1070, ~1288, ~2692, ~2790, ~3051, ~3445, ~3930, ~4285, ~8217 — re-grep, the numbers drift): also pass `currentCastMemberId: input?.scope?.currentCastMemberId ?? null` **only where the host handler it calls gates lore by speaker** (read each handler; `graph_context` ~5685 — decide and say). A site that deliberately passes `currentCharacterId: null` (narrator-shaped, e.g. ~2224) stays narrator: pass nothing. Do **not** touch `build-template-context` (~5413–5530) — w2 owns that hunk.
4. **Verify (read, report):** the reply row of a card-less seat's turn is written with `character_id` null, `cast_member_id` = the member and `metadata.speaker = "seated-member:<id>"` (placeholder/`create-message` in `host.ts` ~7600–7760 and the stamp `messages/store.ts` `speakerSeatOf` ~176). If the speaker ref is not written to `metadata.speaker` for this road, fix it inside `host.ts` (the placeholder writer) and say so; `messages/store.ts` is outside your files — if it needs a change, stop and list it.

## Files owned (edit only these)

`src/lib/server/sessions/fireTurn.ts`, `src/lib/server/utils/runReply.ts`, `src/lib/server/pipelines/runtime/runTurn.ts`, `src/lib/server/pipelines/runtime/host.ts` (**only**: `HostScope`, `loreVisibilitySubject` + its callers, the `lorebook_entries` read incl. `asSession`, the placeholder speaker stamp if item 4 needs it), `src/lib/server/pipelines/runtime/bindings.ts` (**only** the lore-lane `ctx.read` calls listed), and tests: new `src/lib/server/sessions/fireTurn.cardless.int.test.ts`, new `src/lib/server/pipelines/runtime/speakerLore.cardless.int.test.ts` (or additions to `speakerLore.int.test.ts` / `loreMatch.seatedMember.int.test.ts`), additions to `utils/replyRoad.int.test.ts` if it fits.

## Shared files (w2 is editing other hunks at the same time)

`host.ts`: w2 edits the `session_cast` read (~4904–5490) — never touch it. `bindings.ts`: w2 edits `build-template-context` (~5413–5530) only. **Re-read the region before every Edit**; if an Edit fails because the file changed, re-read and redo. Never reformat either file.

## Files readable

Everything. Key: `sessions/seats.ts` (`seatOf`, `seatCast`, w1's card-less paths), `sessions/seats.cardless.int.test.ts` and `sessions/fireTurn.seatedMember.int.test.ts` (harnesses for a card-less seat and a fired turn), `pipelines/prompt/seatCards.ts` (`hostSeatRefOf`), `state/seatRefs.ts`, `pipelines/prompt/characterLore.ts`, `pipelines/runtime/speakerLore.int.test.ts` (how lore-by-speaker is tested), `messages/store.ts`.

## Out of scope (never built here)

`promptFields.ts`, the `session_cast` read, `build-template-context` (w2). `stops.ts`, `dispatch.ts`, `dispatchSpeech.ts`, `contentProcessors.ts`, `ragQuery.ts`, `seatName.ts`, `permissions.ts`, `state/resolve.ts`, `sockets/sessions.ts`, pick-sprite (later workers). SDK. Client. Docs. NOMENCLATURE (list rows to queue).

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a new exported name beyond `currentCastMemberId` (HostScope, sessionScope, run request) and the `ReplyTurn` variant; a change outside your files; the SDK would need a change (e.g. a typed `sessionScope` schema rejects the new key — then stop and report, don't edit the SDK).

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a fixed id. No migration. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- It is a **session**, never a chat.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build; dev servers are running — don't build.)
- Prettier: `npx prettier --check` changed files; only `--write` lines you changed — never reformat a whole file. `host.ts`/`bindings.ts` are huge: hand-format your hunks.
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests (Done means)

Capped, logged:

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-live-w1-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-live-w1-tests.log"
```

Must pass, each its own `it` (real handlers, real DB):
- firing a `seated-member:` entry for a card-less seat runs `runReply` with `speaker: "seated-member:<id>"` (not a narrator turn); a carded seat's entry still passes `characterId`;
- the run's `HostScope.currentCastMemberId` and `sessionScope.currentCastMemberId` = the member for that turn; absent/null on a carded or narrator turn; a narrator turn's scope object has no new key;
- regenerate of a card-less seat's row (characterId null, `metadata.speaker = seated-member:<id>`) re-drives with that speaker;
- lore gate through the host `lorebook_entries` read, session with card-less member M seated, member N (card-less) seated, member B not seated: M's turn sees M's private entry and not N's or B's; the narrator sees B's (background) and not M's; a player seat holding a member still sees that member's entry on every turn (the `castMemberId` the host now passes);
- the reply row of M's turn: `character_id` null, `cast_member_id` = M, `metadata.speaker = seated-member:M`.
Re-run the existing tests of every file you touched (at least `fireTurn.int`, `fireTurn.seatedMember.int`, `replyRoad.int`, `runTurn.int`, `speakerLore.int`, `loreMatch.seatedMember.int`, `host.seatForm.int`, `host.seatMembers.int`, `lorebookEntries.ownBook.int`, `characterLoreRendered.int`), ≤10 files per batch. `npx tsc --noEmit -p .` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`, log `$SP/s4-seat-live-w1-tsc.log`) — no new errors.

## Report (final message)

Changed files with hunks named; decisions (named); what item 4 found; tests + counts + log paths; tsc; stopped-and-asked; Noticed, not done; NOMENCLATURE rows to queue (draft).
