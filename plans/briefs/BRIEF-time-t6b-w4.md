# BRIEF — worker `time-t6b-w4`: the SDK guide section, the alternative-method recipe, and one app test that runs every marked recipe fence

Supervisor: lane `time-t6b` (report to it). Repos: `/home/jody/github/serene-pub-sdk` (the SDK: guides) and
`/home/jody/github/serene-pub` (the app: the test). Never `git checkout`, `git restore` or `git stash` in either.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. **Never `prettier --write`.**

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (**You do not run `sdk:build`**: guides are markdown.)

Never `kill -9`. Another session shares this checkout; worker w3 is editing `pipelines/runtime/bindings.ts` at the
same time: touch only the files under Files owned. It is a **session**, never a *chat*. Never write the phrase "no
lorebook". **No other product's name** in any file. Plain words, short sentences, as the existing guides read.

## What exists (built today, read it)

`core:query/session-history@1` and `core:query/earlier-scenes@1` declare two optional in-ports (read their comments in
`/home/jody/github/serene-pub-sdk/contracts/src/queries.ts`, grep `firsthand`): 🚧 `firsthandFor` (wired
`$.input.characterId`) and 🚧 `firsthandBy` (a cast-level stat's name, a literal). The host filters
(`src/lib/server/sessions/firsthandFilter.ts` in the app; read its header for the rule). `validate()` warns when a
spec wires `firsthandFor` on one of the two nodes and not the other (`sdk/src/validate.ts`, grep `firsthand`). The
receipt notes (exact): `‹n› messages left out: ‹name› was not there` (`1 message …`), `No messages left out for
‹name›`, `‹n› scene summaries left out: ‹name› was not there` (`1 scene summary …`), `No scene summaries left out for
‹name›`, the suffix ` (‹stat› is not tracked here, so by scene only)`, and `Reads everything: not one cast member's
turn`. No shipped pipeline wires the option.

The rule, as the owner ruled it (quote in the guide in plain words, not as quotes):
1. By scene: a scene is witnessed by a member that spoke at least once in it (hidden, rewound and swiped-away lines
   do not count). Its own lines are always kept. Messages in no scene are kept. The open scene is witnessed by the
   speaker.
2. By place, when `firsthandBy` names a cast-level stat: a message is witnessed when the member's value of that stat
   in force at that message equals the message speaker's value in force at it (references by entry, words trimmed
   and case-folded). A message whose speaker has no value falls under rule 1. Where both values exist, rule 2
   decides.
3. Scene summaries (`earlier-scenes@1`): kept for a member that witnessed the scene's last message or more than half
   of its messages; else left out.
4. A narrator's turn, an envoy's, and a step writing for several characters read everything.
5. The run's receipt says how many messages and summaries were left out, and why.
Known limits (state each): a scene that never closes is witnessed whole by anyone who spoke once in it unless a stat
narrows it; a genre that runs no scenes gets rule 2 only; History entries compiled from scenes are not filtered yet;
a summary is never cut in two; Bench plays no part (a benched member who spoke is still there); the history read is
sized before the filter, so a character that missed much reads fewer lines than the window could hold.

## Build

### 1. Guide section (SDK) — `guides/genres-presets-and-routines.md`

A new `## What a character was there for` section after `## A turn, end to end` (~381–398). Contents:
- What the option does and that it is opt-in per node; the rule (1–5) and the limits above; that it shapes one
  character's prompt only and never hides a message from a person.
