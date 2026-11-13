# REPORT shelf-A — Models view installed list (Tidy shelf A1) — 2026-11-08

Saved by the lead (the harness refused the supervisor's write). Brief: `plans/briefs/BRIEF-shelf-A.md`.

## Built

Plan §1 items 1–3 and 5–7 by the lane; item 4 finished by the lead (below).

- `connections/modelsList.ts` (+test): narrowings `in-loadout`, `on-disk`; `loadoutModelKeys`, `isOnDisk`, `sizeOnDiskOf`, `livesInOf`, `isCantUse`, `cantUseNoteOf`, `FOLD_THRESHOLD`, `ModelsFold`, `ModelsGroup`, `groupModels`; `inScope`/`filterModels`/`scopeCounts` take an optional `inLoadout` set. `modelKey` kept private (R1: it is LM Studio's wire word).
- `connections/modelsGroupBy.ts` (+test, new): `ModelsGroupBy` (`where` · `can-do` · `connection`), `MODELS_GROUP_BY`, `DEFAULT_MODELS_GROUP_BY`, `MODELS_GROUP_BY_KEY` (`serene-pub:modelsGroupBy`), `parseModelsGroupBy`, `readModelsGroupBy`, `writeModelsGroupBy`; wrapped storage as `memoryTier.ts`.
- `ModelsListView.svelte`: prop `inLoadout`; `ListGroupLabel` groups with size totals in `trailing`; fold lines with **Show** (unfolds in a `SvelteSet`, reset per visit) outside `role="list"`; **Group by** radio group under a hairline in the filter popout (no chip, trigger not lit); **↓ n** button (title *Downloads*) sets `trayOpen`; stored grouping read in `onMount`.
- `ModelRow.svelte`: prop `metaTail`, meta joined once.
- `sidebars/ModelsSidebar.svelte`: passes `inLoadout` from `loadoutsList`.
- `AudioCppManagedAdapter.ts` (+ new test): `modelsFromPackages` declares `facts: { sizeBytes, source: "file" }` when given a positive size.
- `modelsListView.ssr.test.ts`: 7 new cases (group order + catch-all, size total, fold before loadouts, fold with exemption, 12 don't fold, *lives in Ollama*, no Downloads button when idle).

Tests (lane): 5 files, 67/67. Scope review: 4 findings, answered once (two became ★Q1/★Q2, one fixed, one moved to For shelf-C).

## Lead rulings on the lane's ★ (2026-11-08)

- **★Q1 audio.cpp sizes** — done by the lead in `server/connectionAdapters/audioCppReady.ts`: `EnabledAudioCppPackage` picks `sizeBytes`; `listEnabledAudioCppPackages` reads name and size from the one package listing. Item 4 now end to end.
- **★Q2 exported names** — accepted, implementation inside the asked scope; test-only exports stay (precedent `memoryTier.ts`). shelf-C records them in NOMENCLATURE §25.
- **★Q3 strings** — accepted: all come from the plan, the brief, or existing strings (*Switched off* `connectionRowStatus.ts:522`; *No default loadout can run this model* from `ModelDetailView.svelte:619`).
- **★Q4 (a)–(f)** — accepted as decided: folds also apply inside *Can't be used right now*; rows outside the six kinds group under the SDK's `capabilityLabel` after them; *On disk* = an *On this machine* connection's listed model (ONNX: downloaded); *· 0 in a loadout* printed once loadouts answer; fold counts match what Show reveals; the background remover shows under every narrowing.
- **Noticed: nested *Background remover* heading** — fixed by the lead (a regression of this change): `MattingModelRow.svelte` prop `inGroup`; inside a group it draws no `ListGroupLabel`, names itself *Background remover*, and puts the model's name on the state line. `ModelsListView` passes `inGroup`.

Lead re-ran `modelsListView.ssr`, `modelsList`, `AudioCppManagedAdapter`, `audiocppManagedSpeech`, `AudioCppTranscriptionAdapter` tests: 5 files, 68/68.

## For shelf-C

- `docs/connections.md` (The Models view / models list / Downloads): **Group by** in the filter popout under the kinds, remembered per browser, default *Where it lives*. *Where it lives*: *On this machine* (size total, background remover last) then *Services*. *What it can do*: Chat, Images, Embeddings, Entities, Speech, Transcription, then any other kind by its capability label, then *Cut-outs*; a model appears under every kind it can do. *Connection*: local connections, services, then *Built in*. Every grouping ends with *Can't be used right now* (switched off, no longer listed, or able to do nothing; each says why). Services with more than 12 models start folded each visit; models in a loadout stay visible; *‹n› models · ‹k› in a loadout* · **Show** (count omitted until loadouts load); in kind groups and the last group *+ ‹n› on ‹service›* · **Show**; typing in the filter shows everything. Scope gains **In a loadout** and **On disk** (seven choices with counts). Local group headers total their disk. Ollama rows end *lives in Ollama*. audio.cpp rows show their size. **↓ n** (title *Downloads*) opens the tray's list; the tray stays. Inside a group the background remover's row reads *Background remover* with the model name on its state line.
- STYLE-GUIDE §6.4: list group header with a size total (`ListGroupLabel` `trailing`, local side only, omitted when unknown). §6.3: a popout may carry a second, non-narrowing radio group (**Group by**) under a hairline with a 12px muted label, no chip, trigger not lit; an icon button may carry a count (**↓ n**, `btn h-10 min-w-10 gap-1 px-2.5 preset-tonal-surface`).
- NOMENCLATURE §10/§25: *group by* + options + ids; the fold; *Can't be used right now*; *In a loadout*, *On disk*; *Cut-outs*, *Built in*; *lives in ‹service›* (Ollama only); `serene-pub:modelsGroupBy`; the ★Q2 code names; `MattingModelRow` `inGroup`; amend **models list** (grouped, no longer flat) and **model row** (`metaTail`).

## Noticed, not done

- The Downloads button opens the tray's popover anchored at the list's foot; pressing it while open closes then reopens it. Harmless.
- `AudioCppManagedAdapter.ts` and `MattingModelRow.svelte` carry prettier failures that predate this change.
- `ModelRow` is still the `panel-card` row, not §6.4's face + `MetaLine` anatomy.
- NOMENCLATURE §10 **Models** row still opens describing the status strip and jobs grid (amended 10-12 but reads stale).
