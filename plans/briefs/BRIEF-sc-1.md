# BRIEF — build lane `sc-1` — change history for a scene's cast (owner ruling SC1 of 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then the SC1 and B2 lines in `plans/PLAN-programme-2026-11-15.md` ("third
answers"; "B2, confirmed"), `plans/REPORT-wt-1a-2026-11-17.md` (the scene-cast rule: who writes a scene's
cast and when; the open-scene refresh and its statement ceilings; the SC2 section), the second cold-review
section of `plans/briefs/BRIEF-wt-1.md` (objection 1: why this needs a migration; objection 2: the list of
writers), `plans/REPORT-el-1a-2026-11-17.md` (migration `0169`; the scene lock: a locked scene's cast is not
redrawn), the docs page on change history / edit history (grep `docs/` for "change history", "history of
changes", "redline"), `NOMENCLATURE.md` §1, §24 and rows **change history**, **redline**, **scene's cast**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. Never run
prettier with `--write` or pipe its output into a file. **One generated migration** (`npm run db:generate`
once, after the schema edit; its index must exceed `0169`; never hand-written or edited; no boot pass; a
second boot changes nothing; existing rows unchanged). Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/sc-1-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No SDK build, no full run, no
`npm run build`. Comments state the rule, never the history. Views never toast. In tests remove only your
own temp directories by exact path.

## Owner (2026-11-17)

B2: "hand edits aren't treated differently. Just keep a change history so a user can overwrite."
SC1 (asked: change history for a scene's cast needs a small migration): "Go: add a scene as a subject of
change history, and a cause for the compiler's writes" (as described to him: every change to a scene's cast
is kept; a person opens the history and brings a version back; one migration; no existing rows change).
Standing: the latest write of a scene's cast stands; a scene's cast lists who spoke (B1, SC2); P2 (one
writer of one thing); change history exists today for lorebook entries and character versions.

## What exists (verify)

`lore_redlines` records changes for two subjects: an entry or a character version (CHECK
`(entry_id IS NULL) <> (character_version_id IS NULL)`, `db/schema.ts` ~11076–11078; causes
`save|routine|apply|revert|take-back|restore`, ~11080; the only writer `recordRedline`,
`lorebooks/redlines.ts` ~198–206, takes `{ entryId } | { characterVersionId }`). A scene's cast is rows in
`scene_characters` (schema ~5068–5090), written by: the live compiler (`scenes/liveScenes.ts`
`writeProposedCast` / `refreshOpenSceneCast`: open, close, move, merge, refresh), the summary's Review & Save
and a person's edits through `scenes:update` / `scenes:create` (`sockets/scenes.ts`), the graph build's apply
(`sockets/narrativeGraph.apply.ts` ~1688–1712), import (`sockets/lorebooks.ts` ~4434), merge remap
(`narrativeGraph.merge.ts` ~1678).

## Build

1. **Schema + migration:** a scene becomes a third subject of change history: a nullable `scene_id` on
   `lore_redlines` (references `scenes`, cascade as the other subjects do), the subject CHECK widened to
   "exactly one of the three", and **one new cause** for the scene compiler's own writes (🚧 name by §24: the
   existing causes are verbs of who or what wrote; e.g. `compile`; ★ with one alternative; do not reuse
   `routine`: R1). What a redline row stores for a scene's cast: the cast before and after, in the shape the
   table already uses for an entry's fields (read how entry redlines store a diff: columns or a JSON
   before / after) so the existing reader can show it; if the existing columns cannot hold a list of cast
   members without a second new column, say so before generating and include it in the same migration.
