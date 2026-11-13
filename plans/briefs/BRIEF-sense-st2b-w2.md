# BRIEF — lane `sense-st2b`, worker w2 — Part B: the Lair's clock is the round tick, in every preset

You are a `lane-worker` for the supervisor of lane `sense-st2b`. Repo: `/home/jody/github/serene-pub` (app);
sibling SDK: `/home/jody/github/serene-pub-sdk`. Another worker (w1) is editing `src/lib/server/state/write.ts`,
`scenes/liveScenes.ts`, `sessions/annexChanges.ts`, `sessions/retakeTurn.ts`, `sessions/oneUndoRule.int.test.ts`,
`sessions/annexChanges.keepOnRetell.int.test.ts`, `docs/genre-dungeon-crawler.md`, `docs/stats-and-states.md`, the
SDK's `guides/storage.md` and `core-catalog/src/genres/dungeon-crawler/reveal.ts` right now: never touch those.
Another session is editing visual-novel layout files: never touch anything outside your list.

**This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.**

## Read first

`plans/briefs/BRIEF-sense-st2b.md` Part B (the owner's words), `plans/REPORT-sense-clk2-2026-11-11.md`,
`plans/REPORT-sense-clk3-2026-11-11.md`, `plans/REPORT-sense-clk4-2026-11-11.md` (the clock as built and the scope
review at its end). Re-read every cited line before changing it.

## The owner's ruling (2026-11-11, verbatim)

Told that the Lair's fixed round move sits behind the keeper's model call and stalls when it fails, the owner chose:
**"Round tick in every Lair preset (Recommended)"** — described as: "Code only, can never stall, identical to Story.
The routine moves time only when 'Move the clock' is switched on. Removes the step-aside gate and the Lair routine's
name from the shared round tick." This replaces the earlier rulings that the Lair's routine owns the clock and that
Words only alone uses the tick.

## Tasks

1. **`core-catalog/src/shared/roundTick.ts`**: `core:spec/round-tick` goes back to: the round worth (`worth`), the
   `moves` gate (`clock` junction), the `at` gate (`present` query + `clocked` junction), the `advance` outlet. The
   `modes` query (`core:query/session-settings@1`) and the `keeper` junction go. The outlet then sits directly in the
   `at` branch, so its key returns to **`clock.moves.clocked.at.advance`** (what it was before the gate; confirmed in
   `src/lib/generated/docs/search.json`). Same `advanceStoryClock` config as now (`cause: 'tick'`,
   `onRefusal: 'skip'`, `params: slot.params()`). Keep `ROUND_TICK_VERSION` as it is. Rewrite the docblock: no third
   gate, no empty branches; registered by Story and the Lair (both in their genre defaults); the Dungeon Crawler's
   clock is its turn's; genres that keep real time register none.
2. **`genres/defaults.ts`**: the Lair registers the round tick in `lairRegistrations` exactly as Story does
   (`roundTick: roundTick()`, the same lazy registration, with a one-line doc). Update the docblocks at ~126 and
   ~304–309 (no more "the keeper owns the clock" / "steps aside").
   **`seed/presets.ts`**: remove Words only's `register: [register(coreEvents.roundEnded, roundTickSpec())]`, and the
   imports that become unused (`roundTickSpec`, and `coreEvents` / `register` only if nothing else uses them).
   Rewrite the Words only docblock sentence at ~165–167: the round tick moves the clock, keeper on or off.
3. **The keeper loses its round-worth move.** In `shared/reckoning.ts`: remove `ReckonTerms.ownsTheClock` (~605–611),
   the reckon script's `clockUnnamed` (its output line ~534, the `Reckoned` interface field ~581–582, the script
   docblock lines ~425–428), and the `round` branch (~892–920: return `named`'s junction directly). Remove any import
   that becomes unused (e.g. the `roundWorth` contract if nothing else in the file reads it). In
   `genres/lair/keeper.ts`: drop `ownsTheClock: true` and its comment, and rewrite the docblock bullet ~25–31: it
   judges no time (`time` off) and moves the clock only when its *Move the clock* is switched on and it names a move;
   the round tick moves the round worth. Confirm (read, do not change) that every Lair preset ships the keeper's
   `time` duty off (`duties: { …, time: false }`, and no preset turns it on); report what you found.
   Note: `STORY_RECKON_SCRIPT` is shared with Story, so Story's reckoning spec hash will move too: that is expected.
4. **Tests.**
   - `sdk-tests/coreClockOwners.test.ts`: every Lair preset → `['core:spec/round-tick']`; no reckoning reads the
     round worth (only the round tick does); the round tick reads no session settings and names no keeper id (replace
     the ~113–128 tests accordingly).
   - `sdk-tests/coreGenreDefaults.test.ts`: Story and the Lair both register `round-ended → core:spec/round-tick` in
     their genre defaults; no preset adds it (~235, ~255–308); the structure test asserts the outlet key
     `clock.moves.clocked.at.advance` in the clause `clock.moves.clocked`, on the presences read's `at`, inside the
     junction on `tick.moves`, with no `modes` step and no `keeper` clause; and whatever parity list mentions it.
   - `src/lib/server/pipelines/routines/clockOwners.int.test.ts`: for **each** Lair preset (Words only, Rules, The
     rules decide), one round moves the clock once, by the round worth (5), cause `tick`, with the keeper **Off** and
     with it at **Review**; a round worth of 0 moves nothing and writes no line. Replace the keeper-owns-the-clock
     cases (~394, ~438, ~486, ~511). Keep the Story case. A case that the keeper's *Move the clock* switched on and
     naming a move adds its own move beside the tick is allowed (as Story's ★CLK2-3: two moves, by opt-in), not
     required.
5. **Keep** the empty-branch store rule (`sdk/src/document.ts` `orderedChains`, app `boot/store.ts` `chainsOf`) and
   its tests. Adjust only the cases that used the round tick's keeper junction as their example, so they use a small
   fixture spec with a junction holding empty branches instead: `sdk-tests/junctionEmptyBranch.test.ts` ~92–96 (and
   its `roundTickSpec` import if then unused), `src/lib/server/pipelines/boot/clauseChainRoundTrip.int.test.ts`
   ~200–208 (and its file header if it names the round tick's junction). Look at how the other cases in those files
   build fixtures and do the same. Do not edit `document.ts` or `store.ts`.
6. **Docs** (provisional 🚧 copy; list each changed sentence in your report):
   - `docs/genre-lair.md` ~150–162: the clock moves each round by **Minutes each round moves the clock**, in every
     preset, with no model; **Keep the books** moves it only when its *Move the clock* is switched on and it names a
     move (off in every Lair preset, as in Story); if both are on the clock moves twice a round, so set the round
     worth to 0 (mirror Story's sentence in `docs/genre-story.md`).
   - `docs/lorebook-time.md` ~110: in the Lair, too, the default owner is **Each round moves the clock**.
   - `/home/jody/github/serene-pub-sdk/guides/time.md` ~205–215: the round tick is Story's and the Lair's one owner
     of the clock; drop the keeper-owns and step-aside paragraphs; the keeper's judged move stays opt-in.
   - `NOMENCLATURE.md`: the §4 **round tick** row (line ~206: no session-settings read, no `keeper` junction;
     registered by Story and the Lair in their genre defaults; drop "elsewhere the Lair's clock is Keep the books'
     (`ReckonTerms.ownsTheClock`)"), the §9 **round worth** row (~442: who moves it is the round tick in Story and
     the Lair; drop the keeper and Words only clauses), and one new §25 subsection in the ledger's style (see the
     sense-clk3/clk4 subsections near ~3699–3704), dated 2026-11-11, "the Lair's clock is the round tick (owner
     ruling; lane sense-st2b)": rows for — the round tick's `modes` step and `keeper` junction removed, outlet key
     back to `clock.moves.clocked.at.advance`; `ReckonTerms.ownsTheClock`, the reckon script's `clockUnnamed` and
     branch `reckon.on.time.round.*` retired (never shipped); the Lair registers the round tick in its genre
     defaults, Words only's own registration gone. Do not edit any other NOMENCLATURE row.

## Files owned (edit only these)

SDK (`/home/jody/github/serene-pub-sdk/`): `core-catalog/src/shared/roundTick.ts`, `core-catalog/src/shared/reckoning.ts`,
`core-catalog/src/genres/lair/keeper.ts`, `core-catalog/src/genres/defaults.ts`, `core-catalog/src/seed/presets.ts`
(Words only's registration, its docblock and the imports only), `sdk-tests/coreClockOwners.test.ts`,
`sdk-tests/coreGenreDefaults.test.ts`, `sdk-tests/junctionEmptyBranch.test.ts`, `guides/time.md`.
App: `src/lib/server/pipelines/routines/clockOwners.int.test.ts`,
`src/lib/server/pipelines/boot/clauseChainRoundTrip.int.test.ts`, `docs/genre-lair.md`, `docs/lorebook-time.md`,
`NOMENCLATURE.md` (the rows above only).

## Pins — report, never re-pin

Spec hashes and the SDK digest will move (round-tick, lair-keeper, story-reckoning, the Lair's registrations, the
Dungeon Crawler's reveal from w1). **Do not edit** `src/lib/server/pipelines/boot/specHashes.test.ts`,
`registryHashes.test.ts` or `sdk-tests/coreCatalog.test.ts`. Run them once at the end and report each recorded-vs-code
pair they print. They are expected red for that reason and no other.

## Out of scope

The tie-break in the chain rule; `replyRoad.int.test.ts`; migrations; ST3; any test file not in your list (if one
breaks because of this change — e.g. `routines/roundTick.int.test.ts`, `roundWorth.genres.int.test.ts`,
`roundTick.undo.int.test.ts`, `runtime/roundWorth.test.ts` — report the failure and the exact lines, do not edit it);
the generated docs under `src/lib/generated/docs/`.

## Stop and ask when

A published name other than the internal ones above would change; a new name, setting or migration would be needed;
a Lair preset ships the keeper's `time` duty on; the empty-branch rule's tests cannot keep their meaning with a fixture.

## Verbatim rules

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`. Browser code
  runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a
  *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.

## Running tests and the build

- SDK tests run against the SDK's sources: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test
  coreClockOwners.test.ts coreGenreDefaults.test.ts junctionEmptyBranch.test.ts` (plus `coreCatalog.test.ts` once at
  the end for the digest pair). Also `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit`.
- The app's tests read the SDK's **built** dist, so before the app tests you must build once:
  `cd /home/jody/github/serene-pub && npm run sdk:build`, only after `pgrep -af "[v]ite dev"` shows no serene-pub
  server and `pgrep -af "[v]itest|[t]sx --test"` shows no test run (w1 runs vitest in the app: if one is live, wait
  for it to end, then build). The `[x]` bracket keeps pgrep from matching its own command line. Build as few times
  as you can (once, after your SDK edits are done, is the aim).
- App tests (capped scope, from the app root): `src/lib/server/pipelines/routines/clockOwners.int.test.ts`,
  `src/lib/server/pipelines/boot/clauseChainRoundTrip.int.test.ts`, `src/lib/server/pipelines/boot/store.int.test.ts`
  (if it exists), then once, report-only: `routines/roundTick.int.test.ts`, `routines/roundWorth.genres.int.test.ts`,
  `routines/roundTick.undo.int.test.ts`, `runtime/roundWorth.test.ts`, `boot/specHashes.test.ts`,
  `boot/registryHashes.test.ts`.

## Done means

The three SDK test files and the two owned app test files pass; `sdk-tests` `tsc --noEmit` clean;
`cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean (report other
lanes' errors without fixing them); `npx prettier --check` on each changed file.

## Report (your final message)

Changed files; the rule as built; the presets' keeper `time` duty as found; tests run with pass counts; every pin pair
(recorded vs code) printed by the three pin tests; each report-only test's result (with the failing lines if any);
each provisional sentence; whether `grep -rn "ownsTheClock\|clockUnnamed\|session-settings" core-catalog/src/shared/roundTick.ts core-catalog/src/shared/reckoning.ts core-catalog/src/genres/lair/keeper.ts`
is empty; **Noticed, not done**.
