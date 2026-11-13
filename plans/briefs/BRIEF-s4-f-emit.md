# BRIEF — lane `s4-f-emit` (wave 3; flip unit) — core emits member form

Read `plans/briefs/BRIEF-s4-common.md`, then plan §34.1 in full, §34.5, and the reports of waves 1–2: `plans/REPORT-s4-f-sdk-2026-11-08.md` (**its "Queued for f-emit" list is part of your goal**), `plans/REPORT-s4-f-door-2026-11-08.md` (the switch and the translator), `plans/REPORT-s4-f-pass-2026-11-08.md`, `plans/REPORT-s4-ner-2026-11-08.md` (★s4-ner-2). ★K-1 (ruled): `cast.byId` keyed `seated_member:<id>`; persona seats `player_seat:<seatId>`.

⚠ Flip unit. Lane s4-f-client flips the client beside you. After both report, the lead runs the **turn-on** (f-door's door switch on + f-pass's startup hunk) and the grouped verification. Until then no lasting database boot. Your tests run against member-form data (build fixtures with seats + members; call f-pass's pass in setup where a test needs migrated data).

## Goal

1. **Every emit site in §34.1 emits member form** — `seated-member:<id>` / `player-seat:<seatId>` refs, `seated_member` / `player_seat` owners and keys — for the session layer: seat payloads (`sockets/sessions.ts` ~5460, 5471 host-filled `ref`; ~6749 turn positions; ~7175; ~8319 offer speaker; ~11293 cast-change events), turns and speakers (`runtime/bindings.ts` ~1569, 1573, 4338, 4373, 7264, 7897–7921, 9316, 9499; `speakerRotation.ts` ~347, 370, 384, 566; `fireAction.ts`; `runTurn.ts`; `host.ts` ~657, 661, 5057, 5393, 7884, 8846; `portrayals.ts` ~431, 435 with audiences; `turnPlan.ts`, `turnYield.ts`, `liveScenes.ts`, `sessionEvents.ts`, `moments.ts`, `sessionChanges.ts`, `diceWords.ts`, `runReply.ts`, `dispatchSpeech.ts` ~433, `seatCards.ts` ~189, `bindings.relationships.ts` ~394, `sprites/choices.ts`, `speech/resolveVoice.ts` (the `speechAutoVoice:` key)). `state/resolve.ts`'s byId key flips through f-door's switch (the turn-on), not here — check f-door's report for what's left to you. Grep again — don't trust these line numbers; list every site you changed and every card-form site you deliberately left (card→seat lookups on card columns stay until S5).
2. ~~`links.cast` split~~ — withdrawn, see goal 9's design note.
3. **Turn-advise path** (`bindings.ts` ~7897): `spokenRefsSince(messages, lookup)` with the cast lookup, and `who` (~7913–7921) built from seat refs, not card ids.
4. **f-sdk's queue:** (1) the speaker stamp (`messages/store.ts` ~117–130) stamps a seat's line with its member-form ref and merges ★TIDY-2's second rule into the one stamp; host `selection.sentSinceReply` reads member form; (2) `seatRefLookupOfCast` (`speakerRotation.ts` ~115–140) honours `seatKind` (`'character-seat'` → character seats first; `'player-seat'` → player seats first; other list as fallback) so `contentProcessors.ts:93` and `bindings.ts:4356` get the persona seat for a person's line; (3) `messages/writes.ts` ~145 `LibraryNeed`: remove the now-unused `"lorebooks-into-sessions"` (keep `"sessions"` until ★f-sdk-4's S5 removal, marked ⏳).
5. **Remove `givePlayerSeatACard`'s `session_cast` rekey** if f-door left it to you (its report says).
6. **★s4-ner-2:** retrieval's `castEntityRefs` (`runtime/bindings.ts` ~759) emits `cast_member:<bindingId>` for roster members with no live card (needs the binding id and the card's deleted flag on the host's cast read).
7. **Display duplicate:** `readCastProposal` (`sockets/scenes.ts` ~2864) keys a seat by member, so a seat whose card is soft-deleted and who is also named shows once.
8. **SDK sentence that turns false at the flip:** "a seat with a card is that card's `session_cast`" in `../serene-pub-sdk/sdk/src/widgets.ts` (`SessionStateOwnerV1`) and `guides/widget-examples.md` — reword to the member form (modder rule: one clear sentence + example). Then `npm run sdk:build` (check `pgrep -af "vite dev"` first; blocked → say so).

9. **From f-door's report (`plans/REPORT-s4-f-door-2026-11-08.md`), now yours:**
   - `runtime/bindings.state.ts` (`CastOwner` at ~69) and `runtime/tools/stateTools.ts` — accept `seated_member` / `player_seat`.
   - `runtime/portrayals.ts` `resolvePortrayals` resolves the `player-seat:` / `seated-member:` audience refs `hearingOf` asks for when the switch is on.
   - `sessions/annexChanges.ts` `restoreAnnexDeltas` translates the restored core annex and audiences through f-pass's annex translator (in `sessions/seatKeys.ts` — read `plans/REPORT-s4-f-pass-2026-11-08.md`); `lorebooks/annex.ts:240` `unionAudiences` translates per session.
   - `state/give.ts` offers: `payload.offer.from` / `to` go through the restore door too (f-door is done; you may edit `give.ts` and `write.ts`'s restore path for this).
   - `rulesets/resolve.ts` `ctxFor`: with the switch on, a carded player seat must take the same anchor `session_cast` took (no behaviour change for persona seats); fix it (you may edit that function).
   - `state/durable.ts` (★K-2: two links, one durable `castMemberId`) and `handEdits.ts` `seatMemberOfCard` (keyed by card): make both seat-keyed so a K-2 card's two seats don't overwrite each other.
   - **Design note (lead, accepting f-door's decision):** carded player seats stay in `links.cast` with `playerSeatId` (one link per seat) rather than moving to `links.playerSeats` — so §34.1's "links.cast split" is **not** a goal; goal 2 above is withdrawn. Keep readers working on that shape.
   - Test the flip end to end with `memberFormSwitch.on = true` in your fixtures (`src/lib/server/state/memberForm.ts`); **don't change the literal** — the lead's turn-on does.

## Files owned

`src/lib/server/pipelines/runtime/**` (owns `host.ts`), `src/lib/server/pipelines/routines/*`, `src/lib/server/messages/**`, `src/lib/server/sessions/{turnPlan,turnYield}.ts`, `src/lib/server/scenes/liveScenes.ts`, `src/lib/server/speech/**`, `src/lib/server/sprites/choices.ts`, `src/lib/server/pipelines/prompt/seatCards.ts`, `src/lib/server/sockets/sessions.ts`, `src/lib/server/sockets/pipelines.ts`, `src/lib/server/sockets/scenes.ts` (the one read), `src/lib/server/sessions/annexChanges.ts`, `src/lib/server/lorebooks/annex.ts` (`unionAudiences`), and the named functions in `state/give.ts`, `state/write.ts` (restore path), `state/durable.ts`, `state/handEdits.ts`, `rulesets/resolve.ts` (`ctxFor`), the SDK `widgets.ts` JSDoc block + `guides/widget-examples.md`, tests next to all of these.

## Out of scope

Client (f-client); `state/**`, rulesets, `seatRefs.ts` (f-door, done — queue fixes); the pass and startup (f-pass / turn-on); `seats.ts` (seat lane, wave 4); card-less seats. NOMENCLATURE: queue rows.

## Done means

Emit tests: `cast.byId` keys and refs, owner rows, portrayals against audiences, turn-advise, the sender of a member holding both seat forms, the speaker stamp, auto-voice key, `castEntityRefs` for a card-less member; the existing `runtime/`, `messages/`, `speech/`, turn and scene test files green against member-form fixtures; `sdk:test` no new reds; tsc + check no new errors. Report `plans/REPORT-s4-f-emit-2026-11-08.md`.
