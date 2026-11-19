# INVENTORY — for the knowledge screens and the SDK write (programme 1.4; read-only, 2026-11-16)

Re-verify every file:line. App paths under `src/lib/`; SDK under `../serene-pub-sdk/`.

## 1. What exists

- Kinds `shared/lorebooks/knowledgeKinds.ts` 2–7: `was_told`, `knows`, `has_been_there`, `kept_from`;
  `isKnowledgeKind` :13. CHECK (`drizzle/0167_entry_knowledge.sql:3`, `db/schema.ts` ~5380): `from_node_id` and
  `to_entry_id` set, `reverse_relationship_type` NULL.
- Server `server/lorebooks/entryKnowledge.ts`: `setEntryCommonKnowledge` :403; `writeKnowledgeTie` :433 (returns
  the tie id; member and entry must be in the book or its session's attached book); `endKnowledgeTie` :498
  (`status='resolved'`); `loadEntryKnowledge` :246, `judgeEntryKnowledge` :97. Owner only, no admin exception;
  refusals :400 *Only the lorebook's owner can say who knows what.*, :408 *…can mark what is common knowledge.*
- **No socket handler, no event, no client caller, no UI.** Writers are called only by tests and by import
  (`server/sockets/lorebooks.ts` ~4449, ~4998–5033). No writer of `has_been_there` / `was_told` exists.
- Graph sockets keep ties out: `sockets/narrativeGraph.shared.ts:347`; update / delete refuse them
  (`narrativeGraph.relationships.ts` 281–283, 487–489).
- The entry's wire shape has no mark: `server/utils/lorebookEntries.ts` 274–330 `toEntryRow`.
- `docs/lorebooks.md:120`: "There is no screen yet for marking an entry or for its knowledge ties."

## 2. Entry editing UI

`client/lorebooks/EntryWorkspace.svelte`: header and Save 2885–3000; the door's editor in a `fieldset`
2976–2988; the entry zone (`BeginningDecayRow`: Keywords, Part of, Pinned, Off) 2719–2800; marks are the
`markToggle` snippet (`aria-pressed`, `preset-pressed`) 2500–2528; the ⋯ `editorMenu` :2530. Doors declare
editor and inspector tabs in `SectionDescriptor` (`sections/types.ts` 60–110, `inspector` :87; tab lists in
`sections/index.ts` 151, 181, 215, 305, 352, 376, 426, 480; counts `editor/inspectorTabs.ts:42`);
`sections/EntryInspector.svelte` 168–205 switches on the tab id (`fires`, `references`, `contains`, `scenes`).
Saves: `writeEntryFields` → `entries:update` (1818–1864); marks through `entries:setMarks`
(`editor/teachMarks.ts:69`; server `sockets/entries.ts` 1521–1604, owner or admin, re-emits `entries:update`).
`Layout.svelte` 243, 381 list which `:error` events surfaces toast themselves. Pushes: `entryChannel`
(`components/lorebookForms/entryManager.ts:169`). References tab: `editor/RefsList.svelte` 40–89 (read-only).
Links are edited on the graph through the `BookRelationships` store (`lorebooks/relationships.svelte.ts` 1–20:
owns `narrativeGraph:list` and pushes, provided by context).

## 3. Cast member UI

`client/lorebooks/CastWorkspace.svelte`: tabs `$derived<PanelTab[]>` 869–886 (Member, Lore, Relationships,
Timeline, Sprites, Gallery), `PanelTabStrip` :2196; tabpanels `hidden={memberTab !== …}`: Member :2203, Lore
2485–2560 (panel-inset list with "Add lore"), Relationships :2563 (`cast/CastRelationships.svelte`), Timeline
:2583. `readOnly = book.readOnly` :245. No Memory section exists.

## 4. Drag and drop

Native: `lorebooks/editor/rowDrag.ts` 1–80 (MIME `application/x-lore-row`, `canDrop`, `onDrop`), used by
`EntryPool.svelte` 165–180, 636, 725 (`data-[drop-target]:ring-2`). `svelte-dnd-action` for reorder and
cross-zone seats (`SessionCharacters.svelte` 84–104, `SessionBenchedSeats.svelte`). Button fallbacks:
`SessionCharacters.svelte` 148–165, `BenchedSeatRow.svelte:79`. No knowledge-pool component exists.

## 5. Bulk actions

`EntryPool.svelte` 488–499 (toggle; `!readOnly && store !== "scenes"`), `BulkEditBar.svelte` (`role="toolbar"`
:370, actions 395–460; one request per entry: `entries:update`, `entries:setMarks`, `entries:delete`),
`bulkEdit.ts` (`BulkAction` 28–37, `planBulk` :65, `runBulk` :155, `bulkReport` :185). NOMENCLATURE:405: bulk
edit does not own "marking not common knowledge (lane T6)".

## 6. SDK write side

`contracts/src/outlets.ts`: `create-lore-entry@1` :1818, `update-lore-entry@1` :1952, `link-lore-entries@1`
:2076 (`review: { fields }`, `causesEvent: lore-link-created@1`), `note-scene@1` :915, `update-cast-member@1`
:2343; event `sdk/src/events.ts` 862–873; conformance C39 `LORE_WRITES` (`conformance/src/index.ts` 2236–2242).
App: `pipelines/runtime/bindings.outlets.ts` 859, 895, 916; `host.ts` `commit()` :2923 (cases ~4382, ~6352,
~6941, ~7153, ~7189); `host.loreWrites.ts` 910–926; pins `boot/registryHashes.test.ts`; panel wording
`config/panel/flows.ts:169`. Held writes: `lorebooks/ownBook.ts` (`loreWriteTargetFor` :399; `applyOverlayItems`
:1940; `takeBackApply` :2518; overlay links exclude knowledge ties :1598); imprints `lore_imprints`.
Recipes: guide fences ` ```js recipe <id> ` run by `pipelines/scripts/guideRecipes.int.test.ts` (runner map
154, 179; fails on an unmapped id :285); today only rescore scripts. No SDK write exists for a tie or the mark.

## 7. Rules and rulings

- Sockets rule, P2 (CLAUDE.md). STYLE-GUIDE: bulk bar 1057–1066 ("What an action did is said under the bar
  (`role="status"`), never in a toast"; a disabled control's reason in `aria-describedby`); tabs 1268–1275; drop
  states 1388–1393; forms 1205–1222; a11y 2422–2441. "Pickers explain why" (owner 2026-10-23).
- NOMENCLATURE:961 **not common knowledge** ("Its only writer is `setEntryCommonKnowledge`"; not in edit
  history); :962 **knowledge tie**; :965 **known**.
- `PLAN-entry-time-and-lines-2026-11-14.md`: :67 "The pool on the character and *Known by* on the entry are the
  two ends of the same ties."; 123–124 "A filter always shows its cause: *not known by ‹name›* … in the entry's
  test view and the character's pool. Bulk-marking entries not common knowledge warns with the count."; 126–127
  owner-only; 225–226 ruled ★15 "knowledge as one list with a three-way switch"; :229 ★3 open (lead: every type
  starts as common knowledge); 312–314 "Yes everyone by default …"; 360–362 "(hand: **Knows** and **Kept
  from**; play's rows show their own reason): 'That works, lets add SDK api for it as well, though we won't plug
  it in anywhere. Can add some recipes for how to use it.'"
