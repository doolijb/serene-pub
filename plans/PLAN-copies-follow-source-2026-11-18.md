# Custom copies following their source (owner PC2) — findings and proposal, 2026-11-18

Status: **CLOSED 2026-11-18. Owner (PC3): "I meant settings only; a copy is the administrator's own and stays frozen". Step 1 and Step 2 are not built.** Owed: one check that each existing settings notice names its cause and its undo.

Owner (2026-11-18, PC2): "Sounds like you're describing configs on a pipeline, there should be no choices to make on a shipped pipeline. Custom configs get updated where settings are compatible. Give admins a note when the configs diverge after an update."

## Found
- **The settings layers already behave as the sentence asks.** Named pipeline configs are retired (R38, 2026-10-20; NOMENCLATURE ~258, 275). What an administrator owns is a value layer that stores only what was changed (instance values `pipeline_specs.instance_values`; a session preset's changes `session_presets.settings`, registrations, `variableLayouts`): an unchanged value follows its source through the cascade; a value that no longer fits is set aside with a notice (`refitRegistrations`, culled / backfilled / unbound / misfit notices in `pipeline_config_notices`, `session_preset_notices`). Owed: one check that each such notice names its cause and its undo (P1).
- **A copied library row follows nothing.** A copy of a prompt (`duplicatePrompt`, `pipelines/entities/prompts.ts` 336–360), a context template (`contextTemplates.ts` ~400) or a variable layout (`variableTemplates.ts` ~572) records no source; it is frozen. A cloned session preset copies its source's changes once (`sockets/sessionAdmin.ts` 940–968). Only a cloned pipeline / pub genre records `derived_from_spec_version_id`, and nothing compares with it.
- There is no "layout drift" path in `variableLayouts.ts` (a correction to an earlier note); the Variable layouts page's "Where this differs" compares a preset's choice with the pub's layout.
- Existing "your source changed" surfaces to reuse: components (`basedOn { component, version, sourceHash }`, the banner "Core's X has changed since you cloned it" with Compare, `admin/sections/components/IdPage.svelte` 861–875); session layouts (Start again from "X"); cast members (Update ‹member› to card version); Admin › Overview **Needs you** (`admin/attention.ts`).

## Proposal
**Step 1, prompts only** (PC2 was asked about prompts). A copy of a shipped prompt follows its source field by field: a field the administrator never changed takes the source's new text at the sync; a field they changed stays theirs; when the source changes a field they also changed, the copy keeps theirs and a note names the copy, the field and both texts, with **Take the update** / **Keep mine**. A field the source adds is taken; one it drops goes to `archivedFields` (the boot sweep does this already).
- Stored on `pipeline_prompts`: `copied_from_template_id` (the source's stable `template_id`) and `copied_fields` (the source's fields at copy time, advanced on every take or keep). One generated migration; no back-fill (older copies have no recorded source and stay as they are).
- Written by `duplicatePrompt` only when the source is shipped; a copy of a copy records nothing.
- The follow runs after the two existing writers (`boot/registrySync.ts` `writeTemplateSeed` ~1404; `boot/seedPrompts.ts` ~163) through one pure function `followSource(baseline, sourceNow, copy) → { fields, conflicts }`.
- The note: a banner on Admin › Prompts › the copy, modelled on the component banner, and one **Needs you** item ("N prompts differ from their source after an update"). Automatic takes show in the same banner ("Updated from ‹source›: ‹fields›") with **Undo**. A withdrawn source: "Its source is gone; this copy no longer follows anything."
- Lanes: (1) schema + `followSource` + `duplicatePrompt`; (2) the sync hook; (3) take / keep verbs (`sockets/pipelines.ts` beside `libraryClonePrompt` ~2198), types, the prompts `IdPage.svelte`, `attention.ts`, NOMENCLATURE, `docs/pipelines.md`.
**Step 2, later, same pattern:** context templates and variable layouts (whole text: untouched → take, edited → note); a cloned session preset following the shipped preset it came from.

## Decided by the lead unless the owner says otherwise
Copies made before this ships are left as they are (guessing a source by name could attach the wrong one). The note shows on the prompt's page and the Overview only; it never interrupts.
