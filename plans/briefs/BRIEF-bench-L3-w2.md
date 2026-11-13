# BRIEF — bench-L3-w2: SDK `core:outlet/set-seat-bench@1`, genre `writes.seats`, the Dungeon Crawler opt-in

Supervisor: bench-L3. Design (RULED 2026-11-10): `/home/jody/github/serene-pub/plans/PROPOSAL-benched-seats-2026-11-10.md`, section "Port (genre-managed status)". SDK repo: `/home/jody/github/serene-pub-sdk`. Always use absolute paths. Test **from source**: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file>`. Tests resolve `@serene-pub/*` to `../*/src` through `sdk-tests/tsconfig.json` paths.

## Rules you work under (quoted; binding)

- Owner 2026-11-10: **"seat to benched is something managed by the genre/pipelines, not automatically by core."** A genre opts in. Core never benches on its own.
- Owner 2026-11-10: **"Dragging them back into the seat brings them back and treats them normally, up to the user to manage their status, unless the revival is a part of the story/genre and handled by a function that manages their status."**
- Design: `writes.seats` is **absent = off**, unlike `writes.lore`/`writes.scenes` (absent = on). It follows `writes.library`, which is also off when absent.
- Design: the port is **tied to the turn**. Back and regenerate (a retake) undo it, Forward redoes it, and a person's later bench or drag wins. Without `writes.seats` it is refused in words.
- CLAUDE.md: "Removing or renaming a published SDK name is the owner's call". You only **add** names. The only new names allowed are `core:outlet/set-seat-bench@1` (export `setSeatBench`), `writes.seats`, and their doc comments. Mark them 🚧 / `@experimental` like their neighbours.
- House style for re-pinning a golden or count pin: a dated comment line directly above the new value, in the form `// Moved 2026-11-11 (bench-L3, benched seats): <what moved and why>. (was '<old value>')`. Copy the shape of the existing lines at `sdk-tests/coreCatalog.test.ts:1048-1060`.
- It is a **session**, never a "chat".

## Goal

