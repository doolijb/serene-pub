# REPORT — lane `time-t6c2` (2026-11-15): the *not common knowledge* mark and knowledge ties (opt-in; no shipped pipeline places the node)

Saved by the lead from the supervisor's report.

## Inventory (file:line, checked)

- **Readers that now leave knowledge ties out** (one filter line each): `utils/graphEntryLinks.ts` ~147
  `bookEntryLinks` (covers the link hop, `withLinks`, `loreLinkRowsOf`, `graph_entry_links`);
  `sockets/narrativeGraph.ts` ~711 `buildGraphList`, ~3486 the apply-proposal reply, `sameLink` ~5199 also
  compares the kind; `lorebooks/timeline.ts:182`; `rulesets/read.ts` ~550 `tiesBetween`, `rulesets/ties.ts` ~386
  `rowForSide`; `lorebooks/notesShown.ts` ~115, `lorebooks/ownBook.ts` ~1596 `standaloneLinksOf`;
  `utils/relationshipGuards.ts` (`findLinkedThatWay`, `sharesASentence`, `linksOnReadingThatWay`);
  `lorebooks/timelessCopy.ts` ~129 (the tie key includes the kind).
- **Already cast↔cast only, now pinned by tests:** `graphContextFormatter.ts` (`castEdgeOnly` :426),
  `vectorizationQueue.ts` :1771, :1909, `ragContext.ts:713`, `duplicateBindingDetection.ts:84`, `tieVersions.ts`.
- **Carry the new columns:** export mapper (`mapNarrativeRelationship`, `beginningAndDecay` /
  `importedBeginningAndDecay`), `lorebookExportBuilder.ts:114`, import `restoreNarrativeGraph`
  (`sockets/lorebooks.ts` ~4846–4884). Table registry, timeless copy, fork history, fold into parent and
  imprints copy whole rows.
- **CHECKs:** cast→entry rows were already legal; the new CHECK loosens nothing.
- **Eligibility sources:** `worldLore`, `characterLore`, `history` (`historyEntry` aliased,
  `ranking/eligibility.ts` ~78). Pinned entries reach eligibility as ordinary candidates. The place listing is
  the only pool that bypasses eligibility (rule 8).
- **Speaker, line, date:** `$.input.speaker` → `seatOf` → cast member (`lorebook_bindings.id`); line and date
  from `sessionReadingOf`.

## The rule as built

Brief rules 1–7 and 9. Supervisor's choices: a tie kept in the session's notes (with an attached lorebook) is
the session's own: its branch is not judged, only its date, and it counts as the nearest line;
`endKnowledgeTie` sets `status = 'resolved'` (`ended` is not in `RELATIONSHIP_STATUSES`); a knowledge row's
`relationship_type` repeats its kind; the node is not optional (a failure fails the step); import skips a row
naming a knowledge kind on the wrong ends.

## New names (all 🚧, NOMENCLATURE §25)

Columns `lorebook_entries.not_common_knowledge`, `narrative_relationships.knowledge_kind`
(`was_told · knows · has_been_there · kept_from`); CHECK `narrative_relationships_knowledge_check`; node
`core:query/unknown-entries@1` (`C.unknownEntries`, *Entries not known*; outputs `main`, `exclusions`);
`validate()` law `entry knowledge 2026-11-15`; `shared/lorebooks/knowledgeKinds.ts`;
`lorebooks/entryKnowledge.ts` (`judgeEntryKnowledge`, `loadEntryKnowledge`, `setEntryCommonKnowledge`,
`writeKnowledgeTie`, `endKnowledgeTie`, `knowledgeExclusions`, receipts, `KNOWLEDGE_SOURCES`). Reasons: *Not
known by ‹name›.* · *Kept from ‹name›.* Receipts: *‹n› entries left out: not known by ‹name›* (kept-from and
mixed forms) · *No entries left out for ‹name›* · *No entries left out: nothing here is marked not common
knowledge or kept from anyone*. Refusals: *Only the lorebook's owner can mark what is common knowledge.* · *Only
the lorebook's owner can say who knows what.* Retired: §14 *visibility grade* (§23); §14 **known** redefined.

## Migration

`0167_entry_knowledge`, generated: two `ADD COLUMN`s and the CHECK.

## Statements added per reply

Not placed 0; narrator's turn 0; placed, nothing marked and no *kept from* 1; judged with ties 15 (ceiling 20).

