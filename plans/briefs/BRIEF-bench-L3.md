# BRIEF — bench-L3: the bench port, its undo, and Dungeon Crawler companion death and revival

Design: `plans/PROPOSAL-benched-seats-2026-11-10.md`. Read it all, including both rulings rounds and the challenge answers (binding: **challenge 4, every path calls `setSeatBench`**; **`writes.seats` absent = off**). Also read `plans/REPORT-bench-L1-2026-11-10.md` and `plans/REPORT-bench-L2-2026-11-10.md` (L2 runs just before you; read its report when it exists). RULED 2026-11-10. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. **Don't run `npm run sdk:build`.** The lead coordinates it with another session; report "SDK edits ready for build". Test from source: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file>`.

## Rulings this lane applies (owner, 2026-11-10)

- **"seat to benched is something managed by the genre/pipelines, not automatically by core."** Core never benches on its own; an **opted-in** genre or pipeline does.
- **"Dragging them back into the seat brings them back and treats them normally, up to the user to manage their status, unless the revival is a part of the story/genre and handled by a function that manages their status."**
- **★4:** Dungeon Crawler companion death **and revival** are built in this programme.

## Goal

1. **SDK contract: `core:outlet/set-seat-bench@1`** (`contracts/src/outlets.ts`, beside `set-seat-name@1` ~:627).
   - **Ports:** `seat` (`seated-member:` · `player-seat:` · `character:`) and `benched: boolean`.
   - **Out:** `{ status, seat, seats[] }`, the same shape as `set-seat-name` (bindings ~:8429).
   - **Effects:** `write`.
   - **Doc:** a genre opts in with `writes.seats`; it's tied to the turn (Back and regenerate undo it, Forward redoes it); a person's later bench or drag wins; refused in words without `writes.seats`.
2. **SDK genre shape: `writes.seats?: boolean`, absent = off** (`sdk/src/descriptors.ts` ~1167-1188, next to `writes.library`). It needs a doc comment, and the packager or conformance must accept it. Follow how `writes.library` (also off when absent) is declared and validated.
3. **Core host.**
   - A binding for `set-seat-bench@1` in `pipelines/runtime/bindings.ts`, and a case in `host.ts`.
   - Add a `seatWriteRefusal` beside `loreWriteRefusal` (`messages/writes.ts` ~:101): it refuses unless the session's genre declares `writes.seats: true`.
   - The case resolves the seat ref to (kind, seatId) and calls **`setSeatBench(tx, …)`**, the only writer. It then announces the returned `changes` the way other seat writers do (`announceSeatChanges`).
   - **Tied to the turn:** when the run has its turn message, append `{ messageId, kind, seatId, from, to }` to a core annex key **`seatBenches`** under `lockSessionAnnex`. Copy the `rulesetConversions` pattern (`convertRuleset.ts:246-252`, `state/write.ts:884-903`, `:1251`), but **retract and restore call `setSeatBench`**; nothing else writes `is_active`:
     - `retractStateAnchoredTo` (replacement and Back) puts back `from`, only while the seat still reads `to`, so a person's later drag wins;
     - `restoreRetractedState` re-applies on Forward;
     - the message delete path (`messages/store.ts` `retractLoreOf`, the hook hist-B3 used for scene notes) handles `seatBenches` too.
   - With no anchor, the write isn't tied to a turn.
4. **Dungeon Crawler companions** (SDK `core-catalog/src/genres/dungeon-crawler/**`, `registry/genres.ts` DC entry):
   - **Opt in:** the DC genre declares `writes.seats: true`.
   - **Today:** companions are narrative only, with no sheet and no fate (`story.ts:~532`). Read how companions are seated and named first.
   - **Death:** the Planner's turn plan may name companions who die this turn (a list of companion names/refs). The ledger then places `set-seat-bench@1 { benched: true }` **and** `update-cast-member@1 { nodeState: "deceased" }` for each, in the same turn. A retake undoes both. The fallen list (`progress.fallen`) gets them too.
   - **Revival:** the Planner's turn plan may name a fallen companion who is revived by the story (a shrine, a Raise). The ledger places `set-seat-bench@1 { benched: false }` plus `update-cast-member@1 { nodeState: "active" }`. They leave `progress.fallen`, through the turn's own progress write, which a retake also undoes.
   - **Naming:** prefer existing plan or ledger fields. If new plan fields are needed, name them `fallenCompanions` / `revivedCompanions` (🚧 provisional), list them in the report, and keep the Planner prompt change to one or two sentences.
   - **A person's drag wins** (core rule 3).
   - The Narrator names a companion's death in its own sentence, as for seats.
5. **Conformance and tests (SDK):**
   - the contract for the new outlet;
   - a test that a genre without `writes.seats` is refused (core) and that the descriptor accepts the field;
   - DC tests: a companion dies → bench + deceased in one turn, and a redo files it once; a revival → unbench + active;
   - re-pin the `coreCatalog` golden and any count pins your changes move, with a dated note in the house style ("Moved … (was '…')").

## Files owned

- **SDK:** `contracts/src/outlets.ts` (the one outlet), `sdk/src/descriptors.ts` (`writes.seats`), `core-catalog/src/genres/dungeon-crawler/**`, `core-catalog/src/registry/genres.ts` (the DC `writes` only), `core-catalog/src/seed/prompts.ts` (the DC Planner sentence only, if needed), `sdk-tests/` (tests for these and pins they move)
- **Core:** `src/lib/server/pipelines/runtime/bindings.ts` (one binding), `src/lib/server/pipelines/runtime/host.ts` (one case), `src/lib/server/messages/writes.ts` (`seatWriteRefusal`), `src/lib/server/state/write.ts` (the `seatBenches` retract/restore), `src/lib/server/messages/store.ts` (the delete hook), core tests (new), core hash pins (`pipelines/boot/specHashes.test.ts`, `registryHashes.test.ts`) that move

## Out of scope (write down, never build)

- `setSeatBench` itself (L1). The readers (L2). UI (L4). Docs and NOMENCLATURE (L5): queue names.
- Any automatic bench in core; benching player seats (heroes) on death (the hero retire stays as L1 made it: a new character benches the old seat).

## Stop and ask when

CLAUDE.md §Decisions applies; companion death needs more than one or two Planner sentences or a new player-facing control; undo would need a second writer of `is_active`; a name beyond `set-seat-bench@1`, `writes.seats`, `seatBenches`, `seatWriteRefusal` and the two provisional plan fields is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. **Never `npm run sdk:build`.** Delete only `/tmp/serene-pub-vitest-*` dirs your own runs made, by name — never a glob.
- Inside `db.transaction(async (tx) => …)` use only `tx`. Never hand a DOM node to an assertion.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. App vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`. SDK tests in a capped scope similarly.
- Scratch files start with `bench-L3-`.

## Done means

- **SDK `tsc -p sdk-tests`:** clean.
- **SDK tests from source:** the new outlet, the descriptor, DC companions.
- **Core targeted tests:**
  - the port: refused without `writes.seats`; Back unbenches; Forward re-benches; a person's later drag survives Back; regenerate takes it; no anchor → untied; delete path;
  - the host case announces.
- **Core typecheck:** `npx tsc --noEmit -p .` clean for your files (core tests that need the built SDK are listed for the lead's post-build run).
- **No full suite.**

## Report

`plans/REPORT-bench-L3-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files in both repos, "SDK edits ready for build", tests and results, names for L5, open ★, **Noticed, not done**.
