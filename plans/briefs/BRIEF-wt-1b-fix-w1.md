# BRIEF — worker `wt-1b-fix-w1` — the speaker-in-cast judgement moves into the host's lore read (fixes 1–4)

Supervisor: lane `wt-1b-fix` (`plans/briefs/BRIEF-wt-1b-fix.md`). App repo `/home/jody/github/serene-pub`.
Background, read first: `plans/REPORT-wt-1b-2026-11-17.md` (what lane `wt-1b` built and its gaps),
`plans/REPORT-tl-4-2026-11-16.md` §3 (one filter in the host's lore read covered every path for the timeline rule:
the model to copy), `plans/REPORT-kn-2a-2026-11-16.md` (the `knownToSpeaker` block in the host read; the speaker
resolved once; the per-run `lorebookReads` memo).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No `sdk:build` is expected in this task: you edit no SDK file.)

Both repos are staged by the lead: run **no git command that changes the index or the working tree** (no add,
reset, checkout, restore, stash, commit). `git diff` / `git status` are fine. **Never `prettier --write`.**
No migration. No full test run, no `npm run build`.

## Goal

Today a history day is judged and replaced only on the history lane (`bindings.retrieval.ts` `historyInCast`,
~420–520). Search by meaning (its hit text comes from the `lorebook_entries` read, `bindings.retrieval.ts`
~1281–1295 `readiedOf`), the triggers read (Story's side-character turn, Look, narration), entity search and
keyword chains all see the day's whole text. Move the judgement and the replacement **once into the host's
`lorebook_entries` read** (`pipelines/runtime/host.read.lorebookEntries.ts`, beside the `knownToSpeaker` block
~863–912), so every path that reads lore reads the judged day; make the cut keep the start of the day; keep a scene
resolved with an empty cast; make it cost nothing in a world with no scenes; load the stored casts once per run.

## Files owned (edit only these)

- `src/lib/server/sessions/speakerInCast.ts`, `src/lib/server/sessions/speakerInCast.test.ts`
- `src/lib/server/pipelines/runtime/host.read.lorebookEntries.ts`
- `src/lib/server/pipelines/runtime/host.ts`: **only** one new `case "speaker_in_cast"` beside `case "lorebook_entries"` (~2495). Nothing else in that file.
- `src/lib/server/pipelines/runtime/bindingTypes.ts`: **only** the new `HostTable` member `"speaker_in_cast"` with a one-line 🚧 doc comment.
- `src/lib/server/pipelines/runtime/bindings.retrieval.ts`: the history lane (`HISTORY_LANE_READS`, `historyEntriesRead`, `historyInCast`) and `loreFor`'s query to the host / its receipt lines. Nothing else.
- `src/lib/server/pipelines/runtime/bindings.outlets.ts`: **only** the `core:query/earlier-scenes@1` handler (~229–312).
- `src/lib/server/pipelines/runtime/speakerInCast.reply.int.test.ts` (the fixture world)
- `src/lib/server/pipelines/runtime/bindings.speakerInCast.int.test.ts`
- Re-pins **only if a targeted run shows they fail because of this change**: `bindings.firsthand.int.test.ts`, `earlierScenesQuery.int.test.ts`, and any test that enumerates `HostTable` members. Name each in your report with old → new.

## Files readable

Everything. In particular `host.helpers.ts` (`loreVisibilitySubject`, `NO_SUCH_CHARACTER`, `toLoreEntry`),
`lorebooks/entryKnowledge.ts` (`noteKnowledgeDrop` / `knowledgeDropOf` / `knowledgeDropReceipt`: the pattern for
noting a drop on the returned rows and logging it from a lane), `sessions/firsthandFilter.ts` (`readsAllReceipt`),
`scenes/earlierScenes.ts`, `historyTimelineOff.int.test.ts` and `bindings.entryKnowledge.reads.int.test.ts` (how
earlier lanes tested vector search, entity search and triggers against the host read),
`sockets/sessions.lairUnknownEntries.int.test.ts` and `runtime/unknownEntries.reply.int.test.ts` (the two
baselines: **run them, never edit them**).

## Out of scope (do not build)

The panel and `ganged.ts` (worker w2), every doc and NOMENCLATURE (w2), the SDK, firsthand
(`firsthandFor` / `firsthandBy`, `sessions/firsthandFilter.ts`, `historyFirsthand`: leave byte-for-byte),
`session-history@1`, the compiler (`utils/sceneCast*.ts`, `scenes/liveScenes.ts`), the duplicate *Reads everything*
note on a narrator turn, the declaration description strings in the SDK.

## What to build

### 1. The judgement in the host read

In `readLorebookEntries`, after the timeline-off filter and beside the `knownToSpeaker` block:

- **Switch.** Runs when `q.speakerInCast !== false`. The history lane passes `speakerInCast: false` in its query to
  the host **only when its own param is `false`** (spread it in only then, so an unchanged lane hands the host the
  same query object it always did; the scan memo key ignores it anyway, check `scanKey`). Every other read does not
  carry the param and so follows the default, on. **List in your report every caller of
  `ctx.read("lorebook_entries", …)` / `host.read("lorebook_entries", …)`** (grep `src/lib/server`), so the lead can
  say which reads follow the default.
- **Speaker.** The same ref the `knownToSpeaker` block builds (`seated-member:<member>` when `speaker.member` is set,
  else `character:<card>` unless `NO_SUCH_CHARACTER`, else none). Hoist that computation so both blocks use one ref;
  do not change the knowledge block's behaviour. No ref → note `{ kind: "reads-all" }` for the receipt, no load.
- **Gate (cost).** Only when `out` holds at least one `source === "history"` row is anything loaded. No history rows
  → no statement at all.
- **Load, memoised per run** in the `lorebookReads` map the read already receives (same pattern as the
  `knowledge:` key, ~880–888, including the `.catch(() => delete)`):
  - the session's scenes and their stored cast, **per session** (key e.g. `scene-casts:<sessionId>`): one query of
    the session's scenes (the columns `SpeakerInCastSceneRow` needs), then, only if there are any, one query of
    every `scene_characters` row with role `participant` for those scenes (`sceneId`, `bindingId`). Never a query per
    scene or per row.
  - the speaker, **per ref** (key e.g. `speaker-in-cast:<sessionId>:<ref>`): member id (`seated-member:N` → N;
    `character:C` → `seatOf(db, sessionId, "character:C")?.castMemberId`, none → reads everything), and the name as
    the session shows it (`membersAsRead(...).shownName`, fallback `"this character"`, as today). **Load the speaker
    only when at least one history row in `out` has a scene of this session compiled into it** (from the scene
    rows). No such row → nothing changes and no receipt.
- **Judge each history row with this session's scenes behind it** (rule 1 of `speakerInCast.ts`'s header, with
  fix 3 below):
  - every scene kept → row untouched (same object);
  - some kept, with at least one usable summary → a **new object** `{ ...row, content: <fitted text> }` (never
    mutate: the book read is memoised and shared by every asker in the run);
  - none kept, or no kept scene with a usable summary → the row is **removed from `out`** and its id added to the
    `leftOut` set so a `withLinks` far end does not name it either.
  - a hand-written day, or one with only other sessions' scenes → untouched.