## Changed files

SDK: `contracts/src/queries.ts`, `sdk/src/validate.ts`, `sdk-tests/unknownEntries.test.ts`,
`guides/genres-presets-and-routines.md` (*What a character does not know*). App: `db/schema.ts`,
`drizzle/0167_entry_knowledge.sql` + snapshot + journal, `shared/lorebooks/knowledgeKinds.ts`,
`lorebooks/entryKnowledge.ts`, the readers above, export mapper and builder, `sockets/lorebooks.ts`,
`pipelines/runtime/bindings.ts`, `pipelines/boot/registryHashes.test.ts` (`unknown-entries` →
`156b3a840fe94b`, new), `declaredReads.test.ts`, `docs/pipelines.md`, `docs/lorebooks.md`, `NOMENCLATURE.md`.
Tests: `db/entryKnowledge0167.int.test.ts`, `lorebooks/entryKnowledge.test.ts`, `entryKnowledge.int.test.ts`,
`knowledgeTiesHidden.int.test.ts`, `knowledgeTiesTravel.int.test.ts`,
`runtime/bindings.entryKnowledge.int.test.ts`, `ranking/eligibility.entryKnowledge.test.ts`.

## Verification (lane's)

`sdk:build` 18:50. `sdk:test` 4758, the four known failures (a fifth, in the new test, fixed; 6/6 alone). App
capped run (`plans/time-t6c2-lead2.log`): 11 files, 102 pass, 2 fail (the `paramsSlotWiring` baseline). `tsc`
0; `npm run check` 0 errors.

## Open ★

- ★T6C2-1 all names and sentences.
- ★T6C2-2 the scene's place listing is not filtered (lead: the place a character stands in counts as known; a
  marked way out is left out unless known).
- ★T6C2-3 the node is not optional.
- ★T6C2-4 an ended knowledge tie is `resolved`.
- ★T6C2-5 a notes tie's branch is not judged; it counts as the nearest line.
- ★T6C2-6 *visibility grade* retired, **known** redefined.

## Queued

INTEGRATING.md §1p line for `core:query/unknown-entries@1`.

## Noticed, not done

- `lorebookExportBuilder` `toEntryRow` drops the mark; the builder adds it itself.
- The schema comment on `narrative_relationships.status` names `ended`, which the vocabulary does not have.
- Import drops every tie's date and branch, knowledge ties included.
- The take-back `linked` check (`ownBook.ts` ~2575) still counts knowledge rows.
- `castTags.ts` still rewrites tags in knowledge rows (deliberate).
- `lorebook-triggers@1` and recursion are not filtered (stated in the docs and the guide).
- The entry's wire shape does not carry the mark yet (next lane).
- Worker reports w1, w3, w4 disappeared from `plans/` and `plans/briefs/`; only w2's remains.
- Unattributed `/tmp/serene-pub-vitest-*` dirs left in place.

## Scope review and lead fixes (2026-11-15)

Scope review: nothing outside the owned files, no setting, migration clean, the decision matches rules 2, 4, 5.
Four findings, fixed by the lead:

1. A left-out entry's **name** still reaches the prompt through links (the relationships read's link hop,
   `bindings.relationships.ts` ~196–239; `withLinks`, `graphEntryLinks.ts` ~336–359). Not widened: added to the
   limits in the guide, the node's JSDoc and `docs/pipelines.md`; folded into ★T6C2-2.
2. The graph socket's update and delete handlers (`sockets/narrativeGraph.ts` ~3841, ~4045) accepted a
   knowledge row. Both now answer *That link is not in this lorebook.* (an existing sentence), so
   `entryKnowledge.ts` is the only writer.
3. `KNOWING_KINDS` (unused) removed.
4. The 15 statements when judged: 2 are the loader's grouped reads; about 13 are `seatOf`, `membersAsRead` and
   `sessionReadingOf` resolving the speaker and the reading.

Also: NOMENCLATURE §14 heading no longer says "designed, not built".

## Grouped verification (lead, 2026-11-15)

- Full vitest run 8 (`plans/lead-full8.log`): 2,510 files, 21 failed, 26 tests failed; the same 21 files as run 7, none new.
- `npm run build`: exit 0. `tsc --noEmit`: 0 errors. `npm run check`: 0 errors, 9 warnings (standing).
