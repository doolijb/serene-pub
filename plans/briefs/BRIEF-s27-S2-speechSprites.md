# BRIEF s27-S2-speechSprites — a seated character's voice and sprites come from the member, own over card (seat-cast programme, stage S2, wave 1)

You are a `lane-supervisor` (fresh, Opus). Read `plans/briefs/BRIEF-s27-S2-common.md` first (the contract), then this brief. Lane id **s27-S2-speechSprites**. Two workers at most (Sonnet). App `/home/jody/github/serene-pub`. Concurrent lanes: **s27-S2-state**, **s27-S2-promptText** (owns `host.ts` except your hunk) — don't edit theirs.

Owner ruling (§27, 2026-11-05): **members carry voice and sprites — own over card, like retold text.** S1 added `lorebook_bindings.timbre` and member-owned `sprite_sets` (`cast_member_id`); S2core's `MemberAsRead` gives `timbre`/`voiceFrom` and `spriteSets`/`spriteSetsFrom`.

## Items
1. **Voice:** `speech/resolveVoice.ts` (~114–148 `characterTimbre`/`speakerTimbre`, ~153 `speakerSilent`, ~263–274 voices in use, ~297–357 `castingOf`) resolves a seated speaker's timbre from the member as read (member's own, else the card's); `player-seat:` refs likewise through the seat's member. `speech/preview.ts` ~168–174, `speech/language.ts` ~51–63, `pipelines/runtime/dispatchSpeech.ts` (~146–231 `speakerRef`, ~350–395 `nameOfRef` names from the member as read), `pipelines/speech/cueLines.ts` ~161, `messageLine.ts` ~58–64. Auto voice picks stay keyed by speaker ref (S4) — the hash input must not change for today's data.
2. **Sprites:** `sprites/choices.ts` (~104–140 `spriteChoicesFor`: the member's sets when it has any, else the active card's; ~232–270 `setSessionSpriteSet` / `spriteSetOverridesFor` — the slot stays on the `session_cast` owner, the set name resolved against the member's sets first), `sprites/index.ts` (the per-card reader already skips member-owned sets — add the member-owned read beside it), `attach.ts`, `reexpress.ts`, `fillAction.ts`, `sockets/sprites.ts` ~300–360 `sessions:setSpriteSet` (seat check by `seatOf`), `pipelines/entities/publishedValues.ts` ~205–235, and the sprite node hunk in `pipelines/runtime/host.ts` ~6347–6361 (**your hunk only**). Keep `spriteChoicesFor`'s existing callers working (add a seat- or member-aware form rather than breaking the signature, and switch only the callers in your files).
3. **No UI** to give a member its own voice or sprite sets is in this lane — readers only. List what a UI would need under Noticed.
4. **Tests:** existing speech and sprite suites unchanged and green; new: a member with its own timbre speaks with it over the card's; a member with its own sprite sets shows them over the card's, and a session sprite-set pick resolves against the member's sets; a seat with no member yet reads the card; a `seated-member:` speaker ref resolves.

## Files owned
`src/lib/server/speech/**`, `src/lib/server/sprites/**`, `src/lib/server/sockets/sprites.ts`, `src/lib/server/pipelines/runtime/dispatchSpeech.ts`, `src/lib/server/pipelines/speech/**`, `src/lib/server/pipelines/entities/publishedValues.ts`, `host.ts` ~6347–6361 only, their tests, `NOMENCLATURE.md` (§25 rows).
## Out of scope
Auto-pick rekey, the sprite slot's owner key (S4); client; UI for member voice/sprites; the SDK.