- **Receipt.** Note the outcome on the returned rows with a WeakMap, as `noteKnowledgeDrop` / `noteHistoryLeftOut`
  do: `{ kind: "reads-all" }` or `{ kind: "judged", name, shown, cut, leftOut }`. Only the **history lane** logs it
  (once per read, as now): in `loreFor`, `if (source === "history")`, next to `logHistoryLeftOut`. No other read
  logs it. Sentences (🚧 ★, keep the existing ones, add the cut part):
  `inCastHistoryReceipt(name, shown, leftOut, cut)` → *History for Mira: 2 days shown as the scenes Mira was in,
  1 cut short, 1 left out*; parts with 0 are omitted; all three 0 → *No history entries changed for Mira*;
  reads-all → `readsAllReceipt()` from `firsthandFilter.ts` (as today).
- `inCastHistoryReason` is no longer used by anything (no exclusions are published): **delete it** and its tests;
  list it in the report as retired.

### 2. The history lane loses its own replacement

`historyInCast` no longer loads, replaces or publishes `exclusions` (today a half-known day the lane did not return
is excluded everywhere, so the speaker gets nothing of it, against the 2026-11-14 ruling). Delete what is no longer
needed; keep `historyFirsthand` byte-for-byte. Keep `HISTORY_LANE_READS` declaring `speakerInCast` (the declared
reads must stay the same: `boot/declaredReads` checks).

### 3. The cut (fix 2) — ★ as built

The host read has no token budget (the lanes publish band intents; the ranker spends the budget later), so: the
replaced text is capped at **twice the day's own content length, in characters** (the day's `content` as the read
readied it). Rewrite `fitSummaries(summaries, maxChars)`: take the kept scenes' summaries **in story order from the
start**, joined by a blank line, adding each next one while the joined text stays within the cap; drop from the end.
The first summary is always kept whole, even alone over the cap (a day never loses how it began). Return
`{ text, cut }` with `cut` true when any summary was dropped. A cut day counts in the receipt's *cut short*.
Name the constant (e.g. `REPLACED_DAY_CAP = 2`) with a 🚧 ★ comment.

### 4. A scene resolved with an empty cast (fix 3) — ★

`sceneKept` (`speakerInCast.ts` ~96) leaves out every resolved scene the speaker is not a participant of. A scene
whose cast is resolved but holds **no participant row at all** is kept, like a scene whose cast was never worked out.
The participants query above gives you that (no row for the scene). Carry it on the view (e.g. a field on
`SpeakerInCastSceneRow` or a set on the view); update the header comment's rule 1.

### 5. Earlier scenes (fix 4)

