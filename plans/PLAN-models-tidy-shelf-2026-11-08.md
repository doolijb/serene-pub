# PLAN — Models view: Tidy shelf (A1) with grouping options — 2026-11-08

Design: artifact "Model Shelf Alternatives" v2 (https://claude.ai/code/artifact/c6a2f1f1-8d0a-48a6-95ae-0d0e01a0b179), variant **A1 · By where it lives**. Challenged once (plan-challenger, 2026-11-08); objections 1, 2, 4, 5 accepted, 3 ruled by the owner (below).

## Owner rulings (2026-11-08, this session)

- **GO:** "Lets do A1 and add the 'By what it's for' and 'By runtime' as sorting options."
- **★1 fold:** a service connection with **more than 12 models** starts folded on every visit, no setting. Its models that sit in a loadout always stay visible.
- **★2 Hub card:** fetched **only when the finder model page opens**, cached **one day**. (The plan's "shared Hub limiter" premise was wrong — each search has its own `loginRateLimit` key; the card gets its own key `models:hubCard`, so browsing pages never spends the searches' allowance.)
- **Group by:** a **Group by** radio set in the list's existing filter popout, **remembered per browser** (like the memory tier). Default **Where it lives**. Options, labels ruled: **Where it lives** · **What it can do** · **Connection**. (*What it's for* is `MODEL_PURPOSES`' label, NOMENCLATURE.md:748; *runtime* means a program the pub runs, NOMENCLATURE.md:705.)
- **Extras:** the two extra groupings **regroup only** — same rows, same tray and toolbar count; no per-group doors, no "Reply runs …" line.
- **Catch-all:** an enabled row with no satisfiable capability joins the last group, whose label becomes **Can't be used right now** (was the set-aside rows only); each such row's meta line says why.
- ★3 (lead decided, within scope): STYLE-GUIDE §6.3 gets the sentence-menu pattern in the same change.

Binding older rulings: model library D1 (10-29, one surface outside Admin; "skip the model segregation", Part 2 stays ideas — nothing here touches runtime-last, Serve on, or storage); Models view is **inventory only** (I12, 10-12); quants always choosable (D2), presence on every row (D3); memory tier per browser, *Not sure* suppresses fit hints; Hub searches debounced; admin-only; *Library* is taken (§26) — never used here.

## What gets built

### 1. Installed list

1. **Group by** — three groupings, pure functions in `modelsList.ts` with tests:
   - **Where it lives** (default): *On this machine* then *Services* — labels and split from `connectionGroups.ts:48,53` (R5). The background remover is the last row of *On this machine*.
   - **What it can do**: one group per kind the row can do, from `satisfiableCapabilities` — Chat, Images, Embeddings, Entities, Speech, Transcription, labels from the existing capability/finder label helpers (never new words) — then *Cut-outs* for the background remover. A row able to do several kinds is listed under each.
   - **Connection**: one group per connection, named by `connectionNameOf`, local connections first in the Connections index's order, then services; the background remover under *Built in*.
   - In every grouping the last group is **Can't be used right now**: set-aside rows (`isSetAside`) and enabled rows with no satisfiable capability, each with its reason on the meta line.
   - Within a group: name order as today (`compareFlatModels`).
2. **Sits in a loadout** = a loadout's pair names this (connection, model), from `loadoutsList` in `sidebars/ModelsSidebar.svelte:120-132` (the current pair; merged loadouts skipped per `useInMenu.ts:12-13`). Passed into `ModelsListView` as a membership set. Not the gold default mark.
3. **Fold (★1):** a Services connection with > 12 models shows only its models that sit in a loadout, plus a fold line (*312 models · 1 in a loadout* · **Show**) — one per service in *Where it lives* and *Connection*; in *What it can do*, *+ n on OpenRouter* · **Show** in each kind group where it hides rows. Unfold is per service, component state, applies across groupings, resets each visit. **A non-empty filter box ignores folds.** Until `loadouts:list` answers, services fold with no exemptions and the fold line omits the loadout count (never an unfolded flash of 300 rows; SSR tests cover the no-loadouts case).
4. **Sizes:** KoboldCPP and Ollama rows already show quant and size from model facts (`ModelRow.svelte:160-172`, `modelFacts.ts:86,88`). The gap is audio.cpp: `modelsFromPackages` (`AudioCppManagedAdapter.ts:59-75`) declares `facts: { sizeBytes, source: "file" }` from the package size (`audiocpp/packages.ts:404,495`), through the existing sync — **no new wire field**. Ollama rows add *lives in Ollama* (closes BACKLOG ★M1). Group headers on the *On this machine* side and local connection groups show the sum of `facts.sizeBytes ?? local.sizeBytes` they know (omitted when none).
5. **Filter popout:** the kind radios gain **In a loadout** and **On disk**; then a second radio group **Group by**. Narrowings keep today's chip; grouping is not a narrowing and shows no chip.
6. **Remembered grouping:** `localStorage` key `serene-pub:modelsGroupBy`, every access wrapped as `memoryTier.ts` does; unreadable → default.
7. **Toolbar downloads count:** while anything is arriving, a **↓ n** toolbar icon button (title *Downloads*) opens the existing Downloads list, as the tray's **View** does. The tray stays.

### 2. Get a model

8. **Sentence line:** the *For* pill row, the *Download to* pill row and the landing line collapse into one line — *[Chat] models for [KoboldCPP] · sized for [8 GB]* — each part a popover of radios. A part the door fixed is plain text; a disabled destination stays pickable and its reason shows on a line under the sentence; *Not sure* still suppresses fit hints. `destinationsFor` / `pickDestination` / `memoryTier` unchanged.
9. **Finder model page** (`FinderModelPage.svelte`; no UI label — its title is the model's name): a result's name opens it inside the finder pane; Back returns to the results with query and scroll kept. Hero (name, owner, recommended list or Hugging Face, tier chip), description, a facts strip of only the facts known (Parameters, Context, Licence, Languages, Downloads, Updated), the presence line (D3), a **files table** — the quant picker's rows with a fit bar and a radio, pre-selected by `preselectedQuantIndex` — and a footer *To KoboldCPP · models/text* + **Download ‹quant›**. One-file repos show one row; an Ollama library name with no files shows `quantsNote`. **Get** on a result row keeps today's inline quant picker.
10. **`models:hubCard { repo }`** → `{ repo, card?: { license, languages, contextLength, baseModel, downloads, lastModified }, files?: QuantFile-shaped sizes, error? }`, built on the existing read in `hfGgufQuants.ts:86-110` (`fetchHfRepoSiblings`, same URL): that read keeps the card fields; card part cached 24 h by repo; sibling sizes returned too, so a Hugging Face result's files table shows fit. Limiter key `models:hubCard` (own allowance). Admin-only like the searches.

### 3. Docs and vocabulary

11. `docs/connections.md` §§ The Models view, The models list, Get a model, Downloads rewritten for 1–10.
12. STYLE-GUIDE §6.3: the sentence-menu pattern; §6.4: a list group header with a size total.
13. NOMENCLATURE: rows for **finder model page** 🚧, **group by** with its three options and the fold, **Can't be used right now**, `models:hubCard`; §25 ledger entries.

## Lanes

| Lane | Owns | Waits for |
|---|---|---|
| `shelf-A` installed list | `connections/ModelsListView.svelte`, `connections/modelsList.ts` (+test), `connections/ModelRow.svelte`, `sidebars/ModelsSidebar.svelte`, new `connections/modelsGroupBy.ts` (+test), `server/connectionAdapters/AudioCppManagedAdapter.ts` (facts only) | — |
| `shelf-B` finder | `connections/ModelFinderView.svelte`, `connections/finder.ts` (+tests), new `connections/FinderModelPage.svelte`, `connections/QuantPicker.svelte` (only to share the files rows), `server/connections/hfGgufQuants.ts`, a new `models:hubCard` handler + test, `shared/sockets/types.ts` (that event's types only) | — |
| `shelf-C` docs | `docs/connections.md`, `STYLE-GUIDE.md`, `NOMENCLATURE.md` | A and B reports |

## Out of scope

Runtime-last, Serve on, shared storage, Discover shelves, per-group doors, loadout lines, Speech/Transcription in the kind radios, a Downloads tab, any new wire field on model rows, any migration.

## Done means

Targeted tests per lane. Lead's one grouped run: `npx tsc --noEmit -p .`, `npm run check`, `npm test`, `npm run build`. A browser walk on an isolated dev instance.

## Verification (lead, 2026-11-08)

- Built by lanes shelf-A, shelf-B, shelf-C; reports `plans/REPORT-shelf-{A,B,C}-2026-11-08.md`.
- Lead fixes after the lanes: audio.cpp sizes (`audioCppReady.ts`); `MattingModelRow` `inGroup` (no nested heading; the row keeps its own name); `ModelRow` `factLine` declared before use (svelte-check); `models:hubCard` typed and gated (`typedSocket.ts`, `interest.ts`, `gatedEvents.test.ts`); the finder model page's facts strip reads the ONNX list's parameters, licence and languages (`FinderRow.listFacts`, `modelPageFacts`), docs line added.
- `tsc`: clean. `npm run check`: no errors in this change's files (2 errors in `sockets/sessions.ts`, another session's live work). Area tests (connections, sockets, adapters, shared sockets): 148/149 files — the one failure is `stopsWiring.test.ts` flagging `speech/preview.ts` and `speech/speechTarget.ts`, not this change. Full suite timed out at 50 min with 18 failing files, all sessions/seats/pipelines (another session's seat-cast work). `npm run build` blocked by a duplicate `personaOwnersOf` in `sessionPage/projections/attendance.ts` (another session's live work).
- Browser walk (isolated instance :5231, headless Chromium; OpenRouter + Anthropic fixtures): all three groupings, folds (*506 models · 0 in a loadout*, *+ 461 on OpenRouter*), filter finds inside folds, Group by remembered across reloads, the sentence line (no-destination and ONNX readings), the finder model page (facts, precision list, footer Download, Escape back). Not walked: KoboldCPP/Ollama destinations, a Hub card read, an arriving download (no runtime installed on the scratch instance).
- 2026-11-08 owner ★B-2: **Base model** fact added after Parameters when the Hub card names one (`modelPageFacts`, test, docs, NOMENCLATURE rows).
