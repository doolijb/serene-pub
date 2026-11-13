# REPORT — lane s4-rul-b (2026-11-10): the cast member form in tabs, like the card editor

Saved by the lead from the supervisor's final message. Relayed status question: none.

## Summary
The cast member form has the card editor's tabs in the card's order: **Profile · Voice · Notes · Likeness · Speech** (no Stats tab for members). Fields both forms share are drawn by components extracted from `CharacterForm.svelte`. The card editor looks and behaves as before (its DOM tests pass unedited). Nothing on the member form dropped, copy unchanged, Save sends the same payload. 20 targeted test files, 168 tests pass. tsc / check: the same 3 errors before and after (s4-rul-a's `show-hidden-stats`, waiting on the SDK build). Workers: w1 extracted the shared components, w2 restructured the member form.

## Changed files
- New in `src/lib/client/components/characterForms/` (w1): `fieldClass.ts` (`FIELD_CLASS`), `formTabs.ts` (`FORM_TABS`, `FormTab`; stale comment fixed), `PromptBadge.svelte`, `RemoveRowButton.svelte`, `AddRowButton.svelte` (the card's three snippet bodies; snippet names and call sites stay), `ProseField.svelte` (labelled prose textarea with an optional `follow` snippet), `GreetingsList.svelte`, `CreatorNotesFields.svelte` (Notes tab body: text, Language, Other languages).
- `CharacterForm.svelte` (w1): call sites only — Description, Personality, Scenario, Post-history, the show-all greetings list, the Notes body; imports; moved constants and an unused `type Component` import removed. Ids, classes, hints, placeholders, aria unchanged.
- Member form (w2): `src/lib/client/lorebooks/cast/CastMemberForm.svelte` restructured; new `UseFromCardSwitch.svelte` (six identical inline Switch blocks, same DOM); new `memberTabs.dom.test.ts` (7 tests); `memberPage.dom.test.ts` — only the `tabs()` selector (`[role="tablist"][aria-label$="'s page"] [role="tab"]`; the page now has two tablists).
- Docs: `docs/lorebook-cast.md` — the member page's Member bullet by tab, two sentences in "What the member tells in their own words". STYLE-GUIDE unchanged.

## Tests
- Final grouped run (6G cap): 20 files, 168 pass. Card side: `cardVersions.dom`, `castEditNote.dom`, `likenessDescribe.dom`, `VoiceTab.dom`, `StrokeField.dom`, `charactersSidebar.dom`. Member side: `memberTabs.dom` (new), `castMemberForm.dom`, `castMemberFormLater.dom`, `memberOwned.dom`, `retoldBlock.dom`, `memberVoice.dom`, `memberDraft`, `memberPage.dom`, `memberPageCard.dom`, `memberPageVersions.dom`, `memberCopy.dom`, `memberGallery.dom`, `memberSprites.dom`, `lineConformance.screens.dom`.
- `memberTabs.dom`: carded member — five tabs, no Stats, each field in its card tab with **Use from card**; card-less — same tabs, plain fields, no retold rows; a language named twice blocks Save and marks Notes "(has an error)"; payloads — text-only notes edit equals `memberPatch(withNotesText(…))`, language edit sends lower-cased codes, an empty added row isn't a change, a post-history edit equals `memberPatch` after visiting every tab.
- Prettier: new files and `CharacterForm.svelte` pass; `CastMemberForm.svelte` fails only on two pre-existing `cardOwned` lines; `docs/lorebook-cast.md` already failed at HEAD.
- No vitest temp dirs from this lane (three older ones left).

## Scope review
No objection on scope; two low: (1) the member greeting checkbox lost its phone touch target → ★b-8; (2) "Also known as" heading and Summary hint spacing restyled → in ★b-7. `formTabs.ts` comment fixed.

## Open ★ (built as recommended unless "not built")
- **★b-1** Above the tabs: member header (face, name, tag, badges, Delete), then Name / Nickname with **Use from card**, **Change face**, *Shown in this book only…* — mirrors the card's name/nickname/avatar above its tabs. Keep.
- **★b-2** Profile: **About** (Summary, Description retold carded only, Also known as — the card's About order), **Status in world**, the **Character card** block (Change, Unlink, Update offer, dated line) where the card has Card metadata. Keep.
- **★b-3** Likeness: the likeness (own or **Use from card**), then **Sprite set**. Page-level Sprites and Gallery tabs stay. Keep.
- **★b-4** No Stats tab for members (no stats fields on the member form). Keep.
- **★b-5** The "From the card" intro (copy unchanged) at the top of both Profile and Voice for a carded member (the two tabs with **Retold here** rows). Keep.
- **★b-6** A member's own creator notes gain the card's **Language** / **Other languages** editor (draft and server already carried `lang`, `variants`). Naming a language twice shows *Language "x" is named twice.*, marks Notes and stops Save. With **Use from card** on, only the card's text shows. Behaviour addition, from "reuse the same component/forms". Keep; alternative `languages={false}`.
- **★b-7** Restyle to the card's look (shared components' labels, prompt-visibility eye, `input rounded-base`, 32px remove icon; Summary and alias take the card's classes; "Also known as" heading muted; Summary hint `mt-1`; section titles `h5` in `.panel-inset`). Keep.
- **★b-8 (not built)** Add `pointer-coarse:min-h-11` to `GreetingsList` to restore the member's 44px touch target on "Group sessions only" — also changes the card on touch screens.
- **★b-9 (not built)** Two switch styles on Voice: retold rows **From the card / Retold here** + **Take from card**; post-history/notes/likeness **Use from card**. Recommend leave for now.
- **★b-10 (not built)** The Speech tab's section is still titled "Voice". Recommend dropping that heading (the card's Speech tab has none).
- Also: Save and later-versions stay under the tabs; **When they are here** and **Amendments** stay below the form (`CastWorkspace.svelte`).

## Decisions
- Field-level sharing (`ProseField`, `GreetingsList`, `CreatorNotesFields`), not whole tab bodies (card tab bodies mix card-only parts).
- Not shared: example dialogues (card list vs member text), Summary and aliases (different meaning on the member).
- The member shows every field always (no Show all fields).
- Strip `panelIdPrefix="cast-member-form"`, `ariaLabel="Character fields"`; tab kept when the member changes.
- Creator notes: local `noteText` / `noteLang` / `noteRows` seeded on `seed()` and on switch flip; text-only edits via `withNotesText`; language edits rebuild `{text, lang?, variants}` (trim, lower-case); id `castOwnedLang-creatorNotes-<id>`.
- Likeness `active` constant, as before.

## Noticed, not done
- Card-less members have no Description, Personality, Scenario, Greetings or Example dialogues on the form (retold rows exist only with a card) — a gap under the cascade principle; outside the brief.
- `LikenessTab` loads while hidden (member passes `active` constantly).
- STYLE-GUIDE §6.5 lists the cast member page as four tabs; it now has six plus the form's strip.
- Member Summary / Also known as keep hint lines and an always-on counter; STYLE-GUIDE §6.4 puts hints in `title` and counters past 80%.
- Greetings section title and row label both read "Greetings".
- `memberCopy`, `memberGallery`, `memberSprites`, `memberPageCard`, `memberPageVersions` use a broad `[role="tab"]` selector that would collide with the form strip.
- `docs:build` needed for generated docs.

## NOMENCLATURE
None needed; optional §25 line for the shared field components and `UseFromCardSwitch`.

## Paths
Briefs `plans/briefs/BRIEF-s4-rul-b-w1.md`, `-w2.md`; member diff and tsc/check logs in the session scratchpad (`s4-rul-b-*`).
