# BRIEF — bench-L1: benched seats, the data half

Design: `plans/PROPOSAL-benched-seats-2026-11-10.md`. Read **all** of it: both owner-rulings rounds, the "Revised design", and the challenge answers, which are binding. RULED 2026-11-10. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Other sessions are editing nearby: the variable-layouts session (`serene-pub-83`) in pipelines/entities, config, prompt, admin; the images/vision session (`serene-pub-43`) in `src/lib/server/managed/*`. Check each file's `git diff` before editing.

## Rulings this lane applies (owner, 2026-11-10)

- **Fold Removed into Benched.** Removing a seat becomes benching it, and existing removed rows become benched, except as the challenge narrowed: unused removed rows stay removed.
- **A soft Remove stays for unused seats:** a benched seat with no lines can be removed (invisible; it revives if re-added).
- **Removing a guest benches their player seats.**
- **Benched is the one lore rule** (readers are lane L2). Core never benches on its own: a person does, or an opted-in genre or pipeline function does (lane L3's port).

## Goal

1. **Column:** `session_personas.is_active boolean NOT NULL DEFAULT true` in `src/lib/server/db/schema.ts`. **Coordination:** before running `npm run db:generate`, the lead asks the variable-layouts session (`serene-pub-83`); **stop and report "ready to generate"** and wait for the lead's go. The migration takes whatever index is next (0152 or later, after `0151_shallow_marvel_zombies`). It must add only this column.
2. **One writer: `setSeatBench(tx, { sessionId, kind: 'character' | 'player', seatId, benched })`** in `src/lib/server/sessions/seats.ts`. It replaces `setSeatEnabled` (`:1621-1641`), writes only `is_active` on either table, refuses envoy and removed seats in words, and does nothing when the value is already set. It announces the change the way other seat writers do. Callers of `setSeatEnabled` move to it.
3. **Retire and remove become bench:**
   - `seatName.ts` `writeSeatName` with `retire` (`~:150`) benches the old seat instead of `unseat`;
   - `editCardlessPlayerSeats` remove (`~:429`) benches.
   - Both go through `setSeatBench`.
4. **The soft Remove:** a benched seat with **no lines** can still be removed (`removed_at` set), through the existing remove path. A seat with lines can't be removed, only benched (refused in words). Find how "has lines" is decided (messages by seat).
5. **Revive paths** set `isActive: true`: both `seatPlayer` revive paths (`seats.ts ~1011`, `~1065` `onConflictDoUpdate`), matching `seatCast` (`~708`, `~848`). `branch.ts` copies `is_active` for player seats.
6. **Guest removal benches their player seats:** `sessions:removeGuest` (`sockets/sessions.ts ~7812-7820`) calls `setSeatBench` for each live player seat of that guest, in its transaction.
7. **Reassign on a benched seat:** the Reassign handler (`sockets/sessions.ts ~8161`, `~8280`) accepts a benched seat as well as a removed one.
8. **Data upgrade**, `src/lib/server/db/dataUpgrades/<the generated tag>.ts`, `afterMigration: '<the generated tag>'` (pattern: `0149_familiar_silk_fever.ts` and its `index.ts` entry):
   - each removed row becomes `is_active = false`, `removed_at = NULL`, keeping `removed_name`;
   - **skip:** `merged_into IS NOT NULL`; envoys (`envoy_slug IS NOT NULL`); character rows with neither card nor member; **removed rows with no lines** (they stay removed); **any row, carded or not, whose resolved member a live seat of the session already holds** (K-4's unique index);
   - raw SQL through `tx` only, no ids written down;
   - an int test covering each skip and each conversion, plus a **second-boot test** that runs the upgrade, then the seat-members pass twice, and checks nothing changes.

## Files owned

- `src/lib/server/db/schema.ts` (the one column), generated `drizzle/<tag>.sql` + meta
- `src/lib/server/db/dataUpgrades/<tag>.ts` + int test, `src/lib/server/db/dataUpgrades/index.ts` (one entry)
- `src/lib/server/sessions/seats.ts`, `src/lib/server/sessions/seatName.ts`, `src/lib/server/sessions/branch.ts` (the copy only)
- `src/lib/server/sockets/sessions.ts` (the `setCastSeatEnabled` handler, `removeGuest`, and Reassign only)
- tests for these (new, and existing ones that pin `setSeatEnabled`, retire-unseats or remove behaviour; update only)

## Out of scope (write down, never build)

- **Readers:** turns, prompt, lore gate, `resolve.ts`, SDK `enabled`, DC `liveSeats` (L2).
- **The port:** `set-seat-bench@1`, `writes.seats`, retract/restore, DC companion death (L3).
- **UI** (L4); docs and NOMENCLATURE (L5).
- The departed→removed rename (Noticed, not done).

## Stop and ask when

CLAUDE.md §Decisions applies; **before `db:generate`** (always: report and wait); the upgrade would delete data or hit the K-4 index; a name beyond `setSeatBench` is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. Never `npm run sdk:build` (the lead builds). Delete only `/tmp/serene-pub-vitest-*` dirs your own runs made, by name — never a glob.
- Migrations are generated, and the index must exceed the highest applied. A change to stored data ships with a pass and a second-boot test. Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a row at a hardcoded id.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `bench-L1-`.

## Done means

- **Targeted tests pass:**
  - `setSeatBench`: both tables, the no-op, refusals;
  - retire and remove now bench;
  - the soft Remove only on an unused benched seat;
  - revive sets active;
  - branch copies `is_active`;
  - `removeGuest` benches;
  - Reassign on a benched seat;
  - the data upgrade: each case, plus the second boot;
  - existing seat, session and Dungeon Crawler tests (`sessions.dungeonCrawler*`; a retire now benches) green, or updated where the ruling changes the expectation, with each update listed.
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files.
- **No full suite.**

## Report

`plans/REPORT-bench-L1-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files, the migration tag, tests and results, names for L5, open ★, **Noticed, not done**.
