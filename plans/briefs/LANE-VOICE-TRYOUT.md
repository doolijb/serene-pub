# Lane — Voice try-out + pin, shared by the card and the voicebank (owner 2026-10-29)

Owner: "should we build a scope for testing voices in chara editor?" → yes; "should have the same
event/hook for character voices and global voices, for testing/pinning". Read
`plans/briefs/ACPP-COMMON.md` rules first (binding; no commits, additive edits, capped tests).

## What exists (read these, line ranges only)
- Seed pinning landed today: `src/lib/server/speech/voiceSeed.ts` (`seedFor`, `stableVoiceSeed`),
  `SpeechControls.designsVoice` (`shared/connectionAdapters/speechFacts.ts`), Qwen3 VoiceDesign sets it
  (`shared/speech/catalogues/qwen3.ts`), `VoicebankSettings.seed` (`shared/speech/voicebank.ts`,
  validated in `server/sockets/voicebank.ts cleanSettings`), the voicebank form has an inline Seed +
  Re-roll (`client/components/speech/VoicebankForm.svelte`, `voicebankRows.ts`), and `dispatchSpeech.ts`
  (~:480-520) sends `seed` and keeps the inflection out of a designing model's instruction.
- The speak path: `server/pipelines/runtime/dispatchSpeech.ts` (target pair → adapter → per-group
  `resolveVoice` → `renderDirection` → `adapter.synthesizeSpeech(req)`); `server/speech/resolveVoice.ts`;
  `server/pipelines/speech/lineTemplate.ts renderDirection`; `server/connectionAdapters/speech/getSpeechAdapter.ts`.
- The card's Speech tab: `client/components/characterForms/VoiceTab.svelte` + `voiceTab.ts` (TimbreDraft);
  timbre shape `shared/characters/timbre.ts` (`TimbreSettings` speed/stability/similarity/style),
  validation `server/characters/timbre.ts` (`TIMBRE_LIMITS`).
- Socket conventions: `shared/sockets/types.ts` namespace `Voicebank`, `shared/sockets/interest.ts`
  (GATED_EVENTS sorted; `voicebank:` is a migrated family), `client/sockets/typedSocket.ts`, server
  handlers `server/sockets/voicebank.ts` (`refusable`/`adminHandler`-style), `registerVoicebankHandlers`.
- Phase-2 note from the speech build (lane E): "Try with this line needs a synthesis socket" — this is it.

## Build
1. **One server seam `server/speech/preview.ts`** `previewVoice(db, user, input) → { mime, bytes(base64), durationMs?, spokenAs, applied, ignored, notes }`.
   Input: `{ text?: string (default a shipped sample line, ≤ 300 chars), voice?: slug|null, voiceId?: string,
   connectionModelId?: number|null, description?: string|null, language?: string|null,
   settings?: VoicebankSettings (seed/speed/…), inflection?: string|null }`. It runs EXACTLY the speak
   path's pieces (target pair via `speakingLoadout`, the adapter, `renderDirection`, `seedFor`,
   `designsVoice` rule) for ONE piece, stores nothing, and returns the audio inline. Refuses with a
   sentence when no speaking pair / adapter. One in flight per user (a second request while one runs is
   refused "A voice is already being tried."), 60 s timeout, abort on disconnect.
2. **One socket `voicebank:preview`** (params/response in `Sockets.Voicebank.Preview`), GATED (add to
   `GATED_EVENTS` sorted), typedSocket entry. Allowed for any signed-in user who may edit the card they
   are on — members may try a description; they still cannot pick a voice (A1) — the handler refuses
   `voice`/`voiceId`/`connectionModelId` overrides from a non-admin (uses the pub default voice) and
   accepts `description`, `language`, `settings.seed`, `inflection`.
3. **Timbre gains `settings.seed`** (`TimbreSettings`, `TIMBRE_SETTING_KEYS`, `TIMBRE_LIMITS` 0…2147483647
   integer, validator, import/export unchanged otherwise) so a pinned seed rides on the card; `resolveVoice`
   layers timbre settings over the entry's already (confirm `seed` flows; add a test in
   `resolveVoiceCore`'s suite).
4. **One client component `client/components/speech/VoiceTryout.svelte`** (+ `voiceTryout.ts` pure
   helpers + a `.dom.test.svelte.ts`): a sample line input (prefilled), **Try** (spinner, refusal as inline
   text, never a toast — toasts must not cover actions), a `<audio controls>` player for the returned clip
   (object URL, revoked on next try/unmount), **Seed** number input + **Re-roll** + the designing-model
   hint, and an optional **Inflection** picker (the sprite label set, `INFLECTION_LABELS` from the SDK)
   when the model takes prose. Props: `request` (the overrides the host supplies as a function),
   `mayPickVoice`, `designsVoice`, `bind:seed`. Emits nothing else; the host owns saving the seed.
5. **Mount it twice**: in `VoicebankForm.svelte` (replace today's inline Seed field; the try uses the
   draft's voiceId/model/description/settings) and in `VoiceTab.svelte` (uses the card's timbre draft:
   description, language, voice if admin, `settings.seed`; the Seed/Re-roll shown to `mayPick` only;
   everyone sees Try).
6. **Docs + canon**: `docs/sessions.md` "A character's Speech tab" + `docs/connections.md` voicebank
   section: Try, Seed/Re-roll ("the seed picks which person a voice-designing model becomes; the same
   description with the same seed is the same voice"); NOMENCLATURE §10 rows **voice try-out** (the
   control), **voice seed**; §25 ledger.
7. **Tests (only touched files)**: `preview.int.test.ts` (fake speech adapter: one piece, seed sent, member
   override refusal, in-flight refusal), timbre seed validation, resolveVoice seed layering, the dom test,
   voicebank socket tests still green. `npx tsc --noEmit -p .` and svelte-check (8 GB) once at the end.

Hand back: paths, the `Sockets.Voicebank.Preview` shape, how the two hosts call it, tests + results, ★.
