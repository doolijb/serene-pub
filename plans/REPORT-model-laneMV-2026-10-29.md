# REPORT — model consolidation, Lane MV (verification) — DONE 2026-10-29 (saved by the lead)

**Grouped run green apart from the known reds:** tsc known-only (needs 8 GB heap now); svelte-check 0 errors / 7 pre-existing warnings; sdk:test 4038/4042 (deriveDontSpell speakMessage anys ×1 file, plugin check ×3); docs 155 pages; budgets docsDist known red; targeted unit 24 files/411, dom 5/47, int 19/107 (incl. the owed audio.cpp ints and all 11 KoboldCPP download ints). No commit, no sdk:build, no SDK edits.

## Pins
P1–P22 proven (in-memory literal mutation harness `scratchpad/mv/vitest.mut.mts`); P1 (`models:presence` gated) and P4 (`UD-` prefix) gained real tests. Unproven test gaps: `onnxCache.ts:560`, `packages.ts:216 audioCppOnly`, `modelPresence.ts:148-157` on-disk ONNX dtype check, `ner/index.ts:157` dtype, `ModelCard.svelte:79` door wiring, doc-view `setModelsDir kind`. One pin moved deliberately: `packageFamilies` key now `<runtime>:<family>:<variant>:<model slug>`.

## Fixes made (with tests)
1 `hfGgufQuants.ts` `AUXILIARY_GGUF_RE` drops mmproj + MTP drafters from quant lists (V2). 2 recommended KoboldCPP `pullOptions` carry sizes (`withSiblingSizes`, `koboldcpp.ts:1159`). 3 Qwen3-TTS 1.7B Base visible (family key includes the model). 4 **V1** the speech refusal sentence reaches the client (`koboldcpp:downloadModel:error` emitted before the throw). New ints: `koboldcpp.speechKind.int`, `audiocpp.listPackages.int`. Not changed: doc-view "Ollama, managed" (canon :2684 names the page; Serene Pub never runs Ollama — ★MV-1).

## Canon/docs reconciled
NOMENCLATURE :693 (served packages = on disk or arriving), :694 (doors switch to the Models view; `openInModels`, `getAModelDoor`, picker titles *Pick a size* / *Choose a precision*, `QuantFieldset` labels), :702 Get more… placement, :764 key, :765 **served packages**, §25 :3105. connections.md :79, :83, :515, :598, :632, :650 (fp32 first), :669. STYLE-GUIDE :1018, :1183 (stale job picker), :1247 Get more… pattern.

## Defects open
- **V3** other throws in `koboldCppDownloadModelHandler` reach the client as the generic sentence → wrap in `refusable`. (pre-existing)
- **V4** removing the last enabled audio.cpp package while it runs: restart hits the no-package gate after the file is gone, `relistModels` skipped, tab stale → stop instead of restart when nothing remains; relist in `finally`. (audio.cpp build)
- **V5** a speech GGUF under Chat → Ollama destination is not refused by Serene Pub (Ollama refuses at the manifest; client sees "Failed to download model") → run the speech detector before an `hf.co` pull.
- **V6** HF *search* rows show "Size not listed" → `withSiblingSizes` when the picker opens.
- **V7** docs :646 says the Entities Get a model… door is greyed where ONNX can't run; `ModelCard.svelte:172-185` never disables it; :645 may be stale.

## Walk (isolated :5251, accounts on, private Chromium; 0 errors) — S1–S11 PASS (S8 after V1): real audio.cpp install; tabs without Get; door pre-scoped; six Speech rows; "Choose a precision" q8_0 (190 MB) pre-selected, bf16 offered; real Kokoro download 189,550,976 B; Arriving; presence "You have this on audio.cpp" + On disk replacing Get; served + Enabled; Q4_K_M pre-selected on chat; no mmproj in four gemma repos; every door pre-scoped (KoboldCPP/Ollama/ONNX/Loadouts/Set up chat); doc-view payloads; members locked out. Shots: `scratchpad/mv/walk/shots/`. Caveats: no KoboldCPP binary (client fake), ONNX connection via socket. One accidental `hf.co` pull reached the owner's Ollama and was refused at the manifest (no fetch; tag list unchanged).

## Not verified: `register()` end to end; real KoboldCPP install + speech-family downloads; a transcription download; docs :645.
## ★ owner: ★MV-1 doc-view Ollama page name; ★MV-2 Entities door greyed-with-reason vs docs change; ★MV-3 audio.cpp Models tab look vs KoboldCPP's; ★MV-4 add-by-id default fp32 vs q8.

## Lead follow-up (2026-10-29)
- **V4 fixed:** `applyAudioCppConfig` stops audio.cpp when the config has no models left (instead of restarting into the gate); `audiocpp:removePackage` relists in `finally`. `process.int`, `process.gate.int`, `sockets/audiocpp*` green.
- **V5 fixed:** `ollama:pullModel` runs the speech detector on an `hf.co/<repo>:<quant>` name before pulling and refuses with the same sentences (`ollama:pullModel:error` + throw). `sockets/ollama*` green.
- **V3 left:** wrapping `koboldCppDownloadModelHandler` in `refusable` would double the `:error` emit V1 added; needs a small refactor, not a one-liner. V6, V7 open.
