# BRIEF — `sense-age-w1` — SDK: a function says which time it counts on, a genre says which time it keeps, ruleset fit weighs them

You are a `lane-worker` under supervisor `sense-age`. Work only in `/home/jody/github/serene-pub-sdk` (the SDK repo).
Run commands from `/home/jody/github/serene-pub` where noted. Return your report as your final message (no report file).

## Goal (owner, 2026-11-11: "and it should be a measurable against ruleset compatibility")

1. **A function declares which time it counts on.** New optional key on `FunctionProps`
   (`sdk/src/functions.ts`, about line 242): `countsTime?: 'story' | 'real' | 'both'`, a 🚧 docblock saying: which time
   the function counts on — the story clock (`'story'`), real elapsed time (`'real'`), or both; left out, it counts on
   neither; ruleset fit reads it (`rulesetFit`). It is content (inside the hash), not display text — do NOT add it to
   `FUNCTION_DISPLAY_KEYS`. In `functionFindings` (about line 510) add a finding with reason name `bad-counts-time`:
   `` `${at}.countsTime is 'story', 'real' or 'both', or left out — not ${JSON.stringify(props.countsTime)}.` ``
   and list `bad-counts-time` in the function's docblock list of reasons (about line 500–508).
2. **A genre declares which time it keeps.** New optional key on `GenreProps` (`sdk/src/genres.ts`, near `members`
   about line 235): `readonly keepsTime?: 'story' | 'real' | 'none'`, spelled out (the interface is frozen, as the
   other 🚧 keys say), 🚧 docblock: which time this genre keeps — a story clock (`'story'`: Story, the Lair, the Dungeon
   Crawler), real time (`'real'`: the Guide, Chat) or neither (`'none'`); `rulesetFit` weighs a ruleset's functions'
   `countsTime` against it; left out, fit does not weigh time. Validate in `genre()` beside the `members` check (about
   line 1190), same style: `throw new Error(`${id}.keepsTime: 'story', 'real' or 'none' — not ${JSON.stringify(props.keepsTime)}`)`.
   If `GenreDecl` is not derived from `GenreProps`, add the key there too.
