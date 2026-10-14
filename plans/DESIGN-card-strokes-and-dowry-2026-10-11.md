# Card strokes and the card dowry — design (2026-10-11)

Status: ⏸ **STROKES PAUSED 2026-10-11** (owner, after the build: "Lets disable strokes for now in core and in the sdk,
we will revisit later"). Part A is built but switched off: no core spec places `core:task/card-strokes@1`
(the 19 bumps reverted to their previous versions/hashes), the app hides every stroke surface behind
`STROKES_ENABLED = false` (`src/lib/shared/characters/strokesFlag.ts` lists the gated sites), import never
writes strokes, export never carries them, the characters layout text is the pre-strokes text. The column,
SDK modules, descriptor, sockets and tests (run with the flag mocked on) stay. **Part B (dowry, Stats tab,
`cardState`, vocabulary) stays live.** To revive: flip the flag, re-place the step in the specs (S3 ledger
row names every file), re-add the docs sections (git history of docs/characters.md 2026-10-11).

Previous status: **RULED 2026-10-11 ("Get to work")** — every ★ recommendation below stands as ruled, with
these fixes: A.9 #1 → strokes when small and plain, else a lorebook (no per-card prompt);
A.9 #6 → **widen `core:var/characters@1` in place** with an optional `strokes` field (variables
are code declarations guarded by `refuseUnlessIdentical`, not stored rows; an `@2` would ripple
through every spec output map for no reader's benefit — the sdk-tests pin is updated in the same
change); B.9 #2 → re-own; B.9 #3 → rename + report. **BUILT 2026-10-11**, units S1–S7 below (ledger at the end). Grouped verification:
full app suite 16,322 pass with 5 failures, 3 ours and fixed the same run (chat-respond pin in
`specs/adventure.test.ts`, `receipts.int.test.ts` trail, hardening fixture pinned; plus a NUL-byte
guard in `plainBookRefusal` so a broken embedded book is held, not stroked), 2 another lane's
(`commentHistory` ratchet on untracked `SessionBanners.svelte`; `components.int.test` — core.ts lists
6 component sources, the SDK's `CORE_COMPONENTS` now 13). `sdk:test` 2908/2909 (the failing one is
another lane's guide vocabulary check). svelte-check: 1 error, another lane's untracked test.
Stats tab icon moved to `HeartPulse` (canon I1).

Goal (Jody, verbatim intent): *make character cards excel as the source material.* Everything a
character is — prose, conditional prose, and stats — travels on the card, imports from and exports
to the chara card V2/V3 spec without loss for other tools, and round-trips losslessly between
Serene Pub installs. Lorebook-anchored character lore cannot do this: it does not leave with the
card.

Two shapes, one seam: **strokes** are prose, the **dowry** is state. Both live on the card and
nowhere else; both compile down to the four-field card so every existing template and pipeline
keeps working; both are rendered piecemeal only by an explicit step or template.

---

## Part A — Strokes

### A.1 What exists (facts, 2026-10-11)

- A card is four prose fields rendered as ONE JSON object per character —
  `{name, nickname, description, personality}` — by `compileCharacter`
  (`src/lib/server/pipelines/prompt/promptFields.ts:156-175`). Null keys are deleted. Genre field
  `characterDetail` (`full` · `brief` · `speaker-only`) decides which keys a non-speaker gets.
- Layout `core:var/characters@1` renders that object as indented JSON
  (`entities/variableLayouts.ts:387-640`); SDK `CHARACTER_CARD` VarField (`sdk/src/variables.ts:222`).
  Macros interpolate only name/nickname/description/personality (`prompt/templateContext.ts:229-239`).
- **No token count anywhere on the card form**; no per-field budget. Card text goes in whole.
  Server has `TokenCounterManager` (`src/lib/server/utils/TokenCounterManager.ts`) and
  `connections/backendTokenCount.ts`.
- `characters.description` is `notNull`; `embedTextHash` is a generated column over
  `name || chr(10) || description` (schema.ts:1941-1945). Side characters read
  description/personality straight from the DB (`entities/sideCharacter.ts:201-202`).
- Import (`sockets/characters.ts:639-686 characterFieldsFromParsedData`) never writes
  `characters.extensions`; export (`characterCardParser.ts:1145-1195 buildCharacterCardV3`) rebuilds
  `extensions` from scratch. **Foreign extensions are dropped both ways** — a pre-existing fidelity
  hole this design must close (A.6).
- Keyword-conditional character content exists today only as **character lore**
  (`core:entry/character-lore@1`, anchored to a cast member, placed by `characterLore`). Folding it
  into the card as `"extra lore"` was **retired 2026-09-30** (NOMENCLATURE §23) because nothing
  supplied it. Attributes (Part B) already give a card typed values; a stroke is never a typed value.

### A.2 The stroke

A card's description and personality are an ordered list of **strokes** ("a card is painted in
strokes"). §24 grep 2026-10-11: *stroke* occurs only as the SVG attribute, never as a canon word;
*entry* (R1, lorebook), *facet* (`defineFacet`), *trait* (generic, R2) rejected.

```ts
interface Stroke {
  kind: 'description' | 'personality'      // ★ closed set for now (A.9 #5)
  slug?: string                             // data key for templates and macros; author-owned
  label?: string                            // optional "Eyes" → PList / Ali:Chat style for free
  text: string
  when: StrokeWhen                          // see below
}
type StrokeWhen =
  | { mode: 'always' }
  | { mode: 'off' }
  | { mode: 'keywords'; keys: string[]; matchMode?: 'substring'|'word'|'regex'; caseSensitive?: boolean }
```

- `slug` follows the attributes rule (R2 of DESIGN-attributes-build): slug is the data key,
  `label` is what people read. Unique per card. `character.strokes.eyes` in a template.
- `when` is the ONLY condition language for now. Secondary keys / selective logic can be added
  under `when` later without changing the shape. No priority, no weight (NOMENCLATURE §8: no
  per-entry gates). **Later (R21 of attributes):** a Liquid predicate over `state` as a fourth
  mode — "show this personality stroke when sanity < 30" — is where Part A and Part B meet. Not in
  this build; the shape must not block it.

### A.3 Storage

- ★ `characters.strokes jsonb NOT NULL DEFAULT '[]'` — one column, array order is position, like
  `alternateGreetings` / `exampleDialogues`. (A table was considered; nothing here is per-owner-kind
  and the array IS the order.) Generated migration (`db:generate`), index > 0100.
- `description` and `personality` columns become the **compiled cache**: written on every save as
  the join of every enabled stroke of that kind, keyword strokes included (A.4). Embeddings,
  search, side characters, macros, the 0.5 attic and `embedTextHash` keep working with zero change.
- **A card with no strokes is the legacy shape**: its prose columns are the truth. Import never
  explodes prose into strokes. The form offers **Split into strokes** (by paragraph · by sentence ·
  by PList segment `Key: value;`) as an explicit action, previewed, undoable before save.
- ★ When `strokes` is non-empty, the prose columns are **derived and read-only** in the UI (one
  truth). Clearing every stroke returns the card to the legacy shape with the last compile kept.
- Join rule: strokes with a `label` compile as `Label: text`; without, as the bare text;
  description strokes joined by blank lines, personality strokes by `; ` when any has a label
  (PList-shaped) else by newline. Pure function, in the SDK, one place
  (`compileStrokes(strokes, kind)`), tested.

### A.4 How strokes reach the model — explicit step, never a fold

- **Fallback (no step ran):** `compileCharacter` emits the four-field object from the cached
  columns. Every enabled stroke is in, keyword ones included. Nothing is lost, only budget. This is
  also exactly what a non-Serene-Pub tool sees in the exported `description`.
- **The step:** a pure task node ★ `core:task/card-strokes@1` — in: cast (characters with
  `strokes`), recent transcript (same window the lore keyword scan reads), out: the cast with each
  keyword stroke marked `fired` or not. It reuses the lore keyword **matcher** as shared code
  (match modes, regex time limit, refused-pattern check at save) — R5: one matcher at the seam,
  two vocabularies. It does NOT go through the ranker, the lore budget or `select`: strokes are
  not retrieval candidates and never compete with lore for room.
- After the step, `compileCharacter` emits `always` + `fired` strokes only, and the character
  object in the variable scope additionally carries `strokes: Stroke[]` (resolved, `fired`
  stamped) so a template may iterate or address by slug. `characterDetail` applies per kind as
  today (`brief` drops every personality stroke).
- Core reply specs gain the step before the characters variable is built (explicit in the spec,
  per "no magic in core"). Plugin and custom specs opt in by placing the node.
- ★ Default JSON layout, when strokes exist: `"description": ["…", "…"]` (facts kept apart — the
  stated reason the card is JSON, docs/context-templates.md "Why … JSON, not prose"). Prose layouts
  get the joined string. Labelled strokes render as `{"Eyes": "green"}` entries in the list.
- `core:var/characters@1` gains `strokes` in its scope. ⚠ The id is content-hashed; adding a
  field is an `@2` under §2 grammar unless ruled otherwise. ★ Recommend `@2` with `@1` kept as an
  alias that omits `strokes` (zero template breakage).

### A.5 Tokens

- Counted server-side per stroke and per kind, through `TokenCounterManager` against the person's
  default text connection (fallback: the generic estimator). One socket request per debounced edit
  (`characters:countStrokeTokens`), returns `{ perStroke: number[], perKind: {...}, model }`.
- **Stored nowhere.** A token count is a property of a tokenizer, not of a card. UI label:
  *≈ N tokens (model name)*; when no connection, *≈ N tokens (estimate)*.
- Totals shown in the tab header for description and personality; per-stroke count on the row.

### A.6 Import and export — where this wins

The chara card V2/V3 spec already has the slot for a conditional piece: `character_book.entries[]`
with `keys`, `secondary_keys`, `constant`, `enabled`, `content`, `name`, `position`. So:

**Export** (`buildCharacterCardV3`):
- `description` / `personality` ← the compiled cache (every enabled stroke, A.3 join rule).
- keyword strokes → `character_book.entries[]` (one entry each: `keys`, `name`=label|slug,
  `content`=text, `enabled`=true, `constant`=false, `use_regex` from matchMode, `case_sensitive`),
  merged with any entries the card's own lorebook (`characters.lorebookId`) exports today.
- the full `strokes` list verbatim under `extensions.serenepub.strokes` (lossless SP↔SP).
- **Preserve foreign extensions:** export starts from the stored `characters.extensions` and
  overlays `serenepub`, `depth_prompt`, `source`, `group_only_greetings`. Import writes
  `characters.extensions` with everything it did not map. (Closes the hole in A.1.)

**Import** (`characterFieldsFromParsedData`):
- `extensions.serenepub.strokes` present → it wins; prose columns recomputed from it.
- else → legacy shape (no strokes). Never auto-split.
- ★ `character_book` present, no `serenepub.strokes`: entries become **keyword strokes** when the
  book is small and plain (★ every entry ≤ 600 chars, no `selective`/secondary keys, no
  `position` other than before/after char, ≤ 24 entries); otherwise it imports as a lorebook, as
  today. The import summary says which happened; the character page offers the other.
  _(Open: Jody may prefer "ask per card".)_

### A.7 UI (character form)

- Profile → **Description** and Voice → **Personality** fields become stroke lists when the card
  has strokes: a row per stroke (drag handle · label · text · `when` chip: *Always* / *Off* /
  *Keywords ‹n›* · ≈tokens · ⋮), **Add stroke**, kind total in the field header.
- Legacy card: the textarea as today plus **Split into strokes…** under it.
- `when: keywords` editor = the lore keyword chip control reused (same component, same regex
  refusal copy).
- Read-only compiled preview fold: *What the model reads when nothing has fired*.

### A.8 Interaction with the rest

- **Character lore stays.** World-specific knowledge a character has (the debt only she knows)
  is still lore in the book: it is about the world, not the card. Docs say which goes where.
- **Personas are characters**: a persona may carry strokes; `personas@1` layout follows the same
  list rule.
- **0.5 attic**: nothing to do; legacy shape.
- Export to a non-SP tool with `character_book` entries from strokes AND a linked lorebook: one
  book, strokes first, book entries after; ids re-numbered.

### A.9 Rulings wanted (★)

1. Embedded `character_book` on import: strokes when small and plain (A.6), lorebook otherwise;
   or ask per card.
2. Fallback compile and the cached columns include keyword strokes. **Recommend yes.**
3. Prose columns derived and read-only when strokes exist. **Recommend yes.**
4. The word **stroke**. (grep clean.)
5. `kind` closed to `description` | `personality`. **Recommend closed**; an open registry can
   come with a plugin need.
6. `core:var/characters@2` with `@1` alias, or widen `@1` in place.
7. Default JSON layout renders a list. **Recommend list.**

---

## Part B — The card dowry (attributes on the card)

### B.1 What exists (facts, 2026-10-11)

- The data layer is there: `attribute_values`, `attribute_configs`, `owner_sheets` accept
  `owner_kind = 'card'` (`characters.id`); the read chain is session → lorebook → card → sheet
  default → declaration default (`state/resolve.ts:8-26`, `state/owners.ts`). Docs:
  *the card is the template, the lorebook is the world, the session is this run.*
- **Missing 1 — editor.** docs/stats-and-states.md "What isn't built yet": *there's no stats
  editor yet on a character card*.
- **Missing 2 — vocabulary.** `worldAttributesFor` (`state/resolve.ts:970-990`): *"Character cards
  bring nothing: a card is the same in every story, and what one story tracks of a character is
  its cast member's"* (ruled 2026-09-25). A card's `owner_sheets` never enter a session, so a card
  value matters only if the genre or world already tracks that slot.
- **Missing 3 — portability.** Card export/import carries no attributes. Lorebook export carries
  config/value rows (format 2, `EXPORTED_STAT_OWNER_KINDS = lorebook | cast_member | location`)
  but **no declarations and no sheets** — R21 of DESIGN-attributes-build deferred "sheet/pack
  export+import (import embeds declarations; conflict → opaque + rename offer)". This design
  forces that decision for cards.
- Slot ids are owner-namespaced by username (`jody:slot/sanity@1`; `declarations.ts
  ownerSegmentFor`). Reserved owners: `core` + installed plugin ids. A card leaving one pub
  carries another person's namespace into the next — **the one hard problem.**
- `attribute_declarations` keeps a **last-seen** record of every declaration ever used (R4) —
  display and export after the plugin is gone, never validation.

### B.2 The word

**dowry** — what a card brings with it into a world: its sheets, its starting values and limits,
and the declarations those need. §24 grep 2026-10-11: unused. *pack* rejected (R1: style pack,
preset pack, the `blocks` pack). *kit* rejected (SvelteKit in every import line). UI never says
"dowry" to beginners — the tab is **Stats**; *dowry* is the wire/export name and the canon word.

### B.3 Vocabulary (reverses part of the 2026-09-25 ruling — both quoted)

- Ruled 2026-09-25: *"Character cards bring nothing: a card is the same in every story, and what
  one story tracks of a character is its cast member's."*
- Jody 2026-10-11: *"the goal is to make character cards excel as the source material."*
- ★ Reconciliation: a card's sheets join the session vocabulary **for that character's seat**,
  under the same genre gate as world attributes (genre denies custom attributes → nothing). Order:
  genre sheets, then world (lorebook, cast member), then card — *first mention fixes the position*
  as today. Values still resolve session → lorebook → card; the cast member still overrides the
  card inside a world. Only the vocabulary rule moves; nothing else in the chain.
- Implementation: `worldAttributesFor` gains the seat's `card` owners (through
  `owners.ts` chain, which already pairs `session_cast` with its `card`). Side characters and
  personas included.

