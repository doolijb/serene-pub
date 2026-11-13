# REPORT — adv-B: sessions (start and edit forms) — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-adv-B-w1.md`, `BRIEF-adv-B-w2.md`.

## Changed files
- **`StartSessionForm.svelte`:** `advanced = $derived(showsAdvancedControls(settingsCtx?.settings))` (:130).
  - The Rules card renders only when the switch is on; otherwise `AdvancedHiddenLine` shows in its place.
  - In the book pick, these are hidden: *Play it with* (book and kit), *Start blank*, the in-words list, How strict, and the admin fit audit (inside the rules rows).
  - `bookPickHides` (~1373) decides the single line (~2931).
  - The payload is unchanged: `createSession.svelte.ts` still derives `rulesDefault` and rigour, and that file is untouched.
- **`EditSessionForm.svelte`:** `advanced` (:587) and `settingsHides` (:589).
  - `advanced &&` is added to Actions, PipelineCards, On revision, RulesOptions, Pipelines, RetakeAskSetting and SessionAnnexPanel.
  - The reading gets `readOnly={isGuest || !advanced}`.
  - The line is the Settings tab's last child.
  - The save path is unchanged; a test shows the same `sessions:update` payload with the switch off and on.
- **Tests:**
  - new `startSessionAdvanced.dom.test.svelte.ts` (7) and `editSessionAdvanced.dom.test.svelte.ts` (6);
  - fixture-only edits that turn the switch on in `startSession{Applet,Asks,BookSources,Cast,Modes,Rules}` and `editSessionOwnNotesReading`.

## Tests
- `startSession*`: 7 files, 99 tests, green.
- `editSession*` + `AdvancedHiddenLine` + `advancedControls`: 11 files, 43 tests, green.
- `tsc`: 0 errors.
- An earlier combined run was SIGTERMed under the cap. The 15 temp dirs it left were deleted by name.

## Open ★
- **★adv-B-1:** the preset hint *"‹Rules› keeps no numbers, so ‹preset› runs in words here"* hides with the card. It explains a refusal, so the plan's rule says to keep it. Recommendation: when the switch is off, keep it as a plain line.
- **★adv-B-2:** the read-only reading says *"The session owner chooses both."*, even to an owner who sees it read-only only because the switch is off. Recommendation: a copy variant such as *"Turn on advanced controls to change them."*

## Wording notes for lane E
- `docs/sessions.md`: say which start and edit controls hide, and that the line turns the switch on.
- The edit form's intro (~2711) names "each pipeline's" settings, which are hidden with the switch off.

## Noticed, not done
- A guest whose only hidden control is PipelineCards gets no line, because PipelineCards fetches its own cards.
- A Freeform book with the switch off silently plays `rulesDefault`, and nothing says which rules apply.
- RetakeAskSetting is hidden, read as a personal opt-out rather than the off switch of an automatic action.
- The read-only reading skips `time.listen`, so the client-side deleted-line repair doesn't run. The server still moves the session on.
- `prettier --write` was run on `StartSessionForm.svelte`, which already held earlier work. The changes are formatting only.