3. **The measure** (`sdk/src/fit.ts`):
   - A private helper `timeNeedOf(ruleset): { story: boolean; real: boolean }` — over `rulesetSections(ruleset).functions ?? []`:
     each reference's declaration (`resolveFunctionRef(ref).decl?.countsTime`, import from `./functions.js`) — `'story'`
     → story, `'real'` → real, `'both'` → both. **And** core's `core:function/recurring@1` used with
     `options.every === 'hour'` or `'day'` counts on story time (its hour is a clock move crossing whole hours, its day a
     clock move onto another date — the app's `usesHourlyRecurring` reads it the same way); its declaration is NOT
     changed, because what it counts on depends on its option. Not exported.
   - `rulesetFit(genre, ruleset)`: widen the parameter to `Pick<GenreDecl, 'uses' | 'keepsTime'>` (still nullable).
     When `genre?.keepsTime` is declared, `timeUnmet` = the times the ruleset counts on that the genre does not keep
     (`'story'` unmet unless keepsTime is `'story'`; `'real'` unmet unless keepsTime is `'real'`). When it is non-empty:
       - the rating is lowered to `'poor'` if it was better than `'poor'`; `'incompatible'` and `'poor'` stay as they are;
         `group` is recomputed (`ratingGroupOf`);
       - the reason becomes the time sentence (unless the rating is `'incompatible'`, whose reason stays): story unmet
         takes precedence —
         - story unmet, keeps `'real'`: `its rules count story time, and this genre runs on real time: they would never move`
         - story unmet, keeps `'none'`: `its rules count story time, and this genre keeps no clock: they would never move`
         - real unmet, keeps `'story'`: `its rules count real time, and this genre keeps a story clock: they would move with the hours outside the story`
         - real unmet, keeps `'none'`: `its rules count real time, and this genre keeps no clock: they would move with the hours outside the story`
       - the result carries an additive field `timeUnmet: readonly ('story' | 'real')[]` (story first). Add it to the
         `RulesetFit` interface as optional with a 🚧 docblock ("the times its rules count on that the genre does not
         keep — a rating and a sentence, never a refusal (genres expect, never lock)").
     When `timeUnmet` is empty, or the genre declares no `keepsTime`, or the ruleset's functions declare nothing, the
     result is **exactly** what it is today (no `timeUnmet` key at all, same rating, reason, rows, unused, inWords).
     A genre with no `uses` and a declared `keepsTime` still goes through the same rule (today it rates `'great'`,
     "this genre asks for nothing in particular"; with time unmet it becomes `'poor'` with the time sentence).
   - Update the `rulesetFit` docblock with one sentence on the time rule.
4. **Core's declarations** (`core-catalog/src/`):
   - Genres (`core-catalog/src/registry/genres.ts`): `storyGenre`, `lairGenre`, `dungeonCrawlerGenre` → `keepsTime: 'story'`;
     `chatGenre`, `guideGenre` → `keepsTime: 'real'`. Put it beside `members`/`uses` or near the top of each declaration.
   - Functions that always count on the story clock: `core:function/scheduled@1` and `core:function/deadline@1`
     (`core-catalog/src/functions/time.ts`) and the obligation function in `core-catalog/src/functions/pieces.ts`
     (the one whose body reads `payloadOf(ev).clock` / `crossed(clock, due)`) → `countsTime: 'story'`. Do not touch
     `recurring` (see 3). Do not add it to any other function.
5. **Guides** (`guides/rulesets.md`, "Write a function of your own", about line 240): one short paragraph — 🚧 say
   which time a function counts on with `countsTime` (`'story'`, `'real'`, `'both'`), and that ruleset fit reads it:
   rules that count story time on a genre that runs on real time rate Poor, with the reason ("they would never move");
   a rating and a sentence, never a refusal. `guides/genres-presets-and-routines.md` near the `uses` paragraph (about
   line 114): one sentence — 🚧 say which time your genre keeps with `keepsTime` (`'story'`, `'real'` or `'none'`), and
   ruleset fit weighs the rules' `countsTime` against it. **Do not promise any value a body is handed**: nothing about
   elapsed minutes or seconds in the envelope (that part is not built). Guide code blocks are compiled by tests
   (`guideSnippets.test.ts`); if you add a code block, it must compile — prefer prose.
6. **Tests** (`sdk-tests/`): in `fit.test.ts` add tests:
   - a ruleset with a function declaring `countsTime: 'story'` rates `'poor'` with the story/real sentence and
     `timeUnmet: ['story']` on a genre `{ keepsTime: 'real' }` (with and without `uses`), and is **unchanged** (deep
     equal to the fit with `keepsTime` absent) on a genre `{ uses: …, keepsTime: 'story' }`;
   - a ruleset whose functions declare nothing rates **deep-equal** to today's result on every genre with a keepsTime
     (`'story'`, `'real'`, `'none'`), with and without `uses`;
   - `recurring` with `every: 'hour'` (and `'day'`) counts as story; with `every: 'round'` counts as nothing;
   - an `'incompatible'` rating stays incompatible with its own reason, and carries `timeUnmet`;
   - `real` unmet on a `'story'` genre gives the real-time sentence.
   For function declarations in tests, use the pattern the file or `functions.test.ts` already uses (a carried module
   on the ruleset, or `defineFunction` under a test id like `test.age:function/…@1`). In whichever test file covers
   `functionFindings`, add: `countsTime: 'sometimes'` gives `[bad-counts-time]`; `'story'`, `'real'`, `'both'` give no
   finding. A genre test: `genre(… keepsTime: 'sometimes')` throws naming `keepsTime`.
7. **Golden pins.** Run the whole SDK suite once at the end: `cd /home/jody/github/serene-pub && npm run sdk:test`.
   Adding `countsTime` to three core functions moves their hashes, and `keepsTime` on five genres may move the catalogue
   digest (`sdk-tests/coreCatalog.test.ts` about line 1064, now `'a45adb233d3e2579'`) and any other golden document. A
   pin that moves **only because of this change** is re-pinned with a dated comment in the file's existing style:
   `// Moved 2026-11-11 (sense-age, PLAN-sensible-engine §2.12): <what changed>. (was '<old>')`. Prove each move is
   ours: list in your report every pin you moved, old → new, and what moved it. If a pin moves for a reason you cannot
   tie to this change, **do not re-pin it**: report it. If anything else fails, report it with the failing test name
   and the first lines of the error; do not "fix" unrelated failures.

## Files owned (edit only these)

- `sdk/src/functions.ts`, `sdk/src/genres.ts`, `sdk/src/fit.ts`
- `core-catalog/src/registry/genres.ts`, `core-catalog/src/functions/time.ts`, `core-catalog/src/functions/pieces.ts`
- `guides/rulesets.md`, `guides/genres-presets-and-routines.md`
- `sdk-tests/fit.test.ts`, the sdk-tests file that tests `functionFindings`, the sdk-tests file that tests `genre()`
  validation, and any sdk-tests file whose golden pin moves because of this change (pin lines + their comment only).

## Files readable

Anything in both repos. Useful: `sdk/src/functions.ts` 495–600 (findings), 750–780 (`resolveFunctionRef`);
`sdk/src/fit.ts` 293–372 (`rulesetFit`); `core-catalog/src/functions/time.ts` 40–190; app
`src/lib/server/rulesets/clockHours.ts` (`usesHourlyRecurring`).

## Out of scope (do not build)

Anything a function body is handed (no envelope change, no `since`, no elapsed minutes or seconds); any app file in
`/home/jody/github/serene-pub`; `INTEGRATING.md`; `NOMENCLATURE.md` (the supervisor writes it); any other genre key,
any new export beyond what is named here; the ruleset editor; `contracts`, `controls`, `cli`, `conformance` unless a
test there fails only because of these two new keys (then stop and report it instead of editing).

## Stop and ask (in your report) when

A name beyond `countsTime`, `keepsTime`, `timeUnmet`, `bad-counts-time` seems needed; a published name would change or
be removed; a test outside your owned files fails because of this change; anything here contradicts what you find.

## Rules (quoted by the supervisor)

- CLAUDE.md, Standing rulings: "**Genres expect, never lock.** A genre states what it plays best with (fit,
  recommendations, "why" sentences); a pipeline whose shape is missing degrades in words." — this change moves a rating
  and its sentence only; it never refuses, hides or blocks.
- CLAUDE.md, P1: "Code decides what code can; the model only judges. Same inputs, same result."
- SDK CLAUDE.md: "Test: `npm run sdk:test` (the suite only) after **every** SDK edit. It pins spec hashes, golden
  documents and counts the app suite never sees; a pin that moves on purpose is re-pinned with a dated comment saying why."
- SDK CLAUDE.md: "Catalogue ids evolve **in place at `@1`** until 0.7 / SDK 1.0 — no `@2` bumps."
- `guides/stability.md`: "Anything marked 🚧, ⏳ or `@experimental` may change." Mark every new key 🚧; new interface
  members carry no new export tag (they sit on existing exports).
- NOMENCLATURE R3: "Qualify, never abbreviate to the bare noun." Never call either key bare "time" in docs or comments:
  say "which time it counts on" / "which time it keeps".
- **No reference to any other project or product** in code, comments, tests or docs.
- Every changed file: `npx prettier --check <file>` (from `/home/jody/github/serene-pub-sdk`); match the file's
  existing style (tabs, single quotes in the SDK) if it fails, but never `prettier --write` on a directory.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — **You do not run `sdk:build` at all**; the supervisor does.
- Never `git checkout` / `restore` / `stash` / `clean` in either repo (most of the SDK repo is uncommitted).
- Targeted runs: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test fit.test.ts <other files>`; then the
  full suite once: `cd /home/jody/github/serene-pub && npm run sdk:test`. Never pipe a test run into `head`.

## Done means

`fit.test.ts` and the findings/genre tests pass with the new cases (they would fail before); `npm run sdk:test` passes
with every moved pin listed and explained; each changed file passes `npx prettier --check`.

## Report (final message)

Changed files; each test run and its result; every golden pin moved (old → new, why); anything you stopped on; Noticed,
not done.
