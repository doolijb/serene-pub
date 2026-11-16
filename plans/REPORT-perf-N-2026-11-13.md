# REPORT — lane `perf-N` — the other widget sections skip by identity; the SDK's per-frame order work is measured — 2026-11-14

(Supervisor's report, saved to disk by the lead; the harness refused the supervisor's write. Worker briefs `plans/briefs/BRIEF-perf-N-w1..w4.md`. Lead's acceptance note at the end.)

## Summary
Part (a) built: `session`, `settings` and each scoped section skip by reference on the widget wire. Over 50 streamed frames on the real session page (3 conversation mounts) the dossier and settings went from ~150 serialisations each to 0; these sections post nothing while a reply streams. The dossier (`session_full`) was the one input still changing reference (rebuilt every reasoning frame); `projectConversationDossier` now hands back the same object when a rebuild is equal. Part (b) measured, nothing built: per-frame cost is under the phone gate in most runs and the reusable part is 0.03–0.09 ms → ★N-1. No SDK source changed; no `sdk:build`.

## Part (a) — what changed
- **`frames/widgetWire.svelte.ts`**: `push()` posts `session` (~:359), `settings` (~:422) and each `scoped:<section>` (~:458-466) through `postChangedFrom`; scoped keyed by the section's value, never the `i.scoped` wrapper; the withdrawal branch also runs `heldFrom.delete`; comments name what still compares by JSON (`grants`, `layout`, `viewer`); a note at ~:352 states the contract (owners replace a changed value; a deep in-place change no longer re-posts by itself). `ready` handler (~:577-589), `attach()`, the push effect and the messages branch untouched.
- **`sessionPage/sessionPageProjections.ts`** (`projectConversationDossier`): a reasoning delta replaces the generating row's `metadata` cell, the per-line cache key reads `m.metadata?.…`, so the page's `$derived` reran every frame and built an equal object. Fix: a file-local `WeakMap` keyed by the line cache holds the last dossier; a file-local `samePlainData` compares plain objects/arrays deeply and anything else by identity (missing vs `undefined` key = unequal); an equal rebuild returns the held object. Signature, `envelopeSections.svelte.ts` and fields unchanged. The rebuild itself still runs per reasoning frame (see Noticed).
- **Proven without a code change:** `RemoteWidget` `sessionV1` (deep copy over the page's stable composed session) does not rerun; `Panel` `resolved.settings` / `grantedScoped` do not rerun on a streamed frame; `SessionLayoutRender`'s `{ session_full: dossier }` compiles to a derived over `dossier`; `r.settings` holds; `dossierFor` all four branches hold their reference while inputs hold; the session-view `PluginFrame` (`routes/sessions/[id]/+page.svelte:925-937`) feeds a memoised `{ id, name }` and `lore` over `lorebookAnnexView` (assigned, never mutated). **In-place writers: none found** (`setWidgetSettingValues`/`patchWidgetSettings` replace `values`; `sessionStore.patchSession` sets a new record; `sessionFrames`, `storyCalendar`, `lorebookAnnexView` assigned; state store replaces `state`).

## Part (a) — counts
Wire fixture (`widgetWire.perToken`, 50 messages-only pushes): `session` 50 → **0**, `settings` 50 → **0**, `scoped` → **0**; all `JSON.stringify` 150 → **50** (`viewer` only).

Owner dom tests (50 streamed frames): RemoteWidget `session` 0 posts/0 stringifies (content-only and reasoning); Panel `session`/`settings`/`session_full`/`persona` 0 each; dossier projection content-only 0 reruns same ref, reasoning 50 reruns still the first ref; `dossierFor` 4 branches 0 reruns. Other direction: a rename → exactly 1 `session` post; nested ruleset change → 1; channels → 1; a settings write → 1 `settings` post, an equal write → 0; replaced context → 1; context → `undefined` → 1 withdrawal; deep-mutated-proxy-derived context → 1; dossier: settle / `settledLine` / `lorebookId` / admin+context debugging each → new reference; `dossierFor` each branch reruns once on a page change; wire contract test pins "owners replace".

**Real mount** (isolated instance :5241, scratch data dir, watcher off, stopped after; Story default layout = Messages + Composer + Turn line; 202 rows; one generating row then 50 `sessionMessageDelta` frames; counted on `MessagePort.prototype.postMessage` and `JSON.stringify`; script scratchpad `perfN-pw/measure.mjs`):

| Section (50 frames, 3 mounts) | Before (inferred) | After, content-only | After, reasoning, wire only | After, both |
|---|---|---|---|---|
| `scoped:session_full` stringifies | 150 (≈55 ms, 48.8 KB each) | **0** | 150 (55.2 ms) | **0** |
| `settings` stringifies | 150 | **0** | 0 | **0** |

Other direction after the change: settle → 3 `session_full` posts (one per mount); Messages `lineWidth: "full"` → 1 `settings` + 2 `session_full` posts; equal settings write → 0. Wall clock per frame (rough): reasoning frames ~5.6–6.1 ms before the dossier fix, ~2.2 ms after; content-only ~0.9–2.9 ms.

## Part (b) — measurements and decision
Bench: new `../serene-pub-sdk/sdk-tests/conversationOrderBench.test.ts` (`node:test`, gated on `PERF_BENCH`; one always-on sanity test); real helpers, `msgOrderKey`/`laneKey` copied verbatim from `SessionContainer.svelte:164-166`, `:177-181`, `rows` filter mirrors `conversation.svelte.ts:178-194`; 500 rows, 20 warm-up, 50 measured. Machine Ryzen 7 7800X3D, node 25.

| Case (median ms/frame, five pieces summed) | run 1 | run 2 | run 3 | lead's run |
|---|---|---|---|---|
| default copy (`main`) | 0.117 | 0.196 | 0.132 | 0.140 |
| two channels | 0.158 | 0.160 | 0.223 | 0.079 |
| interleave (~10 % anchored) | **0.302** | 0.245 | 0.251 | 0.117 |

Pieces (case 3): `rows` filter 0.135–0.17; `laneKey` ~0.07; `msgOrderKey` ~0.015; `indexRowsById` ~0.02; `anyGenerating` 0.003. p95 noisy (1–2 ms single frames). An exact O(N) shape check costs ~0.013 ms. **Decision: nothing built** — one run above the 0.25 ms gate, the only key-reusable part is 0.03–0.09 ms, the filtered `rows` array must never be reused; more needs the O(1) "same shape" wire fact → ★N-1.

## Tests
`frames/`, `host/`, `surfaces/` capped: 48 files / 297 passed. Projection + dossier: 7 files / 86 passed. All of `sessionPage/`: 1009/1010 (`narrateDraft.dom` C2 baseline). `dossierFor.identity` + `dialogueBoxPage`: 13; with `conversationTarget`, `channelClaims`: 52. `tsc` filtered: clean; SDK `sdk-tests` tsc exit 0. Bench sanity passes. Prettier: new files clean; `widgetWire.svelte.ts` and `sessionPageProjections.ts` unclean at HEAD — hunks hand-formatted, no rewrite. No `/tmp/serene-pub-vitest-*` left.

## Changed files
`frames/widgetWire.svelte.ts`; `frames/widgetWire.perToken.dom.test.svelte.ts` (extended); `sessionPage/sessionPageProjections.ts`; new `frames/widgetWire.identity.dom.test.svelte.ts`, `host/remoteWidget.identity.dom.test.svelte.ts`, `surfaces/panel.identity.dom.test.svelte.ts`, `sessionPage/conversationDossier.identity.dom.test.svelte.ts`, `sessionLayout/dossierFor.identity.dom.test.svelte.ts`; SDK new `sdk-tests/conversationOrderBench.test.ts`. Owned but unchanged: `RemoteWidget.svelte`, `Panel.svelte`, `SessionLayoutRender.svelte`, `sessionLayoutModel.svelte.ts`, `SessionContainer.svelte`, `conversation.svelte.ts`, `componentWire.ts`. No new name (helpers file-local).

## Scope review (one round)
(1) no dom test mounts `SessionLayoutRender` → model-level test for all four `dossierFor` branches both directions; the template's wrapper proven by the real-mount script — **lead: accepted** (a render-mount test needs the full model/flow/manager; the real mount is the stronger evidence). (2) narrowed/`oneVoice` branches not in the real mount → covered by the w4 test. (3) the dossier fix moves work rather than removing it → wall-clock reported; rebuild listed under Noticed. (4) session-view `PluginFrame` an unlisted owner → listed, proven by reading. (5) gate wording → the 0.302 run stated as above the gate with the reason nothing was built.

## Open ★
**★N-1** O(1) "same shape" fact from `componentWire` to the conversation (a new wire name). For: skips `msgOrderKey`, `laneKey`, `rows` and the row facts without an O(N) check. Against: measured 0.08–0.30 ms/frame, under the ×4 gate except one interleave run; key-only reuse worth 0.03–0.09 ms. ★ Recommend not now; revisit on a phone profile of the interleave copy or a larger window.

## Noticed, not done
`strings` posted once per streamed frame on the one mount asking for translations (`widgetWire.svelte.ts:557-568` reads `input().owner`, which tracks `messages`; one `untrack` or an `owner` derived). `grants`, `layout`, `viewer` still serialised per push per mount (150 each / 50 frames; 40–350 bytes; `viewer.current` builds a fresh object per read). The dossier projection still reruns per reasoning frame (per-row derived keys in `envelopeSections.svelte.ts` would end it). `setWidgetSettingValues` replaces the whole map (an equal write reruns every widget's `resolved` and every `dossierFor`; posts nothing). SDK `sdk-tests` tsc ~4 min. `state_referenced_locally` warning at `widgetWire.identity.dom.test.svelte.ts:144` (and `widgetWire.oneMessage`). Creating a `core:genre/chat` session with one character was refused ("this genre has no characters — the session has 1") — not investigated.

## Lead's acceptance note
Accepted 2026-11-14. ★N-1 stays unbuilt per the lane's recommendation. The `strings` per-frame post and the three small JSON sections are queued for a later pass, not fixed in passing.
