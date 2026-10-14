# PLAN — Split the Connections view into Models and Connections (2026-10-11)

**Status: BUILT + VERIFIED 2026-10-11, uncommitted.** L1–L4 landed. svelte-check/tsc clean except 2 pre-existing errors from the concurrent widget-API work (SDK not rebuilt); full suite 16,637 pass, 6 fail all in that work. Browser walk: screenshots in the session scratchpad `shots/split-*.png`. Soft spots: ModelDetailView hero says "Model"; managed runtimes keep their own Get tab; models-list `canUse` ignores the local-ONNX-unavailable reason.

Owner, 2026-10-11 (after reverting the same day's Models merge): "Restore the sampling sidebar. Let's split
models and connections so model management UI is less complex." Picked from previews:
**two rail views**; **the model finder and the downloads tray live in Models**.

Supersedes the view half of `PLAN-models-view-admin-bridge-2026-10-11.md` (its job sheet, admin doors and
readiness strip stand). The Sampling view is restored and stays. Structural map used for this plan: the
Explore report of 2026-10-11 (ConnectionsSidebar 2735 lines, ConnectionIndexView 1601).

## The two views

**Models** (rail key `models`, URL `/models`, title "Models", icon `Boxes`; admin-only like today's).
"Make my sessions work." Top to bottom:
1. Toolbar: label *Models*; primary **Get a model** (the finder, as the dialog it already is); filter input;
   a job scope menu (All · Chat · Images · Embeddings · Entities) that narrows the list.
2. **Status strip** (chat) and **jobs grid** — moved from the Connections index unchanged, each tile opening the
   **job sheet** (`JobPickerDialog`, kept whole).
3. **The models list** (new `ModelsListView.svelte`): every model of every connection, one `ModelRow` per model,
   flat, sorted by name, each row with its connection as a small chip, its capabilities, the gold default mark(s)
   (`defaultsByModel`) and **Use** (`useModelOn` semantics through the shared `chooseJobModel`). A row opens
   `ModelDetailView` as the detail pane (`PanelSplit` list + detail, like Sampling). The **Defaults ledger**
   filter moves here. **Add a model by name** (the index's dialog) moves here as a toolbar menu item.
4. **Downloads tray** at the foot (`DownloadsTray` + its popover), moved from the index.
5. Dialogs mounted here: the job sheet, the finder, **Set up chat** (`SetupChatFlow`), Add by name.
6. Empty state (no connections): the status strip's **Set up chat** (KoboldCPP stepper) and one line
   "Or add a connection to a service or a server you run" → opens Connections (`openPanel({key:"connections"})`).

**Connections** (key `connections`, unchanged URL/title/icon). "Where models run." Keeps: AddMenu
(A connection · KoboldCPP · Ollama; the Get-a-model and by-name items leave), filter + list/cards, the two groups
of rows, the first-run doors "Where should the writing happen?" (its KoboldCPP door now opens Models' stepper via
`digest.connectionsDoor = "setup-chat"`), the connection level (status card, Models tab with Use, Settings,
managed runtimes, ONNX endpoint, stop scripts), the model level reached from a connection. Loses: status strip,
jobs grid, folded job chips, "Later, optionally", downloads tray, finder dialog, job sheet, SetupChatFlow,
Defaults ledger filter, Add-by-name dialog, the Get-a-model toolbar button.

## Shared state → one domain context (owner rule 2026-10-05, pilot `contexts/characterImports.svelte.ts`)

`src/lib/client/contexts/connections.svelte.ts` — `provideConnections(deps)` in both shells
(`Layout.svelte` beside `provideCharacterImports`, `AccessibleShell.svelte`), `CONNECTIONS_CONTEXT = "connectionsCtx"`.
It is the ONE subscriber for: `connections:list` (+`:error`), `connections:modelDownloadProgress` /
`downloadModel` / `cancelModelDownload` (the `local` patches), `connections:syncModels` (+`:error`),
`connections:setDefault`, `connections:create` (+`:error`). It owns and exposes (reactive getters):
- `list` (sorted by name), `listed` (rows with an id), `loading`, `requestList()`.
- `syncingIds`, `syncingAll`, `requestSync(id?, force?)`.
- `chooseJobModel(job, pair)` with `useStarConfirm` inside (`getDefaults` from systemSettingsCtx, `modelOf`
  from the list, `commit` = one `connections:setDefault` per move, `pendingChoice` → ONE success toast when the
  last ack lands, the sr announcement via a registered listener). `stars.embeddingDialog` / `entityDialog`
  are rendered ONCE by a new `components/connections/ConnectionsDialogs.svelte` that each shell mounts.
- `useModelOn(row, modelId)`, `useLabelOf(model)`, `chatPair`, `defaultsByModel(row)`, `currentDefaultModel(cap)`.
- Listener registrations: `onConnectionsCreated`, `onConnectionsCreateFailed`, `onDefaultSet`, `onSynced`.
- Toasts: the sync warnings/errors, the setDefault success, create errors — here only; the sidebars' copies go.
  Add each `:error` the context toasts to Layout's `HANDLED_ERROR_EVENTS`.
- The optimistic `systemSettingsCtx.capabilityDefaults` patch moves here from `handleConnectionsSetDefault`.

`src/lib/client/components/connections/liveStatus.svelte.ts` — `useLiveStatus(rows, {admin})`: the
koboldcpp/ollama/vectorization/ner status interests and the `reaskLocalOnnx` effect now inside
ConnectionIndexView (559–704), returning `statusOf(connection)`, `factsFor(entry)`, `kcpp`, `ollamaById`,
`embeddingLane`, `entityLane`, `entitiesBlocked`. Both views call it; readiness (`readinessRows`, `chatFacts`,
`buildJobTiles`, `handleReadinessFix`) is computed from it in Models; row status in Connections.

What stays per view: `connections:get/update/delete/createModel/updateModel/test` and the draft/nav machinery
(Connections); `pickerJob`, `finderOpen`, `setupChatOpen`, Add-by-name (Models).

## Doors (digest) after the split

| Door | Goes to |
|---|---|
| `connectionsJob`, `connectionsDoor: "chat"`, `"setup-chat"` | **Models** |
| `connectionId`, `connectionsModality`, `connectionsDoor: "service"`, `"local"` | **Connections** |

Callers to retarget: `routes/+page.svelte` (`openConnectionsDoor` 839, plain opens), `SamplingSidebar.svelte:352`,
`sessionPage/ReadinessStrip.svelte:48`, `admin/railDoors.ts` (`openInModels` → key `models`; new
`openInConnections` for `connectionId`), admin Connections Page/IdPage rows → **Open in Connections**
(`Icons.Cable`), Defaults rows keep **Open in Models**, `shell/openJumpHit.ts:163` (connectionId → connections).

## Lanes

- **L1 — context + live status extraction (first, alone).** Build `contexts/connections.svelte.ts`,
  `ConnectionsDialogs.svelte`, `liveStatus.svelte.ts`; provide in both shells; switch ConnectionsSidebar and
  ConnectionIndexView to consume them with NO visible change. Tests: a dom test for the context (pattern:
  `characterImports.dom.test.svelte.ts`), existing sidebar/index tests still pass.
- **L2 — Models view** (after L1): `sidebars/ModelsSidebar.svelte`, `connections/ModelsListView.svelte`,
  `connections/modelsList.ts` (+test: flat rows, scope filter, sort), `routes/models/+page.svelte`,
  `VIEW_ROUTES.models`, Layout registration (order: models, connections, sampling, pipelines, settings), the
  `sidebarView` branch, door routing above, `railDoors` + admin pages, ReadinessStrip, SamplingSidebar,
  `routes/+page.svelte` callers. ssr test for the Models index.
- **L3 — Connections slimming** (after L1, parallel with L2): remove the moved pieces from ConnectionsSidebar and
  ConnectionIndexView (list above); the first-run KoboldCPP door and any `onSetUpChat` path open Models' stepper
  through the digest; AddMenu loses Get-a-model/by-name; update `connectionsList.dom.test`, `indexRows.ssr`,
  `firstRunDoors.ssr`, `newViews.ssr`.
- **L4 — docs + vocabulary** (after L2/L3 land): `docs/connections.md` (two views), `getting-around.md`,
  `coming-from-sillytavern.md`, `connect-a-model.md`, `getting-started.md`, `sessions.md`, `troubleshooting.md`,
  `users-and-accounts.md`, `embeddings-and-rag.md`, `system-settings.md`, `android.md`; NOMENCLATURE §10
  (**Models** = the new view; **Connections** row; **models list**; the **Sampling view** un-retired in §23
  with a note), §25 entry; STYLE-GUIDE Tune list.

## Verification (once, at the end)
`npm run check` · `npx tsc --noEmit -p .` · `npm test` · docs build · browser walk on an isolated instance:
rail order, Models empty state → Set up chat, Models list Use, finder from Models, downloads tray, job sheet,
Connections rows → connection → model, admin doors, readiness strip → Models.
