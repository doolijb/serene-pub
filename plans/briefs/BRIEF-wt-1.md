# BRIEF — build lane `wt-1` — who was there: the scene's stored cast decides, and a character reads only the scenes it was in (programme 1.2b and 1.3; owner rulings D57, D21)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then rows D57, D21 in
`plans/DISCUSS-LATER.md` (ruled), `plans/INVENTORY-attended-scene-summaries-2026-11-16.md` (the map of this
lane: **re-verify every file:line**), `plans/REPORT-kn-2a-2026-11-16.md` (`knownToSpeaker`: the pattern for an
on-by-default read param; how the speaker is resolved; "reads everything" for a narrator turn),
`plans/PLAN-entry-time-and-lines-2026-11-14.md` ~330–345 (the ruling), `docs/summarization.md`,
`docs/lorebook-cast.md`, the SDK guide `guides/genres-presets-and-routines.md` (~430–450: firsthand),
`NOMENCLATURE.md` §1, §24 and rows **scene**, **stored cast**, **firsthand**, **presence**, **benched**,
**Who's here** (the word *attendance* is taken by that widget: do not use it for this).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only, never `--write`. Never `npm test` / `npm run build` at the SDK root; `sdk:build` only from the
app root after checking no dev / preview server (`pgrep -af "vite"`; the Svelte language server's esbuild does
not count) and no vitest is up. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/wt-1-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. **No migration** (stop and report if
one is needed). Inside `db.transaction` only `tx`. No full run, no `npm run build`.

## Owner

2026-11-14: a character who missed part of a day gets the summaries of the scenes it attended: "As
recommended. Build that query behavior as part of the core tooling, so someone can code a different strategy
instead". 2026-11-15: "Stored cast list, when messages are outside the context window, we won't be querying
them anyway. Scenes/history are what persist." and (knowledge) "a toggle that's on by default … in the query
markup". 2026-11-16 (D57): "Attended = spoke in the scene" + "It's up to the sessions scene
management/compiler to determine who gets listed in the scene. For core catelogue, we will go with: Spoke at
least once, and further filtering by cast members position. For dated lorebooks, we should also store the time
the scene started and ended so we have the full window." (D21): "Same ruling as D57. There's many possibilities
for how the scene could be compiled or queried. Benched doesn't rule them out if they were active at least
once during the window and location didn't rule them out." Standing: Bench is not absence; no position /
location-detail **stat** in core (declined 2026-11-14): *position* here is the place a cast member is in (the
location slot), not posture; comprehension and fidelity first; P1 (same inputs, same result); P2.

## The design those words give (each ★ in the report)

- **Two separate questions, two owners.** *Who is listed in a scene* is the **scene compiler's** answer, stored
  once as the scene's cast (`scene_characters`, role `participant`). *What a character reads* is a **query's**
  answer, and the query only ever asks the stored cast. A genre or plugin may compile the cast differently;
  the reads do not change.
- **Core's compiler rule:** a cast member is a **participant** of a scene when it **spoke at least once in
  it** and **its place does not rule it out** (a member whose known place, while the scene ran, is a different
  place from the scene's is not listed; a member with no known place, or a scene with no place, is not ruled
  out by place). Being benched plays **no part**: a benched seat that spoke in the scene before it was benched
  is listed; one that never spoke is not. The roster and names found in lines no longer make a participant
  (names keep making the `mentioned` role, as today).
- **The window:** a scene on a lorebook that keeps a timeline stores when it started and ended in story time
  (find what exists: opened / closed story clocks on `scenes`; if both already exist, this is "verify and
  pin"; if one is missing, stop and report: no migration here).

## Build

### A. The compiler rule (app)

1. Find the one place core proposes a scene's cast (`utils/sceneCastProposal.ts` ~467–560: senders ∪ roster ∪
   names; `writeSceneCast`, `utils/sceneCast.ts:153`; callers in `scenes/liveScenes.ts` at open, close, move,
   merge, and `refreshOpenSceneCast` on every line for genres with `castRefresh`) and make `participant` follow
   the rule above: **spoke at least once** in the scene's lines, **minus** those ruled out by place. Place:
   read the member's place the way the knowledge filter's standing-place rule does (`lorebooks/entryKnowledge.ts`:
   the location slot; lane `kn-2a`), at the scene's lines, not "now". State exactly which read gives a member's
   place during a past scene; if only the current place is knowable, the place filter applies only while the
   scene is open and at close, and a later re-proposal keeps the stored answer (say so; do not guess history).
2. **Existing scenes are not rewritten.** A scene whose cast is already stored keeps it (0.6 is in users'
   hands; no boot pass). The new rule applies to scenes opened, closed, moved or merged from now on, and to an
   open scene's refresh.
