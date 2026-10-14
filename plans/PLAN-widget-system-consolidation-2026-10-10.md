# PLAN — Widget system consolidation

**Status:** BUILT 2026-10-11 — C1–C7 done and verified (grouped run: sdk:test 2941/2942, tsc 0, svelte-check 0, npm test 16385 pass / 0 fail after fixes, budgets pass, build OK); C8 deferred to 0.7 (Q3). Ledger: scratchpad lanes/LEDGER.md of session 08c975b5. Was BUILDING since 2026-10-10 (owner: "Implement"; recommended rulings taken, see scratchpad lanes/LEDGER.md). Originally PROPOSED 2026-10-10 after the owner asked for "a plan to fix everything" after the
widget-system assessment of the same day. Consolidation only: no new widget, no new layout format, no
protocol bump. The companion plan `PLAN-core-widgets-2026-10-10.md` (new widgets) should be
sequenced **after** C1–C4 here, because each new widget today costs three hand edits and one silent
runtime failure mode that this plan removes.

**Rules in force.** Edit SDK in `../serene-pub-sdk`, then `npm run sdk:build` (never under the
owner's dev server) and `npm run sdk:test`. Additive SDK changes only; `WIDGET_PROTOCOL` stays 2.
One lane per unit, targeted tests per lane, one grouped verification at the end
([[feedback_batch_large_verification_runs]]). Never `git stash`. No subagent resumes.

---

## 0. The seven findings, and the unit that closes each

| # | Finding | Unit |
|---|---|---|
| F1 | `SessionLayout.svelte` 6,160 lines / 123 fns / 35 sections; `sessions/[id]/+page.svelte` 6,007 lines | C6, C7 |
| F2 | Widget request dispatch is hand-wired; a new `WidgetRequests` kind compiles with no handler and fails at runtime | **C1** |
| F3 | `SessionLayoutV1` has three overlapping sub-documents (`zoneLayout` / `widgetGrid` / `arrangedGrid`); "where is it drawn" has no single reader; `pinned` has two default semantics | C5 |
| F4 | Widget facts in three places: catalogue decl, app `CORE_WIDGET_ROWS`, wire `ModePanel` | **C2** |
| F5 | Settings in three stores (`widget_settings.widget_slug` = instance id, preset `widgetSettings`, `layout_settings` pins); merge order in prose | C3 |
| F6 | Scoped sections `session:full`, `persona`, `lore` are `unknown`; `persona` has no supplier; `menu` is a stub | C4 |
| F7 | `messages` (5,112 lines) runs on a private dossier path, view-only, no invoke gate; the contract has never carried a conversation | C8 |

Order: **C1 → C2 → C3 → C4 → C5 → C6 → C7 → C8.** C1–C4 are cheap and remove the silent-failure
modes; C5–C7 are the structural splits; C8 is the long tail and may be deferred past 0.7.

---

## C1 · One typed request table (F2) — S

**Goal.** A `WidgetRequests` kind with no page handler does not compile.

- New `src/lib/client/components/sessionPage/requests/index.ts` exporting
  `buildWidgetRequestAnswerer(deps): WidgetRequestHandler`, built from
  `const table: { [K in WidgetRequestKind]: Answerer<K> } = { messages: answerMessages, … }`.
  The mapped type is the law: a missing key is a type error; an extra key is a type error.
- `deps` is one object (page stores, modals, socket) so answerers stop closing over page locals.
  Each existing `answerX` keeps its signature; the table adapts.
- `+page.svelte` loses its 27 imports and the inline `switch`; it calls
  `guardWidgetRequests(buildWidgetRequestAnswerer(deps))` once.
- Law test: `requests/index.test.ts` asserts `Object.keys(table)` equals the SDK's request-kind
  list (export `WIDGET_REQUEST_KINDS` from `sdk/src/widgets.ts` beside `WIDGET_BASE_SECTIONS`,
  derived from the table so it cannot drift).
- SDK: `+ WIDGET_REQUEST_KINDS` (additive). Both exhaustiveness tests reference it.

**Done when** adding a dummy kind to `WidgetRequests` turns `tsc` red in two places and nowhere
else.

## C2 · One declaration source (F4) — S

**Goal.** A core widget is declared once, in the catalogue.

- `WidgetDecl.layout` (⏳ in `sdk/src/layout.ts`) is already the home for `span/minInline/minBlock`.
  Move the five rows' hints from `CORE_WIDGET_ROWS` into each catalogue decl's `layout`.
- `defaultActive` is a *layout* fact, not a widget fact: it is already expressed by whether the
  genre layout places the widget. Delete the field; `coreWidgets.ts` derives "active" from the
  resolved layout (it already has `drawnIdsOf`).
- `coreWidgets.ts` becomes a pure projection `CORE_WIDGETS → ModePanel[]` with no literals.
  Law test: for every decl, the projected row's `title/icon/layout` deep-equal the decl's.
- Wire: `Sockets.Sessions.View.ModePanel` (`sockets/types.ts:3575`) stays as the transport shape but
  is re-typed as `Pick<WidgetDecl, …> & { instanceId? }` so a field added to the decl flows without a
  second edit. `res.panels` (already marked REMOVE 0.7.0) goes now.
- NOMENCLATURE §25 row: `CORE_WIDGET_ROWS` retired.

**Done when** `grep -rn "HeartPulse\|minInline" src/lib/client/components/sessionPage/` returns nothing.

## C3 · One settings reader and an honest column name (F5) — M

**Goal.** `effectiveWidgetSettings(instanceId)` is the only function that knows the merge order, and
the column that holds an instance id is called that.

- The merge today: decl defaults ← preset `widgetSettings[instance]` ← person's `widget_settings`
  row ← (styles) `layout_settings.widgetStyles[instance]`. Make `effectiveWidgetSettings`
  (`shared/widgets/settings.ts:340`) take all four as explicit inputs and be the single call site
  on both server (`seatedWidgetSettings`) and client. Delete every other inline merge
  (grep `widgetSettings?.[` and `widgetSettings[`).
- Rename `widget_settings.widget_slug` → `widget_instance_id`. **Generated** migration
  (`db:generate`), index > current max ([[feedback_migration_index_must_exceed_applied]]); 0.6 is in
  users' hands so the Drizzle rename must be a `RENAME COLUMN`, not drop/add. Decl-pruning
  (`pruneWidgetSettings`) keys on the widget id read through `widgetOfInstance` — unchanged.
- Move style pins out of `layout_settings` into `widget_settings` as a reserved key `$style`?
  **No** — a pin is per *mount* and layout-scoped by ruling (2026-09-28). Keep the store; document
  the three stores in one table in `docs/session-layout.md` and in the schema comment, and make the
  reader the proof.
- Tests: `settings.test.ts` gains the four-input merge cases; one int test on the renamed column.

**Done when** the word "merged under" appears in exactly one source comment.

## C4 · Finish the envelope (F6) — M

**Goal.** No `v1: unknown` in `WidgetScopedSections`; every verb in `WidgetVerbs` does something.

- `persona`: type `SessionPersonaV1 = SessionCharacterV1 & { isPersona: true }` (it is already a
  member of `characters.v1`); supplier = the page's characters projection filtered to `mine &&
  isPersona`. Small, closes "declared; no host supplies it".
- `lore`: it is a *grant*, not a section (the doc comment says so). Make the type say so:
  `lore: { section: 'lore'; v1: { granted: true } }` — present means granted. Removes the
  "unknown means not yet" ambiguity.
- `session:full`: the dossier (`shared/widgets/conversation.ts`, 17 lines, 🚧 C7). Type it as the
  dossier interface core's conversation already consumes — read `MessagesWidget.svelte`'s props
  and write that shape down. No behaviour change; the `unknown` becomes a name.
- `menu(spec) → pick`: implement on `WidgetHost` with the app's existing anchored Popover; frames
  get it over the port (the union already carries the kind). Or **retire** the verb if no widget
  wants it in 0.7 — ask the owner (Q1). Recommend retire: nothing has asked for it in six weeks.
- SDK: all additive except the possible `menu` retirement (⏳ then REMOVE 0.7.0).

## C5 · One layout reader (F3) — L

**Goal.** One function answers "what does this layout draw, where" and the three sub-documents
become **inputs** to it rather than three truths.

- SDK `sessionLayout.ts`: `resolveDrawn(layout, box): DrawnLayout` returns, per zone, an ordered
  list of `{ instanceId, box?: ArrangedItem, pinned: boolean, group?: string }` with **one**
  `pinned` semantics (absent ⇒ pinned, as `ArrangedItem` already reads; `GridWidget.pinned` is
  normalised on the way in). Precedence (arrangement wins over list when both exist, the width
  ladder when neither) is written **once**, with its reason, in that file.
- App: `arrangedGeometry.ts`, `sideRail.ts`, `sideSlot.ts`, `tuckedSides.ts`, `primaryFloor.ts`,
  `panelWidgets.ts`, `channelClaims.ts` read `DrawnLayout`, not the raw slots. Their *geometry*
  (cells → px, slot inline/margin/stowed) stays; their *reading* of the document goes. Target:
  `grep -rn "zoneLayout\|arrangedGrid\|widgetGrid" src/lib/client/sessionLayout --include=*.ts |
  grep -v test` drops from today's count to the editor's write sites only.
- The editor writes the document; the renderer reads `DrawnLayout`. No format change, no migration,
  no v2 revival (owner L1 2026-09-28 stands).
- Tests: port the existing `arrangedGeometry/sideRail/primaryFloor` cases to run through
  `resolveDrawn`; add property test: for every shipped genre layout and every `plans/` fixture,
  `resolveDrawn` is total and places the primary.

## C6 · Split `SessionLayout.svelte` (F1a) — L

**Goal.** No session-layout file over 1,200 lines; renderer and editor never share a `$state`.

Cut along the file's own section headers (lines 506–3721 script; 3795–4607 snippets; 5231–6160
styles):

| New file | Takes |
|---|---|
| `SessionLayoutRender.svelte` | the drawn layout, `middleWidget`/`sideZone`/`stripZone`/`tabGroup`/`arrangedSide`/`sideMount` snippets, the no-reload side mounts, tucked sides, pop-overs |
| `SessionLayoutEditor.svelte` | edit mode, Move tab, gridstack items, the connector, Start-from, Save-as, confirm dialogs |
| `sessionLayoutModel.svelte.ts` | the resolved/drawn layout store (`$derived` over `resolveDrawn`), measured width, simulator, side rail model |
| `widgetSettingsFlow.svelte.ts` | per-widget settings + style mode (already self-contained at 1255–1437 and 3022–3480) |
| `mobile/` | `MobileLayoutEditor.svelte` (exists), mobile side panels |

- Rule: the renderer takes `drawn: DrawnLayout` + `actionDispatch` + `coreVerbs` as **props**
  ([[project_widget_contract_unified_2026_09_17]] — never a context). The editor emits a new
  `SessionLayoutV1`; the page persists it. `widgetMounts.test.ts` (source-read law) is updated to
  the new file names and keeps biting.
- Styles: the 930-line `<style>` splits with its markup; `messageLayouts.css` untouched.
- Verify: the iframe-counter no-reload probe (1838→1000→1838) and the five packs × two orders ×
  390px screenshots, as the Stage build did.

## C7 · Split `sessions/[id]/+page.svelte` (F1b) — L

**Goal.** The page is a composition root under 800 lines.

- After C1 the request table leaves. Then, by concern: `sessionPageData.svelte.ts` (socket
  listeners → domain contexts, per [[feedback_sockets_and_toasts_centralized]]),
  `sessionPageProjections.ts` (characters / state / turn-order projections the envelope needs —
  `projections/` dir exists), `SessionHeader.svelte` (exists), `SessionSettingsSheet.svelte` (the
  Participants/Settings/Author's note/Session data tabs), `scenesFlow.svelte.ts` (the five
  `Sockets.Scenes.List` call sites at 4234–4859).
- One listener per event, registered through the domain context, as the pilot ruled.
- Verify: `sessionStream.dom.test`, `scenePins`, `composerDraftClear`, `retakeConfirm` dom tests
  unchanged and green.

## C8 · The conversation on the public contract (F7) — XL, deferrable

**Goal.** `messages` could be cloned. Today it cannot because it reads the dossier directly and
runs with no invoke gate.

- Step 1 (with C4): name the dossier type. Step 2: every dossier field becomes either a base
  section (already there: messages, actions, viewer, turnOrder), a scoped section (`session:full`
  shrinks to what is *not* already a section), or a request (the composer's `send/draft/attach-*`
  already are). Step 3: `MessagesWidget.svelte` reads only `ComponentContext`; the special
  unprefixed `#message-<id>` ids become a `reads: ['anchors']`-style host service or are accepted
  as the one core-trust exception, documented. Step 4: drop `CORE_VIEW_ONLY_COMPONENTS` for
  `messages`.
- Split the 5,112-line component along `SessionMessage` / `SessionComposer` / `MessageControls` /
  `StateProposalList` which are already files; the win is the data path, not the file count.
- Only after C1–C7; may slip to 0.7's SDK stabilisation ([[project_sdk_1_0_ships_with_0_7]]).

---

## Open rulings

- **Q1** `menu` verb: implement or retire (recommend retire, ⏳ then REMOVE 0.7.0).
- **Q2** `widget_settings.widget_slug` → `widget_instance_id` now (a 0.6.x migration on
  distributed data) or at the 0.7 squash as previously noted. Recommend now: the rename is one
  statement and the misnomer misleads every reader.
- **Q3** C8 in 0.6 or 0.7.

## Verification, once, at the end

`npm run sdk:build` → `npm run sdk:test` → `npx tsc --noEmit -p .` → `npm run check` →
`npm test` → `npm run test:budgets` → dev instance on a scratch port: Chat, Adventure, Lair at 1280
and 390, layout editor round-trip (add / move / remove / Start from), style save, no-reload probe.
Then docs: `session-layout.md` (three stores table), `sdk/guides/widgets.md` (request table law),
STYLE-GUIDE unchanged, NOMENCLATURE §25 rows (`CORE_WIDGET_ROWS` retired, `widget_instance_id`,
`DrawnLayout`, `menu` if retired).
