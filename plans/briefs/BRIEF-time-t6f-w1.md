# BRIEF — worker `time-t6f-w1` (SDK half of lane time-t6f)

Supervisor: lane `time-t6f`. SDK repo `/home/jody/github/serene-pub-sdk` (edit it there). App repo
`/home/jody/github/serene-pub`. Report path: your final message (the supervisor reads it). Keep it under
~400 words: changed files with line ranges, every node key you added, the exact new strings, anything you could
not do.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**For this brief: do not run `sdk:build`, `sdk:test`, vitest or any test at all.** The supervisor builds and runs the
SDK tests after you report (the SDK tests import the built `dist`, so they cannot see your edit before then). Never
`git checkout / restore / stash` in either repo. Never `prettier --write`. Never `kill -9`. Comments state the
rule, not the story (no dates-and-lane histories in new comments). No other product's name in any file.

## Owner rulings, 2026-11-15 (in his words)

- Should Story and the Lair use the knowledge filter on a character's own turn: "Yes. It should be cheap enough, i think."
- A pipeline-check warning when a History filter is on and its output is not connected: "Yes".
- A scene compiled into History with no messages left: "Stored cast list, when messages are outside the context
  window, we won't be querying them anyway. Scenes/history are what persist."

## Goal

### A. Story and the Lair place `core:query/unknown-entries@1` (`C.unknownEntries`) on a character's own turn

The node already exists (`contracts/src/queries.ts` ~1237–1310, `@experimental`). Do **not** change it, its ports, its
failure behaviour or its JSDoc. No new SDK name, no setting, no preset switch, no `expose` label (a label is new
copy). Nothing else in either spec changes.

1. **Story reply** — `core-catalog/src/genres/story/respond.ts`. In the `gather` parallel block (~547–757), add one
   chain after `presences` (~754), same shape as its siblings:
   ```ts
   .chain('unknownEntries', (c) =>
       c.query('read', ($) => C.unknownEntries.v1({ scope: $.input.sessionScope, speaker: $.input.speaker })),
   )
   ```
   with a short JSDoc stating the rule (the entries this speaker does not know, for `eligible`; a turn with no cast
   member as speaker reads everything). Then in the `retrieval` junction's **`on`** branch `eligible` (~1003–1015)
   append `$.gather.unknownEntries.read.exclusions` to `exclusions`, after the three lore lanes'. The `off` branch
   is untouched.
2. **Lair delver voice** — `core-catalog/src/genres/lair/reply.ts` `voiceBranch` (~378–490). Add, after the
   `lore` query (~411–419):
   ```ts
   .query('unknownEntries', ($) =>
       C.unknownEntries.v1({
           scope: $.input.sessionScope,
           speaker: $.via.turn.channel.story.pick.picked.context.speaker,
       }),
   )
   ```
   with a one-line JSDoc stating the rule, and append
   `$.via.turn.channel.story.pick.picked.unknownEntries.exclusions` to that branch's `eligible` `exclusions`
   (~469–475), after the existing three.
