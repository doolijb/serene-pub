# BRIEF bench-L4b-w1 — host-filled `hasLines` / `fellInStory` on benched seat rows

Supervisor: bench-L4b. Repo: /home/jody/github/serene-pub. Report: your final message (the supervisor reads it). Scratch files start with `bench-L4b-w1-`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal (ruled by the lead, ★L4-1 yes)

`sessions:get` and `sessions:refresh` send each seat row (`session.sessionCharacters[]` and `session.sessionPersonas[]`). Add two **host-filled** fields, **only on benched rows** (a benched row = `removedAt` null/absent AND `isActive === false`; a seat in play or a removed row gets neither field — absent):

- `hasLines: boolean` — any line in the session belongs to this seat.
- `fellInStory: boolean` — the seat's story ended.

The client already reads both by duck-typing (`src/lib/client/components/sessionForms/benchedSeats.ts`: `seatHasNoLines` shows Remove only when `hasLines === false`; `seatFellInStory` shows the Skull when `fellInStory === true`). Field names are fixed: `hasLines`, `fellInStory`. **Introduce no other new name** (no new exported helper, type, event, setting). A local `const` inside the function is fine.

## Where

1. **`src/lib/server/sessions/seats.ts`** — `async function seatHasLines(tx, {sessionId, kind, seatId, castMemberId, cardId})` (~line 1615) is private. Add `export` to it. Nothing else changes in this file (no behaviour change).
2. **`src/lib/server/sockets/sessions.ts`** — `withSessionExtras(sessionData, sessionId)` (~line 5572). It is shared by `buildSessionGetResponse` and `buildSessionRefresh`, so one change covers both. Follow the existing **host-filled identity** block (~5650-5745) that sets `sc.ref` / `sc.cardId` / `sp.ref` / `sp.cardId`. Add a new block after it (before the book-lock block). Only edit inside `withSessionExtras`.
   - **`hasLines`**: for each benched row call the now-exported `seatHasLines(db as unknown as Db, {sessionId, kind, seatId: row.id, castMemberId: row.castMemberId ?? null, cardId})`, where `cardId` is the **stored held card**: `sc.characterId ?? null` for a character seat, `sp.personaId ?? null` for a player seat — NOT the host-filled `cardId` (that one is the member's active card on the timeline; `seatHasLines` matches `session_messages.character_id` / `persona_id`, which store the held card).
   - **`fellInStory`** is true when ANY of:
     - **(a) open annex record:** the `core` annex's `seatBenches` list (read it once per session, only when there is at least one benched row: `readCoreAnnex(db, sessionId)` from `$lib/server/sessions/coreAnnex`; `doc?.seatBenches` is `{ messageId, kind: "character"|"player", seatId, from: boolean, to: boolean }[]`, type `SeatBenchRecord` in `$lib/server/state/write`). The **last** record in the list whose `kind` and `seatId` match the row has `to === true` (a genre's bench, e.g. a Dungeon Crawler companion's death; records leave the list when their turn is taken back, so a present record is open).
     - **(b) deceased:** the seat's cast member's version in force reads `nodeState === "deceased"`. Read it ONLY from the member reads `withSessionExtras` already makes: `seatReads` (a `Map` keyed by the row object, values from `seatMembersAsRead` = `MemberAsRead | null`) for carded rows, and `cardlessReads` (keyed by castMemberId, from `membersAsRead` = `MemberAsRead`) for card-less rows. Both are typed narrowly today (`{ activeCardId: number | null } | null` and `{activeCardId, name, nickname, faceMediaId}`); widen those local types to also carry `nodeState?: string` (or use `Pick<MemberAsRead, ...>` — `MemberAsRead` is exported from `$lib/server/cast/memberAsRead`). **Never read `lorebook_bindings.node_state` or any other frozen column** — `src/lib/server/characters/frozenColumns.guard.test.ts` must stay green. No new query for this.
     - **(c) player seats only, today's rule** (same as the client's `seatFellInStory` part b): the row is benched and some other row in `sessionData.sessionPersonas` has `o.id > row.id && !o.removedAt && o.personaId == null && o.userId === (row.userId ?? row.persona?.userId)` (player not null).
   - Cost rule from the lead: compute only for benched seats (one small query per benched seat for `hasLines`, one annex read per session). Wrap the block in `try/catch`: on failure leave the fields absent (absent reads as "has lines" and "not fallen" on the client — the safe side). Write a short 🚧 comment in the file's style saying what the block does and why (bench-L4b, ★L4-1).
3. **`src/lib/shared/sockets/types.ts`** — `Sockets.Sessions.Get.Response.session` (~line 4880): add to BOTH the `sessionCharacters` row type and the `sessionPersonas` row type, beside `ref?` / `cardId?`, with 🚧 JSDoc in the same style ("Host-filled on a benched seat only …; absent on a seat in play"):
   ```ts
   hasLines?: boolean
   fellInStory?: boolean
   ```
   Touch nothing else in this file.

## Tests

