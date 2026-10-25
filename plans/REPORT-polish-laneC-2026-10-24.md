# REPORT — polish lane C (L5 settings copy + character edit, L11 Start a session), 2026-10-24

Built; svelte-check 0 errors; every touched test passes. No browser, no commit.

## Files
- NEW `settingsTabs/SettingCard.svelte`: one card per setting — title 15/500 (is the control's label), one 13px muted help sentence (string or snippet for a link), the control. Layouts `field` (1fr 280px grid from `@min-[480px]/view`, stacked below), `switch` (beside at every width), `stack`; `below` slot for a full-width line that says something new; words capped at 760px.
- `settingsTabs/UserSettingsTab.svelte`: every card a SettingCard; column capped 760px; Language/Time zone lose repeated labels (`labelHidden`); translation paragraph → docs link text ending the help; "Now:" stays; two switch cards instead of one `divide-y` card; Switch to Document View + Import from SillyTavern tonal (§1.10), Update filled.
- `RoutineCapsCard.svelte` (SettingCard, one sentence per scope; `cardClass` gone), `PluginUserSettingsCard.svelte`, `TotpSettings.svelte` (sizes, `panel-card`).
- `CustomThemeManager.svelte` (Themes): Reading and motion → two cards (Story text size, Animate views; sr-only labels; "in this browser"); Background is a card (no `border-t`); headings 15px.
- `media/MediaManagerTab.svelte`: Storage cleanup one sentence per part; notes → `title`.
- `admin/sections/general/Page.svelte` + `components/admin/pub/{Language,AutoTranslate,Accounts,Messaging,CharaVault,Scripts,LoreWriteMode}Card`: SettingCards; AutoTranslate's select/URL in `below` while on; Accounts status = help line, "permanent" below; Messaging's "On — …" line gone.
- `admin/pub/SettingSwitch.svelte`, `inputs/LanguagePicker.svelte`, `inputs/TimeZonePicker.svelte`: `labelHidden`.
- `sidebars/SamplingValuesForm.svelte`: slider hint → label `title` + sr-only `aria-describedby`; group count at the header's right edge (11px). `SamplingSidebar.svelte`: Parameters total to the right edge before Choose parameters.
- `characterForms/CharacterForm.svelte`: cast banner → one muted line under the name ("In 1 lorebook: Atlas of Everything", links, "(retells …)"; details in `title`); Summary/Aliases/Post-history hints → `title`; Nickname hint → placeholder; Summary counter from 160/200; Show all fields sentence → `title` + sr-only. `castBannerWords.ts` (+test): `lead`, `CAST_LINE_NOTE`.
- `sessionForms/StartSessionForm.svelte` (L11): Name, Genre, Preset; genre = radio list (radio, 15px name, one 13px line; chosen row `sidebar-row-active`, only it unfolds full line + meta line + More/Less); star 14px; Preset row (label, value, Change) + model-warning line; Start in header; lane B's `preset-pressed` kept. `startSessionAsks.dom.test.svelte.ts`: 2 updated (+3 new).
- `shell/adminSettings.test.ts`: accepts `titleId="x"` landing.
- STYLE-GUIDE §6.4 ("Setting cards", "Edit forms", "A pick-one list"), §10 (4 bullets); NOMENCLATURE §25 (**setting card**, **cast line**); docs/themes-and-settings.md, sessions.md, characters.md, genres.md, getting-started.md.

## Skipped
`text-[15px]/[13px]/[11px]` used pending L13 utilities; User-tab switch toasts left to notify (L4); Settings › Data/Import out of scope.

## Needs the owner's word
1. Start form gating: the genre list never collapses; an answered genre settles the step; a chosen preset stays collapsed until Change — a genre with several presets no longer opens its preset cards by itself.
2. Switch cards stay beside the words at every width.
3. Scripts card titled "Run scripts".
4. Messaging status line removed.
5. Two sentences now only in `title` (mouse-only): CharaVault App Password how-to (docs keep the steps), avatar "Your personas keep their own."
6. Switch to Document View and Import from SillyTavern went gold → tonal.

## Tests (verbatim)
startSessionAsks 8 · startSessionCast 14 · startSessionRules 16 · castBannerWords 6 · displayNameField 4 · samplingValuesChoose 3 · samplingFirstOpen 1 · settingsImportSection 3 · adminSettings 20 (2 failed before the titleId fix) — each "Test Files 1 passed (1)".
svelte-check (NODE_OPTIONS=--max-old-space-size=6144, 7G scope): COMPLETED 10328 FILES 0 ERRORS 7 WARNINGS 7 FILES_WITH_PROBLEMS (none in touched files).

## Visual walk
Settings › User at Dock/Half/Focus (cards, 760px, Language link, Now line, switch cards, tonal buttons) · Themes (two cards, Background card, light) · Media Storage cleanup · Admin › General @820 (Accounts on/off, Messaging, Auto-translate on + LibreTranslate URL, CharaVault, Jump landings) · Sampling (group count, hover hint, Choose parameters, Admin › Sampling) · Character edit (cast line + link + title; counter past 160; Nickname placeholder) · Start a session in Dock @900 tall (Name, five genres, Preset row visible; chosen row bar/dot/meta/More; Change opens presets; Guide/Chat cases; light).
