# REPORT — Speech build, lane C (voicebank, timbre, resolver, media) — 2026-10-28

**Status: BUILT, typechecked (lane C files clean), uncommitted.** Supervisor (Opus), workers C1–C4 (Sonnet).
Final `npx tsc --noEmit -p .`: 6 errors, none in lane C files. Five are lane B's in-progress
`connectionAdapters/speech/profiles/{koboldcpp,ollama,openai}.ts` (abstract `synthesizeSpeech` via
`super`). The sixth is the existing `arrangeCanvas.dom.test.svelte.ts` `NARROW_SIDE_PX`.

## Seams (written first)
- **S5** `src/lib/shared/characters/timbre.ts`: `CharacterTimbreInput { description?, voice?, language?, settings? }`, `TimbreSettings`, `TIMBRE_SETTING_KEYS`, `timbreOfExtensions(ext)`, `canPickVoice(user)` (A1: admin only).
- **S4 shared types** `src/lib/shared/speech/voicebank.ts` (new path, D1): `VoicebankVoiceView`, `VoicebankPickableVoice`, `VoicebankVoiceInput`, `VoicebankSettings`, `VoicebankLabels`, `VOICE_FROM`/`VoiceFrom`, `VOICE_LANGUAGE_FROM`/`VoiceLanguageFrom`, `VoiceSkip`, `ResolvedVoice`, `VoiceRefusal`, `VoiceResolution`.
- **Schema**: `voicebankVoices` + relations appended at the end of `src/lib/server/db/schema.ts`; `systemSettings.keepSpokenAudio` (D3).
- **Migration `drizzle/0129_speech_voicebank.sql`**: the journal max was 128 and this one is idx 129. It was generated against a scratch data dir, and contains only the table, its FK and 3 indexes, plus the `system_settings` column. Applied cleanly to a fresh scratch PGlite via `drizzle-kit migrate` (C1, `$S/check-mig.mjs`).

