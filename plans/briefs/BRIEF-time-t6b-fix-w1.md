# BRIEF — worker `time-t6b-fix-w1` — six fixes to the firsthand filter, and a second docs recipe

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: lane `time-t6b-fix`. Report back in your final message
(under about 600 words): each fix with file:line, every sentence you added or changed, tests run with results,
anything you stopped on.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

More standing rules: never `prettier --write`; never `kill -9`; never pipe vitest into `head`; another session
shares this checkout, so touch **only** the files listed below; no GPU, model server or dev instance; no other
product's name in any repo file; it is a **session**, never a *chat*; never write "no lorebook". Comments state
the rule, never the rulings and their dates. Read files by line range.

## Files owned (the only files you may edit)

App (`/home/jody/github/serene-pub`):
- `src/lib/server/sessions/firsthandFilter.ts`, `firsthandFilter.test.ts`, `firsthandFilter.int.test.ts`
- `src/lib/server/pipelines/runtime/bindings.ts` — **only** the two firsthand blocks: session-history ~2578–2625
  and earlier-scenes ~8740–8768
- `src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts`
- `src/lib/server/pipelines/scripts/guideRecipes.int.test.ts`
- `src/lib/server/pipelines/boot/registryHashes.test.ts` — only the two lines 784 and 1856 (and their comments)
- `docs/pipelines.md` — only the section `## What a character was there for` (~344–356)
- `NOMENCLATURE.md` — only the §14 **firsthand** row (~955) and a new §25 line after ~4289

SDK (`/home/jody/github/serene-pub-sdk`):
- `contracts/src/queries.ts` — JSDoc comments only of the four in-ports `firsthandFor` / `firsthandBy` on
  `sessionHistory` (~305–350) and `earlierScenes` (~1460–1480), and the `earlierScenes` header line ~1421–1422.
  Never change code, a port's shape, or any other comment.
- `guides/genres-presets-and-routines.md` — only the section `## What a character was there for` (~399–438)
- `sdk-tests/firsthand.test.ts` (only if a change above needs it)

Readable: anything. Not owned, do not edit: `host.ts`, `sdk/src/validate.ts`, `state/statTrail.ts`,
`sessions/seats.ts`, `messages/store.ts`, `scripts/chains.ts`, any other doc.

## Background (verified by the supervisor)