1. **`contracts/src/outlets.ts`**: add `export const setSeatBench = pin(describeOutletDefinition({ id: 'core:outlet/set-seat-bench@1', … }))` **directly after** `setSeatName` (~:634-662). Model it on `setSeatName`:
   - `i18n: { name: { en: 'Bench or bring back a seat' } }` (proposed copy; the supervisor marks it ★);
   - `effects: 'write'`, `reviewDefault: 'off'`, `timeoutMs: 2000`. Add `review` only if `describeOutletDefinition` requires it; otherwise leave it out, since nothing here is retypeable;
   - in-ports:
     - `seat: S.json`: the seat as `seated-member:<id>`, `player-seat:<id>` or `character:<id>`. It's JSON for the reason `setSeatName.retire` gives: a script's part names it, and `update-cast-member@1`'s `member` is `S.json` too;
     - `benched: S.json`: `true` benches, `false` brings back. JSON like `setComposerState.open`;
   - out-ports: `main: S.writeResult`, `seat: S.participantRef`, `seats: S.participantRefs`. Same as `setSeatName`.
   - Doc comment (house style, 🚧, `@experimental`), covering:
     - what it does: benches a seat or brings it back (in the session, out of the turns);
     - the opt-in: a genre declares `writes.seats: true`; without it the host refuses in words;
     - tied to the turn: the bench is recorded against the run's turn message, Back and a retake put it back, Forward does it again, and a person's later bench or drag wins (the undo only puts back a seat still as the port left it);
     - a seat already in the asked state is a no-op;
     - envoys and removed seats are refused;
     - `seat`/`seats` give the seat's reference, as `set-seat-name@1` does;
     - with no turn message (a person's action), the write is not tied to a turn.
2. **`sdk/src/descriptors.ts`**:
   - In the `writes?: { … }` type (~:1167-1210), add `seats?: boolean` with a doc comment: may this genre's pipelines bench a seat or bring one back (`core:outlet/set-seat-bench@1`)? **Absent = off**, unlike `lore` and `scenes`. A person's own bench and drag are never gated by it.
   - In `assertSessionWrites` (~:750-790), refuse a non-boolean `writes.seats` with a sentence that names the genre. Model it on the `library` block: "a boolean or absent — absent means off, and only an explicit true allows the write". Don't add `seats` to `SESSION_WRITES`: that list's absent-means-on resolver would read it wrong.
   - Don't add a new resolver function. Core reads `writes.seats === true` itself.
   - Check `cli/src/compiler.ts` (~:1745) and anything else that validates a genre's `writes`. Make sure a plugin genre declaring `writes.seats` is **accepted**, which it should be already, since unknown keys are ignored. Change nothing there unless something refuses it. If something does, stop and report it.
3. **`core-catalog/src/registry/genres.ts`**: in the Dungeon Crawler entry's shape (~:1626), change `writes: { lore: true, scenes: true }` to `writes: { lore: true, scenes: true, seats: true }`. Extend the doc comment above it by one short paragraph: `seats: true` (owner ruling 2026-11-10, ★4): a companion's death benches their seat and a story revival brings them back, through `set-seat-bench@1`, tied to the turn. Touch nothing else in that file.
4. **Tests (new file `sdk-tests/seatBench.test.ts`)**:
   - the contract: `C.setSeatBench.id`; `getDefinition('core:outlet/set-seat-bench@1')` is registered, `kind: 'outlet'`, `effects: 'write'`; the in-ports are exactly `benched`, `seat`; the out-ports are exactly `main`, `seat`, `seats`. Model it on `sdk-tests/castMember.test.ts:50-59`;
   - the descriptor: `genre()` accepts `writes: { seats: true }` and `{ seats: false }`, and refuses `{ seats: 'yes' }` with a sentence that names the genre. Model it on `sdk-tests/writes.test.ts:98-160` and `:306`. Use unique test genre ids;
   - the Dungeon Crawler genre's shape declares `writes.seats === true`, and Story's doesn't.
5. **Pins your changes move.** Run `sdk-tests/coreCatalog.test.ts`, `sdk-tests/writes.test.ts`, `sdk-tests/conformance.test.ts`, `sdk-tests/contract.test.ts` and `sdk-tests/dungeonCrawler.test.ts`.
   - A golden or hash pin that moves **only** because of your changes (the DC `writes`, the new outlet): re-pin it with the dated "Moved … (was '…')" line. To prove it moved only for your reason, check it digests back to the old pin with your change reverted in memory, or explain why you can't.
   - A pin that was already red before your change: don't touch it. Report it.
   - Another worker (w3) will change the Dungeon Crawler scripts after you and will move the DC pins again. You re-pin only for your own change.

## Files owned (edit only these)

- `contracts/src/outlets.ts` (the one outlet)
- `sdk/src/descriptors.ts` (`writes.seats` type + validation)
- `core-catalog/src/registry/genres.ts` (the DC `writes` line and its comment only)
- `sdk-tests/seatBench.test.ts` (new); `sdk-tests/*.test.ts` only to re-pin pins your change moves

## Out of scope (write down, never build)

- The core host, bindings, and anything in `/home/jody/github/serene-pub`.
- The Dungeon Crawler scripts (`core-catalog/src/genres/dungeon-crawler/**`): worker w3 does those.
- `INTEGRATING.md`, docs, NOMENCLATURE.
- `npm run sdk:build`: never.

## Stop and ask when

- A name beyond `setSeatBench` / `core:outlet/set-seat-bench@1` / `writes.seats` is needed.
- Something refuses `writes.seats`.
- A file outside the list needs a change.
- A pin moves for a reason you can't attribute to your change.

## Done means

- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p .` is clean, or shows only errors that existed before you started. Run it first to get the baseline.
- `npx tsx --test seatBench.test.ts writes.test.ts castMember.test.ts coreCatalog.test.ts conformance.test.ts contract.test.ts dungeonCrawler.test.ts` (from `sdk-tests/`): report pass/fail counts, and name any failure that existed before your change.
- `npx prettier --check` on each file you changed.

## Report

Reply with a short report as your final message: the files changed (with line ranges), the doc text of the outlet, the pins moved (old → new, and why), tests and results, and **Noticed, not done**.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (In this lane: **never** run `sdk:build` at all.)
- Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted. **Never run `prettier --write` on a file.** Never run npm at the SDK root. Scratch files start with `bench-L3-`.
