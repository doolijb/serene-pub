# BRIEF — build lane `time-t6c2` — the *not common knowledge* mark and knowledge ties (server and SDK; no screens)

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §2, §4, §5 (rules 5, 6, 8) and §8 ★2, ★3, ★6,
`plans/REPORT-time-t6c1-2026-11-15.md` (how a filter reaches every lore pool: the `exclusions` port and
eligibility) and `plans/REPORT-time-t6b-2026-11-15.md` (the firsthand module, receipts, the recipes test),
`../serene-pub-sdk/INTEGRATING.md` by section, `docs/lorebooks.md`, `docs/lorebook-cast.md`, `docs/pipelines.md`,
`NOMENCLATURE.md` §1, §24, §23, §14 Knowledge and the relationships group.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form; use `npx prettier --check <file>`, **never `prettier --write`**. Never commit.
Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own
tests made, by name. Before any `sdk:build`, check `pgrep -af "vite"` (dev and preview; the Svelte language
server's esbuild is not one) and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if a server or a run
is up, don't build; report 'blocked on your dev server'.

## Owner rulings (quote them in worker briefs)

- 2026-11-14 (plan §2, ruled): "**Knowing a particular entry is a tie** between the cast member and the entry
  (*has been there*, *was told*, *knows*; *kept from* for the opposite). An entry marked **not common knowledge**
  is read only by those tied to it. The pool on the character and *Known by* on the entry are the two ends of the
  same ties." ★2: a tie to an entry counts as knowing it. ★3: every entry is common knowledge unless marked; no
  entry type starts marked.
- Plan §5: rule 5 "Knowledge ties are a kind of their own, left out of the relationship graph, tie ranking and
  the ties in the prompt." Rule 6 "A filter always shows its cause: *not known by ‹name›*". Rule 8: marks are the
  lorebook owner's alone.
- 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a character does not
  know." ★6: a narrator, an envoy and a step writing for several characters read everything.
- 2026-11-15: "build what we want best practice into our SDK helper (all features are opt in on invoke)";
  opt-in: "pipeline/node".
- Standing: P1, P2, P5; 0.6 is in users' hands (forward migration; a second boot changes nothing); Decay never
  puts text in a prompt; Bench is not absence.

## The rule (v2, after cold review 2026-11-15)

1. **The mark** is one stored boolean on the entry (not per version, not per line; the edit history does not
   record it). Unmarked = common knowledge = today's behaviour.
2. **Knowing** (★2: "A tie to an entry counts as knowing it (so *has been there* is enough, and nothing is said
   twice)"): the speaker knows an entry when **any** active `narrative_relationships` row runs from the speaker's
   cast binding to that entry and reads on the reply's line at the reply's date, **except** a *kept from* row. An
   ordinary tie that exists today ("member of → The Guild") counts.
3. **A knowledge tie** is such a cast→entry row carrying a kind of its own (a nullable discriminating column):
   *was told*, *knows*, *has been there* (a person's or, later, play's plain statement of knowing) and *kept
   from* (the opposite). The column exists to keep these rows out of the graph, ranking and prompt (plan §5.5)
   and to mark *kept from*. A cast→entry row is legal today (`db/schema.ts` ~5334–5353).
4. **Dating.** A row's date is its `history_entry_id`'s date only (`scene_id` is provenance; see
   `utils/graphBackfill.ts`, `shared/lorebooks/tieVersions.ts`). Undated counts as earliest and is never cut by a
   fork (`lineReading.ts` ~359–375). A knowing row and a *kept from* row both reading: the later date wins; same
   date, the row on the nearer line wins; then *kept from*. With the lorebook's Timeline off, dates play no part
   and only `status` ends a row.
5. **For a reply spoken by one cast member on its own turn, when the pipeline invokes the option**, an entry is
   left out when (a) it is marked and the speaker does not know it, or (b) a *kept from* row wins for it (marked
   or not). A narrator's turn, an envoy's and a step writing for several characters read everything; the receipt
   says so.
6. **Every lorebook the session reads** (its own, its notes, the attached one: `lorebooksReadBy`, as
   `rulesets/read.ts` does) is judged; ties kept in the notes count.
7. **How it reaches the prompt.** Eligibility is pure (`ranking/eligibility.ts` ~26) and is fed by three lanes'
   `exclusions` (`world-lore@1`, `character-lore@1`, `history-entries@1`; story `respond.ts` ~606–631,
   ~1006–1010), so there is no existing single gate. Build **one new query node** (additive, `@experimental`,
   name per NOMENCLATURE §24; lead's 🚧 `core:query/unknown-entries@1`) that takes the speaking member and
   returns `exclusions` for **every** left-out entry of every type, spelled in each source name eligibility
   blocks (`worldLore`, `characterLore`, `history` and its `historyEntry` alias: verify the list at
   `host.ts` ~13077 and `embedding/ragContext.ts` ~137–147), each with a reason (🚧 *not known by ‹name›* /
   *kept from ‹name›*). A spec opts in by wiring that one output into eligibility. `validate()` warns when the
   node is placed and its `exclusions` reach no eligibility node. Not `relationships-known@1` (a published name
   for another thing): do not name the node or a port `known…`.
8. **Stated limit, not built here:** the scene's place listing (`scenePlaces` with `withLinks`, story
   `respond.ts` ~458, ~1037–1078; the Lair `reply.ts` ~1068, ~1261; Dungeon Crawler `respond.ts` ~85) goes to the
   template without passing eligibility. A marked place the speaker stands in, or a marked way out of it, still
   reaches the prompt. Say so in the docs and the guide; ★ for the owner (lead's recommendation: the place a
   character stands in counts as known; a marked way out is left out unless known; a later lane).
9. Not placed, or no marked entry and no *kept from* row in the lorebooks read: the prompt is byte-identical and
   the node costs at most two grouped reads.
10. Knowledge-kind rows never appear in: the relationship graph and its sockets, tie ranking
    (`ranking/relationshipRanking.ts`), the ties rendered into a prompt, the link hop
    (`runtime/bindings.relationships.ts` ~425–475), `lorebook-entries@1`'s `withLinks` / `loreLinkRowsOf`
    (`utils/graphEntryLinks.ts`), the Timeline list (`lorebooks/timeline.ts` ~182), relationship embeddings and
    vector search, ruleset tie reads, duplicate detection, the *This session only* card's link items. They **do**
    travel with the lorebook: export / import, the timeless copy, fork history, fold into parent, the table
    registry. ⚠ `relationship_type` is NOT NULL default `'neutral'`: an import path that drops the new column
    would turn a knowledge tie into a visible tie; the export → import test must prove it does not.

## Build

### A. Inventory (supervisor, read-only; file:line in the report)

Every reader and writer of the table: `grep -rlE "narrative_relationships|narrativeRelationships" src/lib`
(raw-SQL readers included: `utils/graphBackfill.ts`, `lorebooks/timeline.ts`, `ranking/relationshipRanking.ts`,
`runtime/bindings.relationships.ts`, `attic/embeddings.ts`, `utils/relationshipVisibility.ts`,
`shared/lorebooks/tieVersions.ts`, `linkVocabulary.ts`), sorted into "must leave knowledge-kind rows out" and
"must carry them"; the CHECK constraints; the source names eligibility blocks; whether pinned / constant entries
pass eligibility (if a pool besides rule 8's bypasses it, list it under the stated limit, do not widen the lane);
where a run knows its speaker, line and date.

### B. Data

- The mark: one column on `lorebook_entries`, default = common knowledge. The kind: one nullable column on
  `narrative_relationships`, NULL for every existing row. **One generated migration** (`npm run db:generate`),
  index **0167** (reserved with the peer session; confirm it exceeds the highest in `drizzle/meta/_journal.json`
  and report it). No seeded rows.
- An upgrade test in the style of `db/messageFirsthandDrop0166.int.test.ts`: existing rows read as before; a
  second boot changes nothing.

### C. One module owns the decision (P2)

Under `src/lib/server/lorebooks/` (🚧 `entryKnowledge.ts`): pure core (marked entry ids, the speaker's cast→entry
rows with line, date and kind, the reading → left-out entry ids with reasons, counts) plus one loader (two
grouped reads at most across all books read; no query per entry) plus the only writers of a knowledge-kind row
and of the mark (lorebook owner only, plan §5.8; server functions for the next lane's screens and for tests, **no
socket or UI here**).

### D. SDK (additive, `@experimental`; list every name)

The query node of rule 7, its binding with `reads<…>()` declared (`boot/declaredReads.test.ts`), the
`validate()` warning. **No shipped pipeline places it in this lane** (the owner rules that next).

### E. Receipt, docs, names

The node's receipt (🚧 *3 entries left out: not known by ‹name›*; the narrator line). The SDK guide section
beside *What a character was there for*, with the wiring and rule 8's limit; `docs/pipelines.md`,
`docs/lorebooks.md`; `NOMENCLATURE.md`: §14 rows for the mark, knowing, the knowledge kinds (charters per P6);
**reconcile** the existing §14 rows **visibility grade** ("How widely known a fact is") and **known** (~952–956)
with the mark in the same change (retire or redefine, recorded in §23 / §25); *kept from* must not be confused
with the firsthand module's `kept…` ids (say so in the row). A recipe fence only if you show a custom rule; then
it joins `guideRecipes.int.test.ts`. No other product's name.

## Files owned

SDK: the new node's contract, its validation, guide text, SDK tests. App: `db/schema.ts` (the two columns), the
generated migration and its test, the new module and tests, each inventoried reader that must leave knowledge
ties out (the filter line only) or carry them, the new node's binding in `pipelines/runtime/bindings.ts`, the receipt,
`registryHashes.test.ts` re-pins with "(was …)", the docs, `NOMENCLATURE.md`.

## Out of scope

Filtering the scene's place listing and its ways (rule 8); any screen: the mark toggle, *Known by*, the character's pool, bulk marking (next lane); ties written by play
(*has been there* at scene close is lane T9); cast Memory; wiring a shipped pipeline; a setting; telling the
model what a character does not know.

## Stop and ask when

CLAUDE.md §Decisions applies; the table's constraints forbid a cast→entry row without loosening a CHECK that
protects other rows; a published
SDK name would have to change; more than one migration is needed.

## Done means

- `npm run sdk:build` from the app root (after the checks above), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t6c2-sdk.log 2>&1"`:
  only the four known failures.
- App tests (each in that capped form with `npx vitest run --maxWorkers=3 <paths>`, strictly one run at a time):
  unmarked → as today; marked and untied → left out with the reason; an ordinary cast→entry tie lets it in; each
  knowing kind lets it in; *kept from* leaves out an unmarked entry; later date wins, same date nearer line wins,
  then *kept from*; undated is earliest; Timeline off ignores dates; a tie on a line the reply does not read or
  dated after the reply does not count; an ended tie does not count; a tie kept in the session's notes counts; narrator reads all; not invoked → byte-identical;
  the entry is blocked when found by entity search and by vector search too; every "must leave out" reader has a
  test that a knowledge-kind row does not appear (graph, prompt ties, tie ranking, link hop, `withLinks`,
  Timeline list, embeddings queue, ruleset ties); the `validate()` warning;
  export → import and the timeless copy carry mark and ties; the migration test; statements added per reply
  (report the number); `declaredReads.test.ts`, `paramsSlotWiring.test.ts`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t6c2-<date>.md`): the inventory with
file:line; the rule as built; every new name and sentence; the migration index; statements added per reply;
changed files in both repos; when you ran `sdk:build`; tests with results; open ★; **Noticed, not done**. Under
about 900 words.
