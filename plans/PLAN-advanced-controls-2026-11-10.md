# PLAN — Advanced controls: one per-user switch, off by default — 2026-11-10

Status: **BUILDING** (go 2026-11-10). Challenged once (plan-challenger, 2026-11-10). Objections 1–5 accepted; the side note was answered (§ Challenge answers). The owner ruled ★A–★D as recommended ("Works for me", 2026-11-10). No build go yet.

## Owner rulings (2026-11-10, this session)

- **Ask:** "add a 'simple' mode toggle to profiles that's on by default", then inverted: "the control should be inverse, a toggle on for 'advanced' ui/controls". Example: "all the advanced controls when creating/editing sessions."
- **Accepted:** the brainstorm list: "Works for me". This plan narrows it where the code or older rulings disagree; each narrowing is named.
- **Per user:** "Yes on per user." No pub-wide default for new members.
- **Admin unchanged:** "No on the sampling models loadouts and connections. Those stay as they are basic requirements for a functional pub." and "admin panel stays unchanged, we are simply simplifying what users interact the most with the app, i.e. sessions, lorebooks, etc while keeping everything functional."

Binding older rulings:
- **Model plumbing:** members never see it (standing).
- **Presets:** "It's up to the admin to provide a working environment with session presets that their users can select" (2026-10-12).
- **Genres:** expect, never lock (standing).
- **Lorebooks:** there is always one (memory).
- **Stored data:** 0.6 is in users' hands, so a change ships with a migration or data upgrade plus a second-boot test (standing).
- **Principles:** P1 (every automatic action shows how to switch it off) and P3/P5 (2026-11-04).
- **Advanced fold:** ruled 2026-10-19 (§5-2, NOMENCLATURE.md:3021); charter ★E-2 2026-11-04 (NOMENCLATURE.md:3239).
- **Card stats:** the removal plan of 2026-10-29 is still PROPOSED (★C1–C5 open).

## The rule this plan applies

**With advanced controls off, the controls that tune *how* a session, a book entry or a session's look works are hidden, along with two power views of a lorebook.**

It never hides:
- content a person made or reads;
- anything a genre needs to play;
- the off switch of an automatic action (P1);
- the session preset switch;
- accessibility;
- repair prompts;
- anything that explains a refusal.

Wherever a form hides something, one line says so and turns the switch on in place (★C). Advanced controls is a **preference, never a permission**. It never shows a member anything their role hides, and the admin views (Admin, Sampling, Models, Loadouts, Connections, Pipelines, Rulesets) are untouched.

Hidden never means changed. A hidden control keeps its stored value, and the session keeps using it.

## What gets built

### 1. The switch (data, wire, settings card)

1. **Column** `user_settings.show_advanced_controls`: boolean, NOT NULL, default **false**, beside `show_all_character_fields` (`db/schema.ts:155`). Run `npm run db:generate`, which writes `0149_*`; the highest migration today is 0148 (`drizzle/meta/_journal.json:1045`).
2. **Wire:**
   - `showAdvancedControls: boolean` on `userSettings:get` (`sockets/userSettings.ts:194-210`, `shared/sockets/types.ts:14281-14290`).
   - Default rows get `false` (`userSettings.ts:171-172`).
   - New event **`userSettings:updateShowAdvancedControls`**, `{ enabled }` → `{ success, enabled }`, copied from `userSettingsUpdateShowAllCharacterFields` (`userSettings.ts:472-500`) and registered beside it.
3. **Client read:** one pure helper, `showsAdvancedControls(settings)` in a new `src/lib/client/advancedControls.ts` (`settings?.showAdvancedControls ?? false`), plus `AdvancedHiddenLine.svelte` (§6). Every gate below uses these two.
4. **Settings card:** **Show advanced controls** is the first card in `UserSettingsTab.svelte` (before Language, `:604`). It is a switch card shaped like *Show all character fields* (`:735-756`). Help sentence (★C copy): *"More choices on sessions, lorebooks and characters. Off keeps the everyday ones."* Nothing else on the User tab hides: *Lorebook writes from sessions*, the library write mode and *Background routines* are P1 off switches (challenge 1).

