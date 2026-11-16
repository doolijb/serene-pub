# BRIEF — build lane `time-t6c1` — the firsthand filter reaches History entries compiled from scenes

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/briefs/BRIEF-time-t6b.md` (the rule and the owner's words), `plans/REPORT-time-t6b-2026-11-15.md` (all,
incl. the fix lane), `plans/PLAN-living-world-preset-2026-11-15.md` §9 (rule 3), `docs/lorebook-time.md`
(History entries and scenes), `docs/sessions.md` (Earlier in the story), `../serene-pub-sdk/INTEGRATING.md`
(history entries in a prompt; by section), `NOMENCLATURE.md` §1, §24, §23, §14 (**firsthand**).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`; never `prettier --write`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite"` (dev **and** preview; the Svelte language server's esbuild is
not one) and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`. If a server or a run is up, don't build;
report 'blocked on your dev server'.

## The gap

Lane `time-t6b` leaves out, for a character on its own turn, the conversation and the scene summaries it was not
there for. But a scene compiled into a **History entry** leaves the earlier-scenes read
(`scenes/earlierScenes.ts` ~55: `isNull(historyEntryId)`) and comes back through the history-entries lane of the
reply (`core-catalog/src/genres/story/respond.ts` ~629) as part of its day's entry, unfiltered. So what a
character missed returns once the day is compiled.

## Owner rulings (quote them in worker briefs)

- 2026-11-15: "History entries become less reliable for presets/genres running more granular tracking."; "Not so
  much a seperate history, but a per character filter on what gets put into their context."
- 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a character does not
  know." ★6 (a narrator reads everything).
- 2026-11-10: History is one entry per date; scenes first (do not split a day's entry per audience).
- The presence rule and where it lives: as `BRIEF-time-t6b.md` quotes (spoke in the scene; place when a slot is
  named; opt-in per node; Bench plays no part).
- Standing: P1, P2, P5; "0.6 is in users' hands"; no migration is expected.

## The rule

When the reply's history-entries read is invoked with the firsthand option for one cast member:

1. A History entry **compiled from this session's scenes** (scenes whose `history_entry_id` is the entry) is kept
   when the member was there for **every** such scene (by `time-t6b`'s scene test: the summary rule).
2. Otherwise the entry is left out, and **in its place** the member gets the summaries of the scenes of that
   entry it was there for (so nothing it lived through disappears when a day is compiled). They are delivered
   through the earlier-scenes read: a compiled scene is included there **for that member only** when its day's
   entry was left out for it.
3. A History entry with no scene of this session behind it (the world's record, a hand-written day, another
   session's days) is always kept: it is public record.
4. Not invoked, a narrator's or envoy's turn, a step for several characters: nothing changes; the receipt says
   so, as `time-t6b`'s does.
5. The receipt says what was left out and why (🚧 *2 history entries left out: ‹name› was not there for all of
   them; 3 of their scenes kept as summaries*).

Stated limits: a compiled entry cannot be cut in two; other sessions' scenes are not judged (rule 3); the
*not common knowledge* mark for lore is a later lane.

## Build

### A. Inventory (supervisor, read-only; file:line in the report)

How history entries reach a reply: the SDK node and its binding (the `historyEntries` lane; is it a query node
with in-ports like `session-history@1`, or part of lore ranking?), how an entry's scenes are found
(`scenes.history_entry_id`, `schema.ts` ~4855, index ~4992), what `earlierScenesOf` returns and its cap (200),
whether History entries are also recalled by the **lore ranker** as ordinary entries (if so, say whether the
filter must reach ranking candidates too, and stop if that is a second, larger change), and how
`sessions/firsthandFilter.ts` exposes the scene test for reuse.

### B. Build

- The same two in-ports (`firsthandFor`, `firsthandBy`) on the node that reads History entries for the reply,
  additive and `@experimental`; `validate()`'s existing warning extends to it (one node carrying the option while
  a sibling read does not).
- The decision stays in `sessions/firsthandFilter.ts` (P2: one module): add "kept history entries" and "compiled
  scenes to deliver as summaries" to the view. No query per entry.
- `earlierScenesOf` gains the per-member inclusion of compiled scenes whose entry was left out (rule 2), only
  when invoked.
- No shipped pipeline is changed to invoke it.

### C. Docs and names

`docs/pipelines.md` (the *What a character was there for* section: History entries, one example), the SDK guide
section, `docs/lorebook-time.md` (one sentence under History entries and scenes), `NOMENCLATURE.md` (§14 row,
§25). No other product's name.

## Files owned

SDK: the History-entries read node in `contracts/src/` (the two in-ports), `sdk/src/validate.ts` (the warning
only), the guide section, SDK tests. App: `src/lib/server/sessions/firsthandFilter.ts` (+ tests),
`src/lib/server/scenes/earlierScenes.ts` (the inclusion only), the binding(s) in
`pipelines/runtime/bindings.ts` (only to call the module), `pipelines/boot/registryHashes.test.ts` (re-pins with
"(was …)"), tests, the docs, `NOMENCLATURE.md`.

## Out of scope

Lore ranking candidates (unless the inventory shows History entries reach the prompt only that way: then stop);
the not-common-knowledge mark; knowledge ties; splitting or rewriting a History entry; any shipped pipeline
invoking the option; `host.ts`; the `time-t6a` column.

## Stop and ask when

CLAUDE.md §Decisions applies; History entries reach the reply through the lore ranker rather than a query node;
rule 2 would need a compiled scene's summary that is no longer stored after compiling; a migration seems needed.

## Done means

- `npm run sdk:build` from the app root (after the checks above), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t6c1-sdk.log 2>&1"`:
  only the four known failures.
