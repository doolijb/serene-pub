# Lane — Speech follow-ups (owner 2026-10-29): speech as an event, envoy voices, character narration voice, pub narration default

Read `plans/briefs/ACPP-COMMON.md` (rules). Everything here is additive; SDK edits are allowed but ONLY the ones listed (sdk:build only with :5173 and :4173 checked first — the owner runs `vite preview` on :4173; never touch it).

## A. Speech runs after the reply settles (fixes lane V's V-5)
1. SDK `sdk/src/events.ts`: `core:event/message-settled@1` with payload `{ sessionId, messageId, channel, step, revision, speakerRef, kind: 'reply'|'narration'|'user' }`, emitted by core once a reply line has been written and its receipt closed (find the one place the reply outlet commits: `host.ts` attach/commit of the message; emit through the existing event bus the `ruleset-converted` event uses).
2. Core listener (`server/speech/onMessageSettled.ts`, registered beside the services): reads `sessionSpeechSettings`; when Read aloud ≠ off and the message is a reply (or narration), enqueues `core:spec/speak-message` as its OWN run on the speech lane for that session (the same run the ⋮ *Read aloud* verb starts), never under the reply line's hold. One in flight per message; a newer settle of the same message cancels the older run.
3. Remove the speech tail (`speechTail`) from the five reply specs in `core-catalog` and its edge in `speakMessage`/genre defaults; keep `core:spec/speak-message` and the verbs. Re-pin the spec hashes and registry counts this moves (prove each by the removal). The SDK `deriveDontSpell` allowance drops back toward 21 — note the new count.
4. The Spoken line shows **Speaking…** with **Stop** while that run is live (the run id is on the message's `metadata.spoken.pending`), via the existing run-status pushes; Make and play autoplays when the file lands as before.
5. Docs: sessions.md Read aloud ("spoken after the reply lands; the next reply never waits"), pipelines docs where the tail was described; NOMENCLATURE §10 **speech tail** → retired (§23) in favour of **message settled** event; §25.

## B. Envoy voices
6. Session Read aloud card: **Envoy voices** block listing the genre's enabled envoys (from the session's participants), each with the voicebank picker (Pub default) and a description field; stored as genre fields `speechEnvoyVoice:<envoySlug>` and `speechEnvoyDescription:<envoySlug>` (register them in `shared/sessions/speechSettings.ts` as a keyed family; the settings form validates the slug with `narratorVoiceRefusal`).
7. Resolver (`speech/resolveVoice.ts` + `resolveVoiceCore.ts`): an `envoy` speaker reads its session voice/description first, then falls to the narrator chain. Tests in `resolveVoiceCore.test.ts`.

## C. Character narration voice + pub narration default
8. `CharacterTimbreInput.narrationVoice?: string` (voicebank slug; admin-only like `voice`; dropped on export like `voice`) and `narrationDescription?: string` (portable prose, optional). Card Speech tab: **Narration voice** picker + **How their narration sounds** under the Voice block ("the voice that reads the prose around this character's lines; blank uses the session's narrator, then the pub's narration default").
9. Pub narration default: a second star on the voicebank — `voicebank_voices.is_narration_default` (generated migration) — set from Loadouts → Voices ("Use for narration") beside the existing default star; `voicebankDefault(db, 'narration')`. Admin only.
10. Resolution order per CUE KIND (the group's `voice` kind reaches `resolveVoice` as `cueVoice: 'speaker'|'narrator'`):
    - dialogue (speaker): character `voice` → envoy session voice → session narrator voice → pub default star → loadout sampling voice → service default (today's chain, unchanged);
    - narration inside a character's or envoy's line: character `narrationVoice` → envoy narration voice (session field, same block as 6) → session narrator voice → **pub narration default** → pub default star → … ;
    - plain narration (no speaker): session narrator voice → pub narration default → pub default star → … .
    Descriptions follow the same order. `resolveVoiceCore` fixtures cover every arrow; `dispatchSpeech` passes `cueVoice` from the group.
11. Docs: sessions.md "A character's Speech tab" + Read aloud card; connections.md voicebank ("two stars: the pub's default voice and its narration voice"); NOMENCLATURE §10 rows **narration voice** (per character / per envoy / session / pub, qualified), **narration default** (voicebank); §25.

## Tests (touched files only) and hand-back as the other lanes: paths, pins moved + proofs, tests + results, tsc/svelte-check, ★.
