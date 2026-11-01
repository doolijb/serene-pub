# PLAN — Remove card stats: sheets, values, dowry — 2026-10-29

**Status: PROPOSED 2026-10-29. Not GO.** Part A is what the owner asked for. Part B (strokes
remnants) is proposed alongside it and needs its own yes (★C5).

## 0. Owner's words (2026-10-29)

> add to the plan instead to dump chara card sheets and stats all together for now.

How we got here, same day:

1. Asked whether card stat sheets have a purpose. Finding: since RF fix 8 (2026-10-23) a card's
   **sheets** do nothing a session can see. No sheet adds to a session's vocabulary
   (`vocabularyFor`, `resolve.ts:1345`, reads host state plus the rules' attributes only). No
   sheet ships (the catalogue declares none; `core:sheet/adventure@1` is a retired alias). A
   sheet's per-slot default and its order are no longer read. The SDK says so itself: "the
   ruleset's attributes are its sheet" (`rulesetSections.ts:262`). A card's **values** still
   resolve session → lorebook → card, but only for slots the session's rules file.
2. The owner floated a values-only card with seed / constant / off modes and conversion across
   rulesets (parked in §7).
3. I advised against building that now, offering two options: keep values grouped by ruleset, or
   remove card stats. The owner chose removal.

## 1. What goes, what stays

**Goes:**
- the character form's **Stats** tab and the view panel's stats section;
- the `cardState:*` socket family;
- the `card` owner kind in state: `OWNER_KINDS`, the card layer in `resolutionChain`, and the card
  branches in write/earshot/state sockets;
- the **dowry** (card stats carried in a character export, `extensions.serenepub.dowry`) and the
  SDK's `dowry.ts`;
- every stored row with `owner_kind = 'card'` (★C1).

**Stays:**
- **User-authored slot declarations.** Rulesets can borrow them: `pubRulesets.ts:456`
  `slotChoices` offers every stored slot to the ruleset editor's `slot:` / `borrowed` field. R3
  holds: a stored declaration is retired, never deleted.
- **Stored sheet declarations.** They stay stored and inert, because nothing references a user
  sheet once cards stop.
- **Old exported files.** They still import: `cardIO.ts:408` already strips an incoming
  `serenepub`, so a file's dowry is simply ignored.

**What users notice:**
- A character no longer brings starting values into sessions. A session reads the world's value
  (the lorebook cast member), else the rules' start, else the declaration's default.
- Values already set on cards are deleted. Pre-release databases are disposable (ruled
  2026-10-19).

## 2. Inventory (read-only sweep 2026-10-29; line numbers as of that date)

Removing `"card"` from `OWNER_KINDS` (`state/owners.ts:32`) makes `tsc` flag every remaining
server site. Use that as the checklist's backstop, not a substitute for it.

**Client UI**
- Delete `characterForms/{CardStatsTab.svelte, cardStats.ts, cardStatsApi.ts, cardStats.test.ts}`.
  Nothing outside the form and the view panel imports them.
- `CharacterForm.svelte`:
  - imports :25, :37;
  - `"stats"` in `FormTab` :293 and `FORM_TABS` :304, and `stats: []` :340;
  - `|| statsDirty` :697 and its declarations :986-987;
  - the tabpanel :2054-2067 and the `activeFormTab === "stats"` clause :2074.
- `CharacterViewPanel.svelte`: imports :20-21, the read effect :144-165, the `data-view-stats`
  section :447-475.
- No session widget writes to a card. Verified: no client code targets the `card` owner kind.

**Sockets / types**
- Delete `server/sockets/cardState.ts` (+ `.int.test.ts`). In `sockets/index.ts`, drop :77 and :356.
- `shared/sockets/types.ts`:
  - delete `namespace CardState` :16845-17015;
  - remove `"card"` from `State.Owner.kind` :16037;
  - fix the comment at :347.
- `client/sockets/typedSocket.ts:4819-4880`: delete the `cardState:*` map.
- `shared/sockets/interest.ts`: delete the `SCOPED_EVENTS` entries :275-282 and the
  `GATED_EVENTS` entries :1412-1424.

**Server state & resolution**
- Delete `state/cardState.ts`.
- `owners.ts`:
  - drop `"card"` from `OWNER_KINDS` :32;
  - in `resolutionChain`, drop the push :90 and the card link :103-106, so `cast_member` becomes
    `[owner]`;
  - update the docs at :4-13, :50, :74.
- `resolve.ts`:
  - `chainFor` :943-950 no longer needs `characterId`;
  - drop the card part of `worldAttributesFor` :1182-1186, :1194, :1208-1213;
  - fix the comments at :8-20, :1132, :1150-1163, :1341.
- `write.ts`:
  - remove the card branches of `bookOfStatOwner` :1005, `assertSessionOwner` :1359-1371 and
    `assertMayDecide` :2494-2502;
  - remove the `card` keys of `OWNER_ROWS` / `OWNER_GONE` :1495, :1507;
  - update the docs at :60, :382, :459, :971, :1305-1324, :2482.
- `declarations.ts`:
  - remove the card branch of `assertSheetsWriter` :864-876 and its doc :760-770;
  - these become card-only and go: `slotIdFor` :125, `sheetIdFor` :141, `declareSheet` :623,
    `updateSheet` :646, `ownerSheets` :722, `setOwnerSheets` :776, and `ownerSegmentFor` :102
    (used by the dowry). Keep `declareSlot` :381, which rulesets use. For `updateSlot` :414, see
    ★C2.
- `earshot.ts`: `"card"` in `CAST_OWNER_KINDS` :344 and at :376.
- `sockets/state.ts`:
  - :352, drop `|| target.kind === "card"`;
  - `chainOf` :485-496;
  - in `baselinesFor` :1047-1115, the card layer :1075 and the fallback owner :1104;
  - fix the comments at :11-12, :208.
  - The `owner()` parser :221 follows `OWNER_KINDS` automatically.

**Export / import**
- Delete `characters/dowry.ts`.
- `sockets/characters.ts`:
  - the import at :72;
  - `importCardDowry` on create :1071-1075 and on overwrite :1112-1121;
  - the `withDowry` option on `buildExistingCharacterComparisonData` :1149, :1161, and its call
    :1347-1348;
  - the export's `dowry:` at :1741.
- `characters/cardIO.ts`:
  - `CardDowry` import :28;
  - `serenepubStrokesAndDowry` :181-192 becomes strokes-only and is renamed (or goes entirely
    with Part B);
  - `CardImportPlan.dowry` :318-319, :431-433;
  - the doc at :23.
- `utils/characterCardParser.ts`: :36, :40, :1149-1150, :1188.
- Comments only: `client/utils/cardImportedToast.ts:18-19`, `characters/likeness.ts:14`,
  `shared/characters/strokesFlag.ts:7-8, :37`.

**SDK** (`../serene-pub-sdk`)
- Delete `sdk/src/dowry.ts` (513 lines), its export at `sdk/src/index.ts:97-102`, and
  `sdk-tests/dowry.test.ts`. The export is public, so removing it is a breaking change. We evolve
  @1 in place: no @2 bumps before 0.7.
- Regenerate `docs/generated/api/sdk/src/dowry.md` and `docs/generated/api/index.md:42`.
- Delete the dowry entry in `guides/vocabulary.md:237-238`.
- Fix the "session → lorebook → card" comments: `contracts/src/tasks.ts:1870`,
  `contracts/src/queries.ts:2867` (and the generated `queries.md:1012`),
  `sdk/src/attributes.ts:41, :290, :1974`.
- No SDK owner-kind type includes `card` (`widgets.ts:1052` and `turnLock.ts:68` already exclude
  it).

**Tests (app)**
- Delete `cardStats.test.ts` and `sockets/cardState.int.test.ts`.
- Edit:
  - `characters/cardIO.int.test.ts`: :17, the dowry parts of :110-294; delete :362-391;
  - `characters/strokes.test.ts`: :12, :179;
  - `shared/sockets/gatedEvents.test.ts`: :135-138, :387-395;
  - `state/owners.test.ts`: :23-30;
  - `state/resolve.int.test.ts`: :183-240, :309-315, :742-860;
  - `state/sheetDefault.int.test.ts`: :157-165, :179;
  - `state/write.int.test.ts`: :873-884;
  - `state/declarations.int.test.ts`: :514-531;
  - `sockets/state.ownerScope.int.test.ts`: :126, :215-282;
  - `sockets/calendarInvariants.int.test.ts`: :234, :293-296;
  - `sockets/recordingRefusals.int.test.ts:115` (a seed row).
- There are no dom tests for the form or the view panel.

## 3. Data

- **Migration 0134, generated** (`db:generate`; the highest applied is `0133_audiocpp_packages`).
  `schema.ts` drops `'card'` from the owner-kind CHECKs on `attribute_configs` :9627-9628,
  `attribute_values` :9735-9736, `zone_contents` :9913-9914 and `owner_sheets` :10238-10239.
  It also fixes the comment table :9482-9505 and the "five kinds" comment :10198.
- **Data upgrade `dataUpgrades/0134_<tag>.ts`, `before`:** delete the `owner_kind = 'card'` rows
  from those four tables, so the new CHECKs can be added.
  - This catches orphans too: deleting a character never purged its card rows.
  - Anchored on a real schema migration, so it needs no comment-only custom file (see the
    custom-migration lesson of 2026-10-21).
- **Real-data check** on a scratch copy of the owner's live 0.6 database (the usual recipe, with
  meta.json):
  - count the card rows per table before;
  - boot it; confirm the upgrade ran and the CHECKs hold;
  - open a session with a seated character and check its Stats still resolve.