### B.4 Card Stats tab (editor)

- A fourth form tab **Stats**, after Notes. Pick sheets from the registry (core, plugin,
  stored) — chip list, ordered; set starting values and limits on the card layer (writes
  `attribute_values` / `attribute_configs` rows with `owner_kind='card'`, through the ONE gate
  `state/write.ts`, author edits are not turn-locked per R9). Loose slot on the card = the card's
  own unnamed sheet (R6).
- **New slot / new sheet from the card** reuses the U5 sheet editor if it landed; else a slot
  form (label, type, descriptor, config, default) writing a stored declaration under the author's
  namespace (`defineStoredAttributeSlot`). Reserved owners refused with the existing sentence.
- Preview: the state block as the prompt would render it for this card alone (`stateOf` over the
  card layer; no session).

### B.5 Export — the dowry in the card

`extensions.serenepub.dowry` (format 1):

```jsonc
{
  "format": 1,
  "sheets": ["core:sheet/adventure@1", "jody:sheet/sanity-kit@1"],      // owner_sheets, in order
  "rows": [ /* attribute config + value rows for owner card, format-2 shape as lorebook export */ ],
  "declarations": {
    "slots":  [ { "id": "jody:slot/sanity@1", "hash": "…", "props": { /* AttributeSlotProps */ } } ],
    "sheets": [ { "id": "jody:sheet/sanity-kit@1", "hash": "…", "props": { /* AttributeSheetProps */ } } ]
  },
  "refs": [ { "id": "core:slot/hp@1", "hash": "…" } ]                   // core: id + hash only
}
```

