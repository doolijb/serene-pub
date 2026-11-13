# REPORT — lane `sense-age` — 2026-11-11

Written by the lead from the supervisor's final message.

## Headline

Built: **part 4b**, the time a function counts on, the time a genre keeps, and the ruleset fit measure.
**Stopped on the core fact** (story minutes since a value was written, real seconds, the sleep test): the briefed
derivation cannot give the right number, and a correct one needs a stored stamp — a column and a migration. That is
★A. The function envelope is unchanged, so nothing a body already receives has changed.

## Why the story minutes cannot be derived as briefed

1. **A message's clock stamp is taken when the message is written and never moves** (`db/schema.ts` ~3099–3110;
   `messages/store.ts` 87–110). A clock move is a `state_proposals` row "anchored to the message it rode with"
   (`state/clockMoves.ts` 1–35), so it lands *after* that message's stamp. In the sleep case — a clock move under
   message M, then the rules write the meter, also anchored to M — the next run with no time passed computes
   now − stamp(M), the size of the move, not 0. **Not idempotent.**
2. **The anchor is not the moment of writing.** "A change to a cast member anchors to that character's latest
   message and stays open until that character speaks again" (`state/write.ts` 48–56; `anchorFor` 700–733). A value
   written several replies later is stamped with the character's last line's clock.

No existing column records the story clock at the instant a value row was written. **Real seconds** can be derived
from `attribute_values.created_at`, with one gap: `sessions/branch.ts` 735 drops `createdAt` when copying values
into a fork.

## Open ★

- **★A — how a script learns story time since a value was written.**
  - **A1 (recommended): stamp the story clock on each value row at write.** Five nullable `story_clock_*` columns
    on `attribute_values` (the shape `session_messages` and `scenes` carry), one generated migration, stamped in
    `setValue` from `sessionStoryNowOf`, carried by every copy path (branch, rewind, retract/restore, and the other
    insert sites: `placeStats.ts`, `durable.ts`, `cardState.ts`, `sockets/lorebooks.ts`, `characters/dowry.ts`,
    `plugins/providedBooks.ts`, `sessions/convertRuleset.ts`, `lorebooks/starterKits.ts`). Old rows read null. The
    fork copy keeps `createdAt`. Then a follow-up builds the envelope fact, the opt-in real seconds and the sleep test.
  - **A2: per-move delta only.** Add `minutes` beside `hours` on the engine's copy of the clock-moved payload. No
    column, idempotent, enough for a sleep meter on clock moves, but not "since last update".
  - **A3: rebuild from samples.** Not recommended.
- **★B** Real-time rules on a story-clock genre also rate Poor (the rule was made symmetric; the brief named only
  story-on-real). Alternative: rules that count real time never lower a rating.
- **★C** The Guide and Chat now speak in fit: they show *Poor* with the story-time sentence, only for a ruleset whose
  functions count story time. Rulesets started from core's Romance, Slice of life and Workplace templates will show
  it (they use `recurring every: 'day'` and/or `obligation`).
- **★D** `recurring` with `every: 'day'` counts as story time, not only `'hour'`.

## Built (part 4b)

- `FunctionProps.countsTime?: 'story' | 'real' | 'both'` (inside the hash; finding `bad-counts-time`; also the
  real-time opt-in). `GenreDecl.keepsTime?: 'story' | 'real' | 'none'`. `RulesetFit.timeUnmet?: ('story' | 'real')[]`.
- Fit rule: when the genre declares `keepsTime` and a time is unmet, a better-than-Poor rating drops to **Poor**
  with one sentence; an Incompatible rating keeps its own reason; a ruleset whose functions declare nothing gets a
  deep-equal result to today's.
- Core: Story, the Lair and the Dungeon Crawler keep `'story'`; the Guide and Chat keep `'real'`. `scheduled`,
  `deadline` and `obligation` declare `countsTime: 'story'`; `recurring` is read by its option.
- `since` was not used for anything: it already names the `stat-trail` in-port and a history "since {date}". The
  envelope name is decided with ★A.

Files — SDK: `sdk/src/functions.ts`, `sdk/src/genres.ts`, `sdk/src/fit.ts`, `core-catalog/src/registry/genres.ts`,
`core-catalog/src/functions/time.ts`, `core-catalog/src/functions/pieces.ts`, `guides/rulesets.md`,
`guides/genres-presets-and-routines.md`, `sdk-tests/fit.test.ts`, `sdk-tests/functions.test.ts`. App:
`src/lib/server/rulesets/genreFit.ts`, `genreOffer.ts`, `genreFit.test.ts`, `docs/rulesets.md`, `NOMENCLATURE.md`.

## Inventory — every place a script reads a stat

1. The function envelope (`rulesets/functionRun.ts`, `bindingValues` 350–414, `envelopeOf` 426–453). Unchanged.
2. The older seeded-script form (`rulesets/scripts.ts`), still runs. Unchanged.
3. Pipeline scripts and templates, through the state readers (`state/resolve.ts`). Unchanged.

## Tests

SDK targeted: 108 passed. SDK full (`npm run sdk:test`, before the build): 4541 tests, 8 failed; 1 was the lane's and
passes after `sdk:build`; 7 not the lane's: `deriveDontSpell.test.ts` 206, 253; **`dev.test.ts` 142, 159 ("node
'prompt' references config of unknown node 'generate'")**; `surface.test.ts` 447; `vocabulary.test.ts` 193;
`widgetParts.test.ts` 45. `npm run sdk:build` once, exit 0. App targeted: 13 passed. No golden pin moved.

## Noticed, not done

- `sessions/branch.ts` 735 drops `createdAt` when copying values into a fork.
- `INTEGRATING.md` not updated (the envelope did not change).
