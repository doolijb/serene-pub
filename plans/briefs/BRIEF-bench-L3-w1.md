# BRIEF — bench-L3-w1: the core half of `set-seat-bench@1` (refusal, host case, binding, turn-tied undo, delete hook, tests)

Supervisor: bench-L3. Design (RULED 2026-11-10): `plans/PROPOSAL-benched-seats-2026-11-10.md`, section "Port (genre-managed status)" and "Challenge answers" 4. L1 built the one writer `setSeatBench` (`src/lib/server/sessions/seats.ts:1764`) and `announceSeatChanges` (`:1858`). Repo: `/home/jody/github/serene-pub`. Always use absolute paths.

## Rules you work under (quoted; binding)

- Owner 2026-11-10: **"seat to benched is something managed by the genre/pipelines, not automatically by core."** Core never benches on its own. Only an opted-in genre's pipeline does, through this port.
- Owner 2026-11-10: **"Dragging them back into the seat brings them back and treats them normally, up to the user to manage their status, unless the revival is a part of the story/genre and handled by a function that manages their status."** So a person's later bench or drag always wins over the undo.
- Challenge 4 (accepted): **"One writer: retract, Forward, guest removal and the port all call `setSeatBench`; the annex is only a record."** Nothing you write may set `is_active` itself. Every bench change goes through `setSeatBench(tx, …)`.
- `writes.seats` is **absent = off** (P1: a new automatic behaviour is off until a genre opts in). Only an explicit `writes.seats === true` on the session's genre shape allows the port.
- CLAUDE.md Hard rules: inside `db.transaction(async (tx) => …)` use only `tx`. The outer `db` deadlocks PGlite silently. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- CLAUDE.md Sockets: an event in `SCOPED_EVENTS` must carry its scope key (`sessionId`) in the payload. `announceSeatChanges` already does this. Use it; don't emit by hand.
- Core runtime annex keys (`src/lib/server/sessions/coreAnnex.ts` header): written by the host's own helpers, never through `writeAnnexDocument`. Every write takes `lockSessionAnnex(tx, sessionId)` inside its own transaction and writes ONE key with `coreAnnexSetSql`.
- A session, never a "chat". Mark new vocabulary 🚧 in doc comments, like the neighbouring code.

## Goal

1. **`src/lib/server/sessions/coreAnnex.ts`**: add `"seatBenches"` to `CORE_RUNTIME_KEYS`, with a one-line `/** 🚧 … */` doc like the `rulesetConversions` entry. Add one header bullet beside the `rulesetConversions` bullet: `seatBenches`, a list of `{ messageId, kind, seatId, from, to }` written by the `set-seat-bench@1` host case and read by `retractStateAnchoredTo` / `restoreRetractedState` / the message delete path. Nothing else in that file changes.

2. **`src/lib/server/messages/writes.ts`**: add `export async function seatWriteRefusal(db, sessionId): Promise<string | null>` beside `loreWriteRefusal` (~:101). It returns `null` only when the session's genre (`sessionGenre`) has a shape with `writes.seats === true`. Otherwise it returns a refusal sentence. That covers no genre, an unreadable genre, an absent key and `false`. Follow the absent-is-off posture of `libraryWriteRefusal` (~:150): a read error refuses too. Proposed sentence (the supervisor will mark it ★ for the owner): ``This session's genre ('${genre?.name ?? "none"}') does not bench or bring back seats.`` Write a doc comment saying absent = off and naming `set-seat-bench@1`.

3. **`src/lib/server/pipelines/runtime/host.ts`**: add **one** case `"core:outlet/set-seat-bench"` directly after the `"core:outlet/set-seat-name"` case (~:9216-9326). Model it on that case (scope check, `{ halt }` returns, `record(node, "session", sessionId, "updated")`).
   - `scope.sessionId` is undefined → `throw new HostScopeError(...)`, as set-seat-name does.
   - `p.benched` is not a boolean → `{ halt: "…" }` with a sentence.
   - `seatWriteRefusal(db, sessionId)` is not null → `{ halt: refusal }`. Import it beside the existing `loreWriteRefusal` import at host.ts:100. That import line is the only other edit allowed in host.ts.
   - Resolve `p.seat` (a string `seated-member:<id>` · `player-seat:<id>` · `character:<id>`) with `seatOf(tx, sessionId, ref)` from `$lib/server/sessions/seats` (dynamic import, like the case above). Null → `{ halt: "'<ref>' is not a seat in this session, so nothing was benched" }` (or similar).
   - Find the anchor before the transaction: `const anchor = turnMessageId ?? turnMessageOf(scope.runId)` (`turnMessageOf` from `$lib/server/pipelines/runtime/runTurnMessage`, as `update-cast-member` does ~:11500-11519).
   - In ONE `db.transaction(async (tx) => …)`, using only `tx`: `setSeatBench(tx, { sessionId, kind, seatId, benched })`. A refusal → return its sentence as the halt. Do the transaction work, then return `{ halt }` outside it. Don't throw inside it for a refusal. When `changes.length > 0` **and** `anchor !== undefined`: `lockSessionAnnex(tx, sessionId)`, `readCoreAnnex(tx, sessionId)`, then append `{ messageId: anchor, kind, seatId, from: !benched, to: benched }` to `seatBenches` with `coreAnnexSetSql("seatBenches", sql\`${JSON.stringify([...list, rec])}::jsonb\`)`. Copy `convertRuleset.ts:246-252`. `from`/`to` are **benched booleans** (before / after). With no anchor, or a no-op (`changes: []`), write no record.
   - After the commit: `announceSeatChanges(db, scope.io, { sessionId, userId }, changes)` when `scope.io` and changes exist. `userId` is `scope.userId` if set, else the session's owner (`schema.sessions.userId`). It is best-effort and never throws. The case still succeeds with no io.
   - Return `{ written: true, sessionId, seat }`, where `seat` is the seat's reference from `hostSeatRefOf({ kind, seatId, castMemberId, cardId })` (`$lib/server/pipelines/prompt/seatCards`). Fall back to the ref given when it returns null.
   - Write a doc comment block in the house style: 🚧, owner ruling 2026-11-10, opt-in by `writes.seats`, tied to the turn, a person's later drag wins.

