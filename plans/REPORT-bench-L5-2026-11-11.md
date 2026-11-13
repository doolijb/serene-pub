# REPORT — bench-L5: docs and vocabulary for benched seats — 2026-11-11

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-bench-L5-w{1,2}.md`. No code changed by the lane.

## Changed
- **Docs:**
  - `sessions.md`: Participants rewritten (Bench, Benched, no Removed, upgrade, guests, the on-the-bench lines);
  - `group-sessions.md`: "Bench a seat" `#bench-a-seat`;
  - `characters.md`, `coming-from-sillytavern.md`, `session-layout.md`: links;
  - `document-view.md`;
  - `genre-dungeon-crawler.md`: companions seen, can die, can be revived; a hero's new character benches the old seat;
  - `pipelines.md`: Bench or bring back a seat, `writes.seats`;
  - `lorebook-cast.md`: background = no seat in play;
  - `context-templates.md`;
  - `upgrading-from-0.5.md`;
  - the generated docs rebuilt.
- **SDK docs:** `INTEGRATING.md` §1m Benched seats; `guides/forms-and-effects.md` `writes.seats`.
- **NOMENCLATURE:**
  - §4: the outlet.
  - §8: background member (the deceased arm removed).
  - §9: benched seat (charter, with all names) and "a seat in play" (R1 warning); seat, writes, enabled, DC, the fallen and core runtime keys amended.
  - §22: Bench → `Armchair` (⚠ shared with Take a seat), Fell in the story → `Skull`.
  - §23: four retired rows.
  - §25: one block, 11 rows.
- **STYLE-GUIDE:** no change.

## Tests
- `docs:build`: OK. Docs vitest: 7 files, 86/86.
- SDK `guides`/`docsLaws`/`guideSnippets`: 48/48.

## Lead follow-ups (2026-11-11)
- `benchedSeats.ts`: "a proposed field" comments → "host-filled on `sessions:get`".
- SDK `core-catalog/src/registry/widgets.ts` `showBenched` description → "List the benched characters (Participants › Benched) under the order." (retired "switched off" wording). Needs the sdk:build in the final verification.

## Open ★
- **bench-L5-1:** `Armchair` is both Take a seat and Bench. Recommended: record it as the icon for the seat itself, with the label giving the direction. The alternative is a new glyph for Bench.

## Noticed, not done
- `unseat`'s bench-on-remove is reached only by server paths (the UI has no Remove on a seat in play).
- `sessions:reassignRemovedParticipant` and the `setCastSeatEnabled` JSDoc still use the old wording (⚠ in NOMENCLATURE).
- The departed→removed rename is open.
- Older §25 rows mention superseded terms (history).
