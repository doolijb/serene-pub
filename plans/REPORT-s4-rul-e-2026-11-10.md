# REPORT — lane s4-rul-e (2026-11-10): card-less fields on the member form, one switch style, two fixes

Saved by the lead from the supervisor's final message. Relayed status question: none.

## Summary
All four goals built, tests pass.
- **Card-less fields:** a member with no card has Description (Profile), and Personality, Scenario, Greetings and Example dialogues (Voice), as plain editable fields via the shared `ProseField` / `GreetingsList`.
- **b-9:** the retold rows use the same **Use from card** switch as post-history instructions, creator notes and likeness.
- **b-8:** "Group sessions only" has a 44px touch target (card editor too on touch screens).
- **b-10:** the Speech tab's leftover "Voice" heading is gone.
- **No server change needed** — the int test shows the server already saves all seven keys for a card-less member and reads them back.
- tsc and check match the baseline (0 / 0 errors, 8 warnings).
Workers: w1 (`memberDraft` tests, int test), w2 (form, DOM tests); supervisor: `memberDraft.ts`, `GreetingsList` class, docs.

## Changed files
- `src/lib/client/lorebooks/cast/memberDraft.ts`: private `wordsPatch` (description, personality, scenario, firstMessage, alternateGreetings, groupOnlyGreetings, exampleDialogues); `retoldPatch` spreads it (same keys and order for a carded member, tested); `memberPatch(draft, false)` sends `name` + `wordsPatch`, still no `retold` and no `faceMediaId`.
- `src/lib/client/components/characterForms/GreetingsList.svelte`: `pointer-coarse:min-h-11` on the "Group sessions only" label.
- `src/lib/client/lorebooks/cast/CastMemberForm.svelte`: `ownWords = !member.linked` card-less branch inside the existing `textRow` / `greetingsRow` snippets (`data-own-field`, ids `castOwn-{field}-{id}`, same hints/placeholders, `rows={8}`, `font-mono` on Example dialogues); Voice tab shows when `retold.length > 0 || ownWords`; `retoldControls` uses `UseFromCardSwitch` (`checked={!r.retold}`, `onCheckedChange={(on) => toggleRetold(r.field, !on)}`); **Take from card** only while the field is own; kept line and intro copy changed; `Switch` import and `switchClass` removed; Speech tab's `<p>Voice</p>` removed; a linked member whose card hasn't loaded still draws nothing.
- `docs/lorebook-cast.md`: Profile / Voice bullets drop "(a member with a card)"; "What the member tells in their own words" rewritten for **Use from card** + a card-less paragraph; dated-save sentence names exactly what is dated (description, personality, scenario, greetings, example dialogues, face); "Parts left **From the card**" → "Parts left on **Use from card**".
- Tests: new `cast/cardlessWords.dom.test.ts` (6), new `server/sockets/lorebooks.cardlessWords.int.test.ts` (3); edited `memberDraft.test.ts`, `retoldBlock.dom.test.ts`, `memberTabs.dom.test.ts`, `castMemberFormLater.dom.test.ts`, `memberPageVersions.dom.test.ts`.
- Worker briefs `plans/briefs/BRIEF-s4-rul-e-w1.md`, `-w2.md`.

## b-9: what each field shows (★e-1)
Retold rows (Description, Personality, Scenario, Greetings, Example dialogues), carded member:
- **Use from card on:** the card's text, dimmed, read-only (or "The card has none."); greetings dimmed; no Take from card; when the member has words set aside: *Their own description is kept, set aside. Switch off Use from card to read it again.*
- **Use from card off:** the member's own text, editable; **Take from card** beside the switch (disabled when the card has nothing); switching off on an empty field copies the card's text first, as before.
- **Switching back on** keeps the member's text set aside; an untouched copy gives back the saved value.
- Same payload in every state (`retoldBlock.dom` checks against `memberPatch(setRetold/takeFromCard(...), true)`).
Post-history, creator notes, likeness: same switch, no Take from card, no kept line. Name, Nickname, Voice (timbre), face: unchanged.
Intro (★b-5), still titled "From the card": *The card is a starter. Switch **Use from card** off on a field to tell it in this member's own words for this story; the card itself is not changed. Switching it back on keeps what you wrote here, set aside, until you switch it off again.*
Card-less: plain fields, no switch, no Take from card, no kept line, no intro.