3. **Not wired, by design** (do not touch): the Lair spine `eligible` (~1201, the Castellan's ranker, no speaker);
   story `narrate.ts`, `look.ts` (the narrator), `narrateCharacter.ts` (a side character, not a cast member);
   lair `castellanAction.ts`, `buildRoom.ts`, `fileRoom.ts`, `roomAnswer.ts` (Castellan / room drafts read
   everything). Not the Dungeon Crawler, Chat or Guide.
4. Check the `C` import already covers `unknownEntries` in both files (it is `import * as C` or a named import —
   follow the file).
5. Grep `sdk-tests/` for tests that pin `story-respond` / `lair-reply` node keys, node counts, edge counts or the
   eligibility exclusions list (e.g. `coreCatalog.test.ts`, `lair.test.ts`, `docsGraph.test.ts`,
   `streamingStep.test.ts`, `conformance.test.ts`). Where one pins a list/count that this change moves, update it
   and add a `(was …)` note beside the changed value. List each in your report; if unsure whether one moves,
   list it as "may move" instead of guessing.

### B. `validate()` warns on an unconnected History filter

`sdk/src/validate.ts`, inside the existing block `── firsthand (opt-in, 2026-11-15) — the reads agree ──`
(~1319–1365; it defines `wiredFor`). Add, under the same law `'firsthand 2026-11-15'`, severity `'warning'`: for each
node of `core:query/history-entries` v1 for which `wiredFor(n)` is true and whose `exclusions` out-port reaches no
`core:task/eligibility` node, push:

- `message`: `` `'${n.key}' leaves out the history entries the speaker was not there for, but its exclusions reach no eligibility check, so nothing is left out` ``
- `fix`: `` `wire $.${n.key}.exclusions into the eligibility check's exclusions, beside the lore reads'` ``

"Reaches" is exactly the test the `entry knowledge 2026-11-15` case below it uses (~1376–1383): an edge with
`from === n.key`, `fromPort === 'exclusions'`, `toPort.split('.')[0] === 'exclusions'`, to a node whose
`definitionId === 'core:task/eligibility'`. Keep the comment above the block accurate (one added sentence).

**Test** — `sdk-tests/firsthand.test.ts`, beside the existing firsthand tests: a new `describe` with (1) entries
node with `firsthandFor` wired and no eligibility → exactly this warning, exact message and fix; (2) same with its
`exclusions` wired into a `C.eligibility.v1({ … exclusions: [ … ] })` → no such finding; (3) `firsthandFor` not
wired, exclusions unconnected → no such finding. ⚠ The existing tests in that file that wire `firsthandFor` on the
entries node without an eligibility (e.g. "entries filtered, history not", "all three fed", ~118–150) will now get
this second finding under the same law. Fix them by wiring the entries node's `exclusions` into an eligibility
node in the fixture builder when entries are fed (preferred: the assertions stay as they are), not by loosening
assertions. Read the `warned`/`Has` helpers first.

### C. SDK docs for the stored-cast rule (and A)

The app's rule after this lane (built by another worker): a scene whose lines are **all** gone from the live
history (deleted, hidden or rewound — "no live lines") and that is not open is the member's when the member is in
the scene's stored cast (`scene_characters`, role `participant`); otherwise it is not. This applies to the scene-
summary rule and so to the History-entry rule. A scene with live lines is judged as before. One grouped read, only
when such a scene exists.

1. `guides/genres-presets-and-routines.md` § *What a character was there for* (~428–450): in rule 3 add one
   sentence for the no-live-lines case; replace the limit "A compiled scene whose messages were all deleted counts as
   one the character was there for." with one stating the new rule (judged by its stored cast — the scene's
   participants — so a character the cast list leaves out misses it, and one it names has it). Plain short
   sentences like the surrounding text.
2. `INTEGRATING.md` §1p (~1535–1575): in the firsthand bullet, after "a scene summary is kept when the member was
   there for the scene's last message or more than half of it;" add the no-live-lines sentence. In the
   unknown-entries bullet replace "No shipped pipeline places it." with a sentence saying Story's reply and the
   Lair's delver voice place it on a character's own turn (the narrator's, the Castellan's and room drafts' steps
   do not).

Do not touch the `unknown-entries` limits in the guide or anything else in INTEGRATING.

## Files owned

`core-catalog/src/genres/story/respond.ts`, `core-catalog/src/genres/lair/reply.ts`, `sdk/src/validate.ts` (the one
case), `sdk-tests/firsthand.test.ts`, any `sdk-tests/*.test.ts` that pins the two specs' shape (step 5),
`guides/genres-presets-and-routines.md` (the two places named), `INTEGRATING.md` §1p (the two sentences).

## Files readable

Anything in either repo.

## Out of scope

The node's definition and failure behaviour; any other spec; contracts; the app; any new name, setting or migration.

## Stop and ask when

A spec has no eligibility step to wire into; a speaker in the Lair voice branch is not a single cast member's
participant ref; anything needs a new name (other than the node keys above and the two strings in B), a setting,
or a change outside the files owned. Stop and say so in your report instead of improvising.

## Done means

The edits above, `npx prettier --check` on each changed file (report the result; do not fix unrelated drift), no
tests run. Report: changed files with line ranges, the tests you re-pinned (with old/new), anything "may move".