- Core declarations are **referenced** (id + content hash), never embedded.
- Stored and plugin declarations are **embedded** with props + hash; a plugin slot whose plugin
  is gone exports from the last-seen record (R4 is for exactly this).
- `rows` reuse the lorebook export's row shape and limits (`assertStatsWithinImportLimits`
  counterparts). Session-layer rows never travel (as today).
- Only non-SP readers see nothing of this; the prose card is complete without it.

### B.6 Import — declarations and the namespace problem

For each embedded declaration, in dependency order (slots before sheets):

| Local state | Action |
|---|---|
| same id, same hash | use local; nothing written |
| same id, **different hash** | ★ **rename**: register under the importer's namespace with a `-2`… suffix, report in the import summary; never overwrite local |
| id unknown, owner is a **username** | ★ **re-own** to the importer's namespace (`<importer>:slot/<name>@N`), keep the original id in `props.importedFrom`; **dedupe repeat imports by (name, hash)** so the same card twice makes one declaration |
| id unknown, owner is an **installed plugin** | refuse that declaration (reserved owner); use the plugin's live one if it has the id, else drop with a report line |
| id unknown, owner is a **plugin not installed** | last-seen opaque row (`origin: 'plugin'`), values kept, panel greys with the carried label (R3/R4 behaviour already) |
| `refs` core id with a different hash | import proceeds; summary line *"‹label› is a newer/older core stat here"* |

