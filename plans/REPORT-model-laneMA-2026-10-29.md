# REPORT — model consolidation, Lane MA (server) — DONE 2026-10-29 (saved by the lead from the hand-back)

Built, tsc clean except known `NARROW_SIDE_PX`; no migration (owner skipped segregation), no docs.

## Wire shapes (MB codes against these)
- **`models:presence`** (`Sockets.Models.Presence`, gated, admin-checked in handler): `Params {queries: Query[]}` (≤200; `Query {key, repo?, file?, bytes?, tag?, packageId?, dtype?}`) → `Response {results: {key, holders: {runtime: koboldcpp|ollama|onnx|audiocpp, connectionId, where, match}[]}[], error?}`; replies carry no request id — match by `key`; client declares `useInterest("models:presence")`. KoboldCPP: `where` text|image, exact root filename (+size); Ollama: per host `/api/tags` (3 s), `where` = connection name, tag case-insensitive, bare → `:latest`, `repo`+`file` → `hf.co/<repo>:<quant>`; ONNX: lane + dtype weights file; audio.cpp: downloaded/enabled `packageId`.
- **`audiocpp:listPackages`** additive: `families: PackageFamily[] {key "<runtime>:<family>:<variant>", family, variant, task, runtime: audiocpp|koboldcpp, displayName, recommendedId, precisions: PackageRow[] (q8_0, bf16, f16, …)}`; `PackageRow` gains `precision?`, `runtime?`, `koboldCppFiles? [{filename, downloadUrl, sizeBytes?}]` (model first, codec second; `state` downloaded only when every file is at the KoboldCPP text root).
- **`koboldcpp:downloadModel`** `kind?: ModelKindFilter | "speech"` (speech lands in the text dir; row kind text).
- **`ollama:recommendedModels`** rows → `RecommendedModel = yaml row + quants: RecommendedQuant[] {label, tag "hf.co/<repo>:<quant>", filename, sizeBytes?, recommended} + quantsNote?` (plain library names: `quants: []` + note; HF failure: note).
- **ONNX**: `connections:downloadModel` + `connections:addHubModel` take `dtype` (`ONNX_DTYPES` fp32|fp16|q8|q4 in `shared/constants/onnxDtypes.ts`); list entries may carry `dtypes[]` (`catalog.dtypes`); chosen dtype persisted in `local_models.quantization`; loaders read registry then list default (behaviour change ★MA-6); `isCached` checks the dtype's weights file.

## Files
New: `server/connections/{modelPresence,hfGgufQuants}.ts`, `server/sockets/modelPresence.ts`, `shared/constants/onnxDtypes.ts`, `shared/audio/precision.ts`, `server/audiocpp/packageFamilies.ts`, `server/koboldcpp/speechRefusal.ts` (+tests). Edited: `sockets/{index,koboldcpp,ollama,localOnnxModels,audiocpp}.ts`, `embedding/{models,index}.ts`, `ner/{models,index}.ts`, `localModels/{onnxList,onnxCache}.ts`, `audio/audioList.ts`, `audiocpp/packages.ts` (`audioCppOnly`), `shared/sockets/{types,interest}.ts`, `typedSocket.ts`, `gatedEvents.test.ts`, `routes/document-view/koboldcpp/+page.svelte` (sends `kind: "text"`). Data: `audio.yaml` 8 → 20 entries (+5 audio.cpp bf16; +7 KoboldCPP `runtime: koboldcpp` rows from HF `koboldcpp/tts`, each with its tokenizer file); every entry has `precision`; snapshot byte-identical; list repo uncommitted (★MA-4).

## Refusals
"That is a speech model; get it under Speech." · "That is a transcription model; get it under Transcription." · "That is not a speech model." · "That one is run by KoboldCPP; get it for KoboldCPP instead." (detector: wav-tokenizer file, catalogue match, `outetts`, `familyOf` listed/matched; `guessed` never refuses — ★MA-9).

## Tests: all slices green (MA1 4 files/58; MA2 3/52 + 6/68 + others; MA3 6/71 + 2/15; MA4 2/14; lead integration 8/54).

## Routed → MB, MC, MV: CROSS-LANE-NOTES (model block). ★MA-1…9 for the owner (see hand-back; key: ★MA-1 which Qwen3 0.6B variant KoboldCPP ships; ★MA-2 OuteTTS/Dia/Parler not offered; ★MA-3 f16/orig precisions; ★MA-4 push list repo; ★MA-5 onnx-list needs `dtypes`; ★MA-6 ONNX loads the downloaded dtype).
