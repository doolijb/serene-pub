# BRIEF — worker `wt-1b-w2` (app): `speakerInCast` — the new function, the two bindings, receipts, the fixture world, docs

Supervisor: lane `wt-1b` (brief `plans/briefs/BRIEF-wt-1.md`, its last section rules). You are a `lane-worker`.
App repo `/home/jody/github/serene-pub`; SDK `/home/jody/github/serene-pub-sdk` (read only for you: another
worker, `wt-1b-w1`, is adding the param there and running `sdk:build`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: both repos are staged by the lead. Run **no git command that changes the index or the working tree** (no
add, reset, checkout, restore, stash, commit). Never `prettier --write`. **You do not run `sdk:build`.** No full
app test run, no `npm run build`, **no migration**, no `pkill -f` on generic patterns. Inside
`db.transaction(async (tx) => …)` use only `tx`. Never add a top-level `await` to `db/index.ts`.

## Ordering with the SDK worker

Write the new module (step 1) and its pure unit test first. **Before you edit the bindings, run any vitest, or run
`tsc`, wait for the SDK build:** `until [ -f /home/jody/github/serene-pub/plans/wt-1b-sdk-built.done ]; do sleep 15; done`.

## Tests: always this way

`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done` first, then from the app root:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/wt-1b-w2-<n>.log 2>&1"`
— always at least one path, one run at a time, never pipe vitest into `head`. An int test that opens a DB inside an
`it` needs a 60 s timeout. `tsc`: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`

## Goal

The SDK declares 🚧 `speakerInCast` (boolean, default `true`, last field of `params`; label *Only scenes the speaker
was in*) on `core:query/earlier-scenes@1` and `core:query/history-entries@1`. You make it do this, for the speaker
of the turn:

- **Speaker**: exactly as `knownToSpeaker` and firsthand resolve it with no wired speaker: the scope's
  `currentCharacterId` → `seatOf(db, sessionId, "character:<id>")` → its `castMemberId`; else the scope's
  `currentCastMemberId` (a card-less seat). No speaker (narrator's turn, routine, envoy, several characters) or a
  card in no seat → **reads everything**, receipt line `readsAllReceipt()` from `sessions/firsthandFilter.ts`
  (import and reuse it; do not edit that file).
- **In a scene's cast** = a `scene_characters` row for that scene with `bindingId` = the speaker's cast member id
  and `role = 'participant'`. A scene is **kept** for the speaker when it is in its cast, OR it is open
  (`openedAtMessageId` set, `closedAtMessageId` null), OR its cast was never worked out (`scenes.cast_resolved_at`
  IS NULL — check the schema column name). This is today's stored cast (senders ∪ roster ∪ names in lines); do not
  touch how it is written.
- **`earlier-scenes@1`**: of what `earlierScenesOf` returns, keep only the kept scenes. Receipt line (★):
  *No scene summaries left out: ‹name› is in the cast of every one* / *1 scene summary left out: ‹name› is not in
  its cast* / *‹n› scene summaries left out: ‹name› is not in their cast*.
- **`history-entries@1`**: a day = a History entry with ≥ 1 scene of **this session** compiled into it
  (`scenes.history_entry_id`). For each such day among the lane's results:
  - every one of those scenes kept → unchanged (the whole text, including scenes other sessions compiled in: not
    judged);
  - some not kept → the lane's own copy (in `main` and `hits`: the candidate with `source: "history"`, `id` = entry
    id; its text is `payload.content`, its size `tokens`) gets `payload.content` replaced by the kept scenes'
    summaries (`summaryStatus = 'done'`, trimmed, non-blank) in story order (by where each scene starts:
    `sceneStartOf` in `scenes/historyEntryOfDate.ts`, ties by id), joined by a blank line, no names or headings;
    `tokens` recounted with `ctx.countTokens`; **never longer than the day's own `tokens`**: drop the oldest
    summaries first until it fits (newest kept). Everything else on the candidate (date fields, signals, ids)
    stays, so it renders under the day's date;
  - none kept, or no kept scene has a usable summary, or nothing fits → the day is published on `exclusions`
    (`{ source: "history", id, reason }`), which blocks every copy at eligibility;
  - a partly missed day that is **not** among the lane's own results (another mechanism may still bring it, in
    full) → also published on `exclusions`, so its whole text never comes in by the side door.
  - a day with none of this session's scenes → untouched.
  Receipt line (★): *History for ‹name›: ‹a› shown as the scenes ‹name› was in, ‹b› left out* (with natural
  singular/plural: *1 day* / *‹n› days*), or *No history entries changed for ‹name›*. Exclusion reasons (★):
  *‹name› is in the cast of none of this history entry's scenes.* and, for a partly missed day the scan did not
  return, *‹name› missed some of this history entry's scenes.*
- `false` → the read does exactly what it does today, no receipt line.
- Firsthand (`firsthandFor` wired) keeps working exactly as today; when both apply, firsthand runs first and the
  param after, on what is left.
- `session-history@1`: untouched.

## Files owned (only these)

- **new** `src/lib/server/sessions/speakerInCast.ts` — the function behind the param (name 🚧 ★). Shape, like
  `firsthandFilter.ts`: a pure core + one read-only loader on the plain `db`:
  `loadSpeakerInCast(db, { sessionId, characterId, castMemberId, sceneIds? , historyEntries?: boolean })` →
  `{ kind: "reads-all" } | { kind: "speaker"; memberId; name; ... }` (name via `membersAsRead(...).shownName`, as
  firsthand does); pure `keptScenesInCast(view, sceneIds)` → `{ keptIds, leftOut }`;
  pure `historyDaysInCast(view)` → per entry id `{ kind: "whole" } | { kind: "scenes"; summaries: string[] } | { kind: "none" }`;
  the receipt and reason sentences as exported functions. A few grouped queries, never one per scene. Doc comment
  in the manner of `firsthandFilter.ts`'s header: the rule, what it owns, what it does not (who a scene lists is the
  scene compiler's answer; firsthand is a separate ⏳ rule). You may reuse helpers exported by `firsthandFilter.ts`,
  `earlierScenes.ts`, `historyEntryOfDate.ts`; **do not edit those files**.
- `src/lib/server/pipelines/runtime/bindings.outlets.ts` — the `core:query/earlier-scenes@1` handler only (~232–282),
  including adding `"speakerInCast"` to its declared `params`.
- `src/lib/server/pipelines/runtime/bindings.retrieval.ts` — the `core:query/history-entries@1` handler (~762–822)
  and `HISTORY_LANE_READS` (~335) only (add `"speakerInCast"` to its params; `LANE_READS` stays: it is the three
  lanes' intersection).
- Tests (new): `src/lib/server/sessions/speakerInCast.test.ts` (pure), `src/lib/server/pipelines/runtime/bindings.speakerInCast.int.test.ts`
  (each read, each case: in every scene; missed one; in none; open scene; unresolved cast; a hand-written day; a
  day with another session's scene; narrator turn; card-less seat; param off; firsthand wired beside it; the
  replacement text and the cut (newest kept); receipts and reasons), and **one fixture world**
  `src/lib/server/pipelines/runtime/speakerInCast.reply.int.test.ts` (below).
- Re-pins only where the declaration moved them: `src/lib/server/pipelines/boot/registryHashes.test.ts` (write
  "(was …)" beside each moved hash; exactly the two reads should move), `boot/declaredReads.test.ts`,
  `boot/specHashes.test.ts`, receipts tests — only if they fail because of this param.
- Docs: `docs/summarization.md` (who a scene lists today; what a character who missed a scene reads),
  `docs/lorebook-cast.md` (one short paragraph near "What a session reads"/"Lore only one character knows"),
  `docs/context-templates.md` (§ *Earlier in the story* ~396 and where history is described),
  `docs/pipelines.md` (beside **What a character was there for** ~346: a short section for the param; mark the
  firsthand section ⏳ in one sentence and keep its text). Re-read `docs/pipelines.md` right before editing; small
  targeted edits (another lane edits other parts of it).

## The fixture world (`speakerInCast.reply.int.test.ts`)

Model it on `src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts` (real reply road, `runReply` →
shipped `story-respond`, only the model faked, prompt kept; its `beforeAll` sets up the text connection). Also read
`bindings.firsthand.int.test.ts` (scenes, stored cast, compiled history entries) and
`knownToSpeaker.defaultsOff.int.test.ts` (how to turn a read's param `false` through Story respond's preset row).
One world: Mira (speaker, seated) and Bren (seated); scene A (cast Mira + Bren) and scene B (cast Bren only), both
closed, summaries done, compiled into one History entry (the day) whose own text differs from both summaries; plus
one earlier, closed, uncompiled scene C (cast Bren only) with a done summary whose lines have left the prompt (find
what makes Assemble show it: its first line must be older than the first line the prompt keeps). Make sure the day
reaches the prompt (read how history entries are retrieved; pinned is fine if that is how). Two replies as Mira:
param **off** (both reads `false`) and param **on** (default). Assert: off → the day's own text and C's summary are in
the prompt; on → A's summary is where the day's text was, B's summary and C's summary are absent, and nothing else
differs (compare with a `firstDifference`-style check: the only differences are the day block and the earlier
scenes block). Pin both prompts' sha256 as constants in the test, with a comment, and log them (`console.info`).
Also: a narrator turn (no `characterId`) with the param on gives the "off" content.

## Both existing prompt baselines must stay byte-identical

`pipelines/runtime/unknownEntries.reply.int.test.ts` and `sockets/sessions.lairUnknownEntries.int.test.ts`. "Before"
(recorded by the supervisor, `plans/wt-1b-shas-before.txt`):
- story baseline `7be63a35b29178c73aa424981205a5d0ecfbede6d7b1450a05e34c457616e7c5`; c `c76f308b…`; d `8fb15ce7…`; e `7be63a35…`
- lair baseline `cb880fdda079607b4f5b3db4e10fb82f09a0e61f23dcd1de5db68251d26be593`; c `cf9badf5…`; d `7a95f0ef…`; e `cb880fdd…`
After your bindings change, run both files once with
`--setenv=KN2_SHA_LOG=/home/jody/github/serene-pub/plans/wt-1b-shas-after.txt` added to `systemd-run` (env passes
through the scope that way), and diff against the before file. **Any change is a stop**: report it, do not re-pin.

## Rules quoted for this work

- NOMENCLATURE R1 *"One word, one meaning."*: *attendance* is taken (the Who's here widget); *presence* names a cast
  presence; *firsthand* is the spoke-based rule; *was there* is firsthand's phrase. In code comments, receipts and
  docs say "in the scene's cast" / "the scenes whose cast lists it".
- R6: mark new names 🚧, firsthand's mentions you add ⏳.
- CLAUDE.md: *"A new automatic behaviour … every automatic action shows its cause"* → the receipt lines.
- CLAUDE.md: *"It is a **session**, never a *chat*."*
- STYLE-GUIDE copy rules: plain sentences, no jargon in docs.
- Owner 2026-11-14: *"Build that query behavior as part of the core tooling, so someone can code a different
  strategy instead"*; 2026-11-15: *"Stored cast list, when messages are outside the context window, we won't be
  querying them anyway. Scenes/history are what persist."*
- Docs must say: today's stored cast lists senders, the roster (seated characters not benched; every player seat)
  and anyone named in a speech tag or spoken to; who a scene lists is the scene compiler's answer and a separate,
  later change. And the two assumptions: a fully attended day keeps its whole text, including scenes other sessions
  on a shared lorebook compiled into it; a replaced day is never longer than the day's own text, oldest summaries
  dropped first.
- Limits to state in the docs (honestly, as the firsthand section does): a copy of a replaced day found by search
  by meaning still carries the day's whole text (open question for the owner); the triggers read (narration,
  **Look**) is not covered; keyword chains followed from a day's text are not re-judged.

## Out of scope (never built here)

`utils/sceneCastProposal.ts`, `utils/sceneCast.ts`, `scenes/liveScenes.ts` (who a scene lists);
`sessions/firsthandFilter.ts` and anything firsthand does; `session-history@1`; `ranking/eligibility.ts`;
`pipelines/config/panel/*`; `sessions/settingsForm.ts`, `pipelines/entities/prompts.ts`,
`pipelines/config/panel/choices.ts` (another lane's); `NOMENCLATURE.md` (the supervisor writes it); the SDK.

## Stop and ask (in your report) when

A baseline sha changes; a migration seems needed; a shipped pipeline breaks when the speaker is in no scene of a day;
any new name beyond `speakerInCast.ts`'s exports; a registry hash other than the two reads' moves.

## Also report

How many scenes can have no stored cast (`cast_resolved_at` NULL) in practice: list every writer of `scenes` rows
that leaves it NULL (grep), in one line each.

## Done means

All new tests green; both baselines byte-identical (show the diff of the sha files); re-pinned tests green;
`tsc` 0; `npx prettier --check` clean on files you changed.

## Report

Final message: changed files; the exported names; receipts/reasons as built; the fixture world's two shas and the
exact replaced text; baseline before/after; tests run with results and log paths; the NULL-cast writers;
Noticed, not done.