4. **`src/lib/server/pipelines/runtime/bindings.ts`**: add **one** binding `"core:outlet/set-seat-bench@1"` right after `"core:outlet/set-seat-name@1"` (~:8429). It has the same shape, `reads<typeof C.setSeatBench>(…, { ports: ["seat", "benched"] })`: a `halt` string → `halt(halted)`, otherwise `ok({ status: "committed", ids, seat: ref, seats: ref ? [ref] : [] })`. ⚠ `C.setSeatBench` only exists once the SDK is rebuilt (another worker is adding it in the SDK, and the lead builds). **Never run `npm run sdk:build`.** Expect this one line to fail `tsc` until then. Report it, but don't work around it with casts.

5. **`src/lib/server/state/write.ts`**: tie the bench to the turn.
   - Add an exported `SeatBenchRecord` interface `{ messageId: number; kind: "character" | "player"; seatId: number; from: boolean; to: boolean }` with a 🚧 doc (benched before / after). Put it next to `RulesetConversionRecord` (~:1034).
   - Add an exported helper `retractSeatBenchesAnchoredTo(tx, sessionId, messageIds): Promise<{ taken: SeatBenchRecord[]; changed: boolean }>`:
     - `lockSessionAnnex`, then read the `seatBenches` list.
     - Take the records whose `messageId` is in `messageIds`, newest first (reverse list order).
     - For each, call `setSeatBench(tx, { sessionId, kind, seatId, benched: rec.from })`.
     - **The person-wins rule falls out of `setSeatBench`'s no-op.** A seat that no longer reads `to` already reads `from`, because the two are opposite booleans, so the call changes nothing. Say this in a comment.
     - A record goes into `taken` only when its call returned a non-empty `changes`. A refusal (seat gone or removed) is skipped, not thrown.
     - Write the kept list back. Use `null` to drop the key when it's empty, as `rulesetConversions` does.
   - In `retractStateAnchoredTo` (~:806): after the conversions block, when `message` exists, call the helper for `[messageId]` on `t`. Add `seatBenches` to `taken` and to `changed`. Add `seatBenches?: SeatBenchRecord[]` to `RetractedState`, with a doc comment ("absent on a record written before them").
   - In `restoreRetractedState` (~:1198):
     - include `seatBenches` in the early-return emptiness check;
     - inside its transaction, for each taken record in order, `setSeatBench(t, { …, benched: rec.to })`;
     - append back to the annex list (locked, as conversions are) only the records whose call changed something. A person who already set it keeps it, and a later Back won't fight them.
   - In `reviveRetractedState` (~:1074): carry `seatBenches` through. It's plain JSON, so keep only well-formed records (numbers, booleans, `kind` either "character" or "player").
   - Don't touch `takenSummaryOf`.
   - Import `setSeatBench` dynamically (`await import("$lib/server/sessions/seats")`), following the file's existing lazy-import style.

6. **`src/lib/server/messages/store.ts`**: in `retractLoreOf` (~:615), after the lore retraction per session, call `retractSeatBenchesAnchoredTo(db, sessionId, ids)` for each session (same lazy import from `$lib/server/state/write`). Update that function's one-line doc and the `deleteLegacyWhere` doc paragraph so they say seat benches go with their anchor too.

