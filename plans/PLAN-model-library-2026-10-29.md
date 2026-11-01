# PLAN — One place to get models; the library apart from the runtimes — 2026-10-29

**Status: PART 1 BUILDING (owner GO 10-29; owner 10-29 later: "Skip the model segregation for now. Continue with everything else" → D3's `local_models.dir`/`runtime` columns are DROPPED from this pass, presence + the speech-GGUF refusal stay; Part 2 stays ideas): "consolidate the model management (particularly the model search and downloading) on the front end (outside of the admin) … ensure quants are always chooseable when available"). PART 2 (the library / "serve on" workflow) is IDEAS ONLY until the owner has read §6.** Map: `plans/briefs/MODEL-SURFACES-MAP.md`.

## 0. What is wrong today (from the map)
- One finder engine (`ModelFinderView` + `finder.ts`) mounted in five places (Models view dialog, managed KoboldCPP/Ollama Get tabs, ONNX endpoint Get tab, Set up chat), plus audio.cpp's own Models tab with its own catalogue, plus two old copies under `/document-view`. The Loadouts view's "Get a model…" door that the docs describe does not exist; `JobPickerDialog` and `useReadiness` are orphaned.
- Quants: KoboldCPP and Ollama-via-HF open the quant picker; an **Ollama recommended row has no choice** (fixed yaml tag); **ONNX dtype is fixed** per entry and "add by id" never sends one; audio.cpp lists one precision per row (snapshot has q8_0 only); document-view never sets `kind` so everything lands in the text dir.
- The same GGUF can be downloaded twice five ways (map §"Same GGUF twice"); presence checks are per destination; `local_models` has no directory or runtime column.

## 1. Rulings this plan rests on
- Owner 10-29: one front-end surface for search + download, outside admin; quants always choosable when available.
- Owner 10-29: local models (files) are a different thing from managed services (runtimes); one file may serve on several runtimes; **backend-specific conversions stay segregated** (speech GGUFs: koboldcpp/tts vs audio-cpp/audio.cpp-gguf); text GGUFs are one shared format.
- Canon :639 **local model** is already vendor-neutral ("which engines can load one is derived") — keep that word; the surface is the **Models** view, its dialog stays **Get a model** (canon :694), the chooser stays the **quant picker** (:699).
- Members never see model plumbing (10-12 ruling): everything here is admin-only, as today.

## 2. Part 1 — consolidation + quants (BUILDING)

### D1 One surface: the Models view is the library; Get a model is the one finder
- The managed connection views (KoboldCPP, Ollama, audio.cpp) **lose their Get tabs**. Their Models tab keeps "what this runtime serves" (use / stop / kind / delete) and gains one door: **Get more…** → opens Get a model with the destination pre-selected to that runtime and the scope list narrowed to what it can hold. The ONNX endpoint view the same.
- **audio.cpp joins the finder as a destination** (`DestinationKind` already has `audiocpp`; `SCOPE_KINDS` gains **speech** and **transcription** scopes → destination `audiocpp` (and `koboldcpp` for speech once KoboldCPP's conversions are listed — ★M3)). Rows come from `audio.yaml` through `audiocpp:listPackages`; the audio.cpp Models tab becomes the runtime's "served packages" list (enable/disable/remove/confirm family) with the Get more… door; its download button goes.
- **Set up chat** keeps embedding the finder (it is the first-run path).
- **Loadouts**: the missing **Get a model…** door is added on a loadout's Model card when no model fits, opening the finder scoped to that loadout's capability (`loadoutSheet.ts:554-556` prose → a door).
- **/document-view/koboldcpp** and **/ollama**: rebuilt on `finder.ts` rows (same engine, plain markup), sending `kind`; no separate search code. (If that is too large for this pass → ★M4; at minimum fix `kind` and show the quant list from `finder.ts`.)
- Dead code goes: `JobPickerDialog.svelte` (+ its SSR test), `useReadiness.svelte.ts`, `availableTab.ts:47-136` helpers and their tests.

### D2 Quants always choosable
- **Rule:** whenever a repo or package has more than one file/variant, the quant picker opens; the recommended one is pre-selected (Q4_K_M / largest that fits / first) and the file name of a single-file repo is shown on the row before Get. Nothing downloads a multi-file repo without the picker.
- **Ollama recommended rows**: resolve the yaml `pull` (`hf.co/<repo>:<tag>`) to the repo's sibling list (the same `resolveHfModel`/search path KoboldCPP uses) and open the picker with the yaml tag pre-selected; a `pull` that is a plain Ollama library name keeps its tag list from `ollama:search`'s tag resolution when available, else explains "Ollama's library lists no quants for this name".
- **ONNX**: a list entry that lists variants (`dtype` choices, when the yaml has them) opens the picker; "add by id" offers the dtypes transformers.js supports (`fp32 · fp16 · q8 · q4`) with the list's default pre-selected, and sends `dtype`.
- **audio.cpp**: the finder groups a family's packages into one row with a precision picker (q8_0 / bf16 …) from `audio.yaml`; the lane adds the bf16 entries the list already knows about from the specs (`tools/from-audiocpp-specs.py`) so the choice exists.
- **document-view**: same rule, plain radio list.

### D3 Presence across destinations
- One server read `models:presence {repo, file|tag}` → which runtimes already hold this file (KoboldCPP dirs by filename+size, audio tree by package, Ollama by tag per host, ONNX cache). The finder shows **You have this on KoboldCPP** / **Also on Ollama** on every row, HF rows included, and the Get button reads **Get for Ollama too** when another runtime has it. No automatic sharing (Ollama has its own store); the note is the dedupe.
- ~~`local_models` gains `dir` and `runtime`~~ — **skipped by the owner 10-29 ("skip the model segregation for now")**; no schema change in this pass. Presence is computed from the directories and stores directly.
- KoboldCPP's chat finder refuses to download a speech GGUF into the text dir (family detector says tts → "That is a speech model; get it under Speech").

### D4 Docs + canon
- `docs/connections.md`: "The model finder" becomes the one section (Get a model from Models, from a runtime's **Get more…**, from a loadout, from Set up chat); Get/Arriving tabs text updated (Get tab retired); audio.cpp Models tab text; the two stale claims fixed (:65, :534). NOMENCLATURE: **Get tab** → §23 retired (replaced by **Get more…** door); **presence** (a model's) new row, qualified; **speech scope** / **transcription scope**; §25. STYLE-GUIDE: the Models view door pattern if new.

### Lanes (Part 1)
| Lane | Scope |
|---|---|
| **MA server** | `models:presence`; `local_models.dir` + `.runtime` migration + backfill on scan; Ollama recommended → sibling list; ONNX `dtype` through the finder; `audiocpp:listPackages` grouped by family with precisions; bf16 rows in `audio.yaml` (+ snapshot); speech-GGUF refusal in the KoboldCPP download; `kind` in document-view handlers |
| **MB client** | finder: speech/transcription scopes + `audiocpp` destination, presence lines, picker rule, Ollama recommended picker, ONNX dtype picker, audio precision picker; Get tabs → **Get more…** doors (managed views, ONNX view); audio.cpp Models tab trimmed; Loadouts door; document-view rebuilt on `finder.ts`; dead code removed |
| **MC docs/canon** | D4 |
| **MV verify** | pins; targeted tests; a private-Chromium walk of every door; one grouped run |
Order: MA → MB ∥ MC → MV. MA starts after the speech follow-ups lane hands back (shared files: `sockets/audiocpp.ts`, `audio.yaml`).

## 3. Open ★ (Part 1)
- **★M1** Ollama models in the Models view: list each host's pulled models beside the library's files (read-only, "lives in Ollama"), or keep them under the Ollama connection only? Proposal: list them, tagged.
- **★M2** Existing KoboldCPP text/image dirs: keep honouring the configured dirs (proposal) vs migrate files into one `<appData>/models` tree. No file moves in this pass.
- **★M3** KoboldCPP speech conversions (`koboldcpp/tts`): add them to `audio.yaml` with `runtime: koboldcpp` so the Speech scope can offer KoboldCPP as a destination with a real download (today: copy by hand). Proposal: yes, in MA, since the list and detector exist.
- **★M4** document-view rebuild on `finder.ts` in this pass, or only the `kind` fix + quant list? Proposal: rebuild (it removes the last duplicate search code).

## 4. Part 2 — the library apart from the runtimes (IDEAS, for the owner to read; nothing built)
- **One Models view, two halves.** Top: **Your models** — files in the library grouped by family → variant → quant, each row saying its conversion (`any` / for audio.cpp / for KoboldCPP) and **Served by**: the installed runtimes that can take it, with a state word per runtime (serving · loaded · not set up). Bottom: **Runtimes** — the managed services and local connections (KoboldCPP, audio.cpp, Ollama, local ONNX) as process cards: state, what each holds, Start/Stop, Settings door, Get more… door. The managed connection views shrink to Process + Settings; "which models" lives in the library.
- **Serve on ▸** is the one action on a model row: pick a runtime → the runtime's own mechanism runs (KoboldCPP connect/load, audio.cpp enable + config rewrite, ONNX register). "Serve on" never copies files; it only offers runtimes whose conversion this file is. A greyed runtime says why: *needs the KoboldCPP conversion — get it* (one click, same quant), *not installed — set up audio.cpp*.
- **Get a model → choose the runtime last.** Family and quant first; then "for which runtime" with the conversion resolved behind the choice; for `any` files the choice is where the file lands and which runtimes see it (all that share the dir).
- **Storage shape:** `<models>/text`, `/image`, `/embeddings` shared; `/audio/<task>/<family>/<package>` per conversion (audio.cpp dirs as today; KoboldCPP conversions under a `koboldcpp/` leaf). KoboldCPP's configured dirs become the shared ones on a fresh pub; existing pubs keep theirs until the owner moves them (a one-time **Gather into the library** action that moves files and rewrites rows).
- **Ollama** stays a runtime with its own store; its pulled models appear under Runtimes, not under Your models, with an **Import into the library** idea parked (Ollama blobs are content-addressed GGUFs; a symlink import is possible but a different feature).
- **Hardware** (PLAN-local-hardware) slots under Runtimes: each card shows its allotment and the one-at-a-time rule.
- **Loadouts** stay the place where a job picks a pair; the library is where files live and runtimes are chosen. A loadout's model picker shows "served" models only, with a door to Serve on for the rest.
