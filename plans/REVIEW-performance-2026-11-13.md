# REVIEW — performance, four passes — 2026-11-13

**Asked (owner, 2026-11-13):** "Do a full review and look for performance improvement opportunities, especially with how
we handle sandboxing" · "estimate improvements without sacrificing security" · "perform another audit and add any
findings" (×3).

**Method.** One lead read the sandbox code end to end and benchmarked it; four read-only sweeps covered the rest. Every
row below carries **M** (measured by the lead), **V** (sweep finding, verified by the lead against the code) or **S**
(sweep finding, line-anchored, not independently verified). Nothing was changed. Bench scripts live in the session
scratchpad, not the repo; the numbers are from this machine, no dev server running.

**Measured baselines**

| path | p50 |
|---|---|
| pipeline script step, trivial body (worker) | 0.33 ms |
| pipeline script step, 64 KB text in | 2.1 ms |
| rules sandbox open + load + 30 calls + close | 1.8 ms |
| plugin hook, tiny bundle | 1.9 ms |
| plugin hook, 64 KB bundle | 7.2 ms |
| plugin hook, 256 KB bundle | 22 ms |
| plugin hook, warm context per plugin (prototype, raw QuickJS) | 0.01 ms in guest |
| 64 KB input as string literal vs guest global | 1.35 → 0.90 ms |
| Liquid expression, fresh engine vs shared | 0.067 → 0.008 ms |
| three 100 ms-budget hook calls behind one spinning hook, shared worker | settled at ~1,000 ms |
| client entry JS (existing `build/`) | 7.5 MB raw, ~1.1 MB gz; node 0 alone 2.7 MB |

---

## A. Sandboxing

| id | status | finding | evidence |
|---|---|---|---|
| A1 | M | Every plugin hook call re-parses the whole bundle plus the 23 KB prelude in a fresh runtime: ~80 µs/KB of bundle. | `src/lib/server/plugins/QuickJsSandbox.ts:287` (buildProgram), `:430` (evalCode per call) |
| A2 | M | One shared QuickJS worker: a synchronous hook blocks every other plugin's calls (head-of-line). Backstop armed at post time, not start; the manager's overrun timer then kills calls that never ran. The script host fixed the same bug 2026-10-19 with a `started` ack (`pipelines/scripts/host.ts:150-170`); the plugin sandbox never got it. | `QuickJsSandbox.ts:1040-1075`, `SandboxManager.ts` (`HOOK_DEADLINE_SLACK_MS`) |
| A3 | M | Input, annex snapshot and vars cross as JSON inside a string literal inside the program: escaped twice, parsed twice. | `QuickJsSandbox.ts:303`, `:329`; `pipelines/scripts/host.ts:264-265` |
| A4 | M | `scripts/run.ts` + `scripts/engine.ts` have no production callers; `test:budgets` and the abuse corpus measure that dead in-process path. The production host has its own interrupt test (`pipelines/scripts/host.test.ts`). | `grep` of importers |
| A5 | V | Storage host walks the plugin's whole directory (`readdirSync` + `statSync` per file) once to check quota and once for the receipt, per file write, synchronously on the shared worker. | `src/lib/server/plugins/storageHost.ts:263`, `:307`, `:195-215` |
| A6 | V | Fetch host buffers the whole response body (`res.text()`) with no byte cap before masking and marshalling. | `src/lib/server/plugins/fetchHost.ts:325` |
| A7 | M | Async drive loop polls every 1 ms while a hook awaits. Idle churn only. | `QuickJsSandbox.ts:538` |
| A8 | V | SES per-call program embeds the input, so V8's compile cache misses for the bundle every call. Opt-in backend. | `src/lib/server/plugins/SesWorkerSandbox.ts:240-270` |
| A9 | V | Plugin invocation log: one row per hook call, no retention; unfiltered admin list orders by `finished_at` with only `(plugin_id, finished_at)` indexed. | `src/lib/server/plugins/store.ts:166`, `src/lib/server/sockets/plugins.ts:1073`, `db/schema.ts:7522` |
| A10 | M | Three near-identical worker-pool implementations; `RuntimeManager.ts` tombstone still imported by two files. | `plugins/RuntimeManager.ts` header |

Checked and fine: receipts (one insert per run, text bounded); SDK executor hashes payloads only under review; long-lived server maps capped or pruned; wire recorder capped; adapters trim SSE buffers; request hook awaits only readiness.

## B. Streaming (per frame, ~8/s)