3. What changes for a player: who the session's "in this scene" surfaces show (Who's here, scene headers, the
   lorebook's scene cast): list each surface that reads `scene_characters` and what it shows before → after
   (a silent listener is no longer listed as a participant). If a surface needs "present but silent", it is
   not in this lane: report it.
4. Scene start and end in story time: verify, pin with a test, document.

### B. The reads (SDK + app)

5. **One on-by-default read param**, in the manner of `knownToSpeaker` (boolean, default `true`, last field of
   `params`, with its one sentence), on the reads that hand a character a scene's content:
   `earlier-scenes@1`, `history-entries@1`, and `session-history@1` if the owner's "when messages are outside
   the context window, we won't be querying them anyway" leaves it out, **leave `session-history@1` alone**
   (the transcript in the window is not filtered: confirm that reading against the code and say so). Name by
   §24 (★; not *attendance*; the existing term is **firsthand**: `firsthandFor` / `firsthandBy` ports exist on
   these three queries and are wired by no shipped spec: decide whether the param replaces those ports or
   stands beside them, **without removing a published name** (mark ⏳ if superseded) and report).
6. **What the param does, for the speaker of the turn** (resolved as `knownToSpeaker` resolves it; a narrator
   turn or a turn with no single speaker reads everything, with the existing receipt line):
   - `earlier-scenes@1`: only scenes whose stored cast lists the speaker as a participant; an **open** scene is
     always kept; a scene with **no stored cast at all** (never resolved) is kept (★: the safe reading: say
     how many exist in practice).
   - `history-entries@1` (a compiled day): if the speaker was in **every** scene of the day that this session
     compiled into it, the day's own text, as today; if it missed **any**, the day's text is replaced by the
     **summaries of the scenes it was in** (in order, under the day's date), and nothing when it was in none;
     a day with no scenes from this session (lore history written by hand or by another session) is governed
     by `knownToSpeaker` only, as today. Reuse `scenesOfEntry` / `keptSceneIds`
     (`sessions/firsthandFilter.ts` ~80, ~268) reading the **stored cast**, not who spoke.
   - Receipts: one line per read in the manner of the knowledge filter's (★ sentence).
7. **Replace firsthand's own rule with the stored cast.** `sessions/firsthandFilter.ts` (spoke; last line or
   more than half; drops the whole day for one missed scene) becomes the function behind the param, reading
   the stored cast; its old thresholds go; whatever still calls `firsthandFor` gets the same answer. Update
   the guide sentence "A character that missed one scene of a day loses that day's entry".
8. **Shipped specs:** the param defaults on, so Story's reply, Narrate, the side-character turn and the
   Dungeon Crawler (`core-catalog/src/genres/story/respond.ts` ~584–636, `narrate.ts:318`,
   `narrateCharacter.ts:236`, `dungeon-crawler/story.ts:1662`) get it without edits: verify each, and that a
   narrator's turn still reads everything. The Pipelines panel shows the param like `knownToSpeaker` does
   after lane `kn-5` (one switch per pipeline when two or more reads carry it: reuse that mechanism for this
   param, or report why not).
9. **Prompt baselines will change** for worlds where a speaker missed a scene: report each sha that moves and
   show the diff is only a missed scene's summary / a day replaced by attended summaries. A baseline that
   changes for a world where every speaker was in every scene is a stop.

### C. Docs and names

`docs/summarization.md` (who a scene lists; what a character who missed a scene reads), `docs/lorebook-cast.md`,
`docs/pipelines.md`, `docs/context-templates.md` (earlier scenes, history), `INTEGRATING.md` and the SDK guide
(the param; the compiler / query split; how a modder compiles a cast differently), `NOMENCLATURE.md` (rows:
the compiler rule with its charter, the param, **firsthand** updated; §25 with the rulings quoted).

## Tests

A: per rule (spoke / never spoke; place rules out / no place; benched after speaking / benched silent; open
scene refresh; close; move; merge); existing stored casts untouched across a boot. B: per read and case (in
every scene; missed one; in none; open scene; unresolved cast; a hand-written day; narrator turn; param off);
the day's replacement text; receipts. First turns of the shipped genres; both prompt baselines as item 9 says.
SDK: `sdk:build`, `npm run sdk:test` capped (four known failures); registry hashes re-pinned with "(was …)".
`tsc` 0; `npm run check` 0 errors in lane files.

## Stop and ask when

CLAUDE.md §Decisions applies; a member's place during a past scene cannot be known and the rule would silently
differ between open and closed scenes in a way a player would see; a migration is needed; the param would
remove or rename a published name; a shipped pipeline breaks when a speaker was in no scene of a day.

## Report

