# Map: model search, download and quant choice in the non-admin front end (compiled 2026-10-29)

One search engine: `client/components/connections/ModelFinderView.svelte` (logic `finder.ts`), mounted in 5 places; audio.cpp has its own catalogue tab; `/document-view/{koboldcpp,ollama}` keep old copies. Findings: `JobPickerDialog.svelte` orphaned (only its SSR test imports it); the Loadouts view has NO "Get a model…" door though docs say so; an Ollama recommended row cannot change quant.

## Surfaces
- **Models view › Get a model** — `sidebars/ModelsSidebar.svelte:186-206` (`openFinder`), `:405-445` (Dialog + ModelFinderView); toolbar button `connections/ModelsListView.svelte:296-304`. Sources: HF search (koboldcpp/ollama), recommended yaml, koboldcpp/imgmodel repo, ONNX rows.
- **Models list rows** — `ModelsListView.svelte`; ONNX Download `OnnxModelView.svelte:180` (`connections:downloadModel`); matting `MattingModelRow.svelte:51-93`.
- **Downloads tray/list** — `DownloadsTray.svelte`, `DownloadsView.svelte`; store `downloads.svelte.ts` (`DownloadSource` :37-45; feeds kcpp, kcppBinary, audiocppPackage, audiocppBinary, ollama, onnx, matting :110-302; subscriptions :469-520).
- **Managed connection view** — `ManagedConnectionView.svelte` Models tab :1352-1368, **Get tab** :1396-1408 (finder `{connectionId} inTab`, scopes limited `ModelFinderView.svelte:210-218`), Arriving :1416-1429; tabs `managedConnectionView.ts:139-162` (audio.cpp: Process instead of Get); `downloadSourcesFor` :165-172. `ManagedModelsTab.svelte` = local files only (use/delete/kind).
- **AudioCppModelsTab** — `audiocppManager/AudioCppModelsTab.svelte` (`audiocpp:listPackages` :44-46, `downloadPackage` :102; helpers `audiocppPackages.ts`); audio.yaml + folder scan → `models/audio/<task>/<family>/<dir>`.
- **ONNX endpoint view** — `OnnxEndpointView.svelte` Get tab :509-514, Arriving :529; "Add from Hugging Face by id" `ModelFinderView.svelte:336-345`.
- **Set up chat** — `SetupChatFlow.svelte` Model step :307-311 (finder embedded, chat + KoboldCPP only); doors `ModelsSidebar.svelte:449-465`, `ConnectionIndexView.svelte:362-363`, `routes/+page.svelte:2471-2480`.
- **First-run wizard** — `routes/+page.svelte:147-162`; Ollama "Get a model" :2897-2915 opens the managed Ollama view. No search of its own.
- **JobPickerDialog** — orphaned (`:557-601` "Get a model…"). **`useReadiness.svelte.ts`** orphaned.
- **Loadouts** — `loadouts/loadoutSheet.ts:554-556` prose "get a model in Models" (`sheet/ModelCard.svelte:167`); no finder door.
- **/document-view/koboldcpp** — search :232, `downloadModel` :244-249 (**no `kind` → always the text dir**), recommended :535, quant buttons :728/:791. **/document-view/ollama** — pull :82, HF :104-111, recommended :331, quant buttons :491.

## Quant choice
- finder → KoboldCPP: `ModelFinderView.svelte:647-700` (`getRecommended`, `getHub`) + `finder.ts:823-837 quantsFromKcpp`; 1 file → downloads at once (:675, :688; every imgmodel card); else `QuantPicker.svelte` (:1119) pre-selects recommended (`finder.ts:504-506` "Q4_K_M") else largest that fits (`quantFit` :864-877) else first. Server lists: text `sockets/koboldcpp.ts:1328-1366` (last hyphen segment `/^(Q|IQ|BF|F)\d/`), recommended `resolveHfModel` :983-1040 (HF name search, top 5, first repo with quants → may differ from yaml `pull`), image `imagePullOptions` :1059-1076.
- finder → Ollama HF search: picker always (:692-699; `quantsFromOllama` `finder.ts:839-847`; tags `hf.co/<id>:<quant>` `sockets/ollama.ts:795-801`; no sizes). **Ollama recommended: no choice** (yaml `pull` tag; `ModelFinderView.svelte:659-668`, `finder.ts:575-577`). Ollama library not browsable (`shared/constants/OllamaModelSource.ts`).
- ONNX: fixed dtype per entry (`embedding/models.ts:65-93` `dtype: "q8"`; `dtypeFor` `localOnnxModels.ts:295-308`); `addHubModel` accepts `dtype` (:952-955) but the finder never sends one.
- audio.cpp: each precision = its own package row (snapshot has q8_0 only); auto pick `packages.ts:271-289`.
- document-view: every file its own button; no default. Dead: `koboldcppManager/availableTab.ts:47-136` (tests only; `downloadParams` :23-38 live).