### 2. Session creation (`sessionForms/StartSessionForm.svelte`)

Hidden when off. The session takes the default named for each:

5. The **Rules card** (`start-rules-heading`, 3073-3262), with its inline *How strict* (3232-~3258). Defaults: rules = `rulesDefault`, rigour = the preset's or genre's (`createSession.svelte.ts` ~755-764).
6. Inside the **book pick** card (2684-2846): the rules rows (snippet 2451-2558), *Start blank on these rules* (2785-2803), the rules-in-words list (2832-2845) and the book-pick *How strict* (2848-2897). Defaults as in 5.

Kept, narrowing the brainstorm list:
- **The lorebook choice and starter kits** (2741-2830, 2937-3069). There is always a lorebook, and choosing it is the main decision at start.
- **The creation mode picker** (1812-1830). A genre may propose a mode and never locks one (`creationModes.ts:1-4`), so hiding the picker would hide the genre's proposal and the only way to choose *Next chapter*.
- **Start asks** (2016-2039). Nothing marks an ask optional (`startBlocker` 850-871 ignores asks), so "optional asks" would need a new SDK flag nobody asked for.

### 3. Session editing (`sessionForms/EditSessionForm.svelte`, Settings tab 2700-3331)

Hidden when off:

7. **Actions** (2925-3042).
8. **How replies are made**, `PipelineCards` (3047-3053).
9. **On revision** (3141-3167).
10. **Rules options**, `RulesOptions` (3172-3178).
11. **Pipelines**, `PipelineConfigOptions` (3192-3227), including its per-group fold.
12. **Retake ask**, `RetakeAskSetting` (3317-3323).
13. **Annex**, `SessionAnnexPanel` (3324-3329).
14. **Where this session's story stands** (`SessionLorebookReading`, 2873/2884) shows **read-only** when off, through its existing `readOnly` branch (`SessionLorebookReading.svelte:216`).

Kept:
- **Settings tab:** the **session preset** switch (`SessionPresetControl`, 3090-3105, challenge 5), the session settings form with its Advanced fold untouched (★A), name, genre upgrade, the story, attributes, player label and tags.
- **Other tabs:** the whole Participants tab and the Privacy tab.
- **Runs tab:** already admin-only (`SessionViewPanel.svelte:100-103`).

### 4. The session view

15. **Branch from here** (SDK `sdk/src/actions.ts:1227`) is left out of the action venues when off. It is a core-side filter next to `withinAudience` (`sessionPage/actionList.svelte.ts:280,287`), with no SDK change.
16. **Layout editor entry points** are hidden when off:
    - the header **Layout** button (`Header.svelte:~384`);
    - the menu's **Customize layout** (`Header.svelte:167`);
    - the fullscreen-exit entry (`Layout.svelte:3511`).

    Everyone keeps the layout they have. The channel and channel-lane settings live only in the editor's inspector (`ArrangeInspector.svelte:121`), so they hide with it.
17. **Author's note:** the depth and interval numbers (`AuthorsNoteWidget.svelte:275-297`) and the *Sent as* fold (`:304-311`) are hidden when off; the note text stays.
    - **SDK change:** an **optional** field `advancedControls?: boolean` on `SessionDossier`, beside the required `debugPrompts` (`serene-pub-sdk/sdk/src/sessionDossier.ts:303`).
    - **Who writes and reads it:** core fills it in `sessionPageProjections.ts` (:805/:936). The widget reads `dossier.advancedControls !== false`, so a dossier without the field shows everything. Being optional keeps the conformance fixture (`conformance/src/components.ts:263`) and the sdk-tests unchanged (challenge 4).
    - **Build:** then `npm run sdk:build` (never under a running dev server) and `npm run sdk:test`.
    - The widget draws no hidden line (§6).