Final message = the report (lead saves `plans/REPORT-wt-1-<date>.md`): the compiler rule as built and where a
member's place comes from; surfaces that changed; the param (name ★) and what each read does; firsthand's fate;
baselines; sentences (★); **Noticed, not done**. Under about 750 words.

## Cold review corrections (2026-11-17) — these rule over the text above

**The lane is cut in two and the order is reversed. This brief now builds `wt-1b` only: part B (the reads) and
its docs, on today's stored cast. Part A (the compiler rule) is `wt-1a`: it waits on the owner (rulings page
B1, B2 / D70) and is not built here: do not edit `utils/sceneCastProposal.ts`, `utils/sceneCast.ts` or
`scenes/liveScenes.ts`.** Logs `plans/wt-1b-<n>.log`; report `REPORT-wt-1b-<date>.md`.

Licensed (no change): default-on (owner 2026-11-15: "When querying on a characters history/knowledge, have it
be a toggle that's on by default", `PLAN-programme-2026-11-15.md` 11–14).

1. **Firsthand stays untouched (replaces item 7).** `firsthandFor` / `firsthandBy` and
   `sessions/firsthandFilter.ts` are published and may be wired by a user's own pipeline (0.6 is in users'
   hands); `firsthandFor` also filters single lines on `session-history@1` (`wasThereFor`, 243–255) and
   `validate.ts` 1320–1367 warns about its wiring. Leave all of it as it is, mark it ⏳ transitional in its
   doc comments and the guide, and back the **new param** with a **new function** that reads the stored cast
   (it may reuse `scenesOfEntry` and the scene lookups, not the thresholds). The guide sentence about firsthand
   dropping a whole day stays true for firsthand; add the new param's behaviour beside it.
2. **`session-history@1` is left alone** (the transcript in the window is not filtered by the new param).
3. **Two assumptions to state in the docs and the report (★):** a day the speaker fully attended keeps its
   whole text, including scenes other sessions on a shared lorebook compiled into it (those are not judged:
   `firsthandFilter.ts` 27–31); a day replaced by several scene summaries may be longer than the day's own
   text and must stay inside the read's `maxTokens` (say how it is cut: newest kept, in the read's existing
   manner).
4. **The baseline check, made real (replaces item 9).** Neither baseline test
   (`pipelines/runtime/unknownEntries.reply.int.test.ts`, `sockets/sessions.lairUnknownEntries.int.test.ts`)
   contains a scene or a summary, so their fingerprints cannot move: they must stay **byte-identical** (a
   change is a stop). Record the "before" fingerprints first. Add **one fixture world** where a speaker missed
   a scene and a day is built from several scenes, and pin its prompt before (param off) and after (param on).
5. **Today's stored cast is what the reads see:** senders, the roster and names in lines (a name in a speech
   tag or spoken to directly makes a participant today, `utils/sceneCastProposal.ts` 325–328; benched silent
   character seats are already out, `scenes/liveScenes.ts:922`; every player seat is in). Say so in the docs:
   the compiler's rule is a separate, later change.
6. The panel: the new param gets the one-switch-per-pipeline treatment lane `kn-5` built for `knownToSpeaker`
   (`pipelines/config/panel/ganged.ts` is limited to that param by one constant, `ganged.ts:28`): extend the
   constant to this param too if that is all it takes, else report.

## Owner's answers (2026-11-17, B1, B2) — for part A (`wt-1a`); these rule over the text above

- **B1:** "Active means spoke at least once in the scene". A seat that spoke and was then benched is listed; a
  seat that never spoke is not, benched or not. No bench times are stored.
