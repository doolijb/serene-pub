# INVENTORY — split plan for the five files every lane collides in (read-only analysis, 2026-11-15)

Line numbers are of commit `0a293a6a` + the working tree at the time; re-verify in each brief. Mechanical moves
behind unchanged exports; no behaviour change. Sizes: `bindings.ts` 10,363 · `host.ts` 13,150 · `sessions.ts`
12,549 · `narrativeGraph.ts` 6,194 · `EditSessionForm.svelte` 4,167.

## 1. `src/lib/server/pipelines/runtime/bindings.ts` — first

Already built to be split: `coreBindings(run)` spreads 13 groups from sibling files (~4284–4312); 6 non-test
importers (73 in all); no handler key appears twice; handlers depend only on `run`; moves are checked at run
time by `bindingCompat`, `declaredReads`, `readsPairing`. Pattern: a new file exports `xBindings(run?)` and
`coreBindings` spreads it; types from the leaf `./bindingTypes`.

Hazards: **`boot/readsPairing.test.ts` ~24–28 lists its files by name**; every new `bindings.*.ts` must be added
or its checks silently stop; its indirect check looks up a shared handler's declaration in the same file as the
registration (`loreFor` moves with the lore lanes; `generateBinding` / `generateJsonBinding` with providers).
New files import shared helpers from a shared module, never back from `bindings.ts` (a `const` read at module
load, e.g. `RECALLED_LINES_SHARE` ~1410, could fail in a cycle). Public names stay importable from `bindings.ts`
(`coreBindings`, `castEntityRefs`, `SHARED_CORE_HANDLERS`, `boundTypeIds`, `SEMANTIC_SEARCH_SOURCES`,
`exclusionsFrom`, `selectJsonPaths`, `searchByMeaningDecision`, `UNPLAYED_ON_MAIN_REFUSAL`).

Steps (size of `bindings.ts` after):
1. `bindings.shared.ts`: `STATUS` 77–96, 335–892, `readsOfDescriptor`, `resolveAddresseeName`, `stepSlots`,
   `speakingCharacterId`, `committedOrHalt` → ~9,650
2. `bindings.prompt.ts` `promptBindings()`: 5543–6724, 9566–10204, 10209–10235 + helpers 1423–1468, 1501–1542,
   1923–1926 → ~7,700
3. `bindings.retrieval.ts`: 917–1276, 1401–1416, lore / vector / entity / docs 2752–4236, 4329–4412; export
   `LORE_LANES`; re-export `SEMANTIC_SEARCH_SOURCES` → ~5,300
4. `bindings.turnOrder.ts`: 1380–1400, 1716–1806, 4595–4806; export `TURN_STRATEGIES` → ~4,950
5. `bindings.providers.ts`: 1874–2344, 6725–7090, `run-tool` 7500–7566 → ~4,050
6. `bindings.outlets.ts(run)`: 8706–9565 → ~3,200
7. `bindings.summarize.ts(run)`: 7091–7499, 7567–8688 → ~1,350

## 2. `src/lib/server/pipelines/runtime/host.ts`

`createHost` is one closure 2273–12907 (`read` 3966–7551, `call` 7553–8362, `commit` 8364–12853). Mutable state
`liveChannel`, `liveRowId`, `turnMessageId` is assigned only by `create-message` and `update-message`: those stay
inside. 151 importers; three tests `vi.mock(".../runtime/host", importOriginal)`: callers keep importing from
the `host` path. Existing cycle with `loreSources.ts` / `loreMatch.ts`.

Steps: (1) `host.types.ts` 179–539 + `HostScopeError`, `CoreHostServices`, `ChannelShaping` → ~12,780;
(2) `host.loreWrites.ts` 1353–2239 (the `embeddingModule` cache goes to the helpers module; one copy) → ~11,890;
(3) `host.helpers.ts` 542–1338, 12918–13150 → ~10,850; (4) `host.read.*.ts` for `lorebook_entries`,
`session_cast`, `summarize`, vector / entity cases as functions taking `{db, scope, host, node, q}` + the cache
→ ~8,300; (5) `host.call.ts` 7553–8362 → ~7,500; (6) riskier: lore-writer inner helpers 2304–2841 into a
factory with a getter for `turnMessageId`, then commits 11786–12773 → ~6,000.

## 3. `src/lib/server/sockets/sessions.ts`

One entry point `registerSessionHandlers` (12460); 188 importers, 170 tests. Hazards:
**`sessions.fireTurnOnly.test.ts` ~19–22 reads the file's text** for `event: "sessions:fireTurn"` (point it at
the new file when turns move); `ownBooks.fold.int.test.ts` mocks `./sessions` (`pushSessionToParticipants`:
keep the re-export); keep registration order.

Steps: (1) `sessions.shared.ts` (helpers 96–696, relist, `getSessionFromDB`, broadcast 6256–6309, binding check
6385–6610, ~1,400) → ~11,150; (2) messages 8877–10983 → ~9,050; (3) functions / pipelines 2549–3793 → ~7,800;
(4) create 864–2002 → ~6,660; (5) update and draft 6310–7724 → ~5,560; (6) layout 4224–5383 → ~4,420;
(7) turns 10984–11728 + the test path → ~3,680; (8) participants, overlay → ~2,530.

## 4. `src/lib/server/sockets/narrativeGraph.ts`

Module state: `buildResumeStates` / `buildResumeScopes` (build only), `buildsBeingApplied` (apply only). Hazard:
`activity.connectionLeak.test.ts` ~322–343 lists this file and requires a `status: "error",` write (all four are
in build): update its list when build moves.

Steps: (1) shared (~560) → ~5,630; (2) `narrativeGraph.apply.ts` 1862–3571 → ~3,900; (3) merge 4308–6044 →
~2,170; (4) build 815–1814 with its maps + the test list → ~1,170; (5) relationships → ~700.

## 5. `src/lib/client/components/sessionForms/EditSessionForm.svelte`

Used only by `SessionsSidebar.svelte`; 14 tests. Hazard: `noCharacterVisibility.test.ts` ~20–25 reads the source
for `sessions:setCastSeatEnabled` (keep those lines in the parent). Keep listeners in the parent; move markup,
pass state as props / callbacks.

Steps: (1) `SessionVisibilityPanel.svelte` 3881–4026 → ~4,020; (2) actions 3464–3581 → ~3,900; (3) tags
3769–3850 → ~3,820; (4) benched seats 2877–3156 → ~3,550; (5) characters + personas + the two snippets →
~3,170; (6) `sessionSchema` and pure helpers to a `.ts` file → ~3,110.

## Not present in any of the five

No source-hash or snapshot test of these files; no lint rule against cycles; no top-level side effects beyond
constants. For Vite SSR keep one import path per new module; each module-level map or cache lives in exactly one.