| id | status | finding | evidence |
|---|---|---|---|
| B1 | V | Each frame persists the full row through `updateLegacyWhere`, which always runs `mirrorRow` (select, upsert, per-revision part upserts); persists are fire-and-forget and overlap. | `pipelines/runtime/liveRow.ts:72`, `:292-316`, `:375-393`; `messages/store.ts:535-551`, `:759-761` |
| B2 | V | Each frame re-queries the session roster (owner, guests, lane recipients) and broadcasts the whole row, swipe history included, to every member. | `liveRow.ts:254-268`; `sockets/utils/broadcastHelpers.ts:245-262`, `:96` |
| B3 | V | Client re-parses markdown + DOMPurify over the whole reply per token. | `client/components/hostElements/SpMessageBody.svelte:27-30`; `client/utils/markdownToHTML.ts:40-49` |
| B4 | V | Every mounted widget deep-clones and re-projects the whole message window per token; the wire re-projects and structured-clones again and JSON-compares session/props/settings. | `client/components/host/RemoteWidget.svelte:200-204`; `client/components/frames/widgetWire.svelte.ts:234`, `:316`, `:309-347`, `:645-676` |
| B5 | S | ~10 O(N) deriveds over all rows per token on the page side. | `client/sessions/store/sessionStore.svelte.ts:62-70`, `sessionPageData.svelte.ts:100-474`, `openSessionView.svelte.ts:14-21` |
| B6 | S | SDK rows each scan all messages per chunk (`hasGeneratingMessage`, `isDiceLine`, `scened.includes`) because the parent replaces the array reference; container and widget rerun ~8 O(N) deriveds per chunk. | `../serene-pub-sdk/core-catalog/components/shared/messages/SessionMessage.svelte:61-66`, `:212`; `SessionContainer.svelte:160-268`; `MessagesWidget.svelte:206-260` |

## C. Turn path (server)

| id | status | finding | evidence |
|---|---|---|---|
| C1 | M | LLM queue has one global lane: one model call at a time across the whole pub. Comment says the key is the one place to change. | `src/lib/server/utils/llmQueue.ts:143-162` |
| C2 | V | Send handler loads the whole main-channel transcript (no limit) only to test the session exists; repeats access check. | `sockets/sessions.ts:8817`, `:2177-2207` |
| C3 | V | Keyword retrieval reruns per lane (world, character, history, triggers): gazetteer regex compile + DF rebuild each time. The book read beneath it IS memoised per run. | `pipelines/runtime/bindings.ts:2762-2824`, `:1094`; `ranking/keywordQuery.ts:501-526`; `host.ts:4685` |
| C4 | V | Handlebars engine created and template compiled per render; once per variable layout per assemble. Liquid likewise. | `pipelines/prompt/renderers.ts:122-159`; callers `prompt/assemble.ts:977`, `entities/variableLayouts.ts:1262` |
| C5 | V | Local tokenizer counts (llama, llama3, mistral, gpt) never memoised; backend counter is. | `pipelines/runtime/tokenizers.ts:114-145`; `connections/backendTokenCount.ts:178` |
| C6 | V | Each landed message counts all earlier turns with two `metadata::jsonb` casts per row and a correlated NOT EXISTS. | `pipelines/routines/moments.ts:109-133`, `:377` |
| C7 | S | Per-dispatch `selectDistinct(metadata->>'narratorName')` over the session; `metadata` is `json`. | `pipelines/runtime/dispatch.ts:579-588`, `:1190`; `db/schema.ts:3010` |
| C8 | S | Ruleset resolve: ~3 queries per owner (`writtenAgoOf`), one per seat (`sessionAsleep`). | `rulesets/resolve.ts:204-205`, `:602`, `:676-679`; `state/resolve.ts:1108-1120` |
| C9 | M | Liquid expression engine rebuilt per evaluation (0.067 ms vs 0.008 shared). Small. | `state/expressions.ts:293-330`, `:382` |
| C10 | S | State write gate: ~30 serialised queries and its own transaction per changed slot; session constants re-read per change; rules double `configFor`/`nextValue`. | `state/write.ts:3520-3535`, `:2750-2796`, `:2571-2594`, `:3614-3620`; `state/resolve.ts:616-680`, `:1155-1174` |
| C11 | S | `sessions:update` / `reassignRemovedParticipant` reload every live row with parts; `sessions:refresh` sends the same 100 rows twice. | `sockets/sessions.ts:7542`, `:8724`, `:6204-6205` |

## D. Lorebooks

| id | status | finding | evidence |
|---|---|---|---|
| D1 | V | `entries:list` carries every entry's full embedding vector (client never reads it) and is re-sent to every reader after every single-entry write. | `utils/lorebookEntries.ts:211-243`, `:234`; `sockets/entries.ts:207-234`, `:413-460`, `:501-515`; `client/lorebooks/bookPatches.ts:58` |
| D2 | V | Every entry save rescans the whole book's content under the book's advisory lock. | `sockets/lorebooks.ts:1188-1252`; `sockets/entries.ts:421` |
| D3 | S | Client replaces the whole type array twice per edit; six whole-book deriveds rerun; bulk vectorize = N full recomputes. | `client/lorebooks/LorebooksWorkspace.svelte:2016-2020`, `:2078-2103`, `:2143-2150`, deriveds `:474-1147` |
| D4 | S | `lorebooks:list` loads every entry row of every book to ship id arrays nothing reads. | `sockets/lorebooks.ts:395-401`, `:474-509` |
| D5 | S | Entry reorder: 2N single-row updates then a full relist. | `sockets/entries.ts:1748-1758`, `:1673` |

