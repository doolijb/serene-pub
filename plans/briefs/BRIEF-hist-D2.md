# BRIEF — hist-D2: Dungeon Crawler upgrade passes and core tests (core half)

Plan: `plans/PLAN-history-one-per-date-2026-11-10.md`. Read the rulings sections (including ★H4 Q3, "Cast/character lore" for old cairns), **§ Build scope item 6**, and the report `plans/REPORT-hist-D1-2026-11-10.md`, especially "People filter / what D2 stamps" and "For D2". GO 2026-11-10. **The SDK is built** (lead, 2026-11-10) with D1's changes. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Other sessions are editing nearby: a variable-layouts session works in pipelines/entities, config, prompt/assemble, boot/seedVariableTemplates; an images/vision session works in `src/lib/server/managed/*`. Check each file's `git diff` before editing.

## Goal

1. **Boot pass `dc-cairns`** (core, idempotent; follow the existing startup/boot pass pattern, e.g. the seat-members pass; find it, and its registration and health flags, `failsHealth`):
   - **Select:** own books (session notes) of Dungeon Crawler sessions, rows with `type_id = 'core:entry/history'` whose content matches the epitaph shape "Here lies ‹name›[, ‹class›], level ‹n›, who fell[ in ‹place›]." (`death.ts:147-150` in the SDK's git history; D1 removed the writer).
   - **Match the member:**
     1. by `sourceMessageId` → that turn's fate change to `dead` → its seat → `cast_member_id`; check what the ledger table holds;
     2. else by a unique, case-insensitive name among that session's seats, removed ones included;
     3. else no member.
   - **Write**, in one transaction per book, `tx` only:
     - a `deceased` cast version for the matched member (through the existing writer; skip if the member already reads deceased), tied to `sourceMessageId`;
     - the matching `progress.fallen` item `{ name, where, seat, castMemberId }` in the session's progress annex, unless already present;
     - the epitaph **retyped in place to character lore, anchored (`anchorBindingId`) to the matched member** (ruled), keeping its content and `sourceMessageId`;
     - **with no member:** retype to world lore, titled "Cairn of ‹name›" (provisional 🚧).
   - **Second boot is a no-op:** nothing history-typed matches any more. Test it.
   - Never use the outer `db` inside the transaction, and never seed ids.
2. **Boot pass `dc-crawl-clock`** (required, per D1): for each Dungeon Crawler session with a NULL session story clock, read its latest world `crawl-time` value (`Y-MM-DD HH:MM`) and write it as the session clock through the existing clock columns/helper. Keep the parts verbatim; the day may exceed 31 (free-form). Skip sessions that already have a clock, so a second boot is a no-op. Old `crawl-time` rows stay.
3. **Core tests:**
   - the Dungeon Crawler int suites that were red on the cairn write (`sessions.dungeonCrawlerW3.int.test.ts`, `sessions.dungeonCrawlerWalk100.int.test.ts`, `sessions.dungeonCrawlerWalk2.int.test.ts`; see hist-G's report for the names) now assert **no history row**, a `deceased` cast version and a `progress.fallen` entry;
   - add: swipe a death turn → exactly one `deceased` version and one clock move (cause `action`); create sets 08:00 on a fresh session; a rest's clock move;
   - **registry hashes:** `src/lib/server/pipelines/boot/registryHashes.test.ts` pins for the DC create, respond, interview, rest and after-rest specs and host state moved with the SDK build, and a new pin is needed for `core:spec/dungeon-crawler-summarize-scene`. Re-pin, with a dated note per the file's style;
   - any core test that counts conformance laws (now 40) or scene-summarize specs.
4. **The departed-seat lore bug is out of scope:** benched seats fix it later.

## Files owned

- a new boot-pass module (or modules) for `dc-cairns` and `dc-crawl-clock`, their registration in the boot sequence, and their int tests
- `src/lib/server/sockets/sessions.dungeonCrawler*.int.test.ts` and other core Dungeon Crawler tests (update and add)
- `src/lib/server/pipelines/boot/registryHashes.test.ts` (the DC and host-state pins plus the new spec)
- core tests that count laws or specs (update only)

## Out of scope (write down, never build)

- SDK edits (D1 is done and built; report any SDK bug you find instead of fixing it).
- Benched seats and companion death (a later plan). Docs and NOMENCLATURE (hist-F, running alongside): queue names.

## Stop and ask when

CLAUDE.md §Decisions applies; a cairn's member match is ambiguous in a way the rules above don't settle; a pass would delete data; a name beyond the copy above is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. **Never `npm run sdk:build`** (the lead builds).
- A change to stored data ships with a pass and a test that a second boot changes nothing. Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a row at a hardcoded id. Never add a top-level `await` to `db/index.ts`.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`. Delete only `/tmp/serene-pub-vitest-*` dirs your own runs made, by name — never a glob.
- Scratch files start with `hist-D2-`.

## Done means

- **Targeted tests pass:**
  - `dc-cairns`: matched, unmatched and ambiguous rows; second boot is a no-op;
  - `dc-crawl-clock`: a clock is written, an existing clock is skipped; second boot is a no-op;
  - the Dungeon Crawler int suites are green;
  - `registryHashes` is green;
  - the existing boot-pass tests are green.
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files (capped, `NODE_OPTIONS=--max-old-space-size=8192`, `MemoryMax=12G`).
- **No full suite.**

## Report

`plans/REPORT-hist-D2-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files, tests and results, names and copy for lane F, open ★, **Noticed, not done**.