Then `sheets` → `owner_sheets` for the new card (ids rewritten per the table), `rows` → card
layer with slot ids rewritten. A card with no dowry is unchanged. Import limits mirror the
lorebook's (`maxStatRows`, `maxStatJsonBytes`).

Open (★): re-own vs keep the foreign owner. Keeping it means a stranger's username in this
pub's id space and a collision the first time a local user has that name; re-owning means the
importer now owns a copy, which is what owning the card already means.

### B.7 Prompt

Nothing new. Once B.3 lands, `state`, `stateOf`, `derive`, the state block, the gate, turn lock,
rules, proposals and the Stats widget see card values and card sheets for free. `earshot: holder`
applies unchanged.

### B.8 Where A and B meet (later)

R21 of DESIGN-attributes-build schedules Liquid as the predicate language everywhere a predicate
is taken. A stroke `when: { mode: 'liquid', expr }` over state pinned at run start is the fourth
mode. Then "Nervous, picks at her sleeves" is a personality stroke that exists while
`sanity < 30`, and the card carries both the stat and the prose that depends on it. Nothing in
this document is built to require it; nothing blocks it.

### B.9 Rulings wanted (★)

1. Confirm the vocabulary reversal (B.3) and its scope: the seat's card, under the genre gate.
2. Re-own imported declarations to the importer (recommend) or keep the foreign owner.
3. Hash conflict: rename with suffix and report (recommend), or refuse that slot.
4. The word **dowry** (grep clean); UI label **Stats**.
5. Core declarations referenced by id + hash, never embedded. **Recommend yes.**

