# BRIEF — worker `wt-1b-w1` (SDK): the `speakerInCast` param on two reads, its docs and tests, then `sdk:build`

Supervisor: lane `wt-1b` (brief `plans/briefs/BRIEF-wt-1.md`, its last section rules). You are a `lane-worker`.
SDK repo `/home/jody/github/serene-pub-sdk` (edit it there). App repo `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: both repos are staged by the lead. Run **no git command that changes the index or the working tree** (no add, reset, checkout, restore, stash, commit). Never `git checkout / restore / stash` in the SDK repo. Never `prettier --write`. No `pkill -f` on generic patterns.

## Goal

Add ONE on-by-default read param, 🚧 **`speakerInCast`** (name provisional, ★ for the owner), to
`core:query/earlier-scenes@1` and `core:query/history-entries@1`, in the manner of `knownToSpeaker`
(read `contracts/src/queries.ts` ~1060–1090: boolean, `default: true`, the **last** field of `params.schema`,
with `label` and one-sentence `description`). The app (another worker) implements what it does. You declare it,
document it, test the declaration, and build.

What the param does (for your doc comments and docs; the app implements it):
- The speaker is the character the run speaks as (the scope's `currentCharacterId` → that card's seat's cast
  member; else `currentCastMemberId` for a card-less seat). A run that speaks as nobody (a narrator's turn, a
  routine, an envoy, a step writing for several characters) or a card in no seat reads everything.
- `earlier-scenes@1`: only the scenes whose **stored cast** (the scene's cast list, `scene_characters`, role
  participant) lists the speaker are returned. An open scene is kept; a scene whose cast was never worked out
  (no stored cast at all) is kept.
- `history-entries@1` (a compiled day): if the speaker is in the stored cast of **every** scene of this session
  compiled into that day, the day's own text, as today. If it misses **any**, the day's text is replaced by the
  **summaries of the scenes whose cast lists it**, in story order, under the day's date, never longer than the
  day's own text (oldest summaries dropped first); a day it is in none of (or whose kept scenes have no summary)
  is left out, published on `exclusions` like other left-out entries. A day with none of this session's scenes
  (written by hand, or by another session) is untouched (only `knownToSpeaker` governs it). Scenes other sessions
  on a shared lorebook compiled into a fully attended day are not judged.
- Today's stored cast is what the param reads: senders, the roster (seated characters not benched, every player
  seat) and names in lines. Who a scene lists is the scene compiler's answer, a separate later change; the param
  only ever asks the stored cast.
- `false` turns it off for that node. The switch is set in `params` (`params: slot.params()` + `.defaults((d) =>
  d.params('<key>', { speakerInCast: false }))`, a preset, a genre registration), never top-level config — same as
  `knownToSpeaker` (INTEGRATING.md §1p ~1613).
- `session-history@1` is NOT given the param (the transcript in the window is not filtered).
- It stands **beside** firsthand (`firsthandFor` / `firsthandBy`), which stays exactly as it is.

Label (★): `{ en: 'Only scenes the speaker was in' }`.
Descriptions (★), plain strings like `knownToSpeaker`'s, typographic apostrophe `’` as there:
- earlier-scenes: `'Leaves out the earlier scenes whose cast does not list the speaking character (an open scene, and one whose cast was never worked out, are kept), and does nothing on a turn no single character speaks, such as the narrator’s.'`
- history-entries: `'Shows a day the speaking character missed part of as the summaries of the scenes whose cast lists it, leaves out a day it was in none of, and does nothing on a turn no single character speaks, such as the narrator’s.'`

## Files owned (only these)

- `serene-pub-sdk/contracts/src/queries.ts` — only: the `earlierScenes` and `historyEntries` definitions and their doc
  blocks; a new small slots helper for history beside `loreSlots`; ⏳ markers in the doc comments of the
  `firsthandFor` / `firsthandBy` ports on all three queries (session-history's: **comments only**).
- `serene-pub-sdk/guides/genres-presets-and-routines.md` — the firsthand section (~399–455) and the
  `knownToSpeaker` section (~504–525) only.
- `serene-pub-sdk/INTEGRATING.md` — §1p (~1550–1625) and §1n (~1468–1506) only. Re-read it right before editing;
  small targeted edits (another lane may touch other sections).
- `serene-pub-sdk/sdk-tests/speakerInCast.test.ts` (new), and re-pins in existing `sdk-tests/*.test.ts` that pin
  these two definitions' params or hashes (write "(was …)" beside any re-pinned hash).
- Running `npm run sdk:build` from the **app root**.

## Files readable

Everything. Start with: `contracts/src/queries.ts` 1060–1272 and 1474–1556; `sdk-tests/knownToSpeaker.test.ts`
(your model test); `sdk-tests/firsthand.test.ts`; the guide 395–530; INTEGRATING 1468–1625.

## How to build it

1. `historyEntries`: world-lore and character-lore must stay **byte-identical** (their registry hashes must not
   move). Do not change `loreSlots`; add e.g. `historySlots(band, defaults)` that returns `loreSlots(...)` with
   `speakerInCast` appended as the last field of `params.schema` (after `knownToSpeaker`). Check the TS types still
   satisfy what the app's `bindings.retrieval.ts` (`LANE_READS`, `SharedInput`) expects (intersection typing:
   adding a field only to history is fine).
2. `earlierScenes`: append the field after `share`.
3. Doc blocks: on each query's doc comment, one short paragraph saying what the param does (above). On the
   `firsthandFor` / `firsthandBy` port doc comments of all three queries add `⏳ transitional:` + one sentence:
   *superseded for scenes and days by the `speakerInCast` param; kept because a pipeline of a user's own may wire
   it.* Change no other text, no port, no type. Firsthand stays exactly as it is.
4. Guide: keep line ~401's firsthand paragraph and the sentence "A character that missed one scene of a day loses
   that day's entry…" (they stay true for firsthand); mark the firsthand section ⏳ transitional in its first
   sentence; add a short section beside it on `speakerInCast` (what each read does, the two kept cases, the
   compiler/query split: *who a scene lists is the scene compiler's answer, stored once as the scene's cast; the
   reads only ask the stored cast, so a genre or plugin that compiles a cast differently changes what the reads
   see without touching them*; that today's stored cast lists senders, the roster and names in lines; how to
   switch it off, the `params` way, as the `knownToSpeaker` example does). If you add a code fence, keep it a plain
   fence (not `js recipe …`): recipe fences are run by an app test.
5. INTEGRATING.md §1p: a new bullet **What a character's scenes are: the `speakerInCast` param** (🚧), in the
   manner of the `knownToSpeaker` bullet: the two reads, the speaker, what each read does, the two kept cases, the
   two assumptions (a fully attended day keeps its whole text including other sessions' scenes; a replaced day is
   never longer than the day's own text, oldest summaries dropped first), how to switch it off, that the app
   implements it in one module (`sessions/speakerInCast.ts`, named by the app worker; write that name), and that
   firsthand is ⏳. Mark the firsthand bullet ⏳ in one word. §1n: one sentence that earlier scenes are filtered by
   the param.
6. Tests: new `sdk-tests/speakerInCast.test.ts`: on both definitions the param exists, is a boolean, defaults
   `true`, is the last field of `params.schema`, has the label; world-lore and character-lore do NOT declare it;
   session-history does NOT declare it. Then find existing SDK tests that pin these definitions (grep
   `sdk-tests` for `earlier-scenes`, `history-entries`, `historyEntries`, `earlierScenes`, `knownToSpeaker`,
   registry hash pins) and re-pin with "(was …)".
7. Build: from `/home/jody/github/serene-pub` run, in order:
   - `pgrep -af "vite" | grep -v esbuild` — if a serene-pub `vite dev` / preview server is up, do not build; report.
   - `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`
   - `npm run sdk:build > plans/wt-1b-w1-build.log 2>&1` and check it succeeded.
   - Then write the flag file `plans/wt-1b-sdk-built.done` (one line: the time). Another worker waits on it.
8. Targeted SDK tests only, capped, after the same vitest wait, from the SDK root:
   `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > /home/jody/github/serene-pub/plans/wt-1b-w1-<n>.log 2>&1"`
   (always at least one path; never the whole suite; never pipe vitest into `head`). Find how SDK tests are run
   (`package.json` of the SDK root's `sdk:test` script in the app, or the SDK's vitest config) and use the same
   config with explicit paths.
9. `npx prettier --check` on each file you changed; report (don't fix files you didn't change).

## Rules quoted for this work

- CLAUDE.md: *"Removing or renaming a published SDK name is the owner's call."* — remove/rename nothing.
- NOMENCLATURE R1: *"One word, one meaning."* — *attendance* is taken (the Who's here widget), *presence* names a
  cast presence, *firsthand* is the spoke-based rule; don't use any of them for this param in prose — say "in the
  scene's cast" / "the scenes whose cast lists it".
- NOMENCLATURE R6: *"⏳ Transitional — real today, expires on a known event. 🚧 Provisional — designed but not
  built, so the words may still move."*
- CLAUDE.md: *"It is a **session**, never a *chat*."*

## Out of scope

The app (bindings, the function, docs in `serene-pub/docs`, NOMENCLATURE.md): the other worker / supervisor.
`session-history@1`'s schema; `validate.ts`; any core-catalog spec edit (the default applies without edits:
verify by reading `core-catalog/src/genres/story/respond.ts` ~584–636 that the two nodes pass `params:
slot.params(...)`; report if not); `loreSlots` itself; any other definition.

## Stop and ask (in your report, do not decide) when

A published name would be removed or renamed; world-lore's or character-lore's or session-history's hash moves;
a type change would ripple beyond these two definitions; anything needs a new name other than `speakerInCast`
(and an internal helper like `historySlots`).

## Done means

`sdk:build` succeeded and the flag file is written; `sdk-tests/speakerInCast.test.ts` and every re-pinned SDK test
green; prettier --check clean on your files.

## Report

Your final message: changed files; the exact field text as declared; which hashes moved (old → new) and that
world-lore / character-lore / session-history did not; tests run with results and log paths; anything not done.
