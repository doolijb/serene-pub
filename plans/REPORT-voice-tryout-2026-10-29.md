# REPORT — Voice try-out + pin (shared by card and voicebank) — DONE 2026-10-29 (saved by the lead)

Built per `plans/briefs/LANE-VOICE-TRYOUT.md`; touched tests green (A 9 files/197, B 3/74, C 4/39), svelte-check 0 errors, tsc clean except the known `NARROW_SIDE_PX`. No browser walk, no live-adapter run.

## Files
Shared: `shared/speech/voiceTryout.ts` (sample line, 300-char max, seed max), `Sockets.Voicebank.Preview` + `Pickable.Response.controls`, `voicebank:preview` gated, typedSocket. Server: `server/speech/preview.ts` (`previewVoice`: pair via `speakingLoadout` + `resolveCapabilityTarget`, admin `voiceId` direct else `resolveVoice` with the draft timbre, designsVoice rule + note, `renderDirection`, `seedFor`, one `synthesizeSpeech`, stores nothing; one in flight per user; 60 s timeout; ≤300 chars), `resolveVoice.ts` (`timbre` override), `voicebank.ts` (`cleanSettings` moved here), `sockets/voicebank.ts` (`voicebankPreview`, aborts on disconnect; `pickable` returns `controls`), **`speechFacts.ts readControls` now parses `designsVoice`** (real bug: the morning's seed pinning never fired on stored facts). Timbre: `TimbreSettings.seed` (0…2147483647, integer), travels on export like speed. Client: `speech/VoiceTryout.svelte` + `voiceTryout.ts` (+ dom test), mounted in `VoicebankForm.svelte` (replaces the inline Seed) and `VoiceTab.svelte`; `Layout.svelte` handles `voicebank:preview:error` (never a toast). Docs: sessions.md, connections.md; NOMENCLATURE §10 **voice try-out**, **voice seed**; §25.

## Behaviour
Any signed-in person may try; a non-admin's `voice`/`voiceId`/`connectionModelId` are refused ("…your try uses the pub's default voice") and their settings cut to `seed`. Try = tonal button; refusals inline; clip from an object URL; Seed + Re-roll only for `mayPickVoice`; Re-roll tries at once; Mood only when the model takes prose and does not design its voice.

## Lead follow-up
- ★2 applied: the resolution's description is the card's, else the voicebank entry's own description, so a try on the entry form and a real line through that entry design the same person.
- ★1 kept (the `readControls` fix is correct and belongs there). ★4 seed stays member-settable like speed (UI hides it). ★5 seed stays on export like speed. ★3 noted. ★6 socket named `voicebank:preview` vs canon **voice try-out** — owner may rename.

## Unverified
Browser look/autoplay; a real round trip; a refusal without `requestId` waits the 65 s client timeout; non-integer Seed input clears the field.

## Owner report 10-29 "Audio file always returns empty, 0 seconds" — found and fixed by the lead
Traced: the spoken files on disk are whole WAVs (79 s and 99 s), their rows and `core:audio` parts are right, audio.cpp answers `audio/wav` with a proper RIFF header, and GET /media serves the whole file under every browser Accept header (new `media/mediaRoute.spoken.int.test.ts`). The production CSP (`svelte.config.js kit.csp`, applied on the built app at :4173, never on the dev server) had no `media-src`, so it fell back to `default-src 'self'` — which blocks the **try-out's blob: object URL**, leaving the browser's player at an empty 0:00. Fixed: `"media-src": ["self", "blob:"]`. Also: the speak step's `durationMs` is now stored on the file (`createMedia` takes `durationMs`; `files.duration_ms` was always null for spoken audio). Needs a rebuild of the production app to take effect.

## Owner report 10-29 "can't set the default connection/model for voices; qwen tts doesn't show up" — fixed by the lead
Cause: every voicebank entry required a voice id, and Qwen3 VoiceDesign lists no voices (the description IS the voice), so no entry could be made, no default was seeded ("No voice set up on this pub yet"), and the card's picker had nothing. Fixed: on a model whose facts say `designsVoice`, an entry is name + description (voice id stored blank; the dialect already omits an empty `voice`); the form hides the voice picker and makes the description the voice; `ensureVoicebankDefault` seeds a "Narrator" entry with a description on such a model; server create/update accept a blank id only for a designing model. Try-out on the entry form is blocked until the description is written.