---

## Units (after rulings)

| Unit | What | Where |
|---|---|---|
| S1 SDK | `Stroke`, `StrokeWhen`, `compileStrokes`, card-strokes node descriptor, `core:var/characters@2` scope, dowry shape + hash compare, `importDowry` pure resolver (table B.6 as a function) | `../serene-pub-sdk/sdk/src/` + sdk-tests; `sdk:build` |
| S2 storage | `characters.strokes` jsonb (generated migration), cache write on save, `extensions` preserved on import | `db/schema.ts`, `sockets/characters.ts` |
| S3 pipeline | `core:task/card-strokes@1` host impl (shared matcher), `compileCharacter` fired-aware, layout list render, core specs place the node | `pipelines/prompt/`, `entities/variableLayouts.ts`, core-catalog specs |
| S4 cards I/O | export: compiled prose + `character_book` from keyword strokes + `serenepub.strokes` + `serenepub.dowry`; import: the reverse, A.6/B.6 rules, summary lines | `utils/characterCardParser.ts`, `sockets/characters.ts` |
| S5 vocabulary | `worldAttributesFor` includes seat cards | `state/resolve.ts`, `state/owners.ts` |
| S6 client | stroke lists + Split + token counts + keyword chips; **Stats** tab on the card form | `components/characterForms/` |
| S7 docs + canon | docs/characters.md (strokes, Stats tab, what travels), docs/stats-and-states.md (card editor, dowry), docs/context-templates.md (`strokes`, list render), NOMENCLATURE §8/§9/§16 rows + §25 ledger (stroke, dowry, card-strokes node, `@2`) | — |

