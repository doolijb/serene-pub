# PLAN — Models view and the Admin bridge (2026-10-11)

**Superseded in part, 2026-10-11:** the view half (R1: Sampling merged into a Connections view renamed Models) was reverted by the owner the same day and replaced by `PLAN-models-connections-split-2026-10-11.md` (two rail views, Models and Connections; the Sampling view restored). The job sheet, the admin doors and the readiness strip stand.

**Status: BUILT + VERIFIED 2026-10-11, uncommitted.** svelte-check 0 errors · tsc clean · 16,614 tests · docs compile · browser walk (screenshots in session scratchpad `shots/`). Deviations: `SamplingDefaultsDialog` unreachable (sheet radio sets one job at a time); admin changelists carry an extra "Open" column; Document view keeps its "Connections" page name.

Owner: "Do it" on the canvas https://claude.ai/artifact/LT4rEjSsw1iwe6t8tA1k1L (8 boards).
Rulings taken as drawn: **R1** merge Sampling into the Connections view, renamed **Models**;
**R2** one editor component per object in both frames (Admin keeps changelist + chrome);
**R3** members get the readiness strip in the session, not a view.

Principle: split by **intent**, not by object. Rail = "make my sessions work";
Admin = inventory (changelists, filters, bulk, used-by, history).

## Facts that shape the build

- Connections, Sampling and Pipelines rail items are already admin-only (`Layout.svelte` ~736–760).
- The admin change forms ALREADY render the shared editors: `admin/sections/sampling/IdPage` uses
  `SamplingValuesForm` + `SamplingEnabledForm`; `admin/sections/connections/IdPage` uses
  `ConnectionTypeForm`, `ModelTable`, `ModelRow`, … So R2 is mostly true; what is missing is the
  cross-links and the sheet.
- `digest.connectionsDoor: "chat"` opens the chat job picker from outside; new
  `digest.connectionsJob?: string` (added to `src/app.d.ts`) opens any job's sheet.
- `connections:list` is gated (admin). `systemSettings:get` has no role check, so a member's shell
  holds `capabilityDefaults` — enough to know whether the chat job is set.

## Lanes

### A — Rail + Models view (Layout, viewRoutes, SamplingSidebar removal)
- `leftNav.connections` title → **Models** (icon `Icons.Boxes`); key stays `connections`
  (URL `/connections`, `openPanel` keys, digest doors, localStorage restore all keep working).
- Remove `leftNav.sampling`, its `leftNavOrder` / `SYSTEM_ORDER` slots, the `{:else if key === "sampling"}`
  render branch, `VIEW_ROUTES.sampling`; `/sampling` resolves to `connections` (alias) so bookmarks and
  a restored tab list with a stale `sampling` key still land somewhere.
- Delete `sidebars/SamplingSidebar.svelte` + `samplingFirstOpen.dom.test.svelte.ts`; keep
  `SamplingValuesForm`, `SamplingEnabledForm`, `SamplingNewDialog`, `SamplingDefaultsDialog`,
  `samplingList.ts`, `samplingFields.ts` (admin + sheet use them). Drop `samplingSidebarMemory` if unused.
- `admin/sections/sampling/Page.svelte:172` `openPanel({ key: "sampling" })` → Lane C replaces.

### B — The job sheet (`connections/JobPickerDialog.svelte`)
Sections in the order drawn: **1 Which model answers** (today's content), **2 How it writes**
(only for jobs whose capability has a sampling shape: `samplingShapeForCapability`), **3 Where this applies**.
- Step 2: radio list of the job's shape's sampling configs (`samplingConfigs:list`), ★ = the job default
  (`capabilityDefaults[cap].samplingConfigId`); picking emits `samplingConfigs:setDefaultFor { id, transforms:[cap] }`
  at once (like Use). Buttons **Edit parameters…** (new `SamplingEditorDialog`: name + `SamplingValuesForm` +
  Choose parameters via `SamplingEnabledForm`, Save → `samplingConfigs:update`; built-in → read-only + Duplicate)
  and **New config** (`SamplingNewDialog`).
- Step 3: pipelines that pick a sampling config of this shape explicitly (`samplingConfigs:usedBy`), each a link
  via `pipelinesSidebarNav.openPipeline(slug)` + `openPanel({key:"pipelines"})`; footer **Open in Admin**
  → `/admin/defaults`.
- `ConnectionsSidebar` consumes `digest.connectionsJob` → `pickerJob = job` once, like `connectionsDoor`.
- Pure helpers in `connections/jobSheet.ts` with tests; dialog `max-w-xl`.

### C — Admin cross-links ("Open in Models" / "Open in Pipelines")
- Admin › Sampling changelist row + change form header action: **Open in Models** → sets `digest.connectionsJob`
  to the first job the config is default for (else no job) and opens `connections`.
- Admin › Connections changelist row + change form: **Open in Models** → `digest.connectionId = id`, open `connections`.
- Admin › Defaults rows: **Open in Models** → `digest.connectionsJob = capability`.
- Admin › Genres and › Presets change forms: **Open in Pipelines** via `pipelinesSidebarNav` + `openPanel({key:"pipelines"})`.
- Replace the stale `openPanel({ key: "sampling" })`.

### D — Readiness strip in the session (members and admins)
- New `sessionPage/ReadinessStrip.svelte` above the composer field, shown only while the chat job
  (`text->text`) has no model in `systemSettingsCtx.capabilityDefaults`. Same dot/words as `StatusStrip`:
  gold dot, "Sessions can't reply yet. No model is set up for chat." Member: "Ask your administrator."
  Admin: **Set up chat** → `digest.connectionsDoor = "chat"` + `openPanel({key:"connections"})`.
- Pure `readinessStrip.ts` (state from defaults + role) with tests.

### E — Docs, NOMENCLATURE, STYLE-GUIDE
- `docs/connections.md`: view is **Models**; the sheet section; Sampling configs reached from a job's sheet
  or Admin › Models › Sampling (no rail item). `docs/getting-around.md` rail list. `docs/coming-from-sillytavern.md:99`.
  `docs/sessions.md` strip sentence. `docs/system-settings.md`/`troubleshooting.md` where they say "Sampling view".
- NOMENCLATURE §10: **Models** (view; code key ⏳ `connections`), **job sheet**; §23 retire **Sampling view**
  (the rail place); §25 ledger entry. STYLE-GUIDE: only if a pattern moved.

## Verification (once, at the end)
`npm run check` · `npx tsc --noEmit -p .` · `npm test` · screenshots of Models index, the sheet, a member session strip.