In the `earlier-scenes@1` handler: when `earlierScenesOf` returned **no scenes**, skip the speaker-in-cast step
entirely (no read, no receipt; before lane `wt-1b` there was none). Otherwise ask the host:
`ctx.read("speaker_in_cast", { sessionId, currentCharacterId, currentCastMemberId })` (scope values). The new host
case resolves the ref with `loreVisibilitySubject(q)` exactly as the lore read does for an unwired speaker, and returns
the `SpeakerInCastRead` from the **same per-run memo** (shared code exported from `host.read.lorebookEntries.ts`
or `speakerInCast.ts`, your choice; name it in the report). So a Story turn with scenes loads the scenes and casts
once and the speaker once, for both reads. `assertScoped(node, q.sessionId, scope.sessionId)` as the other cases do.
Firsthand stays first, unchanged. The new host read name `speaker_in_cast` is 🚧 ★ (the lead may rename it).

`loadSpeakerInCast` with `sceneIds` / `historyEntries` options goes away or is reshaped to the per-session / per-ref
loads above; keep the module read-only, on the plain `db`, never inside a transaction.

## Tests (done means)

Extend the fixture world (`speakerInCast.reply.int.test.ts`); a test may stub the vector search the way
`historyTimelineOff.int.test.ts` / `bindings.entryKnowledge.reads.int.test.ts` do, or drive the binding with the
host's real read, whichever proves the path. Each case below is its own `it`, named for the path:

1. **Search by meaning** returning the half-missed day: the prompt holds A's summary **once** and nothing of B;
   the day's full text appears nowhere in the prompt. (If the prompt holds the summary twice because the lane copy
   and the meaning copy both reach it, check whether a whole day does the same with the param off before this lane;
   if it does, assert the same count and report it.)
2. **The side-character turn** (`core:spec/story-side-character`, its triggers read) for a speaker who missed part of
   the day. If that pipeline cannot be run for a seated card, test the `lorebook-triggers@1` read with a scope naming
   the seated speaker and report why.
3. **A keyword chain** into the day: an entry whose keys are only in B's part of the day's text is not chained in
   on the speaker's turn (and is with the param off / for the narrator).
4. **Two of three scenes**: the speaker gets both summaries although together they are longer than the day's own text.
5. **The cut keeps the start**: summaries longer than the cap → the first ones kept, the last dropped, receipt says
   *cut short*.
6. **A resolved-empty cast is kept.**
7. **Param off is byte-identical to before `wt-1b`**: keep the existing pin (`c03c1b90…`) green.
8. **The narrator reads everything** (existing case stays green).
9. The existing *on* case: report the sha before and after your change; it may stay identical.

Update `bindings.speakerInCast.int.test.ts` and `speakerInCast.test.ts` to the new shape (no exclusions; the cut;
the empty cast; the earlier-scenes early return; the memo: a Story turn loads the casts once — count statements or
spy on the loader).

**Baselines:** run both, byte-identical sha, and record statements:
`KN2_SHA_LOG=plans/wt-1b-fix-shas-after.txt` on the run of
`src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts` and
`src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts`. Compare every line with
`plans/wt-1b-shas-before.txt` (the numbers **before** lane `wt-1b`). A world with no scenes must cost **exactly**
the before number; if any line differs, find why before reporting (and say so if it is drift unrelated to this
change, with evidence: run it twice).

**How to run tests (exactly; one at a time; always at least one path):**

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/wt-1b-fix-w1-<n>.log 2>&1"
```

Never pipe vitest into `head`. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` must be 0, and
`npx prettier --check` on every file you touched (report pre-existing failures, never `--write`).

## Rules your work depends on (quoted)

- CLAUDE.md Hard rules: "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`." · "Inside
  `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." · "It is a
  **session**, never a *chat*." · "Migrations are generated" (none here).
- CLAUDE.md Principles: "P1 Deterministic, never hidden. … every automatic action shows its cause and how to undo or
  switch it off." (the receipt is the cause; the param is the switch). "P2 Modular. A module owns its data and every
  write to it." (read-only here).
- Owner 2026-11-14: "a character who missed part of a day gets the summaries of the scenes it attended … Build that
  query behavior as part of the core tooling". 2026-11-15: "Stored cast list … Scenes/history are what persist." and
  "a toggle that's on by default".
- NOMENCLATURE R1 one word, one meaning · R3 qualify, never the bare noun · R6 mark 🚧 provisional. Every new internal
  name you add (functions, types, constants, the host read) gets a 🚧 doc comment; **list them all in your report**
  (w2 records them in the ledger). Grep a new name across `src` and `../serene-pub-sdk` before using it.
- Decisions: decide implementation inside this scope and name each choice in the report; anything a user sees, a new
  setting, a migration or a file outside this list → stop and report, do not build.

## Stop and ask (report, do not decide) when

Doing the replacement in the host read changes a prompt for a world where every speaker was in every scene; the host
read cannot tell which session's scenes a day holds without a query per row; a baseline with no scenes costs more
than before `wt-1b`; a file outside "Files owned" must change; a ★ above turns out not to work as written.

## Report

Return in your final message (under ~500 words): changed files with file:line of each change; the callers of the
lore read and which carry the param; the new and retired internal names; tests run (log path, pass/fail counts);
the fixture shas (on before/after, off); statement counts per baseline line against `plans/wt-1b-shas-before.txt`;
open ★; Noticed, not done.
