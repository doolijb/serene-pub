# BRIEF bench-L4b-w2 — the delete path announces its seat moves

Supervisor: bench-L4b. Repo: /home/jody/github/serene-pub. Report: your final message (the supervisor reads it). Scratch files start with `bench-L4b-w2-`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

A genre's pipeline can bench a seat tied to a turn (`core:outlet/set-seat-bench@1`, recorded in the core annex key `seatBenches`). Deleting that turn's message puts the seat back (`retractSeatBenchesAnchoredTo` in `src/lib/server/state/write.ts` ~1075, which returns `{ taken, changed, changes: SeatChange[] }`), but **the delete path throws `changes` away, so no open page hears the move** (no `cast-changed`). Thread the changes out and announce them after commit with `announceSeatChanges(db, io, { sessionId, userId }, changes)` (`src/lib/server/sessions/seats.ts` ~1858; best-effort, never throws; **call it only after the transaction committed, never inside one**).

The pattern to copy is `restoreRetractedState(db, taken, opts?: { seatChanges?: SeatChange[] })` in `state/write.ts` ~1279: an optional out-param array the function pushes into. Signatures change only by an added optional trailing param; every existing caller keeps compiling unchanged.

## Changes

1. **`src/lib/server/messages/store.ts`**
   - `retractLoreOf(db, rows)` (~617, private): return `Promise<SeatChange[]>` — the concatenated `changes` of each `retractSeatBenchesAnchoredTo` call (`[]` when no rows). Import `SeatChange` as a type from `$lib/server/sessions/seats` (type-only import; keep the existing dynamic imports dynamic).
   - `deleteLegacyWhere(db, where, opts?: { seatChanges?: SeatChange[] })` (~573): push `retractLoreOf`'s result into `opts.seatChanges` when given. Return type unchanged.
   - `deleteLegacy(db, id, opts?: { seatChanges?: SeatChange[] })` (~598): same. Still returns `void`.
   - Update the JSDoc of both (one sentence: `opts.seatChanges` gets the seat moves for the caller to announce after commit). `discardForwardStack` (~411) stays as is (Back already took its rows' benches back; say so nowhere else).
2. **`src/lib/server/sessions/retakeTurn.ts`** — `deleteTurnYield(db, opts)` (~165): collect a local `seatChanges: SeatChange[] = []`, pass `{ seatChanges }` to `deleteLegacyWhere(t, …)` inside the transaction, and **after** the transaction (beside the existing `if (opts.io)` broadcasts) call `announceSeatChanges(db, opts.io, { sessionId: opts.sessionId, userId: opts.userId }, seatChanges)` when `opts.io` and `seatChanges.length`. This covers both callers that already have io (the `sessionMessages:delete` socket handler's turn delete at `src/lib/server/sockets/sessions.ts` ~9080, and `retakeTurn`'s own call) — so `sockets/sessions.ts` needs **no** change; do not edit it. Return type unchanged.
3. **`src/lib/server/pipelines/runtime/host.ts`** — the deletion outlet (`case` around ~9790-9870; it runs `retractStateAnchoredTo(t, id, { ticks: "take" })` then `deleteLegacy(t, id)` in one `db.transaction`). Collect seat changes from **both**: `retracted.seatChanges` (`retractStateAnchoredTo` already returns `seatChanges`) and `deleteLegacy(t, id, { seatChanges })`. After the transaction commits, when `scope.io` and there are changes, announce them with the **same userId fallback the `set-seat-bench` case uses** (~9405-9417: `scope.userId`, else the session owner read from `schema.sessions.userId`), and `sessionId = current.sessionId`. `announceSeatChanges` is importable from `$lib/server/sessions/seats` (dynamic import, as the file does). Edit nothing else in host.ts.
4. **`src/lib/server/utils/generationStatus.ts`** (~240-251) — a failed reply's `retractStateAnchoredTo(db, generatingMessageId)` returns `taken.seatChanges`, currently ignored. After it, when `socketIo` and `taken.seatChanges.length`, announce them; userId = `opts.userId` (the `userId` destructured at the top of `persistGenerationErrorRow`), else the session owner (`select userId from sessions where id = sessionId`). Keep it inside the existing `try` so it can never throw into the failure path. Edit nothing else in that file.

Inside any `db.transaction(async (tx) => …)` use only `tx` (or `t`, its cast) — never the outer `db`.

## Tests

Extend **`src/lib/server/pipelines/runtime/setSeatBench.int.test.ts`** (read it first: `world`, `bench`, `activeOf`, `benchesOf`, `stubIo`, and the existing `"deleting the turn's message puts the seat back"` test ~296). Add, each with the 60 s timeout:

- **`deleteLegacy` hands back the move:** bench via the outlet, then `deleteLegacy(db, w.reply, { seatChanges })`; `seatChanges` holds one `{ kind: "character", change: "enabled", seatId: w.seatId, value: true }` (use `toMatchObject`), seat back in play, record gone.
- **Deleting the turn unbenches it AND announces `cast-changed`:** bench via the outlet, `settleSessionEvents()`, count `cast-changed` rows in `schema.sessionChanges` for the session (see the existing announce test ~222-249 for how), then delete through **`deleteTurnYield(db, { sessionId, userId, turn, io: stubIo })`** (from `$lib/server/sessions/retakeTurn`; build `turn` as a minimal `TurnYield` — `src/lib/server/sessions/turnYield.ts` ~64 — `{ runId: 0, runUuid: "x", specSlug: "x", rows: [{ messageId: w.reply, channel: "main", role: "assistant", characterId: null, name: "x" }], runs: [] } as never`; if `deleteTurnYield` needs more to run, read it and supply the least that works, or fall back to the host deletion outlet below and say why). Expect the seat back in play, the record gone, and after `settleSessionEvents()` exactly one NEW `cast-changed` row with payload `{ change: "enabled", value: true }`.
- **The host deletion outlet announces too:** bench via the outlet, then run the deletion outlet through `createHost(...).commit!({ target: <message ref> }, DELETE_NODE)` where `DELETE_NODE = { key: "del", definitionId: "core:outlet/delete-message", definitionVersion: 1 } as never` (check the real definition id/version and how `refId(p.target)` reads a target — `grep -n "core:outlet/delete-message" src/lib/server/pipelines/runtime/host.ts`, and look at an existing int test that commits a delete-message, e.g. `grep -rln "delete-message" src/lib/server --include=*.int.test.ts`). Expect the seat back and one new `cast-changed` `{ change: "enabled", value: true }`. If the outlet cannot be driven from this harness without large scaffolding, skip this one test and say why.

Also run these existing files, which exercise the changed functions, and keep them green: `src/lib/server/pipelines/runtime/setSeatBench.int.test.ts`, plus whatever `grep -rln "deleteTurnYield\|deleteLegacy\b\|retakeTurn(" src/lib/server --include=*.test.ts` finds (run at most 6 of them; name the ones you ran).

## Files owned (edit only these)

- `src/lib/server/messages/store.ts` (`retractLoreOf`, `deleteLegacyWhere`, `deleteLegacy` only)
- `src/lib/server/sessions/retakeTurn.ts` (`deleteTurnYield` only)
- `src/lib/server/pipelines/runtime/host.ts` (the deletion outlet's announce only)
- `src/lib/server/utils/generationStatus.ts` (the failed-reply announce only)
- `src/lib/server/pipelines/runtime/setSeatBench.int.test.ts`

## Files readable

Anything. In particular `src/lib/server/state/write.ts`, `src/lib/server/sessions/seats.ts` (`SeatChange` ~157, `announceSeatChanges` ~1858), `src/lib/server/sessions/rewind.ts` ~680-690 and ~785-790 (an existing after-commit announce).

## Out of scope (do not build)

- No new exported function, type, event or field. The only new thing is an optional `opts` param on `deleteLegacyWhere` / `deleteLegacy` with key `seatChanges` (already the codebase's name for this, see `restoreRetractedState`).
- Changing `announceSeatChanges`' cause ("settings") — known, noticed by another lane; leave it.
- Another worker (w1) is editing `src/lib/server/sockets/sessions.ts`, `src/lib/shared/sockets/types.ts`, `src/lib/server/sessions/seats.ts`, `src/lib/server/sockets/sessions.benchedSeats.int.test.ts` and `src/lib/client/components/sessionForms/editSessionBench.dom.test.svelte.ts` right now. Never touch them.

## Stop and ask (in your report, do not decide) when

- a name beyond the `seatChanges` out-param is needed;
- a change would alter what a living in-play seat does, or change any existing caller's behaviour beyond announcing;
- anything outside the owned files seems to need a change.

## Rules (verbatim from the supervisor's contract and CLAUDE.md)

- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Never `git checkout` / `restore` / `clean`. Never `prettier --write`.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — you need no `sdk:build`; never run `npm run sdk:build`.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "An int test that opens a DB inside an `it` needs a 60 s timeout under load."
- "**Never pipe vitest into `head`**: the SIGPIPE leaks PGlite temp dirs."
- "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." Views never call `toaster`.
- Vocabulary: it is a **session**, never a *chat*.
- Run tests only in the capped scope:
  `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`
  Redirect long output to a scratch log in `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/bench-L4b-w2-*.log` and `tail` it.
- Typecheck: `cd /home/jody/github/serene-pub && npx tsc --noEmit -p . 2>&1 | grep -E "store\.ts|retakeTurn|host\.ts|generationStatus|setSeatBench"` (other lanes' errors are not yours; report them if any).

## Done means

- `src/lib/server/pipelines/runtime/setSeatBench.int.test.ts` green with the new tests, plus the existing delete/retake test files you ran, all in the capped scope.
- `npx tsc --noEmit -p .` clean for your files.

## Report (your final message)

Changed files with a one-line summary each; the exact test command(s) and pass counts; any /tmp dirs you deleted; open questions; Noticed, not done.
