# REPORT — adv-E: docs, vocabulary, style guide — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-adv-E-w1.md`, `BRIEF-adv-E-w2.md`. No code changed in this lane.

## Changed files
- **docs:**
  - `themes-and-settings.md`: a new first card and a new `### Show advanced controls` section; *Show all character fields* removed.
  - `sessions.md`: start, settings, read-only reading, the message-menu row, Branch from here, Author's note.
  - `session-layout.md`: three entry points. "Nobody can open" became "you can't".
  - `getting-around.md`, `session-actions.md`.
  - `characters.md:117,123`.
  - `lorebooks.md`: the fold, the lenses, Book settings.
  - `lorebook-time.md`, `lorebook-cast.md`, `summarization.md`, `lorebook-places.md`, `component-authoring.md`.
  - The generated docs, rebuilt by `npm run docs:build` (157 pages).
- **NOMENCLATURE.md:**
  - §26 **advanced controls** (charter) and `AdvancedHiddenLine`.
  - §9 `ViewerV1.advancedControls`, `lockedByAdvanced`, `ActionListDeps.advancedControls`.
  - §8 `lensesShown`, `lensShown`, the LensTrack prop.
  - §23 retires *Show all character fields* / *Show all fields* (the column and event stay unread until RC1).
  - §25 ledger block.
- **STYLE-GUIDE.md:** §6.21 gets the hidden-controls line pattern. §10's example became "Show advanced controls".

## Tests
- `docs:build` succeeded. Docs tests: 7 files, 86 tests, green.
- `docsDist.budgets.test.ts` (under `test:budgets`) fails, but it was failing before this lane: 4.27 MB against a 3.00 MB budget.

## ★ (lead decisions, 2026-11-10)
- **★adv-E-1:** no prose name. The line is named by its code name and its words; *hidden line* already means a hidden message line.
- **★adv-E-2:** `LensTrack`'s prop was renamed `advanced` → `advancedControls` by the lead (LensTrack, LorebooksWorkspace, two tests, the NOMENCLATURE rows). Lens tests: 3 files, 23 tests, green.

## Noticed, not done
1. STYLE-GUIDE §6.4 (:1183) still uses the retired *Show all fields* as its example of a switch that reshapes a form.
2. `docs/sessions.md:126,243` mention the header's Layout button in passing.
3. `docs/session-actions.md:107`: the floors table lists Branch from here with no caveat.
4. With the switch off, the Chronicle widget's **Extend graph** in a session still builds a graph whose lens is hidden. The relationships it builds still show on cast pages and feed the story.
5. `docs:build` ran while another session's `vite dev` (:5234) was up.
