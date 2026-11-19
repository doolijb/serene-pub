# INVENTORY — the standing test failures, triaged (read-only, 2026-11-16; from `plans/lead-full11.log`)

21 files / 26 tests (not counting `dungeonCrawlerWalk2`, fixed). Most come from the speech build landing without
its guard tests updated. Classes: **A** stale expectation · **B** real defect · **C** environment · **?** unsure.
Re-verify every file:line before editing.

| File | Test | Class | Cause | Fix |
|---|---|---|---|---|
| net/hfDownload.v.test.ts | whole suite | C | `SCRATCH` (line 9) is a dead hardcoded scratch path; `mkdtempSync` ENOENT | `fs.mkdtempSync(path.join(os.tmpdir(), "hfv-"))`; guard `afterAll` for an undefined server |
| audiocpp/packages.v.int.test.ts | whole suite | C | same hardcoded `SCRATCH` (24–25) | same |
| pipelines/boot/placedNodeReconcile.int.test.ts | beforeAll | A | uses `C.speak.v1` as the provisional definition; speak is bound now; provisional ones left are `mcpTool` / `mcpResource` (contracts/src/oracles.ts ~318, ~391) | place `C.mcpTool.v1({ args: … })`; expect `mcp-tool@1` |
| sessionPage/narrateDraft.dom.test.ts | page declares both keys | A | source regex expects one line; the code wraps after `if (direction !== null)` (`+page.svelte` ~546) | `\s+` in the regex (test ~246) |
| adapters/importBoundary.test.ts | nothing under shared/… | A | `shared/speech/voicebank.ts:23` imports `../connectionAdapters/speechFacts` relatively; the regex can't tell it is shared | resolve relative paths in the test (do not edit product imports for a test) |
| importBoundary | allowlist / STATIC (2) | A | `isConcreteAdapter` (test ~69) matches the loader `getSpeechAdapter` | exclude `get*Adapter` loaders in the lookahead |
| importBoundary | registry consumers | A | new importers `speech/getSpeechAdapter.ts`, `speech.conformance.test.ts` | add both to `CONSUMERS` with a reason |
| adapters/registry.test.ts | route all four families | A (timeout) | thunks for `ComfyAdapter`, `KoboldCppEmbeddingAdapter` (registry.ts ~173, ~238) unmocked, load the db | add the two `vi.mock` stubs |
| shared/conformance/commentHistory.test.ts | ratchet | B (comments) | story-telling comments in the files the log lists (~41713) | rewrite each as a present-tense rule; `npm run comments:ratchet` |
| shared/conformance/wiring.test.ts | out-ports consumed | A | speak's `cueMap` / `spokenAs` have no consumer | add to `UNCONSUMED_OUT_SHAPES` with reasons |
| wiring.test.ts | in-ports filled | A | speak `text` (⏳ alias), `language` (has a fallback); `firsthandFor/By` on 3 queries (replaced by programme 1.2); `clock-step.unless` | add to `UNFILLED_IN_PORTS` with those reasons |
| pipelines/boot/paramsSlotWiring.test.ts | no slot unwired (+ names the node) | **B ★ D19** | SDK `speakMessage.ts` ~156–163 never passes `connection` / `sampling`; `host.call.ts` ~596 sends null ids; the step's Connection and Sampling controls are stored and never read | owner |
| plugins/coreRow.int.test.ts | offers no widget | A | `sessions.ts` ~4145 builds `frameSrc(…, e.version)` | expect `…/widget.mjs?v=1.0.0` |
| coreRow | never served as frame | A | the route reads `event.url.host`; the fake event has no `url` | add `url: new URL(...)` |
| sessions/genreFieldDefaults.int.test.ts | 3 tests | A | new declared fields `speechReadAloud` "off", `speechNarratorVoice` "", `sessionLanguage` "", `ownerSheetLatitude` "all-any" | add the four keys |
| pipelines/entities/publishedValues.int.test.ts | session.fields | A | same four | same |
| pipelines/entities/sessionGenres.int.test.ts | standard-mode defaults | A | same four | same |
| sockets/presetFallback.int.test.ts | boot reconcile | A | Story offers speech actions: second notice "needs a model that can speak" | regex `/(draw pictures\|speak)/` |
| sockets/sessionAdmin.presetActions.int.test.ts | Lair companion actions | A | the Lair preset carries `read-aloud`, `say-it-as` | add both keys |
| sockets/sessions.forms.int.test.ts | parked press | A | the ack echoes `askedRunId` (sessions.ts ~3162) | add `askedRunId: "parked-press-run"` |
| db/dataUpgrades/0108_layering_registrations.int.test.ts | moves bindings | A | new speak-message action registrations are dropped like every action an old include list never named | add the two expected rows |
| pipelines/runtime/allPipelines.int.test.ts | every provider dispatch | A | `core:oracle/speak` has its own case (`host.call.ts` ~576) | add to `dispatchable` with a comment |
| pipelines/runtime/guideGrounding.int.test.ts | your-first-plugin guide | ? | top 6 hits don't include the guide | print the scores: just below the cut → the corpus grew (stabilise the assertion); absent → retrieval defect (report, don't fix) |
| pipelines/runtime/scoreLedAllocation.int.test.ts | stored switch | A | the "Reply" sampling preset uses `responseTokens` 1024: budget (8192−1024)×0.95 = 6809 | `BUDGET` 6809, recompute `WORLD_LORE_BAND` |
| pipelines/config/panel/groups.int.test.ts | no two headings alike | **B ★ D20** | two steps in one branch share the label "What to look for, and what is kept" (SDK reckon.ts ~488/493, memory.ts ~89/94) | owner (a visible label) |

No registry hash re-pin is involved. Noticed: `getSpeechAdapter` lives in `connectionAdapters/speech/` while every
other loader is in `server/utils/`.