## E. Database and boot

| id | status | finding | evidence |
|---|---|---|---|
| E1 | V | No `(session_id, id)` index on `session_messages` or `messages`; page, turn-direction, boundary-watcher and RAG queries filter by session and order by id with a limit. | `db/schema.ts:3181-3194`, `:3386-3388`; `sockets/sessions.ts:4470-4483`; `embedding/ragContext.ts:446-480` |
| E2 | S | Boot runs unmarked full scans every start: `is_generating` (no index), spoken-pending jsonb, cairns regex over history entries, summaries metadata cast. | `startup/index.ts:669-670`; `sessions/derelictReplies.ts:44`; `speech/onMessageSettled.ts:307`; `sessions/dcCairns.ts:156-163`; `sessions/summariesToRoutine.ts:110-112` |
| E3 | S | Registry sync: 300–450 sequential queries every boot, not version-gated. | `pipelines/boot/registrySync.ts:335-367`, `:404-405`; `bootstrap.ts:283` |
| E4 | S | Admin overview scans `pipeline_runs` (no `started_at` index) and `pipeline_run_nodes` (no `definition_id` index) every 60 s while Admin is open. | `sockets/adminOverview.ts:120-130`; `admin/jobUse.ts:85-99`; `db/schema.ts:7047-7083` |
| E5 | S | Migration files read and hashed synchronously several times per boot. Tens of ms. | `db/migrationSet.ts:37-46`; `db/backup.ts:164`; `db/migrationLedgerRepair.ts:93` |

## F. Background, media, sockets

| id | status | finding | evidence |
|---|---|---|---|
| F1 | V | Vectorisation picks one item per full-table scan with an unindexable hash predicate; O(N²) drain; characters hash text per row per scan; one embed call per row. | `embedding/vectorizationQueue.ts:900-912`, `:1118-1212`; `indexing/lane.ts:863` |
| F2 | S | Annotation (NER) lane reloads the whole book vocabulary per picked item. | `annotations/queue.ts:267`, `:309-311`; `annotations/index.ts:434-540` |
| F3 | V | `/media/[id]` reads the file before the If-None-Match check, copies the buffer, no Range. | `routes/media/[id]/+server.ts:186-245`; `media/variants.ts:223` |
| F4 | V | Thumbnails decode (Jimp) and encode (WASM webp) synchronously on the main thread; a whole-frame small WebP returns the source without a variant row and is re-decoded on every later thumb request. | `media/thumbnail.ts:69-111`, `:89`; `media/variants.ts:453-465` |
| F5 | S | Daily backup holds 2–3× the DB in memory and writes with `writeFileSync`. | `db/backup.ts:239-246` |
| F6 | S | Scene-boundary watcher rereads full scene text per walked line; replays whole session. | `scenes/boundaryWatcher.ts:430-441`, `:511`, `:1360-1367`; `routines/moments.ts:240-270` |
| F7 | S | `pushToUser`: one global chain, `isAdmin` query and payload build even for offline users; admin tabs each register a progress emitter (k tabs → k² deliveries). | `sockets/utils/userPush.ts:49-75`; `sockets/vectorization.ts:608-611`; `notifications/store.ts:378` |
| F8 | S | Exports go to every tab and zip already-compressed images on the main thread. | `sockets/characters.ts:2282-2344`; `sprites/charx.ts:119`; `plugins/exportPackage.ts:620` |
| F9 | S | Card-source TTL cache evicts only on a repeat key. | `cardSources/cache.ts:15-28` |
| F10 | S | `sessions:list` reads full card-version rows per seat to keep three fields; two `console.log` per build. | `sockets/sessions.ts:456-468`, `:363`, `:379`; `cast/seatedCast.ts:74-88` |

## G. Client load

| id | status | finding | evidence |
|---|---|---|---|
| G1 | V | Entry JS 7.5 MB raw / ~1.1 MB gz. `Layout.svelte` statically imports every sidebar, Admin, Library and modal (drags CodeMirror and TipTap in); `Icons[name]` computed lookups over `import * as Icons` defeat lucide tree-shaking (2.2 MB chunk). No `manualChunks`. | `client/components/Layout.svelte:9-65`; `client/admin/AdminView.svelte:22`, `:111`; `routes/+layout.svelte:12`; `client/components/CustomThemeEditor.svelte:8-30`; `vite.config.ts:252-288`; `build/client/_app/immutable/nodes/0.*.js` |

## Checked and fine (across passes)

SSR loads nothing heavy; admin sections lazy; avatars by URL; messages list keyed by id; idle routine poll touches memory only; periodic timers cheap and unref'd; per-socket listeners cleaned up; lorebook import batched (200); notifications pruned; user-file packing streamed; plugin asset routes streamed with Range and capped sha cache; `core-ui` ETags precomputed; regex keys memoised; seed sync version-gated; prompt history read bounded; lorebook book read memoised per run.