Dropped from the brainstorm list: *Make a copy* (a layout-preset card verb, `startFrom.ts:523`, not a message action) and density (no such setting exists).

### 5. Characters and lorebooks

18. **Show all character fields** is replaced by advanced controls (★B). `CharacterForm.svelte` reads `showsAdvancedControls` wherever it reads `showAllCharacterFields` today (1769, 1866, 1883/1905, 1932, 2015). The inline *Show all fields* switch (2068-2098) gives way to the hidden line (§6). The tabs are unchanged:
    - Notes holds the creator notes, which are content (challenge 3).
    - Stats waits on the card stats removal plan (challenge 3).
    - Card versions stay; the code says they are deliberately not behind show-all (~2144).
19. **Book settings** (`lorebooks/BookSettings.svelte`): **Rules** (`BookRulesCard`, :290) and **Calendar** (`StoryCalendarEditor`, :299) are hidden when off. Kept: *Writes from sessions* (`BookWritesCard`, :294, a P1 off switch, challenge 1), *The story's present* (:297), *What this book holds*, and *Reading into a session*.
20. **Lenses** (`lenses/registry.ts:39-130`): **Graph** and **Lives** are left out of `LensTrack` (Workspace :2724/:2756) and out of their Alt+Shift shortcuts when off. A route that names a hidden lens opens **List**. List, Cards, Tree, Map and Time stay.
21. **The entry tuning fold** (`sections/EntryAdvancedFields.svelte:78`, summary *"Regex, case, keyword chains, priority, conditions"*) is hidden when off, in every editor that mounts it. It is an ordinary gate, outside ★E-2 (challenge 2). With it off the entry still reads in exactly as its stored values say.

Kept:
- the lore rail's rules group (content: rules-list entries a genre may need);
- the Loose ends queue (the "finish this book" work list, `looseEnds.ts:1-13`);
- the moment bar;
- retrieval marks.

The ruleset editor is admin-only (`adminRoutes.ts:105-107`) and strokes are paused (`strokesFlag.ts`), so neither is touched.

### 6. The hidden line

22. **`AdvancedHiddenLine.svelte`** is one muted line at the foot of a form that hid something. The forms that get it:
    - the session form's Settings tab;
    - the start form's last card;
    - Book settings;
    - the character form, where the inline switch was;
    - the entry editors.

    Copy (★C): *"Some controls are hidden. **Show advanced controls**"*. The button sends `userSettings:updateShowAdvancedControls { enabled: true }`, and the form redraws when `userSettings:get` comes back. The line is static and does not count changed values (★C).
23. **No line** in the lens track, the message menu, the session header or the Author's note widget. A widget cannot send core user-settings events. The User tab switch and the docs cover these.

### 7. Docs and vocabulary

24. **Docs:**
    - `docs/themes-and-settings.md`: the User tab list (:47 *Show all character fields* goes under ★B).
    - `docs/characters.md`.
    - `docs/sessions.md`.
    - `docs/session-layout.md`.
    - `docs/lorebooks.md`.
    - `docs/genre-story.md`: the Author's note section.
