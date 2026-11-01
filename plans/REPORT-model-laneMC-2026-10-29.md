# REPORT — model consolidation, Lane MC (docs + canon) — DONE 2026-10-29 (saved by the lead)

Docs compile 155 pages; vocabulary tests 32/32. Nothing committed; SDK untouched.

## Canon
Retired §23 :1552 **Get tab** → **Get more…**. New 🚧 rows: :700 **model presence** · **presence holder** (never stored; lines *You have this on X* · *Also on X*; button *Get for X too*; ⚠ not a cast member's/Knowledge presence, not an attribute holder), :701 **precision** (of a model file; user word for dtype; GGUF files are still quants), :702 **Get more…** (a runtime's door), :763 **speech scope** · **transcription scope** (labels exactly **Speech**/**Transcription**; the four refusal sentences recorded), :764 **package family**. Amended: :639 local model, :652 recommended list (ONNX `dtypes`; audio list is the fourth list), :693 managed connection view (Models · Arriving · Settings; Get more… on every Models tab), :694 model finder · Get a model (one finder, four doors, no tabs), :699 quant picker (always when >1 file; covers ONNX/audio precisions; `quantsNote`), :762 audio list (`precision`, `runtime`). §25 five rows :3093–:3097 (segregation skip flagged ★).

## Docs (`connections.md`)
:63–94 `### Get a model` replaces "The model finder" (anchor `#get-a-model`; links :34, :54, :645); :98 Downloads; :201 loadout Model card door; :220 Speech (fixed stale "Perf tab" → status card **Details**); :320 Ollama; :492/:515/:519 tabs + `### Arriving tab`; :555 KoboldCPP embeddings claim fixed (copied by hand); :581, :596–598 audio.cpp; :632–634 Ollama managed; :650 ONNX add-by-id precision; :669.

## Names guessed → MV reconciles against MB
1 Get more… placement (top of Models tab beside Refresh; dialog over Connections vs switch to Models view); 2 presence copy; 3 loadout door label/placement; 4 Speech/Transcription scopes = recommended audio only (no HF search); 5 precision choice inside the quant picker (not a separate "precision picker"); 6 Fits/Tight/Too big only with known sizes; 7 audio.cpp Models tab = downloaded only; 8 ONNX tabs; 9 JobPickerDialog removed + document-view rebuilt; 10 ONNX loads the downloaded precision.
