# REPORT ui-borders w3 (2026-11-12)

Status question: none relayed. Implementation done; no vitest, no check run.

## 1. Changes
Files under src/lib/client/components/.

**sessionForms/EditSessionForm.svelte**
- CARD_CLASS: `"panel-card border-surface-200-800 bg-surface-100-900 rounded-container border p-4"` -> `"panel-card"`. Doc comment cut to one true line.
- Seat rows (6, each in `<section class={CARD_CLASS}>`, ground 100-900; sections at current lines ~2184, 2223, 2308, 2514, 2596, 2783, 3065): `border-surface-200-800 rounded-base flex min-h-11 ... border p-2` -> `bg-surface-50-950 rounded-base flex min-h-11 ... p-2`. Parent ground: CARD_CLASS = panel-card = 100-900 (this file, line 158 and the section tags).
- Visibility tab (5 boxes): `border-surface-200-800 bg-surface-100-900 ... border p-N` -> `bg-surface-100-900 ... p-N` (empty-state box, Characters / Personas / Lorebooks boxes, viewer rows). Parent ground: the tab body is a plain `flex flex-col gap-3 pt-3` div directly in the sidebar pane (50-950); none nested in another card (the first box is a sibling, not a parent).

**sessionForms/SessionRunsTab.svelte** step list `<ol>`: `border-surface-200-800 flex flex-col gap-1 border-t pt-2` -> `mt-1 flex flex-col gap-1` (separator removed; mt-1 is one step of gap above the li's gap-1). Prettier then collapsed it to one line (`<ol class="mt-1 flex flex-col gap-1">`); file passed at HEAD.

**sessionForms/BenchedSeatRow.svelte** `border-surface-200-800 rounded-base ... border p-2` -> `bg-surface-50-950 rounded-base ... p-2`. Call sites: all 4 are in EditSessionForm sections of CARD_CLASS (2833-3023 inside the section at ~2789, ground 100-900), so one ground.

**sessionForms/SessionAnnexPanel.svelte** (2 `<li>`): `border-surface-200-800 rounded-md border p-2` -> `bg-surface-50-950 rounded-md p-2`. Root is `<section class={cardClass}>` (line 152); sole call site EditSessionForm ~3766 passes CARD_CLASS -> 100-900.

**sessionForms/SpeechSettingsBlock.svelte** `<li>`: `rounded-base border-surface-200-800 border p-2` -> `rounded-base bg-surface-50-950 p-2`. Sole call site SessionSettingsForm.svelte:207 inside `<section class={cardClass}>`; its sole caller EditSessionForm ~3557 passes CARD_CLASS -> 100-900.

**listItems/SessionCardItem.svelte** root: removed `panel-edge` and `border`; kept `bg-surface-100-900`, `transition-shadow hover:shadow-lg`, the selected ring. Only caller SessionsSidebar (per brief, on 50-950 sidebar ground; not re-verified by me).

## 2. Borders kept
- `sessionForms/CharacterPickRow.svelte` ~173 `panel-edge {ROW} border`: kept as `panel-edge border`. It renders on many grounds (AttachPicker, StartSessionForm x3, PersonaSelectModal, CharacterSelectModal x4: modals and cards). Different ground per call site.
- EditSessionForm dashed drop zones (4: ~2316, 2603, 2798, 2942) and the dropdown popover (~3697): never-touch.

## 3. Brief sites not changed
Only CharacterPickRow (above). Everything else handled.

## 4. Chips and pills
Seen and left: `preset-tonal-primary rounded-full` name pills in the Visibility tab, `Badge`.

## 5. Tests rendering touched components (supervisor to run)
sessionForms/editSessionLorebookLine.dom.test.svelte.ts, editSessionSaveParity.dom, noCharacterVisibility.test.ts, editSessionCastMembers.dom, editSessionOwnNotesReading.dom, editSessionGuestOwnNotesReading.dom, editSessionPlayerSeats.dom, editSessionGenreFields.dom, editSessionBench.dom, SpeechSettingsBlock.dom, editSessionHowStrict.dom, applyPresetDefaults.test.ts, editSessionAdvanced.dom; modals/personaSelectModal.dom.test.svelte.ts; avatar.ssr.test.ts. (CharacterPickRow untouched.)

## 6. Assumptions / Noticed, not done
- Prettier --check fails both now and at HEAD for EditSessionForm, SessionAnnexPanel, SpeechSettingsBlock, SessionCardItem (pre-existing, not reformatted). BenchedSeatRow and SessionRunsTab pass.
- The repeated seat-row recipe (`bg-surface-50-950 rounded-base flex min-h-11 ... p-2`) appears 7 times now; a shared class is for the supervisor.
- Seat-row tests might assert on class names; not checked.
