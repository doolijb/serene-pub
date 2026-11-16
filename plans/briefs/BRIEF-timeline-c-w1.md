# BRIEF — worker `timeline-c-w1` — SDK: a preset's timeline default and a genre's timeline mandate

Supervisor: lane `timeline-c` (brief `plans/briefs/BRIEF-timeline-c.md`). Report to
`plans/briefs/REPORT-timeline-c-w1.md` (write it last; if the write is refused, put the whole report in your final
message).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Two additive, optional SDK names (both 🚧, both open ★ for the owner; no `@2`, nothing renamed or removed), the
core catalogue declaring them, tests, and the guides. **You do not run `sdk:build`**: the supervisor does.

Owner rulings this builds (verbatim):
- 2026-11-13: "By default, Story Minimal will use an undated book. Messages will just display real time. All other
  Story presets will continue defaulting to timelined storybooks." Minimal on a timelined lorebook advances story
  time "as it does today".
- 2026-11-14 (plan §8 item 14, "Lets go with all your recommendations"): Chat and Guide undated like Minimal; the
  Lair and Dungeon Crawler timelined as today.
- 2026-11-14, how a preset says it expects no timeline: "preset may override the genres default, but not it's
  mandate".
- Plan §2 (ruled): "The lorebook decides whether story time moves; the preset only picks the default for a new
  session's lorebook."
- 2026-11-13: "Do not provide SDK api for this yet" — covers the lorebook's switch itself: **no pipeline, outlet or
  plugin API reads or sets a lorebook's switch.** The two names below only state defaults for a new session's
  lorebook; add nothing else.

## Build

All paths under `/home/jody/github/serene-pub-sdk`. Line numbers are approximate; re-read before editing.

1. **`sdk/src/announce.ts` — `PresetDefaults.timeline?: boolean`** (interface ~301–328). Doc comment, 🚧: whether
   a new session's lorebook starts with a timeline when the session starts on its own notes; left out = the
   genre's default (a genre that keeps story time defaults to one); a genre that requires a timeline refuses
   `false` at declaration. **Amend** the interface's doc comment (~290–300, "Every key optional and every key
   advisory…") so it says `timeline` is the exception: a genre requiring a timeline refuses `false`.
   `PresetDefaultsInput` (~522) derives from it by `Omit`, so it inherits the key; check.
   In `preset()` (~726–883):
   - `defaults.timeline` present and not a boolean → throw, sentence in the file's existing style
     (`${where}.defaults.timeline: true or false, or leave it out`).
   - `input.genre` is a genre value (not an `ExternalRef`; see `isExternalRef`) whose `timeline` is `'required'`
     and `input.defaults?.timeline === false` → throw a sentence naming **both** the preset and the genre, e.g.
     `preset 'x' sets defaults.timeline: false, but its genre '<id>' requires a timeline — leave it out, or set
     it true`. (A preset naming another package's genre by `use(…)` cannot be checked here; the host's resolver
     lets the mandate win. Say so in a one-line comment.)
   - The stored `defaults` already spreads `input.defaults`, so the key is stored verbatim; a preset that says
     nothing hashes as before. Check that stays true.
