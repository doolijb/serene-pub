# BRIEF — fix lane `time-t6b-fix` — the scope review's findings on the firsthand filter, and the second recipe

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/briefs/BRIEF-time-t6b.md` (the rule and the owner's words), `plans/REPORT-time-t6b-2026-11-15.md`,
`NOMENCLATURE.md` §14 (**firsthand**; *witness* and *attendance* are taken words).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`; never `prettier --write`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite"` (dev **and** preview; the Svelte language server's esbuild is
not one) and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`. If a server or a run is up, don't build;
report 'blocked on your dev server'.

Small lane: one worker is enough. Files owned: `src/lib/server/sessions/firsthandFilter.ts` and its tests,
`src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts`, the two bindings in
`pipelines/runtime/bindings.ts` only if fix 1 needs them, `pipelines/scripts/guideRecipes.int.test.ts`,
`pipelines/boot/registryHashes.test.ts` (re-pins), the SDK's `contracts/src/queries.ts` (the four in-ports'
JSDoc / descriptions only), `guides/genres-presets-and-routines.md`, `sdk-tests/firsthand.test.ts`,
`docs/pipelines.md` (the lane's section), `NOMENCLATURE.md` (§14 row, §25).

## Fixes

1. **A card-less character seat is one cast member's turn too.** `firsthandFilter.ts` ~185–190 turns only
   `character:<cardId>` into a member, so a seat with a name and no card (it has `currentCastMemberId`, no
   `characterId`) reads everything and its receipt falsely says *Reads everything: not one cast member's turn*.
   Find how the reply step identifies such a seat's turn (the run's input for a card-less seat; `sessions/seats.ts`
   `seatOf` and its seat keys) and resolve it to its member the same way the message store's speaker stamp does
   (`messages/store.ts` `speakerMemberOf` ~146), so the filter applies. If the reply's input cannot identify a
   card-less seat without a new published port, **stop and report**; then, as the fallback only, give that case
   its own true receipt line (🚧 *Reads everything: this seat has no cast member to filter by*) and state the
   limit in `docs/pipelines.md` and the guide. Test either way.
2. **No loop grows with the square of the session.** `wasThereFor` re-scans the scene per line (~85) and
   `keptSceneIds` calls it per line (~106); the loader matches tick scenes with `includes` per row (~257). Build
   once per viewpoint: the set of scene ids the member spoke in, and a map from line id to its tick scene ids.
   Add a test that a 5,000-line, 200-scene fixture (pure, in memory) is decided in well under a second.
3. **The place rule uses the messages clock only.** `valueInForce` (~150–166) falls back to the newest timeline
   point for every earlier message, which can drop lines said while both members were together. Remove the
   fallback: with no message-anchored value at or before the message, the value is missing and the message
   falls under the scene rule (as the brief says). Test: a later timeline move does not drop earlier lines.
4. **Words and comments.**
   - Published prose does not say *witness*: the four in-ports' JSDoc in `contracts/src/queries.ts`, the guide
     (`guides/genres-presets-and-routines.md`), the module header: say "was there for". (If a port description
     is part of a content hash, re-pin with the "(was …)" note.)
   - The module header and the binding comments state the rule, not the rulings and their dates.
   - `FirsthandLine` is exported: add it to the §25 line (or stop exporting it if nothing outside the module
     uses it).
   - `registryHashes.test.ts`: the two re-pins carry `(was "bf56f6315cb53")` / `(was "baf88f0f6b87b")` as their
     neighbours do (use the true previous values; these are the reviewer's reading, verify from the diff).
5. **The recipes test cannot skip a malformed marker.** `guideRecipes.int.test.ts` ~40 matches only
   `^```js recipe (\S+)\s*$`. Match any fence whose info string contains the word `recipe` (any language tag,
   any indentation) and fail when it does not parse as `js recipe <id>`.
6. **The second recipe (owner 2026-11-15: "the other method … should be possible via custom querying and logic,
   so we should provide a formula among our example recipes in the docs").** The first draft read the
   per-message seated set, which needs a host change and which the owner called unreliable: **dropped**. Write
   instead, in the guide's *What a character was there for* section under a subsection (🚧 *Another rule*), a
   recipe that needs **no host or SDK change**: a script step that takes the history rows and the speaking
   character and keeps a row when that character spoke it **or the row's text names the character** (its name,
   case-folded, on a word boundary), plus the person's own lines if the genre wants them (say how). First
   verify how a run-script step hands its `input` to the script and what answer shape it expects
   (`scripts/chains.ts` `makeScriptApplier`, the run-script node in `contracts`, an existing shipped script that
   filters rows); if rows cannot be filtered by a script step without a host or SDK change, **stop and report**
   what is missing. Mark the fence `js recipe <id>` and add it to the recipes test, run through the real
   applier with a fixture that proves a kept and a dropped row. State the recipe's limit in one sentence (a
   character addressed by a nickname is missed).

## Not in this lane

`host.ts`; the history window being sized before the filter; a grouped multi-member stat-trail read; the
`time-t6a` column; any shipped pipeline invoking the option.

## Done means

- If the SDK was edited: `npm run sdk:build` from the app root (after the checks above), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t6b-fix-sdk.log 2>&1"`:
  only the four known failures.
- One capped app run:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/firsthandFilter src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts src/lib/server/pipelines/scripts/guideRecipes.int.test.ts src/lib/server/pipelines/boot/registryHashes.test.ts src/lib/server/pipelines/boot/declaredReads.test.ts > plans/time-t6b-fix.log 2>&1"`
  (check no other vitest is running first): all green.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.

## Report

Your final message is the report (the lead appends it to `plans/REPORT-time-t6b-2026-11-15.md`): each fix with
file:line, the recipe's text, every new or changed name and sentence, tests with results, anything stopped on.
Under about 500 words.
