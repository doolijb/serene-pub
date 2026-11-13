# BRIEF — hist-D1-w1: Dungeon Crawler deaths stop writing history (SDK)

Supervisor: hist-D1. Repo: `/home/jody/github/serene-pub-sdk` (always use absolute paths). Plan: `/home/jody/github/serene-pub/plans/PLAN-history-one-per-date-2026-11-10.md` § Build scope item 6 (read only that item and "★H4 design"; everything you need is quoted below).

## Goal

A Dungeon Crawler death writes **no lore at all**. Today a death raises a "cairn": a `core:entry/history` entry (the `loreFallen` junction in `lore.ts`), and the Planner reads every history entry back as "the fallen". After this change:

1. A death records the fallen seat's **cast state**: one `core:outlet/update-cast-member@1` with `changes: { nodeState: "deceased" }` for the seat's cast member. Visibility stays `normal` (don't send `nodeVisibility`). The host ties that cast version to the turn's row (the Narrator's placeholder), so a swipe (re-drive of that row) takes it back and a retake/delete takes it back.
2. "The fallen" the Planner reads comes from a lasting list **`progress.fallen`**: `[{ name, where, seat, castMemberId }]` in the crawl's progress annex. Appended in `death.ts` beside `progress.arrivals`, **never spent** (arrivals count down and go; `fallen` stays).
3. The history `fallen` query, `DUNGEON_CRAWLER_ENTRY_TYPES.fallen`, and the `loreFallen` junction are removed.
4. The people listing ("people the party may meet") leaves out character-lore rows anchored to a fallen member.
5. The Narrator names a death in its own sentence.

## Owner rulings this applies (2026-11-10, verbatim where quoted)

- "Dungeon Crawler must stop writing history." It is the only genre abusing it.
- The fallen's record is the cast state: "There should already be a status we can add to the cast directly". `update-cast-member@1` now accepts `nodeState` (one of `active`, `deceased`, `missing`, `departed`) — contract doc in `/home/jody/github/serene-pub-sdk/contracts/src/outlets.ts` (`updateCastMember`): in-ports `member` (`seated-member:<castMemberId>`, `player-seat:<id>`, or a cast member id) and `changes` (object).
- "The fallen" for the Planner comes from a lasting `progress.fallen [{ name, where, seat, castMemberId }]`, appended in `death.ts` beside arrivals, never spent.
- The Narrator must name a death in its own sentence (`death.ts`, the `told` instruction).
- `note-scene@1` is NOT used: it halts the run when no scene is open (it has no skip), so it does not fit cleanly. The Narrator's line is the record.
- Out of scope: seat benching, companion death, hero retire — don't touch `retireSeat`/interview behaviour.

## Files owned (edit only these)

- `core-catalog/src/genres/dungeon-crawler/death.ts`
- `core-catalog/src/genres/dungeon-crawler/lore.ts`
- `core-catalog/src/genres/dungeon-crawler/preamble.ts`
- `core-catalog/src/genres/dungeon-crawler/respond.ts` (comments only)
- `core-catalog/src/genres/dungeon-crawler/scripts.ts` (only the genesis return's `fallen: null` line, ~line 779)
- `core-catalog/src/genres/dungeon-crawler/genesis.ts` (only if it references `fallen`)
- `core-catalog/src/genres/dungeon-crawler/story.ts` — **the fallen/death parts only.** Do NOT touch the clock: `clockBase`, `clockLabel`, `addMinutes`, the `SL.clock` change, `advance`, `DUNGEON_CRAWLER_EPOCH`. A later worker changes those.
- `sdk-tests/dungeonCrawlerStory.test.ts`, `sdk-tests/dungeonCrawlerWalk100.test.ts`, `sdk-tests/dungeonCrawlerWalk3.test.ts`, `sdk-tests/dungeonCrawler.test.ts` — only the parts about the fallen/cairns/history/people. Leave every clock/`crawl-time` assertion alone.

Another worker (w2) is editing `create.ts`, `names.ts`, `index.ts` (DC), registry files, `conformance/src/index.ts`, `sdk-tests/conformance.test.ts`, `sdk-tests/hostState.test.ts` and the create test in `dungeonCrawler.test.ts` at the same time. Never touch those. In `dungeonCrawler.test.ts`, if you need an edit, re-read the file right before each Edit and never use Write on it.

## Files readable

Anything. Useful: `core-catalog/src/genres/dungeon-crawler/calls.ts` (`jsonPart`, `textPart`, `later`, `on`), `core-catalog/src/shared/lore.ts` (`fileLore`), `core-catalog/src/genres/dungeon-crawler/journal.ts`, `/home/jody/github/serene-pub-sdk/contracts/src/outlets.ts`.

## What to build

### death.ts (`DUNGEON_CRAWLER_DEATH_JS`)
The fragment runs inside the ledger script (story.ts) over its variables. Today the `dead` path pushes `fallenNew.push({ name, content: "Here lies …" })`. Replace:
- Declare (in story.ts ledger, where `var fallenNew = [];` is today) `var deceased = [];` and use it here.
- On a death: `deceased.push({ member: ds.castMemberId != null ? "seated-member:" + ds.castMemberId : ds.ref, changes: { nodeState: "deceased" } })`.
- Append to `progress.fallen` (copy-then-assign like arrivals): `{ name: ds.name, where: where, seat: ds.ref, castMemberId: ds.castMemberId != null ? ds.castMemberId : null }`. For every dead seat (not only `ds.user != null`).
- `told` for the dead: keep the sense of today's line and add that the Narrator names the death in a sentence of its own. Suggested: `ds.name + " is dead: the dice decided it at death's door. Name " + ds.name + "'s death plainly, in a sentence of its own, and give it weight; nothing undoes it."` (prompt copy — report the exact text).
- The lane line says "Their cairn stands in the world now, and the story goes on without them." There is no cairn any more: drop the cairn clause ("… I'm sorry. The story goes on without them. When you're ready, …"). Report the exact new text (user-facing copy; marked 🚧 provisional for the docs lane).
- Rewrite the file header's **dead** bullet and the "Why a fate slot" paragraph so they say: the seat's `fate` is `dead`, the seat's cast member is marked `deceased` (a cast version tied to the turn's row), and the fallen is kept in `progress.fallen`; no lore is written (owner ruling 2026-11-10). Keep the doc's existing style (🚧, ruling dates).

### story.ts — fallen parts only
- Header doc: step 1 no longer reads `fallen`; step 8 names the deceased junction instead of `loreFallen`.
- `DUNGEON_CRAWLER_BOOKS_SCRIPT`: doc `{ session, state, story, messageId, places, people, log }` (no `fallen`); `var people = peopleOf(v.people, progress.fallen);` and the crib call without `fallen:` (cribLines reads `progress.fallen` itself, see preamble). In the redo `told: {...}` object add `deceased: Array.isArray(last.deceased) && last.deceased.length ? last.deceased : null`.
- `DUNGEON_CRAWLER_LEDGER_SCRIPT`: redo return: replace `fallen: null` with `deceased: told0.deceased || null` (a swipe took the cast version back with the row; the redo files it again — once). Fresh path: `var deceased = [];` replaces `var fallenNew = [];`; `progress.lastTelling` gets `deceased: deceased.length ? deceased : null`; the return's `fallen: …` becomes `deceased: deceased.length ? deceased : null`. Update the ledger's doc comment (its returned member list).
- `Ledger` interface: `fallen` → `deceased`.
- `storyBranch`: delete `w.params.push([on(s, 'fallen'), …])` and the `.query('fallen', …)` node; drop `fallen: $.fallen.entries` from the books input. Doc comments that mention "the fallen" read move accordingly.
- After `const worlded = loreWrites(…)`, add a junction placing the cast change, then build `filed` on it instead of on `worlded`. Shape (follow the `after` junction's `lanes` arm at the end of the file for `.each` + `jsonPart` over `$[ITEM]`):
  - junction key `deaths`, `.when('deceased', { path: (v: Ledger) => v.deceased, truthy: true }, …)`;
  - `jsonPart(k, w, 'list', ($) => $.channel.story.ledger.main, 'deceased', …)` then `.each('member', { over: ($) => $.list.main, max: 8 }, (m) => …)`;
  - inside: `jsonPart` the item's `member` and `changes`, then `.outlet('write', ($) => C.updateCastMember.v1({ member: …, changes: … }), { expose: { label: 'Mark the fallen deceased' } })`.
  - Don't reuse the old key `fallen` for the junction (a stored per-node override keyed `channel.story.fallen` must not land on it). Report the node keys you created.
  - No `as any` unless the existing code in the same spot already needs it (`sdk-tests/deriveDontSpell.test.ts` polices casts).

### lore.ts
- Remove the `loreFallen` junction, `DUNGEON_CRAWLER_ENTRY_TYPES.fallen`, `MOST.fallen`, `WorldWrites.fallen`, and the now-unused `historyEntryType` import.
- Header doc: places and people only; a fallen hero is no longer lore (its cast state and `progress.fallen`, 2026-11-10). Fix the `loreWrites` doc (two junctions, node keys `lorePlaces`, `lorePeople`).

### scripts.ts / genesis.ts
- Remove `fallen: null` from the genesis script's return (scripts.ts ~779) and any `fallen` genesis passes to `loreWrites`.

### preamble.ts
- `fallenOf(list)`: reads `progress.fallen` items: each `text(name)` + (`where` ? " fell in " + where : " fell") + "." — skip items without a name.
- `cribLines(progress, journal, o)`: `var fallen = fallenOf(progress.fallen);` (drop `o.fallen`); people via `peopleOf(o.people, progress.fallen)`. Update the `o` doc comment.
- `peopleOf(listing, fallen)`: optional second argument. Leave out any row whose `lorebookBindingId` (a number on `core:query/lorebook-entries@1` rows — the cast member an anchored entry is bound to; a cast member id IS a `lorebook_bindings` id) equals the `castMemberId` of an item in `fallen`. Unbound rows (every NPC the crawl writes) stay. Comment it: the fallen hero's own lore (old cairns become character lore bound to the member, lane hist-D2) is not somebody the party may meet.
- Header doc line for `fallenOf`.

### respond.ts
- Comment only (the `people` / `places` params block, ~line 76-84): the fallen are the crawl's own `progress.fallen`, not a listing; the people listing is filtered of lore anchored to a fallen member by `peopleOf`.

## Tests (update, and add these)

In `sdk-tests/dungeonCrawlerStory.test.ts` (it has fixtures `FALLEN`, `PROGRESS`, `session()`, `state()`, books/ledger runners — reuse them):
- Update the respond-doc node-key list and params assertions: no `channel.story.fallen` node/param, no `loreFallen`; the new deceased write node present with `definitionId` `core:outlet/update-cast-member`.
- The doc writes no history: no node with `definitionId === 'core:outlet/create-lore-entry'` whose params name `core:entry/history`.
- **A Fair death emits the deceased cast change and no history write:** the ledger returns `deceased: [{ member: 'seated-member:<id>' (or the seat ref when no castMemberId), changes: { nodeState: 'deceased' } }]`, has no `fallen` key, and `progress.fallen` holds `{ name, where, seat, castMemberId }`.
- **`progress.fallen` survives the arrival being spent:** run the ledger on later rounds until the arrival is gone from `progress.arrivals`; `progress.fallen` still holds the entry.
- **A swipe or redo writes nothing twice:** with `lastTelling` carrying `deceased`, the books' redo `told.deceased` equals it, and the redo ledger returns exactly that `deceased` once, `progress: null` (no second append).
- **The crib reads `progress.fallen`:** books with `progress.fallen = [{ name: 'Bram', where: 'the Hall', … }]` → crib matches `/The fallen: Bram fell in the Hall\./`; with no history listing passed at all.
- **People filter:** a `people` listing row with `lorebookBindingId` equal to a fallen `castMemberId` is not in the books' `people` nor the crib; an unbound row is.
- Walk100/Walk3 pass `fallen: []` to the books script: harmless; remove only if it reads wrong. Leave their `'crawl-time'` fixtures alone.

## Run (capped scope, from source; never pipe into `head`)

```
cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test dungeonCrawlerStory.test.ts dungeonCrawler.test.ts dungeonCrawlerWalk100.test.ts dungeonCrawlerWalk3.test.ts dungeonCrawlerMultiplayer.test.ts dungeonCrawlerRuleset.test.ts deriveDontSpell.test.ts; echo test-exit=$?'
cd /home/jody/github/serene-pub-sdk && npx tsc --noEmit -p sdk-tests
```
Clock/`crawl-time` tests may fail later because of another worker — not because of you; say which fail and why. Before your edits, these files may already have failures caused by other lanes: record any failure you see before you start, so it isn't blamed on you.

## Code style

- The scripts are ES5-style JavaScript inside TS template literals: `var`, `function`, no arrow functions, no `let`/`const`; inside the template literal a newline escape is `\\n` and a backslash is doubled. Follow the surrounding code exactly.
- Tabs; the file's own quote style. `npx prettier --check <file>` to look, never `--write`; many files were not prettier-clean before you — don't reformat.
- Doc comments in the files' own voice (🚧 marks, ruling dates "owner ruling 2026-11-10").

## Rules (CLAUDE.md, NOMENCLATURE)

- It is a **session**, never a *chat*. No new names beyond: the junction/node keys you create, `deceased` (ledger member), `progress.fallen`. Never reintroduce a retired word. Any other new name → stop and report.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
- Never edit outside the files owned. If you need a change elsewhere, stop and report it.

## Stop and ask when

CLAUDE.md §Decisions applies, a ★ is unruled, a name is new, or a migration is needed. Report instead of guessing.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- **Never run `npm run sdk:build`** in this lane at all (the lead builds). Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted. **Never run `prettier --write` on a file.**
- Never hand a DOM node to an assertion.
- Scratch files start with `hist-D1-`.

## Done means

`npx tsc --noEmit -p sdk-tests` exits 0 for your files, and the test run above passes except failures you name as another worker's clock work or pre-existing.

## Report

Your final message is your report: changed files, the node keys created, the exact new copy (told line, lane line, expose label), tests run with results, open ★, **Noticed, not done**.