## Server entry points
`sockets/koboldcpp.ts`: `koboldCppSetModelsDir` :116-140, `buildKoboldCppListModels` :265, recommended :1111-1207, search :1266-1372, `koboldCppDownloadModelHandler` :1376-1717 (`modelsDirFor(kind)` :1398-1400; upserts `local_models` by filename; notify :1544), cancel/progress :1722-1776. `sockets/ollama.ts`: pull :457-~600, search :711-837 (HF only), recommended :905-936. `sockets/localOnnxModels.ts`: `connectionsDownloadModel` :578-656, `connectionsAddHubModel` :860+. `sockets/audiocpp.ts`: list :275-285, download :292-301 → `audiocpp/packages.ts` :498/:756. `notifications/downloads.ts` `DownloadSource` :21, `notifyDownloadSettled` :72-90 (+ `localModels/matting.ts:379`). Catalogues: `connections/recommendedGguf.ts` (`chatEntries`/`embeddingEntries` :113-130), `localModels/onnxList.ts`, `audio/audioList.ts`. Dirs: KoboldCPP `koboldcpp/modelsDir.ts` (`modelsDirFor` :79-91 — embeddings share text; image falls back to text; columns `db/schema.ts:4148-4150`), ONNX `localModels/onnxCache.ts:74-79` (`<appData>/models/{embeddings,ner,matting}`), audio.cpp `packages.ts:96-100` (`<appData>/models/audio`), Ollama its own store. Shared HF downloader `net/hfDownload.ts` (KoboldCPP + audio.cpp only). Registry `db/schema.ts:4279-4345 local_models` — `filename` UNIQUE, `format`, `kind`, `modality`; **no directory or runtime column**. KoboldCPP speech: no download UI (`managedPreflight.ts:157` says copy from HF `koboldcpp/tts` by hand).

## Unifying pieces
`finder.ts`: `FinderScope` :50-115 (chat/images/embeddings/entities), `DestinationKind` :119 (koboldcpp, ollama, onnx, audiocpp), `SCOPE_KINDS` :162-167 (audiocpp never listed :187; KoboldCPP not an embeddings destination), `destinationsFor` :209-259, `pickDestination` :274-288, `landingNote` :294-309, row builders :521-800, `QuantFile` :810-847. `modelManagement.ts` (`managerFor` :43-66, `manualAddAllowed` :76-81, `rowAction` :202). `managers.ts`. `connectionGroup.ts` EndpointKind :36-56. `jobPicker.ts` (`getModelDisabledReason` :210, `localCatalogLine` :345, `toDownloadSentence` :589).

## Docs / canon
`docs/connections.md`: toolbar :34; Set up chat :49-57; **The model finder** :63-74; **Downloads** :76-78; Get/Arriving :498-500; Ollama Get :612; audio.cpp Models :575-581; where files live :597-599. Out of date: :65 loadout "Get a model…" (does not exist); :534 KoboldCPP embeddings "from the Get tab" (no such scope); `ModelFinderView.svelte:47-50` vs :459-463 contradiction. NOMENCLATURE: :639 **local model** (vendor-neutral; "which engines can load one is derived"), :652 **recommended list**, :691 **downloads tray**, :692 ~~downloads view~~, :693 **managed connection view**, :694 **model finder · Get a model** (defines **destination**, **Get** tab), :699 **quant picker**, :757 **audio.cpp package**, :1266 model download icon, :1827 retired Available tabs.

## Overlap matrix
| Surface | HF | Recommended | Library/tags | Local | Quant | Destinations |
|---|---|---|---|---|---|---|
| Get a model (finder) | yes (not ONNX) | yes | no | presence per destination | yes; auto Q4_K_M; Ollama recommended no | kcpp text/image, ollama, onnx |
| Managed KoboldCPP Models/Get | no/yes | no/yes | no | yes/presence | no/yes | kcpp (Chat, Images) |
| Managed Ollama Models/Get | no/yes | no/yes | no | yes/presence | no/yes(HF) no(rec) | ollama |
| ONNX endpoint Get | add-by-id | yes | no | yes | no (fixed dtype) | onnx |
| audio.cpp Models tab | no | audio.yaml | no | scan | auto per row | audio tree |
| Set up chat | yes | yes | no | presence | yes | kcpp text |
| Models list / OnnxModelView | no | ONNX rows | no | yes | no | onnx |
| Downloads tray/view | — | — | — | — | — | 7 feeds |
| document-view kcpp/ollama | yes | yes | ollama free text | yes | yes, no default | kcpp text / ollama |

## Same GGUF twice today
1 chat recommended → KoboldCPP text dir (HF name search) AND Ollama pull (yaml tag), presence check per destination, possibly different repos; 2 chat HF search → KoboldCPP and `hf.co/<repo>:<quant>` per Ollama host, HF rows carry no presence; 3 KoboldCPP text vs image dir by declared `kind` (document-view never sends kind); 4 embeddings GGUF in KoboldCPP text dir + Ollama + ONNX build; 5 speech: `koboldcpp/tts` files (hand-copied into the text dir) vs `audio-cpp` packages (audio tree) — separate conversions by design, but the chat finder can pull a speech GGUF into the text dir.