- The rule (owner 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a
  character does not know"; 2026-11-15: "a mixture of per scene, per location (when available)"; "we can assume
  if a cast member responded at all within a scene's messages that they were present. We can filter and qualify
  further depending on their location"). Bench plays no part. A narrator's / envoy's turn reads everything.
- Vocabulary (NOMENCLATURE §14): the word is **firsthand**; the prose phrase is **was there for**. *witness* is a
  taken word (`witnessMessage`), *attendance* too. Never use either in prose you write.
- The run's session scope for a **card-less character seat's** turn is built in `pipelines/runtime/runTurn.ts`
  ~1839 and ~1965: `sessionScope = { sessionId, currentCharacterId: null, currentCastMemberId: <member> }`.
  `currentCastMemberId` is set **only** on such a turn (the seat was resolved with `seatOf`, card-less). The
  inlet's `characterId` is null on it. Both firsthand bindings already receive that scope as `input.scope`
  (wired `scope: $.input.sessionScope`). So fix 1 needs no port change.
- A script step (`core:task/run-script@1`, SDK `contracts/src/tasks.ts` ~4946) passes its `input` (S.json) to
  `main`; the attached `core:script:data/transform@1` scripts (SDK `sdk/src/scripts.ts` ~262: ports
  `in: { value }`, `out: { value }`) each get it as the global `value` and `return` the new value
  (`scripts/chains.ts` `makeScriptApplier` ~188, subject = the type's first in-port). A spec hands it an object
  literal, as Story does: `C.runScript.v1({ input: { modes: $.reading.modes, … } as any, params: … })`
  (`core-catalog/src/genres/story/respond.ts` ~1056). History rows (`host.ts` `toMessage` ~12975) carry `id`,
  `role`, `content`, `characterId`, `personaId`, `castMemberId` (only when stamped). The session cast
  (`core:query/session-cast@1`, `main`) has `sessionCharacters[]` with `character.{id,name}` and `castMemberId`
  (a card-less seat's `character` has a `name` and no `id`).

## The fixes

1. **A card-less character seat is one cast member's turn too.** `loadFirsthandView` (~185–190) turns only a
   card id into a member. Add an option `castMemberId?: unknown` to `loadFirsthandView`'s `opts`: when
   `characterId` is not a positive safe integer and `castMemberId` is one, that is the member (no `seatOf` call).
   Both bindings pass `castMemberId: input?.scope?.currentCastMemberId`. Keep everything else as is (a null
   `firsthandFor` on a narrator turn, whose scope has no `currentCastMemberId`, still reads everything).
   Tests: int (loader) — a card-less seat (a `session_characters` row with `characterId` null and a
   `castMemberId`) whose member never spoke in a closed scene gets that scene's lines left out; binding test —
   session-history with `firsthandFor: null` and `scope: { sessionId, currentCastMemberId }` filters and logs
   `… left out: ‹name› was not there` (name as `membersAsRead(...).shownName`), not *Reads everything*.
2. **No loop grows with the square of the session.** Today `wasThereFor` re-scans the scene per line (~85),
   `keptSceneIds` calls it per line (~106), the loader matches tick scenes with `includes` per row (~257), and
   `placeAt` → `valueInForce` scans the whole trail per call. Do this:
   - Extract the pure assembly from the loader into one exported pure function `firsthandViewOf(...)` (inputs:
     member id, name, slot id, slot tracked, the scene rows `{ id, channel, opened, closed, selected }`, the line
     rows `{ id, channel, castMemberId }`, and the trails by member). `loadFirsthandView` = the reads + that call.
   - In it, build once: a map from line id to its tick scene ids (one pass over the ticks' `selected`), the
     range scene per line without `ranges.find` per row (e.g. ranges per lane sorted by `opened`, then a merge
     or binary search), and a new view field `spokeInSceneIds: Set<number>` (scenes holding a live line of the
     member). `wasThereFor` reads that set instead of scanning `sceneLines`.
   - Index each member's trail once (message points sorted by anchor, null anchor first, ties keep array order)
     and answer `placeAt` by binary search. `valueInForce(points, messageId)` stays exported with the same
     answer as the indexed path.
   - Test (pure, in memory, in `firsthandFilter.test.ts`): 5,000 lines across 200 closed range scenes plus
     some tick scenes, two or three members, a slot with a trail of ~1,000 points per member; `firsthandViewOf`
     + `keptLineIds` over all 5,000 + `keptSceneIds` over all 200 complete in **under 1,000 ms**
     (`performance.now()`); also assert a couple of exact answers so the test is not vacuous.
   - Update the unit tests' `viewOf` helper for the new field (or build views through `firsthandViewOf`).
3. **The place rule uses the messages clock only.** `valueInForce` (~150–166) falls back to the newest
   timeline point. Remove the fallback: ignore `layer: "timeline"` points; with no session-layer point anchored
   at or before the message (a null anchor counts as before every message), the value is missing (null), and
   rule 1 decides. Also have the loader call `statTrailFor` with `mode: "messages"` instead of `"both"` (same
   `tracked` answer, no timeline read). Update the `valueInForce` unit test (timeline-only → null; timeline
   points never win), and add an int or binding test: a member's timeline value that differs from the speaker's,
   set later, does not drop lines said while both shared a session value. Report the new statement counts the
   binding test's "none when not invoked; a few when invoked" measures.
4. **Words and comments.**
   - Replace *witness / witnessed / witnesses* with "was there for" phrasing in: the module header and the
     `wasThereFor` doc comment of `firsthandFilter.ts`; the queries.ts JSDoc listed above (~313, 319, 322, 324,
     1422, 1463, 1466); the guide section (~420–428). Also in the test names of `firsthandFilter.test.ts` /
     `.int.test.ts` and the two binding comments.
   - The module header (~1–37) and the two binding comments (~2578–2585, ~8740–8743) state the rule only:
     drop the quoted rulings and their dates (`owner 2026-11-14…`, `★6`, `2026-11-15`).
   - In `registryHashes.test.ts` the two re-pins carry the previous value as their neighbours do:
     line 784 → `… // 2026-11-15 time-t6b: firsthandFor/firsthandBy in-ports added (was "bf56f6315cb53")`;
     line 1856 → `… (was "baf88f0f6b87b")` (verified from `git diff`). If your JSDoc edits move either hash (they
     should not: JSDoc is not part of the definition object), re-pin with the "(was …)" of the current value and
     say so.
5. **The recipes test cannot skip a malformed marker.** `guideRecipes.int.test.ts` ~39 matches only
   `^```js recipe (\S+)\s*$`. Instead: any line that, after leading whitespace, opens a fence (three or more
   backticks or tildes) whose info string contains the word `recipe` (`/\brecipe\b/`) is a recipe marker; it must
   parse exactly as `js recipe <id>` (no indentation, three backticks) or the scan **throws** naming the file,
   line and text. Close on the matching fence. Add a pure test of the scanner over an inline markdown string:
   `ts recipe x`, `   ```js recipe x`, `~~~js recipe x`, `` ```js recipe `` (no id) and `` ```js recipe a b `` all
   throw; `` ```js recipe ok `` parses. (Make the scanner take `(file, text)` so it is testable.)
6. **The second recipe.** In the guide section, after the Limits list and before the `validate()` sentence, add
   a subsection, and in the recipes test a runner for it. Text (adjust only if a test proves a line wrong, and
   report any change):

   ````markdown
   ### 🚧 Another rule

   A genre can keep its own rule instead, with a script and no option. This one keeps a history row when the speaking character said it, or when the row's text names that character (its name, whole word, any case). The person's lines are kept too while `KEEP_PERSON_LINES` is `true`; set it to `false` to judge them by the same rule.

   Put a script step between the history read and the prompt, and hand it the rows, the cast and the session scope:

   ```ts nocheck a fragment: a script step that narrows the history read
   .query('cast', ($) => C.sessionCast.v1({ scope: $.input.sessionScope }))
   .query('history', ($) => C.sessionHistory.v1({ scope: $.input.sessionScope }))
   .task('heard', ($) =>
   	C.runScript.v1({
   		input: { rows: $.history.messages, cast: $.cast.main, scope: $.input.sessionScope } as any,
   	}),
   )
   // the prompt's transcript then reads $.heard.main where it read $.history.messages
   ```

   Paste this in **Admin › Scripts** (type **Transform data**) and add it to that step's scripts:

   ```js recipe spoke-or-named
   // Keep a row the speaking character said, or one whose text names it.
   const KEEP_PERSON_LINES = true

   const { rows, cast, scope } = value
   if (!Array.isArray(rows)) return rows
   const seat = (cast?.sessionCharacters ?? []).find((s) =>
   	scope?.currentCharacterId != null
   		? s.character?.id === scope.currentCharacterId
   		: scope?.currentCastMemberId != null && s.castMemberId === scope.currentCastMemberId,
   )
   if (!seat) return rows // not one character's turn: keep everything

   const name = String(seat.character?.name ?? '').trim()
   const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
   const names = name ? new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu') : null

   return rows.filter(
   	(r) =>
   		(seat.castMemberId != null && r.castMemberId === seat.castMemberId) ||
   		(seat.character?.id != null && r.characterId === seat.character.id) ||
   		(KEEP_PERSON_LINES && r.role === 'user') ||
   		(names !== null && names.test(String(r.content ?? ''))),
   )
   ```

   It misses a character addressed by a nickname or a title, and it never reads scene summaries.
   ````

   Runner `"spoke-or-named"` in `guideRecipes.int.test.ts`: register `core:script:data/transform@1` in
   `pipelineDefinitionRegistry` (kind `script`, transport `node`, status `live`, ports
   `{ in: { value: {} }, out: { value: {} } }`, semantics `transform`) beside the existing one; register the
   script row with that type, `varsIn: ["value"]`, `varsOut: ["value"]`; run it through `makeScriptApplier`
   with a site for `core:task/run-script@1` (slot `scripts`, port `main`, phase `after`,
   accepts `["core:script:data/transform@1"]`). Fixture: cast with a seat `Mira` (card id 7, member 70) and
   one `Bram`; rows: Mira's own line (by `characterId`), a card-less-stamped line (by `castMemberId`), a line
   "Where is mira?" (kept: names her, any case), a line "Miranda left" (dropped: not a whole word), Bram's
   unrelated line (dropped), a person's line `role: 'user'` (kept). Assert the kept ids exactly, and that a
   scope with neither id returns the rows unchanged. If the sandbox rejects `\p{…}` or the `u` flag, stop and
   report (do not rewrite the rule silently).

   Then, in the guide's section and `docs/pipelines.md`, keep the statements true:
   - Guide: after the code fragment add one sentence: *A character seat with no card is read from the session
     scope, so wire `scope` as shown.* In rule 2 add: *Only values set in the session count; a value known only
     from the lorebook's timeline counts as missing.*
   - `docs/pipelines.md` section: in **By place** add *Only places set during this session count.*; after the
     narrator bullet add a bullet *A character seat with no card is filtered the same way.*; at the end of the
     section add: *A genre can keep its own rule instead, with a script; the SDK guide has one that keeps what
     the character said or was named in.*
   - `NOMENCLATURE.md` §14 **firsthand** row: after "where either value is missing, the scene rule decides"
     add "; only values set in the session count, a timeline value counts as missing"; after "(@experimental;
     unwired = unchanged;" add " a card-less seat's turn is read from the session scope's `currentCastMemberId`;".
     Replace "Half BUILT 2026-11-15 (lane time-t6b; …)" only if it says *witness* (it does not; leave it).
   - `NOMENCLATURE.md` §25: a new line after the time-t6b line (~4289):
     `- **2026-11-15 (lane time-t6b-fix — scope review of time-t6b; owner 2026-11-15 "provide a formula among our example recipes in the docs"; 🚧 provisional).** `sessions/firsthandFilter.ts` also exports `FirsthandLine` (a live line: id and speaker's member) and *new* `firsthandViewOf` (the pure assembly the loader calls); the view gains `spokeInSceneIds`; `loadFirsthandView` takes `castMemberId` (a card-less seat's turn, from the session scope). Rule 2 reads the messages clock only (no timeline fallback). Recipe id *new* `spoke-or-named` (guide subsection 🚧 *Another rule*). Prose says "was there for", never *witness* (taken).`

## Done means

Run only these, in this capped form, one vitest run at a time — first check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` is empty (wait if not):

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/firsthandFilter src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts src/lib/server/pipelines/scripts/guideRecipes.int.test.ts src/lib/server/pipelines/boot/registryHashes.test.ts src/lib/server/pipelines/boot/declaredReads.test.ts > plans/time-t6b-fix.log 2>&1"
```

All green. Then `npx prettier --check` on each app file you edited (report, do not `--write`). Do **not** run
`sdk:build`, `sdk:test`, `tsc` or `npm run check`; the supervisor does. Delete the
`/tmp/serene-pub-vitest-*` dirs your runs made, by name (list them before and after).