7. **New test** `src/lib/server/pipelines/runtime/setSeatBench.int.test.ts`. Model the harness on `src/lib/server/sessions/composerStates.int.test.ts`: `vi.mock("$lib/server/db", …createTestDb…)`, the embedding and broadcast mocks, a temp data dir removed in `afterAll`, host commit through `createHost(db, scope).commit!(input, { key, definitionId: "core:outlet/set-seat-bench", definitionVersion: 1 })`. Register test genres with `genre()` from `@serene-pub/sdk`: one whose shape declares `writes: { seats: true }`, and one without. Look at how `convertRuleset.int.test.ts:320-330` registers a genre, and at `getSessionGenre` for how a genre's `shape` is read. Use `noteTurnMessage(runId, messageId)` from `runTurnMessage.ts` to give the run its turn message. Seed a session with a character seat, plus a player seat where it's cheap. To catch the announcement, mock `$lib/server/pipelines/runtime/sessionEvents` `emitSessionEvent` (spy), as composerStates does ~:95, or assert on what it records. Every `it`/`test` that opens or writes the DB gets a **60_000** ms timeout. Cases (one each):
   - **refused** without `writes.seats` (genre without the key) → halt with the sentence, seat still in play, no `seatBenches`;
   - **benches, tied**: with `writes.seats: true` and a turn message → `is_active` false, one record `{ messageId, kind, seatId, from: false, to: true }`, `cast-changed` announced with `change: "enabled", value: false` (needs an `io` in scope; a stub is fine);
   - **Back unbenches, Forward re-benches**: use `rewindTurn` / `forwardTurn` (`src/lib/server/sessions/rewind.ts`) if the seeded history allows, as `convertRuleset.int.test.ts:300-313` does. Otherwise `retractStateAnchoredTo(db, id, { ticks: "take", scenes: "take" })`, then `restoreRetractedState(db, reviveRetractedState(JSON.parse(JSON.stringify(taken))))`. Prefer the real rewind, which proves the JSON revive;
   - **a person's later drag survives Back**: port benches, then the person calls `setSeatBench(db…, { benched: false })` directly → Back leaves the seat in play and drops the record → Forward doesn't re-bench;
   - **regenerate takes it**: `retractStateAnchoredTo(db, id)` (replacement) → back in play, record gone;
   - **no anchor → untied**: no `noteTurnMessage` → benched, no record, and a retract of the newest message leaves it benched;
   - **delete path**: `deleteLegacy(db, id)` from `$lib/server/messages/store` → back in play, record gone.

## Files owned (edit only these)

- `src/lib/server/sessions/coreAnnex.ts` (the one key and header line)
- `src/lib/server/messages/writes.ts` (`seatWriteRefusal`)
- `src/lib/server/pipelines/runtime/host.ts` (the one case + the one import line)
- `src/lib/server/pipelines/runtime/bindings.ts` (the one binding)
- `src/lib/server/state/write.ts` (`SeatBenchRecord`, the helper, retract/restore/revive)
- `src/lib/server/messages/store.ts` (`retractLoreOf` + its docs)
- `src/lib/server/pipelines/runtime/setSeatBench.int.test.ts` (new)

## Files readable

Anything. In particular: `sessions/seats.ts` (`setSeatBench`, `announceSeatChanges`, `seatOf`, `SeatChange`), `sessions/convertRuleset.ts:230-260`, `sessions/rewind.ts`, `state/write.ts`, `pipelines/runtime/runTurnMessage.ts`, `pipelines/prompt/seatCards.ts`, the two test files named above.

## Out of scope (write down, never build)

- `setSeatBench` itself; the readers; UI; docs and NOMENCLATURE.
- Announcing bench changes made by Back, Forward, regenerate or delete. Their callers (`rewind.ts`, `sockets/sessions.ts`) aren't yours. Note it in your report.
- `state/announce.ts` `stateMoved`, any SDK file, `npm run sdk:build`.
- Any automatic bench (deaths, deceased state): never.

## Stop and ask when

- A name beyond `seatWriteRefusal`, `seatBenches`, `SeatBenchRecord`, `retractSeatBenchesAnchoredTo` and the test file is needed.
- Undo seems to need a write of `is_active` that isn't `setSeatBench`.
- A file outside the list needs a change. Stop and report it; don't make it.

## Done means

- `cd /home/jody/github/serene-pub && npx tsc --noEmit -p . 2>&1 | grep -E "coreAnnex|messages/writes|runtime/host|runtime/bindings|state/write|messages/store|setSeatBench"` shows nothing except the expected `C.setSeatBench` line(s) in `bindings.ts` (the SDK isn't built).
- The new test passes, run in a capped scope:
  `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/server/pipelines/runtime/setSeatBench.int.test.ts; echo test-exit=$?'`
  Also re-run `src/lib/server/sessions/convertRuleset.int.test.ts` the same way (it exercises the retract/restore you changed). Report pass counts.
- `npx prettier --check` on each file you changed. Report the result; don't fix drift you didn't cause.

## Report

Reply with a short report as your final message: the files changed (with line ranges), the functions added, the tests and their results, the refusal sentences you wrote, anything out of list you needed, and **Noticed, not done**.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (In this lane: **never** run `sdk:build` at all.)
- Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.** Never pipe vitest into `head`. Never hand a DOM node to an assertion. Scratch files start with `bench-L3-`.
