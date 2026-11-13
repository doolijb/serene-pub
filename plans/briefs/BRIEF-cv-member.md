# BRIEF cv-member — wave 2: the member side writes versions

Lane-supervisor (fresh, Opus). Read `BRIEF-cv-common.md` first, then `plans/REPORT-cv-core-2026-11-05.md` (the writer you call), plan §32 §8–§9 and §33. Lane id **cv-member**. Two workers at most. Concurrent **cv-time**, **cv-writers** — don't edit theirs.

## Items
1. **Member saves write versions:** `sockets/lorebooks.ts` (member create/update/`updateBinding`, retold edits, own names, face, timbre, node state/visibility, overlay rows) through `writeCastVersion` (author path) / `insertCastMember`; the member insert sites ~1214/~1567/~2884/~3574 onto `insertCastMember`. A member page edit of an older version prompts per ★CV-13 (_2 later versions keep their own words_ + **Change later versions too** — server: an option that applies the same field change to later versions on that line).
2. **Dated changes become versions:** `sockets/amendments.ts` — create/update/delete of a dated change writes/edits/removes a cast version (date, line, life point); the read side lists versions as the **Changes** list (★CV-20: same words, each row a version showing what changed from the one before). `cast_amendments` stops being written (frozen).
3. `lorebooks/retold.ts`, `lorebooks/castOwnNames.ts`: read/write through versions (retold flags → `follows`).
4. `utils/characterBindingSync.ts` `syncLorebookBindingsForCharacter`: the name/alias sync also writes the member's base version (cv-core noted new members read with no aliases until then).
5. `lorebooks/tableRegistry.ts`: register `character_versions` (copy with the book, remapping ids and parents; purge with it); `tableRegistry.test` green again.
6. `utils/forkHistory.ts`, `state/storyTime.ts`, `annotations` (NER vocabulary: members from versions, card-less members included), `sessions/rowProjection.ts`, `sockets/narrativeGraph.ts` (graph state and visibility from versions ★CV-10; its insert sites ~2597/~5305 onto `insertCastMember`).
7. **Tests** per item; the member page round trip (edit → version → read); a dated change round trip; registry copy/purge.

## Files owned
`sockets/lorebooks.ts`, `sockets/amendments.ts`, `lorebooks/{retold,castOwnNames,tableRegistry}.ts`, `utils/characterBindingSync.ts` (the sync), `utils/forkHistory.ts`, `state/storyTime.ts`, `src/lib/server/annotations/**`, `sessions/rowProjection.ts`, `sockets/narrativeGraph.ts`, tests, `NOMENCLATURE.md` §25. Not the client (wave 3).
