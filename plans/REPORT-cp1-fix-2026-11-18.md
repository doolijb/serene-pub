# REPORT cp1-fix — the eleven new failures of full run 20 — 2026-11-18

Saved by the lead from the supervisor's hand-back. Brief: `briefs/BRIEF-cp1-fix.md`.

Six of seven items fixed; item 3 is stopped on a missing SDK feature (two test files stay red until the owner rules: rulings page TQ1).

1. **`sessions.sendChannel` (3): expectation.** The test's genre is a made-up inlet that declares no fields; all five core genres declare the switch and the extent, so no shipped channel send fails to advance. The fixture now declares `autoAdvance` and `autoAdvanceRuns` (programme 2.3: core supplies no default). Assertions unchanged.
2. **`genreFieldDefaults` (3): expectation** (TC1 / TN4): exactly `autoAdvance: true` and `autoAdvanceRuns: "next"` added. **`host.sessionSettingsQuery` (1): a test mock**, not the settings shape: p6-12 made the host look the genre up through `listSessionGenres`, and the test mocked only `getSessionGenre`; the mock now serves both.
3. **`showcase.twenty-questions`: STOPPED, a real gap.** The plugin's source is a third repository (`/home/jody/github/serene-pub-plugin-twenty-questions`). It offered its "natural" turn strategy as a swap on Story's turn order (`core:spec/story-turn-order#decide.rules.strategy`). A plugin cannot add a turn order option to a genre it does not own: it can only write its own genres' defaults and its own presets. Missing: a way for an extension to contribute a registration to another package's genre, an install check for it, and genre-level rows owned by the plugin and removed on uninstall. The whodunit and writing-room showcase plugins use the removed names too (no app test loads them). The plugin's genre declares no Auto-advance switch (TA1).
4. **`guestEditSession` (1): expectation** (TN4): no core node offers swaps; the case publishes the test-only `swapTargetSpec` for that session and asserts the owner's cards include it; the guest, the administrator guest and the stranger still get none.
5. **`lineColumns` (1): a test error.** The fixture gave main no dates, so main was undated and draws no fork; the fixture gives main points at years 1 and 20.
6. **`frozenColumns` (2): product defects from ap-4.** `plugins/providedPrimers.ts`: the write to the frozen `lorebookBindings.description` deleted (`writeCastVersion` already writes the member's words: a second writer). `sockets/media.ts` `providedArtProblem`: reads the version's own face from `character_versions`, as `media/access.ts` does. No `ALLOWED` entry added. One new case: a media door refuses a file worn as a provided member's own face.
7. **`bootstrap.queries` (1): expectation** (p6-12): counts `loadDocument`'s single joined statement (70 joined reads = 70 loaded documents, under 83 published specs).

Tests: one locked run of 30 files: 28 pass, 2 fail (item 3's `pluginVariables.int`, `pluginDefaultConfigName.int`); 269 tests pass; `tsc` 0. The SDK was not touched.