## 4. Lanes

- **L1, app (one lane).** Everything in §2 except the SDK, plus §3 and §5.
  - Targeted tests only: the files listed in §2, plus `npx tsc --noEmit -p .` and `npm run check`.
  - Never edit server files while the dev server is booting.
- **L2, SDK (after L1).** Once L1 lands, the app no longer imports the SDK's dowry.
  - Do the SDK items in §2, then `npm run sdk:test` (it pins hashes and counts) and
    `npm run sdk:build`. Check :5173 first: never build under the owner's dev server.
  - Needs an SDK prerelease and an exact pin bump before the app can be pushed.
- **Then one grouped verification run:** `npm test`, `npm run sdk:test`, `npm run check`,
  `npm run build`. Run the heavy suites in a capped scope.

## 5. Canon and docs (same change)

- **NOMENCLATURE.md:**
  - retire to §23: **dowry** :456, **re-own** :457, the card **Stats** tab, the card layer,
    `cardState:*`;
  - edit :965 (`serenepub.{strokes,dowry}`), :1194 (the Stats tab's HeartPulse icon), :1378 ("a
    card's sheets"), :1849, :2390, :2436 (the `setOwnerSheets` card refusal), :2621;
  - add one §25 ledger row.
- **docs/characters.md:**
  - remove :72 (the Stats tab row) and :194-203 ("Stats on a card");
  - edit :242 ("Stats from Serene Pub"), :264 (the export bullet), :290
    (`extensions.serenepub.dowry`).
- **docs/stats-and-states.md:**
  - edit :30, :84, :94, :262;
  - in "Where a value comes from" :171-192, drop item 3 :177, the template sentence :180, the
    card section :182-188 and the card examples :190, :192.
- **STYLE-GUIDE.md:1633-1636:** it uses the Stats tab as its reference example, so it needs a new
  one (★C4).
- `src/lib/generated/docs/search.json` is rebuilt by `scripts/build-docs.js`.

## 6. Open ★

- **★C1 Delete the rows, or leave them dormant?**
  - *Recommended:* delete the card rows and drop `'card'` from the CHECKs (§3). A future return
    would take a different shape (§7: values on the card, not attribute rows), so these rows
    would never be reused.
  - *Alternative:* keep the rows inert and the CHECKs as they are. That needs no migration and
    keeps the values, but leaves a dormant owner kind in the database.
- **★C2 Editing stored slots.** `updateSlot`'s only caller is the card socket. Once it's
  removed, no surface edits a stored slot; rulesets can still borrow one.
  - *Recommended:* accept that for now.
  - *Alternative:* give slot editing a home in Admin → Rulesets.
- **★C3 Attribute sheets afterwards.** No code would write `owner_sheets` any more (it's only
  copied or moved), and `vocabularyFor` no longer reads sheets.
  - *Recommended:* retire the whole concept (`owner_sheets`, SDK `sheets.ts`, sheet defaults,
    `worldAttributesFor`'s sheet reads, `declareSheet`) as a follow-up plan.
  - *Alternative:* leave it dormant. Either way, not in this plan.
- **★C4 STYLE-GUIDE example.** Which surface replaces the Stats tab as the reference example at
  :1633-1636?
- **★C5 Part B.** Fold the strokes removal in? *Recommended:* yes. It touches the same files
  (`cardIO.ts`, `characterCardParser.ts`, `CharacterForm.svelte`, `CharacterViewPanel.svelte`,
  NOMENCLATURE :965) and can share the same SDK prerelease.

## 7. Parked: the values-only card (owner idea, 2026-10-29)

Kept so it isn't lost. Not planned.

**The idea:** a card holds plain stats (key, value, optional min/max/options), each set to
*seed*, *constant* or *off*.
- A **seed** converts into a session's ruleset attribute of the same slug, when the value type is
  compatible:
  - a number is rescaled across bounds (level 50 of 1–100 becomes 25 of 1–50);
  - a string matches the attribute's options case-insensitively, or is accepted as free text.
- A **constant** is told to the model as card text.
- A ruleset can be imported into a card's fields, whole or one field at a time.

**Notes made at the time, if it's revisited:**
- *seed* has three live meanings and *constant* is a lorebook entry (R1).
- The "genre allows custom stats" gate is `customAttributes`, retired by RF fix 8.
- Rescale minimum to minimum, `rMin + (v − cMin)/(cMax − cMin) × (rMax − rMin)`, not by ratio.
- Convert when the value is read, as the card's layer, rather than as a snapshot taken at
  session start.
- A constant whose slug matches a tracked attribute contradicts it.
- **Why not now:** imported cards carry no stats; matching names across ruleset authors is
  fragile; rescaling is a guess; constants duplicate Description; the build is sizeable.

---

## Part B (PROPOSED, needs ★C5): remove the paused strokes remnants

**Background.** Strokes split a card's description and personality into pieces, each with
`when: always | off | keywords`. They were built 2026-10-11 and paused the same day
(`STROKES_ENABLED = false`, `shared/characters/strokesFlag.ts:50`). Every strokes file entered
git in one commit, `12c611b1` (0.6.0-pr-5), with the flag already off. **No release ever ran
with strokes on.**

**What is still live with the flag off:**
- Every form create/update and every card import writes `characters.strokes = []`, the column
  default (`server/characters/strokes.ts:89-94`, `sockets/characters.ts:533, :721-738, :919`).
- The `characters:countStrokeTokens` socket is registered and only refuses
  (`sockets/characters.ts:1996-2025, :2334`).
- An import carrying `serenepub.strokes` has its stroke-made lorebook entries filtered out
  (`cardIO.ts:208-211, :347-361`).
- The `core:task/card-strokes@1` node is published at boot, so it shows in the node picker,
  though no spec places it (`runtime/bindings.ts:196-198, :5141-5163`, `prompt/cardStrokes.ts`).
  It can't go alone: `boot/bindingCompat.ts:167-181` throws if a core definition lacks a binding.
- The `strokeList` template helper and filter are registered: `shared/utils/strokeList.ts`,
  `contextHandlebarsHelpers.ts:123-131`, `contextLiquid.ts:56, :278-280`,
  `templateCheckOptions.ts:28, :46`, `imageGen/comfy/fit.ts:87`.
- SDK: `sdk/src/strokes.ts` and its export `index.ts:97-101`; `CHARACTER_CARD.strokes` in
  `core:var/characters@1` (`variables.ts:243-285`); the `cardStrokes` contract
  (`contracts/src/tasks.ts:3106-3171`). The playground bundle includes them too.

**Dead behind the flag:**
- `StrokeList.svelte`, `SplitStrokesDialog.svelte` and most of client `strokes.ts`.
- `CharacterForm.svelte`:
  - imports :22-24, :46-50; error keys :325, :335;
  - draft load :811-816; token recount and Back to one text :885-983;
  - the dialog :2190-2240.
- `CharacterViewPanel.svelte` :17-19, :136-142, :368-395, :410-437.
- Server `strokeTokens.ts`.
- `cardIO.ts` stroke-book helpers :50-126, :214-298, :346-406.
- The `compileCharacter` stroke path, `promptFields.ts:193-300`.
- `contextFields.ts:37-54`, `variableLayouts.ts` flag branches, `templateAssist.ts`.

**Shared, so edit rather than delete:**
- The two `StrokeField` uses in `CharacterForm.svelte` (:1289-1352, :1688-1725) render the
  description and personality textareas when the flag is off. Inline the textareas.
- The "Description is required" rule lives inside the strokes `superRefine` (:120-130). Move it
  out.
- `characterForSave` (client `strokes.ts:266-279`) strips `strokes` from the save. Drop the
  field instead.

**Data:**
- `characters.strokes` was added in `drizzle/0100_schema_0_6_0_pr_5.sql:141`, a squashed release
  migration. Never edit that file; the column is dropped in the same generated 0134.
- No card can hold strokes data: with the flag off nothing writes a non-empty list, and the
  prose columns are what the prompt, UI and export read.
- Confirm on the real-data copy: `SELECT count(*) FROM characters WHERE jsonb_array_length(strokes) > 0`.

**Removal, folded into the lanes:**
- **L1 (app):**
  - inline the textareas and move the description rule;
  - delete the client stroke components and helpers, server `strokes.ts` and `strokeTokens.ts`,
    the token socket and its types, and the stroke branches in `cardIO.ts` and the parser (so
    `serenepubStrokesAndDowry` goes entirely);
  - delete the `compileCharacter` stroke path and the layout branches, `strokeList`, the flag,
    and the strokes-only tests;
  - drop the column;
  - **keep** the `card-strokes` binding until L2.
- **L2 (SDK + app):**
  - SDK: delete `strokes.ts` and its export, `CHARACTER_CARD.strokes`, the `cardStrokes`
    contract and the SDK tests;
  - app: delete the binding and `prompt/cardStrokes.ts`; update the registry pin
    (`registryHashes.test.ts:1612-1615`); rebuild the SDK and the playground bundle.
- **Risk:** a user's own pipeline that placed `core:task/card-strokes@1` stops resolving. No core
  spec places it.

**Tests touched, beyond the strokes-only files:**
- `characterAvatarAndUpdate.int.test.ts:31-37, :489-740`
- `cardIO.int.test.ts:29-35, :392-`
- `retold.int.test.ts:6, :61, :96-114, :151-157`
- `templateCompletions.test.ts:352-362`
- `liquidParity.fixtures.ts:16, :255-258`
- `rulesetVocabulary.test.ts:87-89`
- `cardImportedToast.test.ts:49-53`
- SDK `helpers.ts:232-234`, `lair.test.ts:253`

**Canon:**
- NOMENCLATURE :380-383 (the four ⏸ rows) go to §23; edit :965.
- Edit `STYLE-GUIDE.md:176`.
- Mark `plans/DESIGN-card-strokes-and-dowry-2026-10-11.md` superseded.

## Ledger

- 2026-10-29: plan written from two read-only sweeps. Nothing built.