1. **Extend `src/lib/server/sockets/sessions.benchedSeats.int.test.ts`** with a new `describe("sessions:get seat facts on benched seats", …)`. Use the file's existing helpers (`owner`, `ownBook`, `carded`, `make`, `socket`, `recorder`; read the file first). Call `sessionsGetHandler.handler(socket(u.id), { id: sessionId } as any, emit)` (exported from `$lib/server/sockets/sessions`, ~line 6049) and read `res.session.sessionCharacters` / `sessionPersonas`. Cover at least:
   - a seat in play: neither field present (`"hasLines" in row` false);
   - a benched character seat with no lines: `hasLines === false`, `fellInStory === false`;
   - a benched character seat with a line (insert a message with `insertLegacy` from `$lib/server/messages/store`, `characterId` = the held card): `hasLines === true`;
   - a benched seat with an open `seatBenches` record `to: true` in `sessions.annex.core.seatBenches` (write the annex jsonb directly in the fixture: `annex: { core: { seatBenches: [ {messageId, kind:"character", seatId, from:false, to:true} ] } }`): `fellInStory === true`;
   - a benched seat whose cast member has a version in force reading deceased: write it with `writeCastVersion(tx, { member, changes: { nodeState: "deceased" }, writtenBy: "test", session?: … })` — find its import (`grep -rn "export async function writeCastVersion" src/lib/server`) and look at `src/lib/server/sessions/dcCairns.ts:~296` for a real call; if a session-anchored version is awkward, an un-anchored one on the member (main) is fine, as long as `membersAsRead` with `{sessionId}` reads it as in force. `fellInStory === true`;
   - a benched card-less player seat followed by a newer live card-less seat of the same user: `fellInStory === true`.
   Every `test`/`it` that touches the DB keeps the file's 60 s timeout (`vi.setConfig` at the top already sets it).
2. **Extend `src/lib/client/components/sessionForms/editSessionBench.dom.test.svelte.ts`** (`describe("Edit Session — Reassign and Remove", …)` ~line 491 and `"fallen seats"` ~401) with at most 3 small tests using the existing `charSeat` / `personaSeat` / `cardlessSeat` / `menuLabels` / `btn` helpers:
   - a benched carded seat with `hasLines: true` offers only `["Reassign…"]` (no Remove);
   - a benched **player** seat (`personaSeat(..., { isActive: false, hasLines: false })`) offers `["Reassign…", "Remove"]`;
   - a benched persona seat with `fellInStory: true` shows the Skull (`svg.lucide-skull`) and "Fell in the story".
   If one of these already exists verbatim, skip it and say so. Do not change the component.

## Files owned (edit only these)

- `src/lib/server/sessions/seats.ts` (add `export` to `seatHasLines` only)
- `src/lib/server/sockets/sessions.ts` (inside `withSessionExtras` only)
- `src/lib/shared/sockets/types.ts` (the two Get seat row types only)
- `src/lib/server/sockets/sessions.benchedSeats.int.test.ts`
- `src/lib/client/components/sessionForms/editSessionBench.dom.test.svelte.ts`

## Files readable

Anything. In particular `src/lib/client/components/sessionForms/benchedSeats.ts`, `src/lib/server/sessions/coreAnnex.ts`, `src/lib/server/state/write.ts` (~1040-1110), `src/lib/server/cast/memberAsRead.ts`, `src/lib/server/pipelines/prompt/seatCards.ts`.

## Out of scope (do not build)

- Any change to what a seat in play does, to `seatHasLines`' logic, to the client components, to `benchedSeats.ts`.
- Another worker (w2) is editing `src/lib/server/messages/store.ts`, `src/lib/server/sessions/retakeTurn.ts`, `src/lib/server/utils/generationStatus.ts`, `src/lib/server/pipelines/runtime/host.ts`, and `src/lib/server/pipelines/runtime/setSeatBench.int.test.ts` right now. Never touch them.
- Docs, NOMENCLATURE.

## Stop and ask (in your report, do not decide) when

- a name beyond `hasLines` / `fellInStory` would be needed (exported helper, type, field);
- a change would alter what a living in-play seat does;
- anything outside the owned files seems to need a change.

## Rules (verbatim from the supervisor's contract and CLAUDE.md)

- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Never `git checkout` / `restore` / `clean`. Never `prettier --write`.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — you need no `sdk:build`; never run `npm run sdk:build`.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "An int test that opens a DB inside an `it` needs a 60 s timeout under load."
- "**Never pipe vitest into `head`**: the SIGPIPE leaks PGlite temp dirs."
- Vocabulary: it is a **session**, never a *chat*.
- Run tests only in the capped scope:
  `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`
  Redirect long output to a scratch log in `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/bench-L4b-w1-*.log` and `tail` it.
- Typecheck: `cd /home/jody/github/serene-pub && npx tsc --noEmit -p . 2>&1 | grep -E "sessions\.ts|types\.ts|seats\.ts|benchedSeats|editSessionBench" ` (other lanes' errors are not yours; report them if any).

## Done means

- `src/lib/server/sockets/sessions.benchedSeats.int.test.ts`, `src/lib/client/components/sessionForms/editSessionBench.dom.test.svelte.ts`, `src/lib/client/components/sessionForms/benchedSeats.test.ts`, `src/lib/server/characters/frozenColumns.guard.test.ts` all green in the capped scope.
- `npx tsc --noEmit -p .` clean for your files.

## Report (your final message)

Changed files with a one-line summary each; the exact test command(s) and pass counts; any /tmp dirs you deleted; open questions; Noticed, not done.
