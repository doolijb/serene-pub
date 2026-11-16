# BRIEF — worker `time-t6c1-w2` (app half 1) — the History-entries decision in `firsthandFilter.ts`, its tests, the docs

Supervisor: lane `time-t6c1`. App repo `/home/jody/github/serene-pub`. Another session shares this checkout:
touch only the files below. A second worker is editing the SDK at the same time (not your files).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never run `sdk:build` yourself (the supervisor does). Never `prettier --write`. Never `git checkout / restore /
stash`. Never `kill -9`. Never pipe vitest into `head`. No dev server, no model server.

## Goal

`src/lib/server/sessions/firsthandFilter.ts` (lane `time-t6b`, built today — read it whole first) decides, for one
cast member on its own turn, which history lines and which earlier-scene summaries it was there for. Extend the
same module (P2: one module owns the decision) with **which History entries are left out** for that member.
The binding that calls it is a later worker's; you build the pure core, the loader change, tests and docs.

Owner rulings (quote, don't change): 2026-11-14 "Unknown content is left out of the prompt; the model is never
told what a character does not know." ★6: a narrator or envoy reads everything. 2026-11-15 "History entries become
less reliable for presets/genres running more granular tracking."; "Not so much a seperate history, but a per
character filter on what gets put into their context." 2026-11-10: History is one entry per date; scenes first
(never split a day's entry per audience). Standing: P1 (off until invoked; the cause shown), P2, "0.6 is in users'
hands" (no migration; none is needed).

## The rule (build exactly this)

1. History entries are lorebook entries (`lorebook_entries`, the history type). A scene is **compiled into** an
   entry when `scenes.history_entry_id` is that entry's id (`db/schema.ts` ~4855).
2. For the member, an entry is **left out** when **at least one scene of this session** compiled into it is one the
   member was not there for, by the existing **summary rule** (`keptSceneIds`: there for the scene's last live
   line, or more than half of its live lines, by rules 1 and 2; a scene with no live line counts as kept).
3. Scenes of other sessions, scenes whose session was deleted (`session_id` null), and any text a person wrote
   into the entry are **not judged**. So an entry with none of this session's scenes behind it is always kept.
4. Nothing is added in place of a left-out entry (no replacement by scene summaries: that is NOT built and is not
   yours; do not touch `scenes/earlierScenes.ts`).
5. A turn that is not one cast member's reads everything (already `{ kind: "reads-all" }`).

## Build (names are 🚧 provisional; use exactly these, they were grepped free)

In `firsthandFilter.ts`:
- `FirsthandSceneRow` gains optional `historyEntryId?: number | null` (the entry the scene is compiled into; null or
  absent: not compiled). Optional so existing callers and tests are unchanged.
- `FirsthandView` gains `scenesOfEntry: Map<number, number[]>` — a History entry → this session's scenes compiled
  into it, by scene id ascending. Built in `firsthandViewOf` from the scene rows.
- `export function leftOutEntryIds(view: FirsthandView): number[]` — the entries left out, ascending id; reuses
  `keptSceneIds` (no second copy of the summary rule).
- `export function historyReceipt(view: FirsthandView, leftOut: number): string` — exactly:
  `No history entries left out for ${name}` · `1 history entry left out: ${name} was not there for all of its scenes`
  · `${n} history entries left out: ${name} was not there for all of their scenes`; followed by the existing
  `untrackedSuffix(view)`, as `linesReceipt` does.
- `export function historyExclusionReason(view: FirsthandView): string` — the sentence published per left-out
  entry and shown in the ranker's record: exactly `${name} was not there for all of this history entry's scenes.`
- `loadFirsthandView`: add `historyEntryId: schema.scenes.historyEntryId` to the **existing** scenes select (no new
  query), and a new option `judgeHistoryEntries?: boolean`: when true and a slot is named, the members whose value
  trails are read also include every speaker of a line in a compiled scene (as `sceneIds` does today for the scenes
  it names). No query per entry or per scene.
- Update the module's top comment: add rule **5. History entries** (rules 2–3 above, two or three lines) and list
  the new exports in the "Pure core" sentence. Comments state the rule, not the story.

Tests:
- `src/lib/server/sessions/firsthandFilter.test.ts` (pure, read it first and follow its style): an entry whose
  this-session scenes the member was all there for → kept; an entry with one missed scene → left out; an entry
  whose only scenes are not this session's (simply absent from the view's rows) → kept, and is not in
  `scenesOfEntry`; a compiled scene with no live line → counts as there (entry kept); the place rule (slot) can
  make a compiled scene missed; the three receipt strings and the suffix; the exclusion reason string;
  `scenesOfEntry` ordering; existing tests unchanged.
- `src/lib/server/sessions/firsthandFilter.int.test.ts` (PGlite, read it first): a fixture with History entries
  (insert real `lorebook_entries` history rows; find the history type id constant, `HISTORY_TYPE_ID` in
  `utils/lorebookEntries`) and scenes with `history_entry_id` set: one entry the member attended fully, one with a
  missed scene, one **mixed** entry (a missed scene of this session plus a scene of another session), one entry
  with only another session's scene, one with only a deleted session's scene (`session_id` null). Assert the
  left-out set through `loadFirsthandView` + `leftOutEntryIds`. Report how many entries in your fixture are mixed.
  Extend the existing statements test: `judgeHistoryEntries` with no slot adds **0** statements over today's
  no-slot count (assert it), and report the numbers it logs.

Docs and names:
- `docs/pipelines.md`, section **What a character was there for** (~344–360): the opening paragraph names the
  **History entries** step as a third step; a new bullet **History entries**: a day's entry is left out of the
  character's prompt when it missed at least one of this session's scenes compiled into it; entries with no scene
  of this session behind it (another session's days, a day a person wrote) always stay; however the reply finds
  the entry (by keywords, by name, by meaning) it stays out, and the run's ranking record says why. The receipt
  sentence gains one example: *1 history entry left out: Mira was not there for all of its scenes*. In **Limits**,
  replace "history entries compiled from scenes are not filtered yet" with: a day's entry can't be cut in two, so
  leaving it out also leaves out everything else that day holds, other sessions' scenes and anything a person
  added; a character that missed one scene of a day loses that day's entry, apart from its own lines still in the
  history; a scene whose messages were all deleted counts as one the character was there for. Plain user prose,
  as the section around it.
- `docs/lorebook-time.md`, section **History entries and scenes** (~58–72): **one** sentence, after the paragraph
  on scenes (~70) or the not-yet-compiled one (~72), saying a pipeline can leave a day's history entry out of a
  character's prompt when the character wasn't there for one of the session's scenes compiled into it, linking
  `./pipelines.md#what-a-character-was-there-for`.
- `NOMENCLATURE.md`:
  - §14 row **firsthand** (line ~955): add, after the summaries sentence, the History-entries clause (rules 2–3,
    one sentence; entries published on the History-entries read's `exclusions` so eligibility blocks every copy);
    add `core:query/history-entries@1` to the in-ports sentence; add `leftOutEntryIds`, `historyReceipt`,
    `historyExclusionReason` to *Owns*; keep the row one table row. Don't touch the t6a-column part.
  - §25 Change ledger: append **one** bullet at the end of the file (after the `time-t6b-fix` bullet, line ~4290),
    in the style of the two t6b bullets: `**2026-11-15 (lane time-t6c1 — the History half of the firsthand filter;
    owner rulings 2026-11-14 "Unknown content is left out of the prompt; the model is never told what a character
    does not know", 2026-11-15 "Not so much a seperate history, but a per character filter on what gets put into
    their context", 2026-11-10 one entry per date; 🚧 provisional names and copy, the lead's proposal, not
    ruled).**` then: the in-ports `firsthandFor` / `firsthandBy` now also on `core:query/history-entries@1`
    (left-out entries published on its `exclusions`); `validate()`'s law `firsthand 2026-11-15` covers three reads;
    *new* `scenesOfEntry` (view field), `FirsthandSceneRow.historyEntryId`, `leftOutEntryIds`, `historyReceipt`,
    `historyExclusionReason`, loader option `judgeHistoryEntries`; the receipt and reason sentences verbatim; and:
    "This lane is the History half of the filter; the living-world plan's *T6c* (the not-common-knowledge mark and
    knowledge ties) is a different, later lane." Read §1 and §24 before writing (grep each name first, R3: qualify).

## Rules (quoted)

- "Comments state the rule, not the story. Published prose says 'was there for', never *witness*."
- It is a **session**, never a *chat*. Never write "no lorebook". No other product's name in any file.
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`". The loader is read-only on the plain `db`.
- Never seed a row at a hardcoded id in a test: use the ids returned by inserts.
- "An int test that opens a DB inside an `it` needs a 60 s timeout under load."

## Tests: how to run (strictly one vitest run at a time)

First `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` — if a run is up, do other work (docs) and check again
later; never start a second run beside it. Then, from
`/home/jody/github/serene-pub`:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/firsthandFilter.test.ts src/lib/server/sessions/firsthandFilter.int.test.ts > plans/time-t6c1-w2-vitest.log 2>&1"`

then read the log. Also run `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` once at the end and
report only errors in your files (the SDK half is being edited elsewhere; ignore errors outside your files).

## Files owned (only these)

`src/lib/server/sessions/firsthandFilter.ts`, `src/lib/server/sessions/firsthandFilter.test.ts`,
`src/lib/server/sessions/firsthandFilter.int.test.ts`, `docs/pipelines.md` (that section only),
`docs/lorebook-time.md` (one sentence), `NOMENCLATURE.md` (§14 row, §25 bullet).

Readable: anything. Not yours: `pipelines/runtime/bindings.ts`, `scenes/earlierScenes.ts`, `host.ts`, the SDK.

## Stop and ask (in your report, without choosing) when

A new name beyond those above seems needed; a query per entry or per scene seems needed; a migration seems needed;
the summary rule can't be reused as is; anything outside the files above.

## Done means

Edits above; both test files green; tsc clean for your files; `npx prettier --check` on each edited file (report).
Report as your final message: changed files with line ranges, test results with counts, the mixed-entry count, the
statement numbers, anything noticed but not done.
