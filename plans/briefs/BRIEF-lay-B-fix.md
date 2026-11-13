# BRIEF lay-B-fix — five follow-ups from lay-B's scope review (lead-supervised worker)

You are a lane-worker. Read `plans/briefs/BRIEF-lay-common.md` (rules; they apply to you) and `plans/REPORT-lay-B-2026-11-05.md` (what lay-B built). SDK = /home/jody/github/serene-pub-sdk.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."
Do NOT run sdk:build (the lead builds after you).

Owner ruling R10 (2026-11-05): "don't have most widgets show placeholder text when there's nothing to show. Messages being an obvious exception". Principle P1: every automatic outcome shows its cause. Lead's reading for this fix: a widget AT REST with nothing to show draws nothing; but a line that states a CAUSE the reader can act on, or answers something the reader just did, is not a placeholder.

## Items
1. **Restore cause lines** (exact original copy) — Annex "Pick a key in settings"; Scene Portraits "Nobody picked yet. Name who to show in this widget's settings." and "Nobody in this session goes by the names picked in this widget's settings."; Stats "Nothing in this session matches the names in this widget's settings."; Places "None of this book's places is in {categories}."; Lore entries "Nothing matches." (only after a search/filter the reader set — not at rest). Files: `core-catalog/components/shared/{annex,scene-portraits,stats,places,lore-entries}/*Widget.svelte` and their `core-catalog/src/shared/ui/**` view helpers if the strings live there. Restore any `*.empty` part these lines used, under the same part name.
2. **Inside views the reader opened** (Stats change history, the Stats face picker): restore "Reading the changes…", "No changes in this session yet.", "Finding pictures…". Do NOT restore the widget-at-rest loading lines (Stats main read, Places, Author's note).
3. **Alias scheme**: the D8 aliases repeat the prefix. Rename every alias token so the owner prefix is not repeated: `composer.composer-<x>` → `composer.<x>`; `turn-line.turn-line-<x>` → `turn-line.<x>`; keep `turn-line.next-up-<x>` as is (a distinct piece). Leave every `messages.*` token untouched (they are the ⏳ names existing styles use). If a stripped name collides with an existing alias on a different element (e.g. `composer.compose` vs `composer.compose-area`), keep the longer one unstripped and list it. Files: `core-catalog/components/shared/messages/{SessionComposer,TurnLine,NextCharacterBlock}.svelte`, `components/shared/composer/**`, `components/shared/turn-line/**`; update the tests that assert alias tokens (grep sdk-tests for `composer.composer-` and `turn-line.turn-line-`). Output the final alias list (old → new) in your report.
4. **Lair GM layout**: title its Left `stats` panel "Party" (`core-catalog/src/registry/layouts.ts` ≈:237/:252 — add `stats: { title: "Party" }` to that layout's widgetSettings). Regenerate `sdk-tests/goldens/core-session-layouts.json` only if a test compares it (check sessionLayout.test.ts ≈:697 / coreShippedLayouts.test.ts).
5. **Proposal list alias**: `StateProposalList` drawn by TurnLine (`TurnLine.svelte` ≈:174,184) gets `turn-line.*` alias tokens via a prop (only when the Turn line draws it; the log's copy unchanged).

## Files owned
The files named above, their sdk-tests, the golden. Nothing else.

## Done means
`cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test coreComposerComponent.test.ts coreTurnLineComponent.test.ts coreConversationComponent.test.ts coreAnnex.test.ts coreScenePortraits.test.ts coreStateWidgets.test.ts coreStatsKinds.test.ts corePlaces.test.ts coreShippedLayouts.test.ts lair.test.ts sessionLayout.test.ts` green (plus any test you changed), and `npx tsc --noEmit` in sdk-tests clean on your files. Your final message is your report: changed files, the alias list, tests + results, anything not done.