2. **`sdk/src/genres.ts` — `timeline?: 'required'`** on `GenreDecl` (~216–300, readonly, beside `keepsTime` ~237)
   and on `GenreProps` (~440–470, beside `keepsTime` ~455). Doc comment, 🚧: the genre **requires** its sessions'
   new lorebooks to start with a timeline: no preset may declare `defaults.timeline: false`. The vocabulary is the
   one `uses.dice` already has (`'required' | 'optional'`, ~255); only `'required'` exists here because the
   default is derived from `keepsTime` (`'story'` = a timeline by default; `'real'`, `'none'` or left out = none).
   Say what it is not: not a lock on a session (a session on an undated lorebook still plays; "genres expect,
   never lock"), not `keepsTime`.
   Validation in `genre()` beside the `keepsTime` check (~1196):
   - a value other than `undefined` or `'required'` → error (`${id}.timeline: 'required', or leave it out — not …`);
   - `timeline: 'required'` with `keepsTime` other than `'story'` (including left out) → error naming both.
   The frozen decl (~1203–1240): `...(props.timeline === 'required' ? { timeline: 'required' as const } : {})`,
   with the same comment the neighbours carry ("absent when unstated, so a genre that says nothing hashes as it
   did"). Check `fit.ts` and any other place that copies genre keys (grep `keepsTime` across `sdk/src`,
   `contracts`, `conformance`, `cli`, `docs`) and carry the key only where a genre's keys are copied whole.
3. **Core catalogue.**
   - `core-catalog/src/registry/genres.ts`: `lairGenre` (~1180) and `dungeonCrawlerGenre` (~1551) add
     `timeline: "required",` after `keepsTime: "story",`. Story, Chat and Guide: no change.
   - `core-catalog/src/seed/presets.ts` `storyMinimalPreset` (~55–68): add `defaults: { timeline: false },`. Its
     JSDoc (~45–53) and `description` (~60) say the clock moves each round; replace **that clause only** with
     🚧 *On a lorebook with a timeline, the clock moves on a few minutes each round.* and keep the rest. The
     description becomes: `"Just the story: one model call a turn. On a lorebook with a timeline, the clock moves
     on a few minutes each round; nothing else changes unless you change it."` Make the JSDoc say the same and
     add one line that it starts a session on its own notes undated (`defaults.timeline: false`).
   - Check `corePresetSeeds()` (~280–360) carries `defaults` to the seed verbatim (it should: `decl.defaults`).
   - grep both repos for the old sentence (`The clock moves on a few minutes each round`) and list every hit in
     your report; change hits only inside the files you own (below). Tests in the app that pin it: list them,
     don't edit.
4. **Tests** (in `/home/jody/github/serene-pub-sdk/sdk-tests/`; pick the existing file that tests each thing —
   `presets.test.ts` for `preset()`, the file that tests `genre()`'s `keepsTime` check (grep; `fit.test.ts` or
   another), `coreCatalog.test.ts` for the catalogue):
   - `genre()` refuses `timeline: 'required'` without `keepsTime: 'story'` (left out, and `'real'`); refuses
     `timeline: 'optional'`; accepts `timeline: 'required'` with `keepsTime: 'story'` and stores it; a genre that
     says nothing has no `timeline` key.
   - `preset()` refuses `defaults.timeline: false` on a required genre (the sentence names both); accepts
     `defaults.timeline: true` there and `false` on a genre that does not require one; refuses a non-boolean.
   - Catalogue: Lair and Dungeon Crawler `timeline === 'required'`; Story, Chat, Guide have none; Story Minimal's
     declaration and seed carry `defaults.timeline === false`; Living and Rule Based carry no `timeline` key.
   - **Messages show real time when unstamped**: `sdk-tests/conversationSceneMarks.test.ts` tests
     `messageStoryTime` (`core-catalog/components/shared/messages/sceneMarks.ts` ~154). If it already has a case
     where a row with no story stamp gives `null` (so `SessionMessage.svelte` ~362–367 shows the real time), cite
     the test name; if not, add that one case there, named for "a message in a session whose lorebook has no
     timeline carries no stamp and shows its real time".
   - Run, from `/home/jody/github/serene-pub-sdk/sdk-tests`, only these files:
     `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx tsx --test presets.test.ts presetsAsChanges.test.ts coreCatalog.test.ts coreGenreDefaults.test.ts catalogueParity.test.ts fit.test.ts conversationSceneMarks.test.ts announce.test.ts <the genre test file> > /home/jody/github/serene-pub/plans/timeline-c-w1-tests.log 2>&1"`
     Then `cd /home/jody/github/serene-pub-sdk/sdk-tests && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`
     A hash pin in these files that moves because the Lair, Dungeon Crawler or Story Minimal changed: re-pin it and
     list it (old → new). Any other failure: report it, don't "fix" unrelated code.
5. **Docs (SDK)**: `guides/genres-presets-and-routines.md` — beside the `keepsTime` paragraph (~135) one short
   paragraph on `timeline: 'required'` and the derived default; in the Presets section (~394) one short paragraph
   on `defaults.timeline`. `INTEGRATING.md`: grep for where genres' `keepsTime` and presets' `defaults` are
   described (~981 mentions `PresetDefaults.envoys`); add one sentence there only if such a place exists; say in
   the report what you found. Plain words; no other product's name; "session", never "chat" (except chat-
   completions wire vocabulary).

## Files owned (edit only these)

`sdk/src/announce.ts`, `sdk/src/genres.ts`, `core-catalog/src/registry/genres.ts` (two lines),
`core-catalog/src/seed/presets.ts` (Story Minimal only), `sdk-tests/presets.test.ts`, `sdk-tests/coreCatalog.test.ts`,
the genre test file you pick, `sdk-tests/conversationSceneMarks.test.ts` (one case, only if missing), hash pins in
the test files listed under 4, `guides/genres-presets-and-routines.md`, `INTEGRATING.md` (one sentence at most).

## Files readable

Anything in both repos.

## Out of scope — never built

Anything that reads or sets a lorebook's switch from a pipeline, outlet, plugin or widget; `sdk/src/widgets.ts`;
the Chronicle; changing `keepsTime`'s meaning or `rulesetFit`; any app file; `sdk:build`.
A peer session owns the SDK `surfaces` and `testing` packages: don't touch them.

## Stop and ask (in your report, then stop) when

A third SDK name seems needed; a change outside Files owned seems needed; a test outside your list fails because of
your change in a way you can't re-pin; anything a user sees beyond the sentences named here.

## Rules (quoted from CLAUDE.md and the lane brief)

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You don't build in this task at all.)
- "Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted." Never `prettier --write` a directory or glob. Never `kill -9`.
- "Removing or renaming a published SDK name is the owner's call." Add only the two names above.
- NOMENCLATURE R3: "Qualify, never abbreviate to the bare noun." The two keys are as the lead named them
  (`PresetDefaults.timeline`, `GenreDecl.timeline`); in prose always say "a preset's timeline default" and "a
  genre's timeline mandate", never bare "timeline" for them. Mark every new name and sentence 🚧.
- "Comments state the rule, not the story (a ratchet test counts phrases such as "no longer")."
- Never write "no lorebook": a session always has one; say "a session whose lorebook is its own notes".
- No other product's name in any file.
- Decide implementation inside this scope and name each choice in your report; anything a user sees or that
  outlives the change beyond what is written here is a question, not a decision.

## Report

Changed files; each test file run with pass/fail counts; hash pins moved (old → new); the old-sentence grep hits;
every name and sentence added (🚧); what you found in `INTEGRATING.md`; Noticed, not done.