- One wiring example: a `ts nocheck <reason>` fence showing Story-like `C.sessionHistory.v1({ …, firsthandFor:
  $.input.characterId })` and `C.earlierScenes.v1({ …, firsthandFor: $.input.characterId })`, and a second line with
  `firsthandBy: 'location'` as the by-place variant (say the stat must be one the genre keeps on cast members;
  today only the Dungeon Crawler keeps a location on cast members and its story turn is its Narrator's).
- The `validate()` warning in one sentence.
- `### Another rule: who was seated when each line was written` — the recipe: presence by the genre's own rule
  through custom logic, here the per-message set of seats in play stored on each row
  (`session_messages.firsthand_cast_member_ids`, read on a history row as `firsthandCastMemberIds`; NULL = not
  recorded, kept). It is a **Transform data** script (`core:script:data/transform@1`) pasted in **Admin › Scripts**
  and run by a **Run a script** step (`core:task/run-script@1`) the spec places between the history read and what
  reads its rows. Show the step as a `ts nocheck <reason>` fence (`C.runScript.v1({ input: { rows:
  $.gather.history.read.messages, speaker: $.input.characterId } })`: **verify** in
  `../serene-pub-sdk/sdk/src/executor.ts` `resolveInput` (~1241) that a reference nested inside an object literal is
  resolved; if it is not, stop and report) and the script as a fence whose info string is exactly
  ```` ```js recipe seated-when-written ````. The script: find the speaker's cast member from a row the speaker wrote
  (`characterId === speaker`), keep that member's own rows, rows with no record, and rows whose set includes it;
  return the rows unchanged when the speaker has no cast member or has not spoken. Say its limits (summaries are not
  filtered by it; Bench does count here, since the set is "every seat in play, not benched"; rows written before the
  set was recorded are kept). Keep it short.

**Verify the row keys** the script reads (`characterId`, `castMemberId`, `firsthandCastMemberIds`) against what
the host's `session_messages` read returns (`src/lib/server/pipelines/runtime/host.ts` ~3970–4200: a drizzle
`select()` over `schema.sessionMessages`) and against what reaches a script (the sandbox's JSON hand-off,
`src/lib/server/pipelines/scripts/chains.ts`, `makeScriptApplier`).

### 2. Mark the existing recipe (SDK) — `guides/time.md`

Change the one recipe fence at ~222 from ```` ```js ```` to ```` ```js recipe living-recall ````. Nothing else.

### 3. One app test runs every marked fence

Replace `src/lib/server/pipelines/scripts/livingRecallRecipe.int.test.ts` with
`src/lib/server/pipelines/scripts/guideRecipes.int.test.ts` (delete the old file once the new one passes; keep both of
its cases). The new test:
- reads every `../serene-pub-sdk/guides/*.md` (path resolved as the old test does, from `import.meta.url`), finds
  every fence whose info string starts `js recipe `, and takes its id;
- holds an explicit map `id → runner` (`living-recall`, `seated-when-written`); fails, naming them, on a marked id
  the map does not know, on a known id no guide carries, and on an id that appears twice;
- runs each fence's exact text through the real script applier, as the old test does (`makeScriptApplier`, a
  registry row for the script kind, a `pipeline_scripts` row): `living-recall` on the rescore site (the old cases);
  `seated-when-written` on the run-script site (`definitionId: 'core:task/run-script@1'`, slot `scripts`, phase
  `after`, port `main`, accepts `core:script:data/transform@1`) with rows shaped as the host returns them: the
  speaker's own row kept; a row whose set lacks the member left out; a row with a null set kept; no row by the
  speaker → rows unchanged; a non-number speaker → rows unchanged.
- Its header says: `ts` and `playground` fences are covered by the SDK's `sdk-tests/guideSnippets.test.ts` and
  `sdk-tests/guides.test.ts`; marked `js recipe <id>` fences are covered here. (The guides have no contributor note
  to put this in; say so in your report.)

Then confirm the SDK's guide suites still pass with the new section and the new info strings:

    cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx tsx --test guides.test.ts guideSnippets.test.ts > /home/jody/github/serene-pub/plans/time-t6b-w4-sdk.log 2>&1"

App tests only in this capped form, from the app root, **strictly one vitest run at a time across everyone**: first
check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if any line shows (the lead or worker w3 may be
running one), wait (`timeout 900 bash -c 'while ps -eo args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 20; done'`)
and check again.

    systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/scripts/guideRecipes.int.test.ts > plans/time-t6b-w4.log 2>&1"

Never pipe vitest into `head`.

## Files owned

- `/home/jody/github/serene-pub-sdk/guides/genres-presets-and-routines.md` (the new section only)
- `/home/jody/github/serene-pub-sdk/guides/time.md` (the one fence info string only)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/scripts/guideRecipes.int.test.ts` (new)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/scripts/livingRecallRecipe.int.test.ts` (delete, after)

## Out of scope

`docs/*.md` in the app and `NOMENCLATURE.md` (the supervisor writes those); any shipped pipeline; bindings; host;
the column, its writer, migration 0165; a setting.

## Stop and ask (stop, and write it in your report; do not choose) when

- a nested reference in a step's config is not resolved (the recipe's wiring would not work as shown);
- the rows a script receives do not carry the keys the recipe needs;
- a name other than the recipe id `seated-when-written`, the section and subsection headings above seems needed.

## Report

Your final message: files changed (line ranges), the section's text (paste it), test results per run, what you
verified about nested references and row keys (file:line), anything noticed and not done.
