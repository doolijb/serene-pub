# BRIEF — `sense-age-w2` — app: ruleset fit hears which time a genre keeps

You are a `lane-worker` under supervisor `sense-age`. Work only in `/home/jody/github/serene-pub`. Return your report as
your final message (no report file).

## What already landed (SDK, built — do not edit the SDK)

- `FunctionProps.countsTime?: 'story' | 'real' | 'both'` — which time a function counts on (core's `scheduled`,
  `deadline` and `obligation` functions say `'story'`; core's `recurring` with `every: 'hour' | 'day'` is read as story).
- `GenreDecl.keepsTime?: 'story' | 'real' | 'none'` — which time a genre keeps. Core: Story, the Lair, the Dungeon
  Crawler `'story'`; the Guide and Chat `'real'`.
- `rulesetFit(genre: Pick<GenreDecl, 'uses' | 'keepsTime'>, ruleset)`: when the genre declares `keepsTime` and the
  ruleset's functions count on a time it does not keep, the rating is lowered to `'poor'` (an `'incompatible'` stays),
  the reason becomes one sentence (e.g. `its rules count story time, and this genre runs on real time: they would never
  move`), and the result carries `timeUnmet: ('story' | 'real')[]`. Otherwise the result is exactly as before, with no
  `timeUnmet` key. A genre with no `uses` but a `keepsTime` rates `'great'` ("this genre asks for nothing in
  particular") unless time is unmet.

## Goal

1. `src/lib/server/rulesets/genreFit.ts`:
   - `FitRatingGenre.decl` gains `keepsTime?: 'story' | 'real' | 'none'`.
   - `fitRatingGenres` also keeps a genre that declares `keepsTime` (beside `uses` / `rulesets.only`).
   - `rulesetFitByGenre`: the `only` branch and the `uses` branch stay exactly as they are (the `uses` branch already
     gets the time rule from `rulesetFit`, since `decl` carries `keepsTime`). **New branch**, after them: a genre with
     no `uses` (and not refused by `only`) but a `keepsTime` speaks **only when** `rulesetFit(decl, ruleset).timeUnmet`
     is non-empty — then it pushes `{ genreId, genreName, rating, reason }` like the `uses` branch (with `inWords` only
     if present). Otherwise it says nothing, as today. So the Guide and Chat stay silent for every ruleset whose
     functions declare nothing, and say *Poor — its rules count story time, …* for one that counts story time.
   - Update the module docblock / the function's docblock in one sentence each.
2. `src/lib/server/rulesets/genreOffer.ts`: only if the type needs it, add `keepsTime?: 'story' | 'real' | 'none'` to
   `GenreRulesDecl` (the caller passes the whole registered genre, `sockets/sessions.ts` about 2565, so `rulesetFit`
   already sees it). No behaviour change there: the Rules card still rates only for a genre with `uses`.
3. Tests in `src/lib/server/rulesets/genreFit.test.ts` (keep every existing test passing unchanged):
   - a ruleset whose function counts story time (use core's `core:function/scheduled@1` in a sections ruleset
     `{ id, name, functions: [{ ref: 'core:function/scheduled@1', key: 'festival', options: { at: { year: 1, month: 1, day: 3 } } }] }`
     — read how the existing tests build rulesets and genres, and check `scheduled`'s form in
     `../serene-pub-sdk/core-catalog/src/functions/time.ts` about 120–150 for the option shape; or a carried module
     `{ ref, key, module: { …, countsTime: 'story' } }` if that is simpler — whichever the SDK's `resolveFunctionRef`
     accepts) rates `'poor'` on Chat (`keepsTime: 'real'`, no `uses`) with the story-time sentence, and on Story
     (`keepsTime: 'story'`) rates exactly what `rulesetFit` gave before the time rule — assert it equals the rating of
     the same genre with `keepsTime` removed (`{ ...storyGenre, keepsTime: undefined }`);
   - a ruleset whose functions declare nothing (Freeform, Vis Itineris): Chat and the Guide say nothing (the existing
     "says nothing for a genre with no uses (Chat)" test must still pass), Story's rating and reason are unchanged
     (equal to the `keepsTime`-removed genre's);
   - `fitRatingGenres`-style filter: if `genreFit.int.test.ts` covers `fitRatingGenres`, add one assertion there that
     the Guide/Chat now appear in the list (they declare `keepsTime`) — only if that file already tests the list;
     otherwise skip it and say so.
4. `docs/rulesets.md`:
   - **## Time** (about line 127): add one short paragraph after the first: rules can say they count story time (a
     curse at midnight, an hourly poison) or real time; a genre that runs on real time, such as the Guide or Chat,
     keeps no story clock, so rules that count story time would never move there — **Genre fit** rates them *Poor* and
     says so. Rules that count real time rate *Poor* on a genre that keeps a story clock. A rating and a sentence; it
     never stops you choosing them.
   - In the **Genre fit** sentence (about line 137, "**Genre fit** says how each genre that rates rules …"): add that
     the Guide and Chat, which rate nothing else, speak up only for rules that count story time (link `#time`).
   Member-facing copy: plain words, no code names (`countsTime`, `keepsTime` never appear in `docs/`). It is a
   **session**, never a *chat* — Chat with a capital C is the genre's name and is fine.

## Files owned (edit only these)

`src/lib/server/rulesets/genreFit.ts`, `src/lib/server/rulesets/genreOffer.ts`,
`src/lib/server/rulesets/genreFit.test.ts`, `src/lib/server/rulesets/genreFit.int.test.ts` (one assertion, only as
said), `docs/rulesets.md`.

## Out of scope

The SDK repo (read only); any client/UI file; `NOMENCLATURE.md`; anything a function body is handed; any other doc.

## Stop and ask (in your report) when

A new name seems needed; a test outside your files fails because of this change; the SDK's behaviour differs from
what is described above (say exactly how).

## Rules (quoted by the supervisor)

- CLAUDE.md: "**Genres expect, never lock.** A genre states what it plays best with (fit, recommendations, "why"
  sentences); a pipeline whose shape is missing degrades in words." — a rating and a sentence only; nothing is hidden,
  refused or blocked.
- docs rule from the brief: "An existing ruleset that declares nothing rates exactly as it does today."
- "It is a **session**, never a *chat* — except in chat-completions wire vocabulary." Every session has a lorebook:
  never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs.
- Run only your targeted tests, capped:
  `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/rulesets/genreFit.test.ts src/lib/server/rulesets/genreFit.int.test.ts"`
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- `npx prettier --check <file>` on each changed file; if a file already failed before your change, match its style
  and say so rather than reformatting it. Never `prettier --write` on a directory.
- Do not start a dev server. Do not run `sdk:build`.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `git checkout` / `restore` / `stash` in either repo.

## Done means

The new tests in `genreFit.test.ts` pass (and would fail before this change); every existing test in the two files
still passes; `npx tsc --noEmit -p .` shows no new error in your files (filter its output to them; do not fix others).

## Report (final message)

Changed files; tests run and results; prettier results; anything stopped on; Noticed, not done.