2. **Recording.** One function records a scene-cast change (extend `recordRedline` to take `{ sceneId }`; do
   not add a second writer). Every writer of `scene_characters` listed above calls it when the cast actually
   changes (no row when nothing changed): a person's save (`save`), the compiler (the new cause), the summary
   review (a person's `save`), the graph build's apply and import (decide the truthful cause for each from
   the existing set; say which), a restore (`restore`). **The open-scene refresh runs once per line**: it
   writes a redline only when it adds a speaker (it writes nothing otherwise, so the 5-statement ceiling for
   a listed speaker holds; a new speaker's ceiling may rise by the one insert: re-pin and report the number).
   Inside a transaction use `tx`.
3. **Reading and bringing a version back.** Where a person can see a scene's cast and edit it (the scene
   form / the scene's page in the lorebook: `SceneForm.svelte`, `SceneCastChips.svelte`), add the scene's
   change history the way an entry shows its own (reuse the entry history component and its socket if they
   can take a scene subject; if they are entry-specific, add the smallest scene variant and say why), listing
   each change with its cause and time, and **Restore this version**, which writes the cast as it was (a
   person's write: `restore`), itself recorded. Access: whoever may edit the scene. A locked scene
   (`scene_lock`, lane `el-1a`): the compiler does not redraw it, so no compiler rows appear while locked; a
   person's restore still works. Reuse existing words for history and restore; any new label is ★ with one
   alternative.
4. **Retention:** follow what entry redlines do (find any cap or pruning) and apply the same to scene rows;
   if entries have none, add none and report the growth rate for a long scene (one row per new speaker plus
   boundary recomputes).
5. **Export / import:** lane `io-1`'s column guard classifies every lorebook column (grep `REPORT-io-1` in
   `plans/` for the test): classify the new column(s); history is not exported today for entries: do the
   same for scenes (say so).
6. Docs (the change-history page; `docs/lorebook-cast.md` / wherever a scene's cast is described);
   NOMENCLATURE rows **change history** (three subjects now), the new cause, §25 quoting SC1 and B2.

## Tests

The migration applies; a second boot changes nothing; existing redline rows still read. Each writer: a
change records one row with the right cause and before / after; no change records nothing. The refresh:
listed speaker ≤ 5 statements still; new speaker's new ceiling pinned. Restore brings the earlier cast back
and records itself. A person who may not edit the scene cannot read its history or restore. A locked scene.
Both prompt baselines unchanged (they open no scene); statements per reply not higher. Client DOM for the
history list and Restore. `tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`db/schema.ts` (`lore_redlines`) and the generated migration; `lorebooks/redlines.ts`; the scene-cast writers
(their one recording call): `scenes/liveScenes.ts`, `sockets/scenes.ts`, `sockets/narrativeGraph.apply.ts`,
`sockets/lorebooks.ts` (the import site only), `narrativeGraph.merge.ts`; the redlines socket and the history
component (or its scene variant); `SceneForm.svelte` / the scene page; tests; docs; NOMENCLATURE. Live lanes
may hold: `state/handEdits.ts`, `state/write.ts`, cast member writers and page (`el-1b`); seat code
(`gs-3a3b` follow-ups). Shared files (`db/schema.ts`, `shared/sockets/types.ts`, `docs/*`,
`NOMENCLATURE.md`): re-read right before each edit; **only this lane may run `db:generate` now**: if
`drizzle/meta/_journal.json` shows an index above `0169` that is not yours, stop and report.

## Stop and ask when

CLAUDE.md §Decisions applies; the redline table cannot hold a cast diff without more than the planned
column(s); recording would add a statement to every line of an open scene; the entry history reader cannot
take a third subject without a rewrite (report the size first); a published SDK name would be needed.

## Report

Final message = the report (lead saves `plans/REPORT-sc-1-<date>.md`), under about 600 words: the migration
(file, index, columns, the CHECK, the cause's name); what a row stores; each writer and its cause; the
refresh's statement numbers; the history view and Restore (where, who, words ★); retention; tests;
**Noticed, not done**.

## Cold review corrections (2026-11-17 night) — these rule over the text above

1. **Names and counts.** There is no "change history" row: the term is **redline · Edit history**
   (`NOMENCLATURE.md:1811`; the UI label is "Edit history"). It already has **three** subjects (entry, card
   version, cast version: `db/schema.ts:11041`, `lorebooks/redlines.ts` 2–3); a scene is the **fourth**, with
   `scene_id` as the third key column. Line references drifted: the subject CHECK is at ~11108–11111, the
   cause CHECK ~11112–11115, `scene_characters` ~5091–5113. The cause CHECK has never been widened (0161
   created it; 0163 added the subject CHECK and `character_version_id`): drizzle generates a drop and add of
   the constraint, safe because every existing row meets the wider CHECK. Other places that list causes:
   `REDLINE_CAUSES` (`redlines.ts:41`), `shared/sockets/types.ts:59`, `REDLINE_CAUSE_LABELS`
   (`editHistoryCopy.ts:12`, a typed Record), the NOMENCLATURE row. `whoReader` would show the new cause as
   "By itself, from ‹session›" (`sockets/redlines.ts` 156–162): check that reads right (★).
   **Storage:** the `changes` jsonb `{ key: { before, after } }` holds the cast list under one key: no second
   column.
2. **Record in the one low-level writer** (P2): every cast write except `repointSceneCast` goes through
   `writeSceneCast` (`utils/sceneCast.ts:153`); every compiler write through `writeProposedCast`
   (`scenes/liveScenes.ts` 1294–1335). Follow the existing pattern (`characters/versions.ts:564`,
   `sockets/lorebooks.ts:1768`, `sockets/redlines.ts:747`): `writeSceneCast` takes an optional
   `redline?: { by, cause }`; when passed it reads the participants before writing on the same handle and
   calls `recordRedline({ sceneId, … })`. `utils/sceneCast.ts` joins Files owned. No call-site recording.
3. **No row when nothing changed, and none for a new scene.** Compare **sorted id sets** (`recordRedline`
   compares lists in order, `redlines.ts:93`; the refresh appends, a recompute orders speakers then tagged
   members, `liveScenes.ts` 1696–1712: the same members in a different order must record nothing). **Creating
   a scene, importing one, and the compiler's first write when a scene opens record nothing**
   (`docs/lorebooks.md:84`: what is not kept: "adding it or importing it"): so `scenes:create`
   (`sockets/scenes.ts` 507–520), import (`sockets/lorebooks.ts` ~4451–4472: **no edit there at all**) and
   the open write pass no `redline`.
4. **Structural id remaps are exempt** (★ in the report): a cast-member **merge** rewrites every affected
   scene's cast through `repointSceneCast` (`narrativeGraph.merge.ts:1104`; `utils/sceneCast.ts` 199–257),
   bypassing `writeSceneCast`; **fold** remaps member ids in place (`lorebooks/foldInParent.ts` 840–850);
   `narrativeGraph.merge.ts:1678` is the **undo** of a merge. None records a row (the cast did not change:
   its members' ids did). But stored redline rows keep raw member ids with no foreign key: **Restore must
   survive ids that no longer exist**: send Restore through the `scenes:update` save path, where
   `filterCharacterIdsToLorebook` (`sockets/scenes.ts` 104–116) drops ids that are gone and the
   lore-writes-Off refusal applies; pass the stored **mentioned** list along (`carriesCast` writes
   `mentionedCharacters ?? []`, `scenes.ts` 688–698, 877: a restore carrying participants only would clear
   the mentioned rows). On the read side resolve ids to **names** (the reader prints `String(v)`,
   `editHistoryCopy.ts` 78–87: a person would see bare ids); an id whose member is gone shows as a member no
   longer in the lorebook (reuse existing words for a gone subject if any; else ★).
5. **Cost, stated truthfully:** `recordRedline` is an insert plus `keepNewest`'s select, plus a delete once a
   subject holds more than 50 rows (`redlines.ts` 172–188, 196–215): a new speaker costs **+2** statements
   (+3 when evicting): pin both. The refresh paths already hold `stored` (`liveScenes.ts` 1355, 1457): no
   extra read there. The full recompute (`proposeAndWriteCast` → `writeProposedCast`, 1253–1260) does not
   load the earlier cast: one more read per close / move / merge (not per line): say so. A listed speaker's
   line stays ≤ 5.
6. **Scope, count and clear.** `scopeWhere`'s lorebook scope covers entries and cast versions only
   (`redlines.ts` 561–576) and is used by Share as a lorebook (`lorebooks/ownBook.ts` 1296–1298) and Book
   settings' count and clear (`sockets/redlines.ts` 383–430); `keepNewest` takes two kinds of subject
   (196–207); `docs/lorebooks.md:86` promises "Share as a lorebook clears it" and that Book settings clears
   "the whole lorebook's". Add a `scenes.lorebook_id` subquery to `scopeWhere`, a scene case to `keepNewest`,
   scene rows to the registry count (`lorebooks/tableRegistry.ts` 669–681); the copy "across its entries and
   cast" (`editHistoryCopy.ts` 58–60) gains scenes (★ wording).
7. **Not this lane (Noticed):** Back deletes a scene opened at the taken row (`liveScenes.ts:2773`) and
   Forward reinserts only the scene row (2871): the scene comes back without its cast today, and would come
   back without its history rows.
8. **Shared files:** `lorebooks/tableRegistry.ts` (a lane finished there an hour ago), `db/schema.ts`,
   `shared/sockets/types.ts`, `docs/*`, `NOMENCLATURE.md`: re-read right before each edit. Live lane
   `gs-3a3b-2`: `sessions/seats.ts`, `sessions/seatKeys.ts`, `sessions/guestSeats.ts`,
   `sockets/sessions.update.ts`, `state/write.ts:763`, `lorebooks/entryKnowledge.ts:342`,
   `pipelines/runtime/bindings.outlets.ts:644`, the seat form components: not yours.