## Tests
- Grouped run (6G cap): 34 files, 309 passed, exit 0 — card side `cardVersions.dom`, `castEditNote.dom`, `likenessDescribe.dom`, `StrokeField.dom`, `VoiceTab.dom`, `charactersSidebar.dom`; member side everything in `src/lib/client/lorebooks/cast/`; plus `lineConformance.screens.dom`, `lorebooks.cardlessWords.int`, `lorebooks.versionOnlyKeys.int`.
- New tests: card-less member shows five plain fields; editing each and saving sends seven keys; a card-deleted row shows the card's words, not dirty until edited; int test edits and reads back through `membersAsRead`, makes a member card-less (cause `card-delete`), checks the card's words, edits one field and checks the rest kept; carded retold description unchanged; b-8 class on the label; b-10 no "Voice" heading (card-less and carded).
- `memberDraft.test` "normalises the row the way the form writes it" expected object gained the seven keys (intended).
- No vitest temp dirs left. tsc 0 → 0; check 0 / 8 → 0 / 8.
- Prettier: new and edited files pass except pre-existing lines in `CastMemberForm.svelte` (~633, ~636) and `memberDraft.test.ts` (~188, ~348, ~398); `docs/lorebook-cast.md` already failed.

## Scope review
No objection to code, tests or docs; one low: the NOMENCLATURE "retold" row describes the old toggle — queued. "read the version of the card the member is on" was pre-existing wording.

## Open ★
- **★e-1 (b-9, built as recommended):** **Use from card** on all eight card-followable fields; **Take from card** only on the five retold rows, only while off. Trade-off: the three version-only fields still have no Take from card and no kept line (new behaviour, not added).
- **★e-2 (copy):** the kept line, intro and docs wording above ("hidden" → "set aside").
- **★e-3 (info):** the shared `VoiceTab.svelte` still draws its own `<h3>Voice</h3>` on the Speech tab whenever the voice fields show (always for card-less; for carded with Use from card off). The card's Speech tab shows the same `<h3>`, so they match; removing it would change the card.

## Decisions
Card-less patch sends seven words keys, no `retold` / `faceMediaId`; card-less branch inside existing snippets; internal hooks `data-own-field` / `castOwn-…` (`data-retold-field` stays carded-only); retold switch keeps its form `name`; int test in `server/sockets/` beside `lorebooks.versionOnlyKeys.int.test.ts`.

## NOMENCLATURE queued
- §8 "retold" row (~364): UI is a **Use from card** switch per field (on = the card's reads through; off = the member's own), the **From the card** note at the top of Profile and Voice, **Take from card** while off; card-less members have the fields as their own, no switch.
- §25: retold rows take **Use from card** (b-9); retired UI labels *Retold here* / *From the card* switch (UI only, no §23); card-less members' own five fields (hooks `data-own-field`, `castOwn-…`); b-8 44px target on `GreetingsList`.

## Noticed, not done
- "Save as of" drops the version-only text (`amendments.ts` `CAST_AMENDABLE` ~650–671, `cleanCastFields` ~726): switch dated, text not. Docs don't promise it.
- **The base save path may drop group-only greetings:** `writeMemberEdit`'s base path (`sockets/lorebooks.ts` ~1642–1647) picks `FROZEN_MEMBER_KEYS + BOTH_WAYS + VERSION_ONLY`, and `FROZEN_MEMBER_KEYS` (~1272) lacks `groupOnlyGreetings`; `writeShownEdit` (~1766–1770) adds it explicitly. A save that falls to the base path (no version shown yet) may not write group-only greetings, carded or card-less. Not verified.
- Example dialogues come back differently: the update response's `lorebookBinding.exampleDialogues` is stored text with a `<START>` prefix; `membersAsRead` gives an array.
- A linked member whose card hasn't loaded shows none of the five fields (`member.linked && card` guard, unchanged).
- Old wording: `retoldBlock.dom.test.ts` header and one test name say "background member"; `retoldRows.ts` header calls the block "**From the card**".
- Weak assertion in `cardlessWords.dom.test.ts` (`expect(patch).toEqual({ ...memberPatch(d, false), ...patch })`); the value assertions before it carry the test.
