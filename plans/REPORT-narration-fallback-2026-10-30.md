# REPORT — Narration is the one fallback loadout (default voice + Auto for other speakers) — DONE 2026-10-30 (saved by the lead)

Built; isolated walk green (Lair + Castellan + voiceless character + voiceless persona); 36 lane test files / 477 green; tsc known-only; svelte-check 0 errors; sdk:test 4048/4049 (known red); docs 155 pages. No commits; **no sdk:build** (another session's instances read dist) — the one SDK line (`EnvoyDecl.casting?`) is read structurally by the app and reaches dist at the next build.

## Data
**0137 `loadout_voices`**: `loadouts.default_voice_id`, `loadouts.other_speakers_voice_id` (→ voicebank_voices, set null; null other-speakers = Auto). Data upgrade (anchored on 0137, runs before 0138 in 0137's transaction): `is_default` row → its loadout's `default_voice_id` if null, then `is_narration_default` row likewise (default star wins — ★1). **0138 `voicebank_drop_stars`** drops the index + both star columns. `ensureLoadoutVoice` replaces `ensureVoicebankDefault`: seeds "Narrator" on the speaking loadout when the voicebank is empty; fills an empty Voice with the lowest-id usable entry; clears pointers when an entry is disabled/moved.

## Resolution (VoiceFrom arms; fixtures in `resolveVoice.fixtures.ts`)
- Narrator chain: `session` → `loadout-voice` → `loadout-first` → `loadout` (sampling voice) → `service`.
- Dialogue with a speaker: `timbre` → `envoy` → `other-speakers` (pinned) → `auto` → narrator chain.
- Narration inside a line: `narration-timbre` (card's override narrator) → `envoy-narration` → narrator chain. Plain narration: narrator chain. No-speaker dialogue / try-out: narrator chain (was the default star — ★6).
- Descriptions: dialogue = card's own else entry's; narration = entry's only; envoy prose gone. Card settings layer on dialogue only. `VOICE_FROM` drops `voicebank-default`/`narration-default` (old records still render).

## Auto (`server/speech/autoVoice.ts`, pure)
Candidates = the speaking loadout's enabled usable entries; sticky stored pick reused if still valid and not the narrator's; pool = candidates minus the narrator's actual winner (empty → `only-narrator` → narrator chain); prefer unused voices (cast cards, envoy overrides, other stored picks) → `avoids-narrator`, else `shared`; casting tags (gender/age/"narrat" label) filter when they match; tie-break slug sort + FNV-1a(`speakerRef|sessionId`) mod n. Stored as `sessions.genre_fields["speechAutoVoice:<speakerRef>"]` only from `dispatchSpeech` (`rememberAuto`), under an advisory xact lock; stale picks dropped at next resolution; clients cannot write the key. `speakerFallbackVoice` = read-only view for the card.

## UI
Loadouts sheet (text→audio, unmerged): **Voices** card — Voice (the narrator; picker over the loadout's entries; never empty while entries exist) and Other speakers (Auto or pinned; refuses a voice from another loadout); saves immediately; "Add a voice" door. Voices panel: stars gone; per-loadout header "Narration · Voice: X · Other speakers: Auto · Open loadout" + Voice chip. Read aloud card: narrator = "Narration's voice (X)" + override (members: "Pub narrator (X)"); envoy rows "Auto: Mira — Avoids the narrator." / "Shared with another speaker…" / "Auto: same as the narrator" (+ admin hint) / "Other speakers: Mira"; **both envoy description fields removed** (unregistered; writes refused). Card Speech tab blank Voice = "Auto".

## Docs/canon: connections.md, sessions.md, NOMENCLATURE (loadout voice, other speakers, auto voice pick; stars + narration default retired; `casting` collision noted). Shots: `scratchpad/narration-fallback/shots/` (20/21 read-aloud desk/compact light/dark, 22 voices panel, 11 loadout sheet ×4, 12/13 pinned).

## ★ owner
1 upgrade: default star wins over narration star when both sit on one loadout (pubs using the narration star hear the narrator change) — reverse? 2 `EnvoyDecl.casting` collides with spellcasting `casting` (R1) — rename `voiceCasting` before 0.7? 3 SDK `SpokenVoiceFrom` is stale (lacks the new arms; lists retired ones) — update at the next SDK prerelease. 4 the Voice never stays empty; unpinning on disable is not restored on re-enable. 5 envoy narration-voice PICK kept, only prose removed — confirm. 6 no-speaker cases now use the narrator chain. 7 the Castellan's unquoted prose is narration (Auto only on quoted speech). 8 stale picks drop at next resolution; "avoids the narrator" wording is sticky. 9 members' wording checked by tests only. 10 the Voices card saves immediately. 11 not verified: real 0137/0138 upgrade on the owner's DB; casting tags live; two vitest PGlite dirs left in /tmp (sweep).
## Outside-lane reds seen: `0108_layering_registrations.int` (speak-message keys), `startSessionModes.dom` (another session's work).
