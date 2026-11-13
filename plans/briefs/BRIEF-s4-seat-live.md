# BRIEF — lane `s4-seat-live` (wave 4 follow-up) — make a card-less seat play end to end

Read `plans/briefs/BRIEF-s4-common.md`, plan §34.2, and **`plans/REPORT-s4-seat-2026-11-08.md` in full — its "Queued edits outside the lane" Q1–Q12 and "Smaller" items are your goal, exactly as written there.** Also `plans/REPORT-s4-on-2026-11-08.md` and `plans/REPORT-s4-f-emit-2026-11-08.md` (the flip is on; `hostSeatRefOf` is the one emit rule). Rulings: ★4 (background member = not seated in this session), ★6 (named Take a seat mints a card-less member), ★S2b-1 "Still theo".

## Goal

1. **Q1–Q5 first** (turn, reply, host scope + lore gate inputs, the host `session_cast` read, prompt fields) — they make a card-less seat speak as itself and see its own private lore. Then Q6–Q8 (stops, transcript naming, adapter/speech session reads), Q10 (`writeSeatName` → `seatPlayer({ mintCardless: true })`), Q11 (`PickSpeakerModal` gets `cardlessSeatShown`), Q12 (`canActOnMessage`: the seater acts for a card-less character line; mirror in client `canControlMessageAs`).
2. **Smaller items:** `promptTokenCount` head; `pick-sprite` (`host.ts` ~6702 + `bindings.ts` ~8574–8606 together) passes `castMemberId`; **`state/resolve.ts` `sessionLinks` adds a link for card-less seats (`seated_member` owner)** so their stats and sheets exist (the largest item — read f-door's report on `sessionLinks`' on-mode shape first).
3. **★s4-seat-1 — build the lane's recommendation, flagged ★ in the report for the owner:** in the Add characters picker (`CharacterSelectModal`, used by StartSessionForm and EditSessionForm) a second group under the book's name listing its card-less members (name + face, read from `lorebooks:bindingList` filtered to members with no card), sent as `castMemberIds` (the server accepts it). Group heading copy: propose one (★) and build it. Follow STYLE-GUIDE's picker/list patterns (read the relevant sections) and memory `feedback_pickers_explain_why.md`.
4. **Q9 (modder rule):** the castFromLorebook sentence in `docs/plugins.md:52`, SDK `guides/frames.md:212`, and the `castFromLorebook` JSDoc in `sdk/src/descriptors.ts:1052`. **No `sdk:build`** — another session runs a dev server on :5199; report "sdk:build owed" (JSDoc only, no runtime change).
5. **Docs (now that it's live):** `docs/sessions.md`, `docs/group-sessions.md` (seating card-less cast), `docs/personas.md` (Take a seat mints a cast member). `docs/lorebook-cast.md` (★4 background member) belongs to lane s4-cp this wave — **write the paragraph in your report** for the lead to merge.
6. **End-to-end test:** a session with a card-less character seat: its turn fires as that seat (not the narrator), the prompt names it with its member's words, it sees its own private lore and not another member's, the reply doesn't stop on its own `Name:`, the line is stamped `cast_member_id` + `metadata.speaker = seated-member:<id>`, regenerate keeps the speaker, its sprite pick uses member art, a stat write on its `seated_member` owner lands, the seater (not only the owner) may act for its line. A named Take a seat creates one card-less member. Run it in an int test through the real handlers.

## Files owned

`src/lib/server/sessions/{fireTurn,seatName}.ts`, `src/lib/server/utils/runReply.ts`, `src/lib/server/pipelines/runtime/{host,runTurn,dispatch,dispatchSpeech,bindings}.ts`, `src/lib/server/pipelines/prompt/{promptFields,contentProcessors}.ts`, `src/lib/server/pipelines/ranking/ragQuery.ts`, `src/lib/server/connections/stops.ts`, `src/lib/server/messages/permissions.ts`, `src/lib/server/state/resolve.ts` (`sessionLinks` + what it needs), `src/lib/server/sockets/sessions.ts` (`promptTokenCount` only), `src/routes/sessions/[id]/+page.svelte` (the one prop), `src/lib/client/components/sessionPage/sessionPageProjections.ts` (`canControlMessageAs`), `CharacterSelectModal.svelte` + the two session forms' picker wiring (find them), `docs/{sessions,group-sessions,personas,plugins}.md`, SDK `guides/frames.md` + the one JSDoc in `sdk/src/descriptors.ts`, tests next to all of these.

**Lane s4-cp runs beside you** and owns `sockets/characters.ts`, `characters/versions.ts`, `utils/characterBindingSync.ts`, `cast/cardless.ts`, the sprite/portrait action files, the `Sockets.Characters` namespace in `shared/sockets/types.ts`, `characters:*` in `typedSocket.ts`, the member page/sheet components, the Sprites tab, the Backdrop picker, `docs/{characters,lorebook-cast,images}.md`. Don't touch them; you may edit the rest of `shared/sockets/types.ts`.

## Out of scope

Starters (st), fold (bk-fold), the Characters view (chr-view), `new-world` create mode's member map (Noticed in the seat report — leave). NOMENCLATURE: queue rows.

## Done means

The end-to-end int test above, plus targeted tests per Q item; the existing neighbouring test files green; tsc + check no new errors. Report `plans/REPORT-s4-seat-live-2026-11-08.md` with the ★ picker copy and the lorebook-cast paragraph.
