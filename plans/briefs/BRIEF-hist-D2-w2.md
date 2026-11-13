# BRIEF — hist-D2-w2: Dungeon Crawler core tests after the SDK change (core)

Supervisor: hist-D2. Repo `/home/jody/github/serene-pub`. The SDK sibling (`../serene-pub-sdk`) is built with lane hist-D1's changes; **never edit it, never run `npm run sdk:build`**. Owner GO 2026-11-10.

## What moved in the SDK (hist-D1, built)

- **Deaths:** a death no longer writes a history "cairn" (`Here lies …`). It writes a `deceased` cast version for the fallen seat's cast member through `update-cast-member@1` (`{ nodeState: "deceased" }`, cause `action`, tied to the turn so a retake takes it back), and appends `{ name, where, seat, castMemberId }` to `progress.fallen` in the progress annex (`sessions.annex.core["dungeon-crawler-progress"].fallen`; `where` is the place name, `""` when none; `seat` the participant ref, e.g. `player-seat:<id>`; never spent). The Narrator names the death in its own sentence. The death's lane line now reads "‹name› has fallen[ in ‹place›]. I'm sorry. The story goes on without them. When you're ready, make a new character: they will arrive near where ‹name› fell, within a couple of rounds." (no cairn). The world-lore `fallen` arm (`ENTRY_TYPES.fallen`, `loreFallen`) and the history `fallen` query are gone.
- **Clock:** `core:slot/crawl-time@1` is no longer written. Create moves the **session story clock** (`sessions.story_clock_*`) with `advance-story-clock@1 { to: { hour: 8, day: "today" } }` (cause `action`, skip on refusal); story turns and rests move it by minutes (`advance-story-clock@1`, cause `action`). The ledger returns `deceased` and `clock` (re-filed once on a redo). The brief and journal read the story now (`storyNowClock`); the rest's label is "Heal the party".
- **Scenes:** DC has `writes: { lore: true, scenes: true }`, `scenes.triggers.timeAction: false`, and a new `core:spec/dungeon-crawler-summarize-scene`.
- Readers: core's `sessionStoryNowOf` / `clockOf` (`src/lib/server/state/storyTime.ts`); clock moves are recorded as state proposals / ledger moves (find the exact kind in `state/storyTime.ts` `moveSessionStoryClock` and `pipelines/runtime/host.ts` `advance-story-clock`); cast versions in `character_versions` (`node_state`, `valid_from_message_id`, `source_message_id`), read as the session reads them via `membersAsRead(db, [id], { sessionId })` (`$lib/server/cast/memberAsRead`).

## Goal

1. Run the core Dungeon Crawler tests below and fix every failure **caused by the moves above**, by changing the test's expectation to the new behaviour (never by weakening an unrelated assertion). In particular, where a test asserted the cairn, it now asserts **no `core:entry/history` row**, a **`deceased` cast version** for the fallen seat's member, and a **`progress.fallen` entry**; where it asserted `crawl-time`, it asserts the session story clock. Keep each test's intent. Add a dated one-line comment where an expectation moved (`// Moved 2026-11-10 (hist-D1/D2): …`), as the files already do.
   - `src/lib/server/pipelines/scripts/dungeonCrawlerStory.test.ts` (known red: "the ledger and Rest run in the sandbox…" expects a `world` crawl-time change), `dungeonCrawlerScripts.test.ts`, `dungeonCrawlerRound.test.ts`
   - `src/lib/server/sockets/sessions.dungeonCrawler.int.test.ts` (asserts `crawl-time` at ~:464, :860, :888), `…W3`, `…Walk100`, `…Walk2`, `…Walk3`, `…Rounds`, `…FixTurn`, `…Feedback`, `…Persona` (all `sessions.dungeonCrawler*.int.test.ts`). Known red before the build (lane hist-G): W3 ×2 (cairn), Walk100 "is a NEW seat", Walk2 "the card stays with the fallen seat".
2. **Add** (in the suite that already has the helpers: deaths in `…W3`, create/rest in `sessions.dungeonCrawler.int.test.ts` or W3 — your choice, name it):
   - **swipe a death turn** (the retake/regenerate road the suites already use, e.g. `retakeTurn`, with the Planner killing the seat again) → exactly **one** `deceased` cast version for the member and exactly **one** clock move for the turn, cause `action`;
   - **create sets 08:00** on a fresh session: after create, the session's story clock reads hour 8, minute 0;
   - **a rest's clock move**: a rest moves the session story clock forward by its length (one move, cause `action`).
3. If a failure is **not** explained by the moves above (an SDK bug, a core bug, another lane's change), do not fix it: record the test, the assertion and your diagnosis in the report.

## Files owned (edit only these)

- `src/lib/server/sockets/sessions.dungeonCrawler*.int.test.ts`
- `src/lib/server/pipelines/scripts/dungeonCrawler*.test.ts`

Each already carries other lanes' uncommitted edits: check `git diff <file>` before editing and keep them.

## Files readable

Anything. Don't edit `src/lib/server/sessions/dcCairns*`, `dcCrawlClock*`, `startup/index.ts` (worker w1), `pipelines/boot/specHashes.test.ts` (supervisor), or anything under `pipelines/entities`, config, `prompt/assemble`, `boot/seedVariableTemplates`, `src/lib/server/managed/*` (other sessions).

## Out of scope (write down, never build)

SDK edits; product code; docs, `NOMENCLATURE.md`, `STYLE-GUIDE.md`; the departed-seat lore bug; benched seats; companion death.

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a test's intent can't be kept under the new behaviour; you'd need to touch a file outside the list.

## Rules (quoted)

- "Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`. Delete only `/tmp/serene-pub-vitest-*` dirs your own runs made, by name — never a glob."
- Run the int suites **two or three files at a time**, and redirect output to a scratch file under `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/` named `hist-D2-w2-*`, then grep it.
- "Inside `db.transaction(async (tx) => …)` use only `tx`."
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You run no sdk:build at all.)
- It is a **session**, never a *chat*. Never `kill -9` anything.

## Done means

- Every file listed in Goal 1 green, run in capped groups; the three new tests green.
- `npx tsc --noEmit -p .` (capped: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p . > <scratch>/hist-D2-w2-tsc.log 2>&1; echo exit=$?'`) shows no error in your files.

## Report

Final message (no report file): changed files and what moved in each (one line per expectation group); tests run with counts per file; failures not explained by the SDK move, with diagnosis; open questions; Noticed, not done.