Verification: one grouped run at the end (sdk:test, app unit + int for characters/state/import,
real-data upgrade check on a 0.6 scratch copy, a card round-trip SP→file→SP and SP→file→ST-shaped
reader). Screenshots of the form.

## Unit ledger (keep current)

| Unit | Status | Evidence |
|---|---|---|
| S1 SDK | **BUILT 2026-10-11** | `sdk/src/strokes.ts`, `sdk/src/dowry.ts`, `CHARACTER_CARD.strokes` widened in place, `contracts/src/tasks.ts cardStrokes` (`core:task/card-strokes@1`: in `cast`+`messages`, `params.scanDepth` default 10, out `main`/`cast`); 49 tests; `sdk:build` ok. `DowryDeclaration.origin?: 'stored'|'plugin'` (exporter must set). Plan carries `from` for re-own/rename; `idMap` only changed ids; `dropped` for refused. Derive/rules slot refs NOT rewritten (known gap). 3 pre-existing sdk:test failures from another lane (chronicle snapshot, guide vocab, `story:moved`). |
| S5 vocabulary | **BUILT 2026-10-11** | `state/resolve.ts worldAttributesFor` + 5 tests in `resolve.int.test.ts`; state suite 261 green. Decided: cards count with no world; order lorebook → cast → places → seat cards; ride the same `on` switch as world attributes; card-held values bring their slot. |
| S2 storage | **BUILT 2026-10-11** | `characters.strokes` jsonb (0101_slimy_master_mold, column only); `server/characters/strokes.ts` (`applyStrokesToCard`, `StrokesRefused`, regex keys must compile at save), `strokeTokens.ts` (`countStrokeTokens`, default text connection, estimate fallback `model: null`); `characters:countStrokeTokens` (+`requestId`, ungated); update with prose-only save recompiles from stored strokes; `characters:list` carries no strokes. 10 + 23 tests green. |
| S3 pipeline | **BUILT 2026-10-11** | `prompt/cardStrokes.ts` (`resolveCastStrokes`, shares `signals.ts` matcher + `boundedPattern.ts` time limit), binding `core:task/card-strokes@1` in `runtime/bindings.ts`, `compileCharacter` exported + stroke-aware (card gains `strokes` when resolved; per-kind column fallback), layout rows render `(or (strokeList strokes "description") description)`; new helper/filter **`strokeList`** (Handlebars + Liquid, in `shared/utils/strokeList.ts`, assist docs); 19 specs bumped (chat-respond 1.22.0, chat-narrate 1.12.0, guide-respond 1.3.0, 12 × 1.1.0, answer-form 1.1.0) — step label *Card strokes*, `params.scanDepth` back-filled 10 by `reconcileConfigs`; pins moved (`specHashes`, `registryHashes` `1c9c09d64cdc1f`, lair PUBLISHED, catalog digest `bf867f9d8a4a7f9a`). 912 tests green. Open: semver bumps vs the 0.6 freeze note in `seed.ts`; personas/side/envoy cards use the raw fallback (cache); no diagnostics port for patterns not run. |
| S4 cards I/O | **BUILT 2026-10-11** | `server/characters/cardIO.ts` (pure: `planCardImport`, `strokeBookEntries`, `mergeStrokeBook`, `exportedExtensions`, `PLAIN_BOOK_LIMITS`, 256 KiB extensions cap), `server/characters/dowry.ts` (`buildCardDowry`, `importCardDowry` — one `tx`, never throws), parser `buildCharacterCardV3` starts from stored extensions; import writes `strokes` + `extensions`, runs the dowry, returns `summary?: string[]` on ImportCard/ImportResolve/ImportFromLibrary. Plain-book → strokes conversion keeps the prose as whole `always` strokes first; SP-authored books (any `extensions.serenepub`) are always held; `importedFrom` lives in props. 171 tests green. Open: registry keeps an in-memory stored decl if the tx rolls back after it (until boot); derive/rules refs not rewritten (S1 gap); `summary` not shown in UI yet. |
| S6a cardState sockets | **BUILT 2026-10-11** | `server/state/cardState.ts` (`cardStateFor`, `applyCardChanges` — card-layer rows written directly like `placeStats.ts`, since `write.ts` needs a session; gate checks reused), `sockets/cardState.ts`: `cardState:get/set/setSheets` (scoped by characterId) + `declareSlot/updateSlot/declareSheet/updateSheet` (gated, unscoped) + push `cardState:changed`; sessions seating the card get `state:changed`. `Sockets.CardState.*`; `changes: Array<{slotId, value?, config?}>`, all-or-nothing. 63 tests green. Open: no retire verbs; declarations not pushed; `get` returns no defaults (S6b adds). |
| S6b client | **BUILT 2026-10-11** | `characterForms/`: `StrokeList.svelte`, `StrokeField.svelte`, `SplitStrokesDialog.svelte`, `CardStatsTab.svelte`, `strokes.ts`, `cardStats.ts`, `cardStatsApi.ts`; form: `strokes` in draft, description required unless strokes, Stats tab (Gauge icon), 400 ms token recount with one in-flight `requestId`; view panel shows strokes + Stats. `cardState:get` gained `defaults`. An un-split field saves as one trailing `always` stroke. Back to one text compiles both kinds and clears. 37 tests; screenshots in scratchpad `shots/`. Import `summary` shown in the central import toast (`cardImportedToast.ts`). Open: pending Stats edits are not sent by the character's Save; New slot reaches the card only via a sheet; sheet order by buttons. |
| S7 docs + canon | **BUILT 2026-10-11** | `docs/characters.md` (Edit a character: Stats tab row + strokes line; new **Strokes** (Split into strokes, A stroke's row, Back to one text, Limits, `:::note` on Card strokes), **Stats on a card**, Cards that carry a lorebook: plain book; new **What else a card brings**; Exporting: what the file carries; power users: `extensions.serenepub.*`), `docs/stats-and-states.md` (What a session tracks: card sheets after the world's; new **The character card** under Where a value comes from; What isn't built yet line narrowed), `docs/context-templates.md` (`characters`: `strokes`, list render, Card strokes step; `strokeList` helper/filter row), `NOMENCLATURE.md` (§8 **stroke** · **Card strokes** · **Split into strokes / Back to one text** · **plain book**; §9 **dowry** · **re-own**; §16 **V3 card** + `summary`; §22 Nouns: card Stats tab `Gauge`, flagged against the Stats widget's `HeartPulse`; §25 one row _card strokes · dowry — 2026-10-11_), `STYLE-GUIDE.md` §6.14 (a tab that saves on its own). `docs:build` clean (108 pages). Open: the `Gauge`/`HeartPulse` icon ruling (I1). |