## Built
**C1: voicebank helpers and sockets**
- `src/lib/server/speech/voicebank.ts`: `speakingLoadout(db, loadoutId?)`, `loadoutSamplingVoice(db, samplingConfigId)` (reads `sampling_configs.values.voice`), `voicebankRefusal(row, pairModelId)` (A7, 4 reasons), `voicebankBySlug` (prefers `pub`), `voicebankDefault`, `toVoicebankView`, `slugifyVoicebank`, `uniqueVoicebankSlug`, `ensureVoicebankDefault(db)`.
- `ensureVoicebankDefault` seeds one `pub` "Narrator" default, but only when the table is empty, the speaking loadout has a model, and a voice id is known. The voice id comes from the sampling `voice`, else from `readSpeechFacts(...).voices[0]`. The seed runs in a transaction under an advisory lock; deleting every row re-seeds it.
- `src/lib/server/sockets/voicebank.ts`, registered in `sockets/index.ts`. Refusals go out as `<event>:error` (cardState's `refusable` convention).
  - `voicebank:list` (admin) `{}` → `{ voices: VoicebankVoiceView[]; pairModelId: number|null }`. Calls `ensureVoicebankDefault` first.
  - `voicebank:create` (admin) `{ voice: VoicebankVoiceInput }` → `{ voice }`. A7: refuses another model or an unfilled loadout.
  - `voicebank:update` (admin) `{ id; voice: Partial<VoicebankVoiceInput> }` → `{ voice }`. A row that is not `pub` accepts `enabled` only.
  - `voicebank:delete` (admin) `{ id }` → `{ id }`. No cascade into timbres.
  - `voicebank:setDefault` (admin) `{ id: number|null }` → `{ defaultId }`. Refuses an unusable row.
  - `voicebank:pickable` (any signed-in user) `{}` → `{ voices: VoicebankPickableVoice[] }`. Enabled and usable rows only; `previewUrl` comes from the facts.
  - Every mutation re-pushes `voicebank:list`. `Sockets.Voicebank` is in `shared/sockets/types.ts`. All 6 events are in `GATED_EVENTS`, born gated.

**C2: timbre**
- `src/lib/server/characters/timbre.ts`: `validateTimbre`, `applyTimbreToExtensions`, `applyTimbreUpdate` (the one hook), `timbreForExport` (drops `voice`), `timbreFromImport` (drops `voice`, sanitises silently), and `TIMBRE_LIMITS`.
- Hook in `sockets/characters.ts` `charactersUpdate`, around line 691. It runs when the save carries `extensions`; a member's `voice` stays as stored, and a refusal is reported as `characters:update:error`.
- `cardIO.ts`: export adds the timbre through `exportedExtensions()`, and import passes it through `timbreFromImport`.

**C3: resolver** (`src/lib/server/speech/`)
- `resolveVoice(input: ResolveVoiceInput, db?) → Promise<VoiceResolution>`, where `ResolveVoiceInput = { speakerRef: ParticipantRef|null; sessionId: number|null; loadoutId?; cueLanguage?; text? }`.
- Voice order: no pair → refusal; then timbre → session (`speech.narratorVoice`) → voicebank-default → loadout → service (`voiceId: null`). A named entry that is missing, disabled or off the pair is skipped with a reason in `skipped[]`, and resolution continues.
- `settings` is the entry's settings with the timbre's on top. `connectionModelId` is always the loadout's model.
- Speaker refs: `character:<id>` and `player-seat:<id>` carry a timbre; `user:`, `envoy:`, roles and null (the narrator) do not.
- `language.ts`: language order is cue → script → timbre → session (`session.language`) → pub (`system_settings.default_language`).
- Script detection never detects Latin. It returns `ja`, `ko`, `zh`, `el`, `he`, `th`, `ka`, `hy` or `hi` when one script holds at least 60% of the letters; Cyrillic and Arabic return null.
- `resolveVoiceCore.ts` is pure (`resolveVoiceFrom(facts)`). `resolveVoice.fixtures.ts` has 16 fixtures covering every `from` value, the refusal, the three skip reasons, settings layering and every language link. All pass via tsx (`$S/run-fixtures.ts`).

**C4: media** (`src/lib/server/media/spoken.ts`, `spokenRetention.ts`, `cull.ts`, `sockets/media.ts`)
- `isSpokenMedia`, `spokenSql`/`notSpokenSql` (`(meta->>'spoken') IS DISTINCT FROM 'true'`), `KeepSpokenAudio = 'forever'|'archived'|number`, `read`/`write`/`parse`/`formatKeepSpokenAudio`, `findSpoken`, and `deleteSpokenFiles` (which uses the same `deleteFile` path as `media:delete`).
- Cull: `cullableDerived` now includes spoken files (`spokenFileIds`, counted in `files` and `bytes`), and `media:cullDerived` deletes them. `cullableOriginals` excludes spoken files.
- `media:list` excludes spoken files by default; the new `includeSpoken?: boolean` opts in.
- Sockets (gated):
  - `media:spokenSummary { sessionId? }` → `{ count, bytes, keep, sessionId }`
  - `media:clearSpoken { sessionId? }` → `{ cleared, bytes, sessionId }`
  - `media:setKeepSpokenAudio { keep }` → `{ keep }` (admin only; the system-settings sockets have one handler per field, so there is no generic setter).
  - Summary and clear are admin-only pub-wide; with a `sessionId`, the session owner or an admin may call them.
- `sweepSpokenAudio(db, now)` handles forever, archived (`sessions.archivedAt`) and N days. `startSpokenRetention()`/`stopSpokenRetention()` run an unref'd hourly timer.

## Deviations from the seams
- **D1**: the S4 wire types live in a new `src/lib/shared/speech/voicebank.ts`, which is not in §4's ownership table.
- **D2**: `resolveVoice` returns `ResolvedVoice` (`ok: true` + the seam fields + `languageFrom`, `voicebankSlug`, `description`, `skipped`) or `VoiceRefusal` (`ok: false, reason`). Lane D must narrow on `ok`. The input also takes `cueLanguage?` and `text?` (for A2 script detection); `db` is optional.
- **D3**: `speech.keepSpokenAudio` is a `system_settings.keep_spoken_audio` column, because there is no key-value pub store. That makes it one edit to `schema.ts` outside the voicebank block, and `media:setKeepSpokenAudio` was added as its setter.
- **D4**: language order puts **script** detection second (cue → script → timbre → …). A2 does not place it.
- **D5**: edits to shared files outside the ownership table, all append-only:
  - `shared/sockets/types.ts`: `Sockets.Voicebank`, plus additions in `Sockets.Media`.
  - `shared/sockets/interest.ts`: a voicebank group and 3 media events.
  - `server/sockets/index.ts`: 1 import and 1 register line.
- **D6**: C3 reads the session's narrator voice (`speech.narratorVoice`) on every speaker's chain, not only the narrator's, as the session's fallback voice. This follows the brief's single chain.

## Loose ends: need the lead (files outside lane C)
- **L1 (sweep not wired)**: `src/lib/server/services/register.ts`, after the `dailyBackup` block (line ~71), needs this:
  `const spokenRetention = await import("$lib/server/media/spokenRetention"); registerService({ id: "spokenRetention", label: "Spoken audio retention", reconcileOnBoot: async () => spokenRetention.startSpokenRetention(), shutdown: async () => spokenRetention.stopSpokenRetention() })`.
  The plugin schedule tick only delivers to plugins.
- **L2**: `ensureVoicebankDefault` runs lazily, on `voicebank:list`/`pickable` only. A boot call in the defaults sync would seed it earlier. Nothing is lost without it, because the resolver falls through to the loadout voice.
- **L3 (lane D)**: where are `speech.narratorVoice` and `session.language` stored? `sessionSpeechSetting(db, sessionId, key)` in `resolveVoice.ts` is the only reader. It tries `sessions.genreFields[key]`, then `sessions.metadata[key]`, then `metadata.speech.narratorVoice` / `metadata.session.language`. Confidence is about 50%; lane D should fix only that function.
- **L4 (lane D)**: `storeGeneratedMedia` sets `files.userId = scope.userId ?? 0`. Pass the session owner's id, or spoken files are missed by the per-user derived cull. Pub-wide and per-session clear work either way.
- **L5 (lanes D and E)**: clearing or sweeping deletes the files only. A line's `core:audio` part may then name a missing file, which must read as "not spoken yet", not as a broken line.
- **L6 (lane E)**: every `voicebank:*` event and the new `media:*` events are gated. The client must declare interest (the registry) before calling, or the reply is dropped.

## ★ Questions
1. `characters:create` does not guard `timbre.voice`, so a member could create a card that carries a voice; only `update` is hooked (the brief allowed one function). Should create be hooked too?
2. Should a voicebank entry's own `language` sit in the A2 chain (after timbre, say)? It does not today.
3. Should a timbre be allowed to name a disabled entry? It is accepted, then skipped with a reason at resolution.
4. `voicebankBySlug` prefers `pub`, so a disabled `pub` row shadows an enabled plugin row with the same slug. Is that acceptable for phase 1?
5. Should a non-owner session participant be allowed to see or clear spoken audio? Today only the owner or an admin can.
6. ★15 is carried: the code word is `voicebank`. Lane E records it in NOMENCLATURE, along with timbre, cue, voicebank and the spoken class (🚧).

## What to test (lane V)
- **Resolver**: run `voiceFixtures` through `resolveVoiceFrom`. Run `resolveVoice` against a real db for each speakerRef kind (character, player-seat, user/envoy/null, malformed ref → no timbre, no throw). Also cover: an unfilled loadout → refusal; omitted `loadoutId` → Narration; a drifted, deleted-model or disabled entry → skip; the pub language fallback.
- **Voicebank**:
  - `voicebankRefusal`'s 4 reasons.
  - `ensureVoicebankDefault`: seeds once, with the voice from sampling then facts. No voice known means no row, a non-empty table means no insert, and it re-seeds after all rows are deleted.
  - Slug suffixing.
  - create: A7 refusal, validation, duplicate slug.
  - update: a plugin row changes `enabled` only; `updatedAt` is bumped.
  - setDefault: exactly one default afterwards; a disabled row is refused; `null` clears.
  - pickable: excludes unusable rows, works for a member; a member's `voicebank:list` is refused.
  - Each mutation pushes `voicebank:list`. Gating: the reply is delivered only with interest declared.
- **Timbre**:
  - The validation table: language `EN`→`en`, `eng` refused; speed 0.25 and 4 pass, 0.24 and 4.01 are refused; the 0/1 dial bounds; NaN dropped; a 2001-character description refused.
  - Voice: an admin can set a voice from the voicebank, setting an unknown slug gets the exact reason, and an empty string clears it. A member's sent voice is ignored and the stored one kept.
  - Absent timbre → kept. Export drops `voice`. Import sanitises, ignores `voice`, and a malformed timbre still imports.
- **Media**:
  - Listing: default excludes spoken, `includeSpoken` includes it, and null meta is listed.
  - Cull: derived includes spoken (row, bytes and thumbs gone); originals never see spoken.
  - Summary and clear: per session as owner, admin and stranger; pub-wide as admin and member. Counts are correct and other sessions are untouched.
  - Keep setter accepts forever, archived and 1–3650, and rejects 0, 3651, 1.5 and a member caller.
  - Sweep: forever, archived and N days, each at its boundary. Non-spoken files are never touched. The timer is idempotent.
