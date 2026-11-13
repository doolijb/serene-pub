# BRIEF — bench-L3-w3: Dungeon Crawler companions — seen, killed, and revived by the story

Supervisor: bench-L3. Design (RULED 2026-11-10): `/home/jody/github/serene-pub/plans/PROPOSAL-benched-seats-2026-11-10.md`, ★4 in "Owner rulings, second round". SDK repo: `/home/jody/github/serene-pub-sdk`. Always use absolute paths. Test **from source**: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file>`. ⚠ Import the catalog in a test as `../core-catalog/src/index.js`, as `dungeonCrawlerStory.test.ts:15` does. A bare `@serene-pub/core-catalog` import reads the stale `dist`.

Already done by worker w2, so don't redo it: `C.setSeatBench` (`core:outlet/set-seat-bench@1`, in-ports `seat: S.json`, `benched: S.json`; `contracts/src/outlets.ts` ~:664-713), and the DC genre declaring `writes: { lore: true, scenes: true, seats: true }`. Core's host refuses the port unless the genre declares `writes.seats: true`. It records the bench against the turn's message, so a retake, a Back or a delete of the Narrator's row puts the seat back, and a swipe takes it back before the redo files it again.

## Rules you work under (quoted; binding)

- Owner ★4 (2026-11-10): **"In this programme"**. Dungeon Crawler companion death **and revival** through the bench port are built here.
- Owner 2026-11-10: **"seat to benched is something managed by the genre/pipelines, not automatically by core."**
- Owner 2026-11-10: **"Dragging them back into the seat brings them back and treats them normally, up to the user to manage their status, unless the revival is a part of the story/genre and handled by a function that manages their status."** The genre never undoes a person's drag. Core already makes a person's later drag win; the genre must not fight it either.
- Lead ruling 2026-11-11 (Q2): **`companionsOf` reads `cast.sessionCharacters`** (the real host shape), skips removed seats, and leaves benched ones out of "travelling" but findable for revival. Move the DC test fixtures to the real shape. Today it reads `cast.characters`, which the host's session document never carries, so in a real session no companion is ever seen. Keep the Planner prompt change minimal.
- Brief (lead): **"keep the Planner prompt change to one or two sentences"**. New plan fields are named **`fallenCompanions` / `revivedCompanions` (🚧 provisional)**. **"The Narrator names a companion's death in its own sentence, as for seats."**
- Brief: a death places `set-seat-bench@1 { benched: true }` **and** `update-cast-member@1 { nodeState: "deceased" }` for each companion, in the same turn, and the fallen list (`progress.fallen`) gets them too. A revival places `set-seat-bench@1 { benched: false }` plus `update-cast-member@1 { nodeState: "active" }`, and they leave `progress.fallen` through the turn's own progress write. A retake undoes all of it.
- Heroes (player seats) are **out of scope**. Their death stays exactly as it is: `death.ts`, the `deceased` list, and the new character retiring the old seat. Never bench a player seat here.
- House style: 🚧 on new vocabulary in comments, dated rulings in comments, and a "Moved 2026-11-11 (bench-L3 …): … (was '…')" line above any re-pinned value (see `sdk-tests/coreCatalog.test.ts:1048-1060`). It is a **session**, never a "chat".

## Goal

1. **`core-catalog/src/genres/dungeon-crawler/preamble.ts` `companionsOf` (~:289-310)**:
   - Read `own(own(d).cast).sessionCharacters`. Each row has `{ character: { id?, name }, ref, castMemberId, enabled, removedAt, … }`; the host fills `ref` (`seated-member:<id>` once member-form is on, else `character:<id>`) and `castMemberId`.
   - Skip rows with `removedAt`, rows with no name, and rows matched to a live player seat (keep the existing `seatRefs`/`seatMembers` test).
   - **Skip benched rows** (`enabled === false`): a benched companion isn't travelling.
   - The name is `text(row.character && row.character.name)`. The ref is `row.ref` when it's a non-empty string, else `"character:" + row.character.id` when there's an id.
   - Return `{ ref, name, castMemberId }`, with `castMemberId` null when absent.
   - Update its comment: the 2026-11-11 lead ruling, why (the old field never existed on the host's document), and benched rows left out.
   - Don't change any other reader of the cast.
2. **The plan grammar (`shape.ts` `DUNGEON_CRAWLER_TURN_FRAME`, ~:63-105)**:
   - Add `fallenCompanions` and `revivedCompanions`, each `{ type: 'array', maxItems: 4, items: { type: 'string' } }`, and add both to `required` (the grammar-compiling families need every member; empty says none).
   - Check how the words branch (`planWords`, `story.ts:1194`) and the shape script (`shape.ts` ~:178 `FRAMES`) lay the frame, and make sure both carry the new fields.
   - Extend the frame's doc comment by one line.
3. **`checkPlan` (`storyScripts.ts` ~:138-175)**: normalise both fields to lists of trimmed non-empty strings, at most 4 each, defaulting to `[]` when absent (old answers and the tests' `planOf` fixtures have neither).
4. **The Planner's brief (`story.ts` ~:256-260, the books script)**. This is the only prompt change, two sentences at most:
   - On the existing companion line, append one sentence: if one of them dies this round, name them in `fallenCompanions`.
   - When the crawl's `progress.fallen` holds companions (`companion: true`, see 5), add one line: the fallen companions the story could bring back to life (a shrine, a Raise), naming them, with "name any it does in `revivedCompanions`".
   - Change nothing in `core-catalog/src/seed/prompts.ts` unless the brief can't carry it. If you think it can't, stop and report.
5. **The ledger (`story.ts` `DUNGEON_CRAWLER_LEDGER_SCRIPT`, ~:656-890)**. After `${DUNGEON_CRAWLER_DEATH_JS}`, add the companions' fates in the script's ES5 style:
   - `var companionFates = [];`.
   - For each name in `plan.fallenCompanions` (when `plan`):
     - Find it (case-insensitive name, or exact ref) among `companionsOf(doc)`. Skip unknown names, duplicates, and a companion with no `castMemberId` and no `seated-member:` ref (it has no cast member to mark).
     - Push `{ seat: c.ref, benched: true, member: "seated-member:" + castMemberId (or the ref when it's already `seated-member:`), changes: { nodeState: "deceased" } }`.
     - Push onto `progress.fallen` `{ name, where, seat: c.ref, castMemberId, companion: true }`. `where` is where the party stands (the ledger's `partyPlace("")`, or the first living seat's location if `partyPlace` isn't defined yet at that point).
     - `told.push(name + " is dead. Name " + name + "'s death plainly, in a sentence of its own, and give it weight.")`. Mirror the hero sentence in `death.ts`.
   - For each name in `plan.revivedCompanions`:
     - Find the entry in `progress.fallen` with `companion: true` and that name (case-insensitive). Skip others: a hero is never revived here.
     - Push `{ seat: entry.seat, benched: false, member: <same member rule from entry.castMemberId / entry.seat>, changes: { nodeState: "active" } }`.
     - Remove that entry from `progress.fallen`.
     - `told.push(name + " is alive again: the story brought them back. Tell how, plainly.")`.
   - Put `companionFates` on `progress.lastTelling` and on the returned ledger (`null` when empty). On `b.redo`, return `companionFates: told0.companionFates || null`, as `deceased` does: a swipe took the writes back with the row, and the redo files them again, once.
   - Add `companionFates` to the `Ledger` interface (~:935-955) and to the script's doc comment (the "Returns {…}" list).
6. **The wiring (`story.ts` ~:1450-1478)**. Right after the `deathsFiled` junction and before `filed`:
   - Add a junction `'companions'` on `$.ledger.main`, `.when('fates', { path: (v: Ledger) => v.companionFates, truthy: true }, …)`.
   - Inside it, `jsonPart(k, w, 'list', …, 'companionFates', "The companions' fates")`, then `.each('companion', { over: ($) => $.list.main, max: 8 }, (m) => …)`.
   - In the each body, the parts `seat`, `benched`, `member`, `changes` off `$[ITEM]`, then two outlets in order:
     - `'bench'`: `C.setSeatBench.v1({ seat, benched })`, expose label `'Bench or bring back the companion'`;
     - `'state'`: `C.updateCastMember.v1({ member, changes })`, expose label `"Mark the companion's state"`.
   - If the chain builder can't chain two outlets in one `each` body, use two parallel `when`s over the same list (each one outlet), or the nearest pattern you find in the catalog, and say which you used.
   - `filed` then chains off the new junction.
   - Give the junction a 🚧 doc comment in the house style (★4, owner 2026-11-10; tied to the Narrator's row; a swipe takes it back and the redo files it once; a retake or a delete takes it back for good; a person's later drag wins, in core).
   - Also update the file-header step list (~:60-70, step 8) by one clause.
7. **Tests**:
   - **Move fixtures to the real shape.** Replace `cast: { …, characters: [...] }` with `sessionCharacters: [{ character: { id, name }, ref, castMemberId, enabled: true, removedAt: null, position: 0, absorbedAliases: [] }]` in `sdk-tests/dungeonCrawlerWalk100.test.ts:74`, `dungeonCrawlerWalk3.test.ts:35`, `dungeonCrawlerStory.test.ts:322,865` and `seatCastScripts.test.ts` (~:540-570, the `companionsOf` cases). Keep each test's meaning. `grep -rn "characters:" sdk-tests/*.test.ts` for any other DC companion fixture.
   - **New `sdk-tests/dungeonCrawlerCompanions.test.ts`**, built on the existing DC test helpers (see `dungeonCrawlerStory.test.ts` around :600-700 and :1063-1105 for how a death runs through books → plan → turn → door → ledger, and how a swipe's redo is checked):
     - `companionsOf` reads `sessionCharacters`: a travelling companion is named in the Planner's brief; a benched one (`enabled: false`) and a removed one are not;
     - **a companion dies**: a plan with `fallenCompanions: ['Brother Tamsin']` → `ledger.companionFates` deep-equals `[{ seat, benched: true, member, changes: { nodeState: 'deceased' } }]`; `progress.fallen` has the companion with `companion: true`; the told/outcomes text names the death in its own sentence; an unknown name is ignored;
     - **a redo files it once**: the swipe's ledger (`b.redo`) returns the same `companionFates`, once, not doubled;
     - **a revival**: with the companion in `progress.fallen`, a plan with `revivedCompanions: ['Brother Tamsin']` → `companionFates` `[{ seat, benched: false, member, changes: { nodeState: 'active' } }]`, and `progress.fallen` no longer holds them; a hero's name in `revivedCompanions` does nothing;
     - **the spec**: nodes `channel.story.companions.fates.companion.item.bench` → `core:outlet/set-seat-bench` and `….state` → `core:outlet/update-cast-member` exist (look up node keys the way `dungeonCrawlerStory.test.ts:79,132` does).
   - Update any existing DC test whose expected node list or ledger shape your change moves (e.g. `dungeonCrawlerStory.test.ts:79` lists node keys; ledger deep-equals at ~:698). Each update gets a short dated comment.

## Files owned (edit only these)

- `core-catalog/src/genres/dungeon-crawler/**` (in practice `preamble.ts`, `shape.ts`, `storyScripts.ts`, `story.ts`)
- `core-catalog/src/seed/prompts.ts`: only if step 4 truly can't be done in the brief (stop and report first)
- `sdk-tests/dungeonCrawlerCompanions.test.ts` (new); the existing `sdk-tests/dungeonCrawler*.test.ts` and `sdk-tests/seatCastScripts.test.ts` for fixtures and pins your change moves

## Out of scope (write down, never build)

- Hero (player seat) death, retire, arrivals. The `deceased` list for heroes.
- `contracts/`, `sdk/src/`, `registry/genres.ts` (w2 did them), anything in `/home/jody/github/serene-pub`.
- The `coreCatalog.test.ts` golden (it reads the stale `dist`; the supervisor handles it).
- `npm run sdk:build`: never.

## Stop and ask when

- A name is needed beyond `fallenCompanions`, `revivedCompanions`, `companionFates`, the node keys `companions` / `fates` / `companion` / `bench` / `state`, the `companion: true` flag on a fallen entry, and the test file.
- The Planner needs more than two sentences.
- A player-facing control seems needed.
- A file outside the list needs a change.

## Done means

- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p .` is clean.
- `npx tsx --test dungeonCrawlerCompanions.test.ts dungeonCrawlerStory.test.ts dungeonCrawler.test.ts dungeonCrawlerWalk100.test.ts dungeonCrawlerWalk3.test.ts dungeonCrawlerMultiplayer.test.ts dungeonCrawlerRuleset.test.ts seatCastScripts.test.ts seatBench.test.ts` (from `sdk-tests/`) passes. Report the counts and any failure that existed before your change: run the suite once **before** editing to get a baseline.
- `npx prettier --check` on each file you changed: report it, don't fix it.

## Report

Reply with a short report as your final message: the files changed (with line ranges), the exact Planner sentences and Narrator lines added, the ledger and wiring shape, tests and results (baseline vs after), and **Noticed, not done**.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (In this lane: **never** run `sdk:build` at all.)
- Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted. **Never run `prettier --write` on a file.** Never run npm at the SDK root. Scratch files start with `bench-L3-`.