25. **NOMENCLATURE:**
    - An **advanced controls** row with its charter:
      - purpose: keep everyday surfaces short;
      - why: P3/P4;
      - owns: the per-user switch and the hidden line;
      - not: a permission, the admin views, the **Advanced fold** (the deriver's under-declared fold, which shows in both modes), or `advanced: true` on a FieldDecl.
    - Rows for `show_advanced_controls`, `showAdvancedControls`, `userSettings:updateShowAdvancedControls`, `AdvancedHiddenLine` and `SessionDossier.advancedControls`.
    - Under ★B, *Show all character fields* moves to §23 Retired words.
    - §25 ledger entries.
26. **STYLE-GUIDE §6.21 (Notices):** the hidden-line pattern.

## Open decisions

- **★A: the Advanced folds stay as they are in both modes** (narrowed after challenge 2).
  - **What the rulings say:**
    - P5 (2026-11-04): an under-declared user-facing declaration "lands under Advanced".
    - §5-2 (2026-10-19, NOMENCLATURE.md:3021): "`advanced: true` on a field: folded under **Advanced** until opened; genre pins the fold, host owns it".
    - ★E-2 charter (2026-11-04, NOMENCLATURE.md:3239): "keep an under-declared setting out of the way without hiding it … the client never hides a field the server sent".
  - **Recommendation:** the switch leaves `SessionSettingsForm.svelte:149-169` and `SchemaForm.svelte:595-606` alone, so P5, §5-2 and ★E-2 all stand unchanged.
  - **R1:** the switch is named **advanced controls** and the fold stays **Advanced fold**. Both mean "the less everyday choices", one per form and one per person, and the switch never acts on the fold.
  - **Trade-off:** a session's genre settings can still show an *Advanced · N settings* fold while advanced controls are off.
  - **Alternative:** hide the fold too, amending P5 and ★E-2, which takes your ruling on both.
- **★B: replace *Show all character fields*.**
  - **Recommendation:** advanced controls replaces it. The migration's data upgrade (`dataUpgrades/0149_*.ts`, `afterMigration` like 0142, `dataUpgrades/index.ts:181`) copies `show_all_character_fields = true` into `show_advanced_controls = true`, so people who opted in keep the full form. It runs once, with a second-boot test. The old column stays unread; dropping it is RC1 squash work.
  - *Easy character creation* stays a setting of its own: it chooses the quick creator or the full form, not how much a form shows.
  - **Trade-off:** "every character field but simple sessions" is no longer possible.
- **★C: the hidden line.**
  - **Recommendation:** a static line with the copy in item 22 and the help sentence in item 4. It counts nothing.
  - **Trade-off:** the line cannot say *which* hidden control holds a non-default value.
- **★D: existing accounts at upgrade.**
  - **Recommendation:** everyone upgrades with advanced controls off (your default), except the people ★B carries over. Prerelease users will find session tuning hidden after updating; the hidden line gets it back.
  - **Alternative:** on for every account that exists at upgrade, off only for new ones. That is gentler for testers, but today's pubs never see the simple surface.

## Build rulings (2026-11-10, during the build)

- **★adv-C-1:** the owner asked which option is "less likely to drive future changes into a corner and be more intuitive to manage and use". The lead chose a third option. Item 17 reads the switch from the **base `viewer` section**: `ViewerV1.advancedControls?: boolean` (SDK `sdk/src/widgets.ts:541`), filled by core's `envelopeSections.svelte.ts`, with `authors-note` changed to `reads: ['viewer']`. Every widget, plugin widgets included, can read the viewer section without a grant, and it updates live. **This replaces `SessionDossier.advancedControls`**; there is no dossier field and no new scope.
- **★adv-B-2:** the owner chose "Owner-aware wording". `SessionLorebookReading` gets `lockedByAdvanced`, and an owner who sees it read-only only because the switch is off reads *"Turn on advanced controls to change them."*
- **★adv-B-1 (lead, applying this plan's rule):** with the switch off, the adopted-rules sentence and the preset hint stay as plain text, and the hidden line shows only when a real choice was hidden.
- **★adv-A-1 (lead, applying ★B):** the 0.5.3 attic restore also carries *Show all character fields* into advanced controls (`attic/etl/accounts.ts`).
- **★adv-D-1 (lead, following from item 20: a door into a hidden lens does nothing):** with advanced controls off, the Cast board's *See in graph* (`PoolMount` → `CastWorkspace` → `CastRelationships`, `onSeeInGraph` optional) and the two *Build graph* buttons (`HistorySceneList`, `SceneEditor`, through `PoolMount`'s `onNavigateToGraph`) are hidden. With the switch off, a lorebook has no way to build a graph; turning the switch on brings them back. ActivitySidebar's graph-build rows still open the book on List. Test: `cast/castRelationshipsSeeInGraph.dom.test.svelte.ts`.
- **Calendar draft (lead, scope review D):** with the switch off, `StoryCalendarEditor` stays mounted inside a `hidden` wrapper, so a flip in the middle of an edit keeps its draft and the unsaved prompt stays honest.
- **Layout editor (lead, Q2):** `FullscreenExit.onLayout` is optional, and `Layout.svelte` omits it when the switch is off.

## Challenge answers (plan-challenger, 2026-11-10)

1. **Hiding the write-mode and routine cards breaks P1.** *Accept.* Those cards and *Writes from sessions* stay in both modes (items 4, 19).
2. **★A amends P5 and misses §5-2; the entry fold is mis-filed.** *Accept.* ★A is rewritten, quoting all three rulings, and now recommends that the folds stay. The entry fold is an ordinary gate (item 21).
3. **Notes and Stats are content or undecided.** *Accept.* The tabs are unchanged; only the show-all fields move (item 18).
4. **The SDK field was under-scoped and unnamed.** *Accept.* The field is optional and named in its file, so the fixtures are untouched, and it is listed in item 25.
5. **The preset switch is a member's only way to move environments.** *Accept.* It is kept (§3).

Side note: hiding *Branch from here* contradicts keeping Branch at start. *Partly accepted:* the citation is fixed (§2). The two stay as they are because they are different paths. The start form's Branch picks up a whole session and has its own sentence. *Branch from here* is a per-message power verb from the accepted brainstorm list, and branching stays reachable with advanced controls off.

## Lanes

| Lane | Owns | Waits for |
|---|---|---|
| `adv-A` switch | `db/schema.ts` (the one column), generated `drizzle/0149_*` + meta, `db/dataUpgrades/0149_*.ts` (+int test, ★B) and its `index.ts` entry, `sockets/userSettings.ts`, the socket registration, `shared/sockets/types.ts` (userSettings only), new `client/advancedControls.ts` (+test), new `components/AdvancedHiddenLine.svelte` (+dom test), `settingsTabs/UserSettingsTab.svelte` | rulings |
| `adv-B` sessions | `sessionForms/StartSessionForm.svelte`, `EditSessionForm.svelte`, `SessionLorebookReading.svelte` (only if `readOnly` needs a new prop path), their dom tests | A |
| `adv-C` session view | `sessionPage/actionList.svelte.ts` (+test), `Header.svelte`, `Layout.svelte` (the one entry), `sessionPage/sessionPageProjections.ts` (the dossier field), SDK `sdk/src/sessionDossier.ts` (the one optional field), SDK `core-catalog/components/genres/story/authors-note/AuthorsNoteWidget.svelte` | A |
| `adv-D` characters + lorebooks | `characterForms/CharacterForm.svelte`, `lorebooks/BookSettings.svelte`, `lorebooks/lenses/registry.ts` or `LensTrack.svelte`, `LorebooksWorkspace.svelte` (the lens fallback only), `lorebooks/sections/EntryAdvancedFields.svelte`, their tests | A |
| `adv-E` docs | the docs in item 24, `NOMENCLATURE.md`, `STYLE-GUIDE.md` | B, C, D reports |

## Out of scope

- Admin and every admin view; Sampling, Models, Loadouts and Connections.
- Document View (it has its own session pages); the Participants tab; the composer.
- The Advanced fold (★A); the character form's tabs.
- A pub-wide default; per-surface switches; counting changed values.
- Dropping `show_all_character_fields`; any SDK name removal.

## Done means

**Targeted tests per lane, including:**
- the switch's default for a new user is off;
- the data upgrade's second boot changes nothing;
- each gate's render with the switch off and on;
- a route to a hidden lens falls back to List;
- *Branch from here* is gone from the venues when off and back when on;
- a dossier without `advancedControls` shows the Author's note numbers.

**Then the lead's one grouped run:** `npx tsc --noEmit -p .`, `npm run check`, `npm test`, `npm run sdk:test`, `npm run build`.

**Last:** a browser walk on an isolated dev instance, as a member and as an admin, with the switch off and on.
