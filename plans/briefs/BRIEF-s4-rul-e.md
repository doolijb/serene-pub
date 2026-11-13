# BRIEF — lane `s4-rul-e` (2026-11-10) — cast member form: card-less fields, one switch style, two fixes

Supervisor: read `.claude/guides/multi-agent.md`, then `plans/briefs/BRIEF-s4-common.md` (its :5199 note is stale: the **owner's** `vite dev` runs on :5173, so **no `sdk:build`**; date your report 2026-11-10), then this file, then the last three bullets of `plans/PLAN-sdk-creation-seams-2026-10-30.md`. Then `plans/REPORT-s4-rul-b-2026-11-10.md` in full — it built the tabbed member form and the shared field components you extend — and `plans/REPORT-s4-follow-a-2026-11-09.md` goal 8 (cp-10, own-or-follow and the version-only keys). Read STYLE-GUIDE §6.4 (edit forms), §6.5 (tabs) and its touch-target rule before any UI change; `docs/lorebook-cast.md` "A member's page" and "What the member tells in their own words"; memory `feedback_pickers_explain_why.md`.

## Owner's words (quote them; never reinterpret)

- Cascade principle (2026-11-09): *"Cast by default cascades… a card is a seed, not the sole carrier… not having a card doesn't make them 2nd class."*
- 2026-11-10, asked about the gap "a cast member with no card has no Description, Personality, Scenario, Greetings or Example dialogues on its form": **"Build it now"**.
- 2026-11-10, form fixes: **b-8, b-10 and b-9** all go. b-9 is against lane b's "leave for now", so it's the owner's choice, not yours to soften.
- a-4 (2026-11-10): *"tabs like card, should probably adapt and reuse the same component/forms"*.

## Goals

1. **Card-less members get their own text fields.** A member with no card shows **Description**, **Personality**, **Scenario**, **Greetings** (opener, alternates, group-only) and **Example dialogues** as plain editable fields in the same tabs as a carded member's (Profile / Voice, the card's places), drawn by the shared components (`ProseField`, `GreetingsList`, …), with no switch. Storage already owns them: `memberProfileOf` (`server/characters/versions.ts` ~180–260) says a card-less member's "every field is own". Members made card-less by a card delete already hold the card's words; they must now be editable.
   - Challenger (accepted): the read and the server save already carry all five for a card-less member (`versions.ts` ~228–262, `memberAsRead.ts` ~269–274, `lorebooks/retold.ts` ~251–261; `writeMemberEdit`, `sockets/lorebooks.ts` ~1640–1645, picks the frozen keys with or without a card). **The only gap is the client:** `memberPatch` (`memberDraft.ts` ~250–256) sends just `name` for an unlinked member, and the form draws rows only when `member.linked && card` (`CastMemberForm.svelte` ~593). No server edit should be needed; if one is, stop and ask.
   - Tests: a card-less member shows the five fields, edits each, saves, reads back through `membersAsRead`; a member made card-less by a delete shows the card's words in them; a carded member is unchanged.
2. **b-9: one switch style.** The owner was asked about *the Voice tab* showing two switch styles. Scope (challenger, accepted): **the retold rows (Description, Personality, Scenario, greetings, example dialogues) plus the three version-only fields (post-history instructions, creator notes, likeness)** use one control. **Name, Nickname, Voice (timbre) and face keep their current behaviour**: they store `null` for "use the card" and have nowhere to keep an own value aside (`memberDraft.ts` ~47–51), so giving them a set-aside value would change stored data: stop and ask instead. Mind the polarity: the retold switch is checked when the field is the member's own (~1235); `UseFromCardSwitch` is checked when it follows the card. Today retold rows use **From the card / Retold here** plus **Take from card**, while post-history, creator notes and likeness use **Use from card** (`UseFromCardSwitch`). Pick the one style (your ★ recommendation; lane b's notes suggest **Use from card** for all, with **Take from card** as an action beside a field that has its own text), keep every behaviour the retold toggle has today (switching back to the card keeps what was written, set aside; **Take from card** copies the card's current text), and say exactly what each field shows in each state. The "From the card" intro (★b-5) adapts to the one style. Same payload as today for every state (compare with `memberDraft` tests). Docs: `docs/lorebook-cast.md` ~61 and the member page bullets. **Don't promise dated saves for the three version-only fields:** "Save as of" (`amendments.ts` `CAST_AMENDABLE` ~650–671, `cleanCastFields` ~726) writes their switch but drops their text. Note it under Noticed, not done; don't fix it.
3. **b-8: touch target.** Add `pointer-coarse:min-h-11` (44px) to the "Group sessions only" control in the shared `GreetingsList`. It changes the card editor on touch screens too; the owner chose that. Nothing else on the card changes.
4. **b-10: Speech heading.** Drop the leftover "Voice" section heading inside the member form's Speech tab (the card's Speech tab has none).

## Files owned

- `src/lib/client/lorebooks/cast/CastMemberForm.svelte`, `UseFromCardSwitch.svelte`, `memberDraft.ts`, `retoldRows.ts` and `retoldRows.test.ts` (`setRetold`, `takeFromCard`, the `kept` flag, greeting helpers ~181–300), and new components under `src/lib/client/lorebooks/cast/`
- the shared field components in `src/lib/client/components/characterForms/` (`ProseField.svelte`, `GreetingsList.svelte`, `CreatorNotesFields.svelte`, …) — card behaviour unchanged except b-8
- `src/lib/client/components/characterForms/CharacterForm.svelte` only if a shared component's props change; no visible card change except b-8
- `docs/lorebook-cast.md`; `STYLE-GUIDE.md` only if a rule moves
- tests next to these

Not yours: `sessions/**`, `state/**`, `media/**`, startup passes (lane s4-rul-f runs beside you, server boot only; you share no files). serene-pub-43 owns image generation: stay clear of `dispatchImage.ts`, `imageGen/**`, `matting.ts`, `KoboldCppManagedAdapter.ts`, `sprites/fillAction.ts`, `characters/portrait.ts`, `registrations/unserved.ts`, `runProgress.svelte.ts`. No SDK changes.

## Stop and ask when

The common brief's Decisions apply; a stored-data change or migration; a field would lose a behaviour it has today; the card editor would change beyond b-8.

## Done means

- Tests for each goal; existing `CharacterForm` / card DOM tests (`cardVersions.dom`, `castEditNote.dom`, `likenessDescribe.dom`, `VoiceTab.dom`, `StrokeField.dom`), every member DOM test lane b listed (`memberTabs.dom`, `castMemberForm.dom`, `castMemberFormLater.dom`, `memberOwned.dom`, `retoldBlock.dom`, `memberVoice.dom`, `memberDraft`, `memberPage*.dom`, `memberCopy.dom`, `memberGallery.dom`, `memberSprites.dom`, `lineConformance.screens.dom`), and any server test you touch, green (capped scope per the common brief).
- `npx tsc --noEmit -p .` and `npm run check`: no new errors beyond the current baseline (the SDK is built now: tsc 0 errors, check 0 errors / 8 warnings).
- **Prettier: only the lines you changed.** Never a whole-file `--write` (two lanes broke this rule this week).
- Queue any NOMENCLATURE rows for the lead.
- Run a `scope-reviewer` on your diff before reporting; answer each finding once.
- Report: return it in your final message; the lead saves it as `plans/REPORT-s4-rul-e-2026-11-10.md`.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