- **B2:** (no option picked) "Keep latest version, track change history". *Lead's reading (★ in the report):*
  a scene's cast lists **speakers only** (not silent listeners, not the roster, not people only named or
  spoken to); there is **no "edited by hand" lock**: the latest write of a scene's cast stands, whoever made
  it (a hand edit, or the compiler at refresh, close, move, merge); and **every change to a scene's cast is
  recorded in change history**, so a hand edit the compiler later replaced can be seen and brought back.
  Use the change history that already exists for lorebook entries (find it: the agreed change history of
  2026-11-13 and what was built since: `plans/REPORT-*` for edit history; NOMENCLATURE **change history**);
  add no second history mechanism. If a scene's cast is not something that history can record today, stop
  and report what it would take (a migration is the owner's call).

## Cold review corrections for part A (2026-11-17, second review) — these rule over everything above for `wt-1a`

Owner, confirming B2 (2026-11-17): "B2, no, hand edits aren't treated differently. Just keep a change history so
a user can overwrite."

1. **This lane builds "speakers only; the latest write stands". It does NOT build the change history of a
   scene's cast**: `lore_redlines` takes an entry or a character version only (CHECK at `db/schema.ts`
   11076–11078; causes `save|routine|apply|revert|take-back|restore`, 11080; `recordRedline`,
   `lorebooks/redlines.ts` 198–206), and a scene's cast is `scene_characters` rows (schema 5068–5090), not an
   entry. Recording it needs a migration (a scene subject and a cause for the compiler's own writes): asked on
   the rulings page (SC1). No migration here. Strike the "stop and report" about history: it is known.
2. **Every writer of a scene's cast, not one.** The live compiler (`scenes/liveScenes.ts` ~818; refresh, close,
   move, merge); the summary's **Review & Save**, which seeds participants from the summarize pipeline's
   `cast` node (the model's extraction) plus the senders (`sockets/scenes.ts` 2310–2313, 2401–2456) and saves
   through `scenes:update` (`ProcessSceneModal.svelte` 231–236 → `scenes.ts` 668–676, 854–858); the graph
   build's apply (`sockets/narrativeGraph.apply.ts` 1688–1712); `scenes:create` (`scenes.ts:513`); import
   (`sockets/lorebooks.ts:4434`); merge remap (`narrativeGraph.merge.ts:1678`). Build: **the live compiler and
   the summary review's seed list speakers only** (who spoke is something code decides, P1; the model's `cast`
   extraction no longer adds participants to the seed; a person can still add anyone by hand in the review,
   and a hand edit through `scenes:update` / `scenes:create` stays a person's write, unfiltered). The **graph
   build's apply, import and merge remap are not changed**: list each in the report as ★ (what it writes
   today, whether it can put a non-speaker back).
3. **The place rule** ("further filtering by cast members position"): compare the member's own
   `core:slot/location@1` value **as of the line where the member spoke** with the scene's place at that line,
   using the reads part A's own file already has: `valueOf({ asOfMessageId })` (`state/resolve.ts` 53–59,
   908–912), `worldStateReader` and `scenePlaceOf` (`liveScenes.ts` 531–611), `scenePlaceKeyOf` (505–526: the
   place key the genre declares, or null). No session fallback for the member; with no declared place key, or
   no known place for the member, the place rule does not exclude. **Do not touch
   `lorebooks/entryKnowledge.ts`** (`standingPlaceIds` is private there and another lane owns the file).
   Delete the stop branch "if only the current place is knowable".
4. **Names**: a person only named in a speech tag or spoken to is not a participant; nothing is written for
   them; they appear only as the derived mentions (`utils/sceneMentions.ts` 1–20). (The line above saying
   names "keep making the `mentioned` role" is wrong: that role is never stored.)
5. **The window** is already stored (`scenes.opened_story_clock_*`, `closed_story_clock_*`, schema 4930–4941;
   written in `liveScenes.ts` 1219, 1432–1436, 1653–1674, 1746, 2140): verify and pin, no migration.
6. **Readers of a scene's cast** (report before → after for each): scene divider faces
   (`client/components/sessionPage/liveSceneProjection.ts` 48–93); the cast page's scene list
   (`client/lorebooks/cast/memberScenes.ts:53`); the lorebook timeline's `present`
   (`client/lorebooks/time/storyTime.ts` 177, 202); `SceneCastChips.svelte`, `SceneForm.svelte`;
   `sessions/speakerInCast.ts` (lane `wt-1b`: a silent seat no longer gets that scene's summary: the owner
   accepted this, D70); firsthand for scenes with no live line (`sessions/firsthandFilter.ts` 454–460); the
   graph build and export. "Who's here" does not read scene cast (`sessions/attendance.ts`).
7. **Files owned:** `scenes/liveScenes.ts` (the cast proposal), `utils/sceneCastProposal.ts`,
   `utils/sceneCast.ts`, `scenes/boundaryWatcher.ts` (only if it proposes cast), `sockets/scenes.ts` (the
   review seed only), `utils/activityStore.ts` (`pendingResult.participantCharacters`, only if the seed's
   shape requires it), tests, `docs/` pages that say who a scene lists, NOMENCLATURE. Live lanes, not yours:
   `gs-3b` (`sockets/sessions.update.ts`, `sessions/seats.ts`, `sessions/guestSeats.ts`, `sessions/seatName.ts`,
   seat components, `EditSessionForm.svelte`), `dg-2` (`messages/debugMeta.ts`, `sockets/sessions.messages.ts`,
   `pipelines/runtime/liveRow.ts`, `utils/runReply.ts`, `utils/generationStatus.ts`), `ap-2` (`utils/ownedBook.ts`,
   `lorebooks/ownBook.ts`, `lorebooks/entryKnowledge.ts`, `sockets/sessions.shared.ts`,
   `sockets/sessions.create.ts`, `StartSessionForm.svelte`).
8. Never run prettier with `--write` or pipe its output into a file. No migration. Log names
   `plans/wt-1a-<n>.log`.