- App tests (each in that capped form with `npx vitest run --maxWorkers=3 <paths>`, strictly one run at a time):
  an entry whose scenes the member all attended is kept; one with a missed scene is left out and the attended
  scenes come back as summaries; an entry with no scene of this session is kept; a narrator reads all; not
  invoked → byte-identical; the receipt line; statements added per reply (report the number);
  `pipelines/boot/declaredReads.test.ts`, `registryHashes.test.ts`, the existing `firsthandFilter` and
  `earlierScenes` tests.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story. Published prose says "was there for", never *witness*.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t6c1-<date>.md`): the inventory with
file:line; the rule as built; names and sentences; statements added; changed files in both repos; when you ran
`sdk:build`; tests with results; open ★; **Noticed, not done**. Under about 700 words.

## Corrections after the cold review (2026-11-15) — these rule over the text above

1. **Leave out through the exclusions port, so no other mechanism brings the entry back.** History entries are
   ranked lore: `core:query/history-entries@1` (one in-port `scope`, `contracts/src/queries.ts` ~1188–1192;
   binding `runtime/bindings.ts` ~2833–2839, ~1110–1131) feeds `lore` with entity search (~3537–3590, which pools
   every enabled entry, History rows labelled `source: "history"` by `host.ts` ~5598–5617) and vector search
   (`core-catalog/src/genres/story/respond.ts` ~793–824, ~858–877), then `eligibility` and `rank-hybrid`
   (~1003–1020). Dropping an entry from one node's `main` leaks through the others. Use the mechanism that
   exists: the lane's **`exclusions`** port ("A copy of one that another mechanism brings in … `eligibility@1`
   marks it ineligible", `queries.ts` ~1196–1206; built by `exclusionsFrom`, `bindings.ts` ~860; consumed
   `respond.ts` ~1006–1010). The node publishes each left-out entry there with the firsthand reason as its
   sentence; eligibility blocks it whichever mechanism found it and the ranker records `excluded_ineligible`.
   The inventory confirms the vector-search pool is covered. The brief's stop "History entries reach the reply
   through the lore ranker" is **withdrawn**: they do, and this is how it is handled.
2. **Rule 2 (the replacement) is not built.** It was the lead's addition, it adds content rather than filtering
   (the filter "only narrows"), and one node's decision would change what another returns. This lane is **left
   out only**. `scenes/earlierScenes.ts` is **removed** from Files owned. The loss is stated in the docs: a
   character that missed one scene of a day loses that day's entry, apart from its own lines still in the
   history window. The replacement goes to the owner as ★ in the report.
3. **Mixed entries: the rule, restated.** One entry per date holds every session's and every channel's scenes
   and any paragraph a person added (`scenes/unfiledScenesByEntry.ts` ~49–51; `docs/lorebook-time.md` ~62, ~66).
   An entry is left out for a member when **at least one scene of this session** compiled into it is one the
   member was not there for; scenes of other sessions (or of a deleted session: `session_id` null) and
   hand-written text are not judged, so an entry with none of this session's scenes is always kept. Limit to
   state: leaving the entry out also drops whatever else that day holds. Report how many entries in a test
   fixture are mixed; no count of real data.
4. **A compiled scene with no live lines** (its messages were deleted) counts as "was there" today
   (`firsthandFilter.ts` ~246): state it as a limit; a fallback to the scene's stored cast is ★ for the owner
   (his rule is "spoke in the scene").
5. Naming: this lane is the History half of the filter; the plan's "T6c" (the not-common-knowledge mark and
   knowledge ties) is a different, later lane. Say so in the §25 line.
