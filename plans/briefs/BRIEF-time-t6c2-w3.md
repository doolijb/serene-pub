# BRIEF — worker `time-t6c2-w3` (app) — knowledge ties stay out of every tie reader, and travel with the lorebook

Supervisor: lane `time-t6c2`. App repo `/home/jody/github/serene-pub`. Another session shares the checkout: touch
only the files below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: **do not run `sdk:build` or `sdk:test`.** You are the only one in the lane running tests while you work; run
them **only** in this capped form, one run at a time, to a log you then Read (never pipe vitest into `head`/`tail`):

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t6c2-w3.log 2>&1"
```

An int test that opens a DB inside an `it` takes a 60 s timeout. Never `prettier --write`; never `git checkout /
restore / stash`; never `kill -9`. Inside `db.transaction(async (tx) => …)` use only `tx`. `socket.off(event)` needs
its handler. Comments state the rule, not the story. No other product's name in any file.

## Background (already built, read it)

- `narrative_relationships.knowledge_kind` (text, nullable; Drizzle `knowledgeKind`, `src/lib/server/db/schema.ts`
  ~5254–5275) and `lorebook_entries.not_common_knowledge` (boolean, default false; Drizzle `notCommonKnowledge`),
  migration `drizzle/0167_entry_knowledge.sql`. CHECK `narrative_relationships_knowledge_check`: a non-NULL kind is
  one of `was_told · knows · has_been_there · kept_from` on a row from a cast binding (`from_node_id`) to an entry
  (`to_entry_id`), with no reverse relationship type. `src/lib/shared/lorebooks/knowledgeKinds.ts` holds the kinds
  (`isKnowledgeKind`).
- The only writer: `src/lib/server/lorebooks/entryKnowledge.ts` (`writeKnowledgeTie`, `endKnowledgeTie`,
  `setEntryCommonKnowledge`). A knowledge row's `relationship_type` equals its kind. Use these writers in tests.

## Rulings this serves (quoted)

- Plan §5 rule 5 (owner-ruled 2026-11-14): "Knowledge ties are a kind of their own, left out of the relationship
  graph, tie ranking and the ties in the prompt."
- The lane's rule 10: knowledge-kind rows never appear in: the relationship graph and its sockets, tie ranking, the
  ties rendered into a prompt, the link hop, `lorebook-entries@1`'s `withLinks` / `loreLinkRowsOf`, the Timeline,
  relationship embeddings and vector search, ruleset tie reads, duplicate detection, the *This session only* card's
  link items. They **do** travel with the lorebook: export / import, the timeless copy, fork history, fold into
  parent, the table registry. ⚠ `relationship_type` is NOT NULL default `'neutral'`: an import path that drops the
  new column would turn a knowledge tie into a visible tie; the export → import test must prove it does not.
- "0.6 is in users' hands": nothing here changes stored data; files exported before this change import unchanged.

## Files owned — each change is the filter line (or the one carried field), nothing else

LEAVE OUT (add `isNull(knowledgeKind)` / `knowledge_kind IS NULL` to the existing where; verify each line number
first, they are from an inventory):
1. `src/lib/server/utils/graphEntryLinks.ts` ~147–157 `bookEntryLinks` (this one covers the link hop,
   `withLinks`, `loreLinkRowsOf` and `graph_entry_links`).
2. `src/lib/server/sockets/narrativeGraph.ts` ~711–717 `buildGraphList`, and ~3486–3492 the apply-proposal reply's
   read. ~5199–5223 the merge's `sameLink` fold: also compare `knowledgeKind` (two rows differing in kind are not
   the same link).
3. `src/lib/server/lorebooks/timeline.ts` ~182, the `dated` EXISTS check.
4. `src/lib/server/rulesets/read.ts` ~535–562 `tiesBetween`.
5. `src/lib/server/rulesets/ties.ts` ~386–401 `rowForSide`.
6. `src/lib/server/lorebooks/notesShown.ts` ~110 `writtenNotesOf` (if `byBook` is generic, the smallest change
   that lets this one table's read carry the extra where).
7. `src/lib/server/lorebooks/ownBook.ts` ~1589–1603 `standaloneLinksOf` (the *This session only* card).
8. `src/lib/server/utils/relationshipGuards.ts` ~218–236 `findLinkedThatWay`, ~253–285 `sharesASentence`,
   ~355–380 `linksOnReadingThatWay`: an ordinary link never collides with a knowledge tie (filter them out).
9. `src/lib/server/lorebooks/timelessCopy.ts` ~108–131 `tieKeyOf`: the key includes `knowledgeKind`.

CARRY:
10. `src/lib/server/utils/lorebookExportMapper.ts`: `mapNarrativeRelationship` (~1015–1062) writes `knowledgeKind`
    when set (only then); `ExportedNarrativeRelationship` (~952) and `NarrativeRelationshipLike` (~979) gain it.
    The entry's mark travels beside `decayRate` in the entry's Serene Pub bag (`beginningAndDecay` ~337 writes
    `notCommonKnowledge: true` only when set; `importedBeginningAndDecay` ~355 reads it back as a boolean, `true`
    only for a literal `true`). Rename neither function; extend their JSDoc by one clause and their return types.
11. Import: `src/lib/server/sockets/lorebooks.ts` `restoreNarrativeGraph` (~4561; insert ~4846–4862): carry
    `knowledgeKind` when `isKnowledgeKind(rel.knowledgeKind)` and the resolved endpoints are cast→entry; a row
    whose file says a knowledge kind but cannot be stored as one (wrong endpoints) is **skipped**, never stored as
    an ordinary tie; a knowledge row skips the `findLinkedThatWay` dedupe (~4842). Wherever the entry import
    applies `importedBeginningAndDecay`, the mark lands on `notCommonKnowledge` the same way. Verify by reading
    how `decayRate` reaches the insert.
    Also check the lorebook export builder (`src/lib/server/utils/lorebookExportBuilder.ts` ~375–383) reads every
    column it needs (if it selects named columns, add `knowledgeKind` / `notCommonKnowledge`).

## Tests (new files; owned)

12. **`src/lib/server/lorebooks/knowledgeTiesHidden.int.test.ts`** — one fixture: a lorebook with two cast members
    A and B (cast↔cast tie A→B), an entry E, an ordinary cast→entry link A→E (kind NULL) where useful, and a
    knowledge tie A→E written by `writeKnowledgeTie` (and one `kept_from`). For each reader below, assert the
    knowledge row does not appear while the ordinary rows still do (so the test proves the filter, not an empty
    read): the graph list (`buildGraphList` or the function behind `narrativeGraph:list`); the prompt's ties and
    the ranked ties (the `graph_relationships` read / `collectGraphLayers` path in
    `src/lib/server/utils/graphContextFormatter.ts`, already cast↔cast only — the test pins it); the link hop and
    `withLinks` (`readGraphEntryLinks` / `loreLinkRowsOf`, `utils/graphEntryLinks.ts`); the Timeline's `dated`
    check (`lorebooks/timeline.ts`: a dated knowledge row alone does not make the book dated); the embeddings queue
    (`src/lib/server/embedding/vectorizationQueue.ts` `pickNarrativeRelationship` / `countUnembedded`, already
    cast↔cast only — pin it); ruleset ties (`tiesBetween`, `rulesets/read.ts`); duplicate detection
    (`utils/duplicateBindingDetection.ts`, pin); the *This session only* card (`standaloneLinksOf` /
    `overlayItemsOf`, `ownBook.ts`, with the knowledge row kept in a session's notes); `findLinkedThatWay` does not
    refuse an ordinary link with the same words as a knowledge tie. Find existing int tests for each reader first
    (`grep -rln "<function>" src/lib --include=*.int.test.ts`) and reuse their fixture helpers; if a reader is
    impractical to reach, say so in the report rather than skipping silently.
13. **`src/lib/server/lorebooks/knowledgeTiesTravel.int.test.ts`** — a marked entry and three knowledge ties (one
    `kept_from`, one dated by a history entry): **export → import** into a new book keeps the mark and each tie
    with its kind and `relationship_type` (and no knowledge tie arrives as an ordinary tie); an exported file from
    before (no `knowledgeKind`, no `notCommonKnowledge`) imports as today (unmarked, kind NULL); a file row with a
    knowledge kind on entry→entry endpoints is skipped; the **timeless copy** (`lorebooks/timelessCopy.ts`) keeps
    the mark and the ties (two kinds between the same pair are two rows); a lorebook **duplicate**
    (`utils/lorebookDuplicate.ts` / `tableRegistry` copy) keeps them. Find the existing export/import and timeless
    copy int tests and reuse their helpers.

## Out of scope

The decision module, the SDK, the pipeline binding, docs, NOMENCLATURE, any UI or socket event, any reader not
listed (if you find another reader that admits cast→entry rows, report it under **Noticed, not done**; don't fix
it). `castTags.ts`, `forkHistory.ts`, `clockMoveBack.ts`, `imprints.ts`, `graphBackfill.ts` stay unfiltered.

## Stop and ask when

CLAUDE.md §Decisions applies; a filter would change what an ordinary (kind NULL) row does anywhere; a change needs a
file not listed; an existing test breaks for a reason that is not a knowledge row.

## Done means

- Capped runs green: your two new files, plus the existing tests of each file you touched that you can find
  (list them; e.g. `graphEntryLinks`, `timelessCopy`, `relationshipGuards`, `lorebookExportMapper`, `notesShown`,
  `rulesets/read` tests). Report failures that predate you with evidence (same failure on the untouched code path).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — no error in your files.
- `npx prettier --check` on your two new files.

## Report

`/home/jody/github/serene-pub/plans/briefs/REPORT-time-t6c2-w3.md`: every changed line range per file, each reader
you verified as already excluded, tests run with results, decisions, **Noticed, not done**.
