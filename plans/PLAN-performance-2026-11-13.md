# PLAN — performance — 2026-11-13

**Status: round 5 GO for R5-1/R5-2/R5-3 (owner, 2026-11-14 "Go for it"; ★R5-4/5/6 open; lanes perf-Q, perf-R, Part 6; R5-1..3 BUILT + verified 2026-11-14). Round 4 DONE + verified 2026-11-14 (Part 5). Round 2 GO (owner, 2026-11-13: all ★ ruled, see Part 3; building P1+P14 → P2 → P7+P15 → P6+small ★s → E-4b). Round 1: GO for the un-★'d steps (owner, 2026-11-13: "Negotiate any workspace you need and coordination with the
other running agent, and start").** Every ★ still waits on the owner; a go does not rule open ★s. Cold-read by a
`plan-challenger` 2026-11-13: five objections, all accepted, folded in below (marked **[C1]–[C5]**). Lanes built and
scope-reviewed 2026-11-13: `perf-A` (W1-a/c + recipients once per run), `perf-B` (W3-a/b/d/h, tests re-pointed),
`perf-C` (W5-b/c/d/e), `perf-D` (W4-a/c/d/h/i; e/f not built, g half), `perf-E` (W8 all but 2 and 4b), `perf-F`
(W1-c page deriveds, W1-d in-lane half, W1-e SDK rows, W6-a closed-set icon maps), `perf-G` (W4-b gazetteer/DF cache,
W7-c/d). Reports: `plans/REPORT-perf-{A,B,C,D,E,F,G}-2026-11-13.md`. Grouped verification (second run, 05:20):
`tsc` clean, `svelte-check` 0 errors, `npm run build` green, `sdk:test` 4689/4696 (7 baseline); full `npm test`
25,048 passed. Third run (after the peer's lore-match SDK rebuild, 11:40): 25,105 passed, 27 failed in 20 files —
the six lore-match failures cleared; every remaining failing file and every source it flags is untouched by the lanes
and unmodified in the working tree (committed pre-pr-8 baseline: speech adapters, `oracle/speak` ports, comment ratchet,
narrateDraft). Nothing ours fails. The peer session `serene-pub-c4`
owns `runtime/host.ts`, `runtime/bindings.ts`, the session store files and the SDK files it listed — my lanes stay off
them and queue changes there in their reports.

**Asked (owner, 2026-11-13):** "Do a full review and look for performance improvement opportunities, especially with how
we handle sandboxing" → "estimate improvements without sacrificing security" → three more audits → "Now estimate total
savings" → "Draft the plan".

**Source:** `plans/REVIEW-performance-2026-11-13.md`. Row ids below (A1, B3, E1 …) are that file's; evidence lives
there. Rows marked **S** there (sweep finding, not independently verified) are re-verified by the lane that takes them
before it changes anything.

**Shape:** Part 1 is the rule every lane follows. Part 2 is the workstreams, each with its rows, its owned files and
its estimated payoff. Part 3 is the rulings needed. Part 4 is order, lanes and verification.

---

## Part 1 — One rule: fewer times, not less work

Every finding in the review has the same shape: the code computes the right thing and computes it too often — per
frame instead of per settle, per item instead of per batch, per call instead of per load, per render instead of per
template. Nothing here changes *what* a turn, a save or a hook produces. A lane that finds itself changing an answer
rather than how often it is computed has left its brief and stops.

Three constraints hold throughout:

- **Security is not traded.** The guest-to-host wall (WASM, no bridges beyond grants), plugin-to-plugin isolation,
  the interrupt and kill path, and the memory cap stay exactly as they are. The one item that touches a *determinism*
  property (W3-c, warm context) is a ★ and ships only if ruled.
- **P1 holds.** No new automatic behaviour. Caches are invisible when correct; every one named here is keyed so that
  a stale answer is impossible, not merely unlikely, and each lane says in its report what invalidates it.
- **0.6 is in users' hands.** Every schema change is one generated migration whose index exceeds the applied max,
  plus a test that a second boot changes nothing. Done-markers for boot tasks follow the same test.

---

## Part 2 — Workstreams

Payoff column: **M** measured, **E** estimated from the code. Per-turn figures are server time beside model latency.

### W1 — Streaming: per frame → per settle (B1–B6)

The largest felt change, and the one that frees the single PGlite connection for every other member.

| step | change | rows |
|---|---|---|
| W1-a | One persist in flight at a time: a dirty flag, not a stacked promise. **[C4]** The store's rule (`messages/store.ts:1-25`) is that every legacy write re-derives the `messages`/`message_parts` rows, and readers already exist (`state/resolve.ts`, `messages/liveHistory.ts`, `sessions/rewind.ts`, `scenes/boundaryWatcher.ts`). So the lane first lists every reader that can see a row still generating. Then: the mid-stream mirror keeps the `messages` row's content honest but skips the per-revision parts re-projection until settle, if `upsertProjection` splits that way; otherwise the mirror stays per persist and the saving is the single-in-flight rule alone. | B1 |
| W1-b | Resolve the broadcast recipient list once per run (invalidated by guest and lane changes); mid-stream frames carry `{id, content, reasoning}`; the full row goes out once when the reply settles. **★P1** names the frame. | B2 |
| W1-c | Client applies the frame as a row patch; `SpMessageBody` parses markdown on a 50 ms throttle while `data-streaming` and once on `generation:end`. | B3, B5 |
| W1-d | `RemoteWidget` / `widgetWire` post a row patch while streaming, the full list only on add/remove; drop the per-token JSON comparisons. | B4 |
| W1-e | SDK: `conversation.svelte.ts` computes `hasGeneratingMessage`, the form-answer set and the `scened` set once; rows read O(1). Container and widget deriveds keyed on `msgOrderKey`; `selectable` gated on `selecting`. SDK edits land in `../serene-pub-sdk`, built with `sdk:build`, never under a running dev server. | B6 |

Payoff: server DB statements per frame ~5 + mirror → 1 (**E** 80–90% less DB time while streaming); roster queries
per frame 2 → 0; payload O(reply) → O(delta); client work per frame from whole-window clones and full re-parse to one
patch (**E** similar factor on long windows).

Files owned: `src/lib/server/pipelines/runtime/liveRow.ts`, `src/lib/server/messages/store.ts` (the mirror call
only), `src/lib/server/sockets/utils/broadcastHelpers.ts`, `src/lib/client/components/hostElements/SpMessageBody.svelte`,
`src/lib/client/components/host/RemoteWidget.svelte`, `src/lib/client/components/frames/widgetWire.svelte.ts`,
`src/lib/client/sessions/store/sessionStore.svelte.ts`, `src/lib/client/sessions/store/openSessionView.svelte.ts`,
`src/lib/client/components/sessionPage/sessionPageData.svelte.ts` (these three are the peer session's until it says otherwise);
SDK: `core-catalog/components/shared/messages/{SessionMessage,SessionContainer,MessagesWidget}.svelte`,
`core-catalog/src/shared/ui/conversation/conversation.svelte.ts`.

### W2 — Model concurrency (C1)

| step | change | rows |
|---|---|---|
| W2-a | `getConcurrencyKey` returns a lane per connection, folding connections that share a base URL into one lane; managed local backends keep a lane of one. **★P2.** `MAX_QUEUE_DEPTH` becomes per lane. **[C1]** The item (`LLMQueueItemInput`, `llmQueue.ts:13-38`) carries only a display name, so both enqueue callers (`pipelines/runtime/dispatch.ts:1429`, `utils/runQueuedLLMCall.ts:58`) must pass the connection id and resolved base URL; the queue's "nothing else needs to change" comment is stale and is corrected. The re-entry guard (`:227`) knows only its own lane: with several lanes, run A on X enqueuing on Y while Y's run enqueues on X deadlocks. The guard must cover every lane the caller's causal chain holds, or any nested enqueue from an active run runs inline. The key is a placeholder for the Servers pages' concurrency setting (owner direction 2026-09-07, `project_model_lane_lifecycle`) and must give way to it. | C1 |

Payoff: **E** throughput scales with distinct *backends*: two members on two different providers go from serialised to
parallel; two members on the same provider still share a lane. Files owned: `src/lib/server/utils/llmQueue.ts`, its
test, `src/lib/server/utils/runQueuedLLMCall.ts`, the enqueue call in `pipelines/runtime/dispatch.ts:1429` (queued
with the peer session that owns the runtime files if it is still busy).

### W3 — Plugin sandbox (A1–A10)

| step | change | rows | security |
|---|---|---|---|
| W3-a | Worker pool (2–4) with per-plugin affinity; port the script host's `started` ack so the backstop arms when a job starts. Bundles re-hydrated into each worker as today. | A2 | improves: smaller kill blast radius |
| W3-b | Input, annex snapshot and vars handed to the guest as a global string and `JSON.parse`d once, in both plugin hosts and the script host. | A3 | none |
| W3-c | **★P3** Warm context per `(plugin, grant set)` per worker: bundle and prelude evaluated at load, hooks called through a fixed door that resets RNG, clock and logs per call. The context is discarded on any timeout, kill or error, and recycled past a memory threshold. **[C2] Deferred by recommendation:** a bundle with module-level state would answer the same input differently depending on what ran before, which worker served it and when it was recycled. That is a P1 break ("same inputs, same result"), not only F11; conformance case 06 (seeded replay) exists for it. | A1 | none to the threat model; breaks P1 determinism unless a replay conformance test gates it |
| W3-d | Storage host measures the directory once when the transaction opens and tracks deltas from its write/remove sets. | A5 | none |
| W3-e | Fetch host streams the body and stops at a cap (**★P4** the number) before masking. | A6 | improves |
| W3-f | Repoint `test:budgets` and `abuse.test.ts` at `runScriptSource` so the budgets measure the production host. **[C5]** Deleting `scripts/run.ts`, `scripts/engine.ts` and `RuntimeManager.ts` is tidiness, not speed: **★P11**, not done by the lane. | A4, A10 | none |
| W3-g | Invocation log retention (**★P5** the policy) and a `finished_at` index (migration, with E1). | A9 | none |
| W3-h | Drive loop waits on `Promise.race` of the pending fetch, the abort flag and the deadline instead of a 1 ms timer. Only if W3-a leaves it standing. | A7 | none |

Payoff: **M** bystander latency under contention ~1,000 ms → ~2 ms; **M** per-call cost 1.9–22 ms → ~0.5 ms with
W3-c, or ~25–35% less marshalling without it; A5 removes O(files) sync walks per write from the shared thread.

Files owned: `src/lib/server/plugins/{QuickJsSandbox,SandboxManager,SesWorkerSandbox,storageHost,fetchHost,RuntimeManager}.ts`
and tests, `src/lib/server/pipelines/scripts/host.ts`, `src/lib/server/scripts/**`,
`src/lib/server/pipelines/runtime/pluginBindings.ts` (import line only), `vitest.budgets.config.ts`.

### W4 — Turn path (C2–C9, C11)

| step | change | rows |
|---|---|---|
| W4-a | Send handler: existence check instead of the transcript load; `fireNarratorResponse` asks `EXISTS(is_generating)`. | C2 |
| W4-b | **[C3]** Only the expensive, input-independent parts are cached: the gazetteer regex and the DF profile, per lorebook and entry-write version. The scan itself (which takes the node's own `params.retrieval`, `currentCharacterId`, `currentCastMemberId`) is not memoised, so no two nodes can share a wrong answer. Lives in `ranking/keywordQuery.ts`; the call site in `runtime/bindings.ts` is the peer session's and is queued if a line there must move. | C3 |
| W4-c | Compiled templates cached by `(engine, source, promptFormat id + updatedAt)`; helpers read `promptFormat` from the cache key's scope. | C4 |
| W4-d | Content-keyed LRU on local tokenizer counts, the same shape the backend counter has. | C5 |
| W4-e | ~~Turn number kept on the lane tally and incremented~~ **Not built (perf-D):** an increment answers differently from the recount after a delete, import or copy. Recount stays; make its query cheaper without changing the answer, later. | C6 |
| W4-f | ~~Narrator labels cached per session~~ **Not built (perf-D):** edits/deletes of narration lines also change the labels; no stale-proof key. | C7 |
| W4-g | `sessionAsleep` reads links once (built, perf-D). `writtenAgoOf` batching needs a new export in `state/resolve.ts`: **deferred to W9**. | C8 |
| W4-h | One shared expression Liquid; filters read scope from the render context. | C9 |
| W4-i | `sessions:update` paths pass `"none"` / `{limit}`; refresh payload carries rows once. | C11 |

Payoff: **E** 100–500 ms off server time per turn, 10–30% off time-to-first-token on local models.
Files owned: `src/lib/server/sockets/sessions.ts` (named handlers only), `src/lib/server/pipelines/runtime/{bindings,dispatch}.ts`
(named functions only), `src/lib/server/pipelines/ranking/keywordQuery.ts`, `src/lib/server/pipelines/prompt/renderers.ts`,
`src/lib/server/pipelines/runtime/tokenizers.ts`, `src/lib/server/pipelines/routines/moments.ts`,
`src/lib/server/rulesets/resolve.ts` (`writtenAgoOf`, `sessionAsleep`), `src/lib/server/state/expressions.ts`.

### W5 — Lorebooks (D1–D5)

| step | change | rows |
|---|---|---|
| W5-a | `entries:list` selects embedding model and timestamp, never the vector (**★P6**, a wire-shape change); `afterWrite` drops the trailing relist for create/update. | D1 |
| W5-b | `syncLorebookBindings` scans only the written entry's old and new content; queries `held` only when that entry has an unissued tag. | D2 |
| W5-c | Client keeps entries in a keyed `SvelteMap` per type; vectorized patches batched per frame. | D3 |
| W5-d | `lorebooks:list` uses `count(*) … GROUP BY` and explicit columns; drops the id arrays. | D4 |
| W5-e | Reorder as two `UPDATE … FROM (VALUES …)`; sends positions, not the list. | D5 |

Payoff: **E** per save 2–4 MB per reader → one patch; O(book) under lock → O(entry).
Files owned: `src/lib/server/sockets/{entries,lorebooks}.ts` (named handlers), `src/lib/server/utils/lorebookEntries.ts`,
`src/lib/client/lorebooks/LorebooksWorkspace.svelte`, `src/lib/client/lorebooks/bookPatches.ts`.

### W6 — Client entry (G1)

| step | change | rows |
|---|---|---|
| W6-a | Explicit name→component icon map for the computed lookups; no `import * as Icons` left on the entry path. | G1 |
| W6-b | `CustomThemeEditor`, `CodeField` and the TipTap fields load with `{#await import()}`; sidebars, Admin and Library views load by active view (**★P7**, a visible loading beat). | G1 |

Payoff: **M baseline** 7.5 MB → **E** ~2 MB raw, ~1.1 → ~0.35 MB gz. Measured again from `build/` after.
Files owned: `src/lib/client/components/Layout.svelte`, `src/lib/client/admin/AdminView.svelte`, `src/routes/+layout.svelte`,
the editor components named, `vite.config.ts` (`manualChunks` only if the measurement still asks for it).

### W7 — Database and boot (E1–E5, A9)

| step | change | rows |
|---|---|---|
| W7-a | **★P8** One generated migration: `(session_id, id)` on `session_messages` and `messages`; partial `started_at WHERE NOT is_preview` on `pipeline_runs`; `definition_id WHERE result='err'` on `pipeline_run_nodes`; partial `WHERE is_generating` on `session_messages`; `finished_at` on `plugin_hook_invocations`. | E1, E4, E2, A9 |
| W7-b | **★P9** Done-markers for one-off boot tasks (cairns, summaries-to-routine, seat keys, and the others the lane confirms are one-shot) in `system_settings`; second boot skips them. | E2 |
| W7-c | Registry sync loads the table once into maps (**built, perf-G**: unchanged boot 413 → 3 queries). The skip gate is **not built (★G1)**: nothing stores a catalogue hash and a version-only gate misses plugin installs; an exact skip is the 3-read comparison the pass now does. | E3 |
| W7-d | Migration set read and hashed once per process, memoised on folder + journal and file stat (**built, perf-G**). | E5 |

Payoff: **E** 0.5–3 s off boot on a large install; the hottest paged reads become bounded index walks.
Files owned: `src/lib/server/db/schema.ts` (indexes only), the new migration, `src/lib/server/startup/index.ts`,
`src/lib/server/pipelines/boot/registrySync.ts`, `src/lib/server/db/{migrationSet,backup,migrationLedgerRepair}.ts`.

### W8 — Background, media, sockets (F1–F10)

| step | change | rows |
|---|---|---|
| W8-a | Vectorisation: fetch K ids per scan into a buffer; stored needs-embedding flag with a partial index (joins W7-a's migration); batch embed; stored hash for characters and relationships. | F1 |
| W8-b | Annotation vocabulary cached per lorebook for the lane run, invalidated on entry/binding writes. | F2 |
| W8-c | `/media/[id]`: ETag from `row.hash` before disk; stream with Range via the `frameHost` responders. | F3 |
| W8-d | Thumbnails: short-circuit on stored width/height/mime; record a "thumb is source" variant (**★P10**, a new variant kind); codec work on a `worker_thread`. | F4 |
| W8-e | Backup piped from `blob.stream()` to a write stream. | F5 |
| W8-f | Boundary watcher keeps running counts; replays from the anchor. | F6 |
| W8-g | `pushToUser`: return early on an empty user room; `isAdmin` from the connected socket; one chain per user; one progress emitter per user. | F7 |
| W8-h | Exports answer the asking socket; images stored at `level: 0`; async zip. | F8 |
| W8-i | Card-source cache gets a size cap and expiry on set. | F9 |
| W8-j | Narrow `cardsNow` variant for `sessions:list`; drop the two `console.log`s. | F10 |

Payoff: **E** O(N²) → O(N) on both backfills; removes multi-hundred-ms main-thread stalls that land mid-stream.
Files owned: per step, the files the review cites; each step is one worker brief.

### W9 — Write gate (C10)

Measurement first. The lane profiles one keeper turn (query count and ms per changed slot) before touching anything,
then builds one per-set context (links, vocabulary, readBy, lore write mode, own-book flag, session lorebook) threaded
through `applyChange`/`setValue`, and runs the set in one transaction with `lockStateVersion` taken once. Largest
refactor in the plan and last in order; may be deferred without affecting the others.

---

## Part 3 — Rulings needed (★)

**Ruled by the owner, 2026-11-13 (second round of questions):**

| ★ | ruling |
|---|---|
| P1 | New scoped event `sessionMessageDelta` (`sessionId, id, content, reasoning`); §25 entry. |
| P2 | Lane key **per connection, per host** (scheme + host + port). Width: local and managed hosts 1; known cloud hosts 4 (a constant, no setting). No admin field now; the key is shaped so the managed-server record can carry a width later ("tie it safely into server management"). Cross-lane re-entry fix and both callers passing the connection. |
| P3 | **Defer.** |
| P4 | 4 MB fetch cap, refused with a named sentence. |
| P5 | Invocation log: keep 30 days or newest 50,000, pruned every 100 writes. |
| P6 | Remove `embedding` from the `entries:list` wire row. |
| P7 | Lazy sidebars and views; shell's existing loading affordance. |
| P8 | One generated index migration above the applied max; second-boot test. |
| P9 | One `system_settings` done-marker key per one-off boot task. |
| P10 | Thumb-is-source variant row; name per §24. |
| P11 | Delete `scripts/run.ts`, `scripts/engine.ts`, `RuntimeManager.ts` alias once tests are re-pointed. |
| P12 | Accept as built. |
| P13 | Keep removed. |
| P14 | Build the `{t:'message'}` row patch in `componentWire.ts` behind a `WidgetWireOptions` flag. |
| P15 | **Curated list static in the entry + lazy per-icon import for every other declared name**, a minimal fixed-size placeholder while loading so nothing shifts. **No warning.** |
| P16 | Keep the reformat. |
| E-2 | Owner: no preference → recommendation stands, not built. |
| E-4b | Build: thumbnail codecs on a worker (pool of one). |
| G1 | Owner: no preference → recommendation stands, not built. |

Build order (owner go, 2026-11-13): (1) P1 + P14, (2) P2, (3) P7 + P15, (4) P6 + P4/P5/P8/P9/P10/P11, (5) E-4b, then W9
measurement. Lanes as before: challenger first, supervised lanes, scope review per lane, one grouped verification.

**Original questions and recommendations, kept for the record:**

| ★ | question | recommendation and trade-off |
|---|---|---|
| **P1** | The mid-stream frame: a new scoped event, or `sessionMessage` with a partial row? | ★ New event `sessionMessageDelta` carrying `sessionId, id, content, reasoning` (NOMENCLATURE §25 entry). Partial rows on the existing event would make every listener defensive. |
| **P2** | LLM lane key. | ★ Per connection id, connections sharing a base URL folded into one lane; managed local backends one lane; the key is a placeholder that the Servers pages' concurrency setting (2026-09-07 direction) replaces when it exists. Trade-off: two connections to one unmanaged local server through a proxy could overlap. Needs the cross-lane re-entry fix and both callers passing the connection ([C1]). |
| **P3** | Warm plugin context per `(plugin, grant set)`. | ★ **Defer** (changed after the cold read, [C2]). It is 5–40× per call and the security boundaries stay, but it breaks P1: a hook with module-level state answers the same input differently by history, worker and recycle time. Take W3-a/b now. If the owner wants it later, a conformance case "same input twice through a warm context gives the same output" gates it, and bundles that fail it run cold. |
| **P4** | Fetch response cap. | ★ 4 MB, refused with a named sentence. Larger payloads belong in `ctx.storage`, not a hook return. |
| **P5** | Invocation log retention. | ★ Keep 30 days or the newest 50,000 rows, whichever is smaller, pruned every 100 writes like notifications. |
| **P6** | Removing `embedding` from the `entries:list` wire row. | ★ Remove; no client reader exists. A published SDK name is the owner's call. |
| **P7** | Lazy sidebars and views add a first-open loading beat. | ★ Accept; use the shell's existing loading affordance, no new spinner. |
| **P8** | One migration for all indexes. | ★ One file, generated, index above the applied max; a second-boot test. |
| **P9** | Done-marker rows for one-off boot tasks. | ★ One `system_settings` key per task, written after the task's first clean run. |
| **P10** | A "thumb is source" media variant. | ★ Record it as a variant row pointing at the source bytes; name per NOMENCLATURE §24. |
| **P12** | A guest removed mid-reply still receives that one reply's remaining frames (recipients read once per run, W1-b as built). | ★ Accept for 0.6; the released row asks the live roster. Else an invalidation hook in the guest/lane writers. |
| **P13** | `lorebooks:list` dropped the unread per-book id arrays `worldLoreEntries` / `characterLoreEntries` / `historyEntries` (W5-d as built). | ★ Keep removed; `entryCounts` carries the counts. Put back behind the grouped count only if a plugin could read that payload. |
| **P14** | Widget row patches across the worker boundary (W1-d). The SDK's `HostFrameMessage` already has a `{t:'message'}` member with no receiver; the fix is a `case 'message'` in `sdk/src/componentWire.ts` that replaces the row by id in `data.messages` and the held channel list, plus a `WidgetWireOptions` flag so `ComponentMount` declares its peer understands it while `PluginFrame` keeps full lists (iframes have no receiver). | ★ Allow both: the member exists and is `@experimental`; the cost is one more protocol semantic and one option name. Without it, widgets keep receiving the whole window per frame (perf-F built the in-lane half: identity checks and per-row projection reuse). |
| **P15** | Five client sites resolve ANY lucide kebab name a plugin, genre, widget or layout declares (`sessionLayoutModel.svelte.ts:350`, `editorMembership.svelte.ts:115`, `surfaces/Panel.svelte:149`, `surfaces/SurfaceGrid.svelte:338/402`, `sessionPage/pressRouting.svelte.ts:620`), so the whole 2.25 MB icon set stays in the entry even with every closed-set lookup mapped (perf-F, W6-a). | ★ (a) a curated set of supported icon names with a P5-style validation warning and a fallback icon for others — a plugin naming an unlisted icon shows the fallback; (b) per-icon dynamic import, which is a lazy load and so falls under ★P7; (c) leave it. Recommend (a). |
| **P16** | perf-F's icon worker reformatted 20 client files with `prettier --write` (~750/290 whitespace lines beyond the icon edits; behaviour unchanged; the files were unclean at HEAD). A restore-and-redo brief exists (`BRIEF-perf-F-w5.md`); the permission system declined running it. | ★ Keep the reformat (the files become prettier-clean) — or authorise the redo, which is scripted. |
| **P11** | Delete the dead in-process script path (`scripts/run.ts`, `scripts/engine.ts`) and the `RuntimeManager.ts` alias whose header asks for its own deletion. | ★ Delete all three once the tests are re-pointed; nothing imports them in production. Tidiness, so it waits for the word ([C5]). |

---

## Part 4 — Order, lanes, verification

### 4.1 Order

1. **M0 — measure.** Before any lane: a scripted turn on a real-shaped session (300 messages, 200 entries, one
   plugin) with timings at the hot points named in the review, saved as the baseline the lanes are checked against.
   The sandbox and bundle numbers already exist.
2. **W1 + W7-a** first: the felt change and the index that most reads want. Independent files; run as two lanes.
3. **W2** (one file, one ★).
4. **W6** (measured from `build/`).
5. **W5**, **W4**: independent of each other; run in parallel lanes.
6. **W3**: after W2 so the queue change is not confused with the pool change in measurements.
7. **W8**, **W7-b/c/d**.
8. **W9** last, after its own profile.

### 4.2 Lanes

Each workstream is one lane under a `lane-supervisor` (Opus) with `lane-worker`s (Sonnet), briefs per step, owned
files as listed, nothing outside them. Briefs ban `git stash`, `/tmp` glob removal, SDK-root `npm`, and
`prettier --write` on a directory. SDK steps (W1-e) carry the `sdk:build` rule and check for a running `vite dev`
first. A `scope-reviewer` reads each lane's diff against its brief; `/code-review` follows.

### 4.2b Round 2 lanes (all ★ ruled 2026-11-13)

At most two supervisors live; order H+I, then J+K, then L. Each lane: supervisor brief at `plans/briefs/BRIEF-perf-<L>.md`, scope review, report at `plans/REPORT-perf-<L>-2026-11-13.md`.

| lane | steps | files owned | notes |
|---|---|---|---|
| **perf-H** | W1-b `sessionMessageDelta` frame (P1); W1-c client applies it as a row patch; W1-d/P14 `case 'message'` in `componentWire.ts` + `WidgetWireOptions` flag; §25 entry | `pipelines/runtime/liveRow.ts`, `sockets/utils/broadcastHelpers.ts`, `shared/sockets/types.ts` (+ `SCOPED_EVENTS`), the sessions socket **domain context** on the client (the one listener for the family), `client/sessions/store/sessionStore.svelte.ts` (`patchCells` only), `client/components/frames/widgetWire.svelte.ts`, `client/components/host/RemoteWidget.svelte`; SDK `sdk/src/componentWire.ts`, `ComponentMount`, `contracts` frame message types; `docs/sessions.md` (streaming paragraph) | Settled row still goes out as `sessionMessage` (full row, live roster). Delta carries `sessionId` (scoped). `PluginFrame` keeps full lists. Needs `sdk:build` at the end: tell the peer, `pgrep` first. Session store is the peer's unless released — ask before the brief. |
| **perf-I** | W2-a lane key per connection per host (P2) | `utils/llmQueue.ts` (+ test), `utils/runQueuedLLMCall.ts`, the enqueue call in `pipelines/runtime/dispatch.ts:1429`, `docs/connections.md` (one paragraph) | Key `(scheme, host, port)` of the resolved base URL; width 1 local/managed, **4** for known cloud hosts (a constant `CLOUD_LANE_WIDTH`, no setting); `MAX_QUEUE_DEPTH` per lane; re-entry guard covers every lane the causal chain holds or a nested enqueue runs inline. The key type is a struct the managed-server record can later populate with a width. No admin UI. |
| **perf-J** | W6-b lazy views (P7); P15 curated static icon set + lazy per-icon import with a fixed-size placeholder, no warning | `client/components/Layout.svelte`, `client/admin/AdminView.svelte`, `routes/+layout.svelte`, the five resolver sites, `client/shell/*icons*`, a new `client/components/icons/LazyIcon.svelte` (name per §24), `vite.config.ts` only if chunking needs it | Curated set = every name the closed-set maps already carry + the names core genres/widgets/layouts declare (lane enumerates and lists them in the report). Placeholder is a same-size empty box, no spinner. First-open loading uses the shell's existing affordance. Measure `nodes/0.*.js` and the lucide chunk before/after. |
| **perf-K** | W5-a drop `embedding` from `entries:list` (P6); W3-e fetch cap 4 MB (P4); W3-g retention 30 d / 50,000 (P5); W7-a one index migration (P8); W7-b done-markers (P9); W8-d variant row (P10); P11 deletions | `sockets/entries.ts` (`toListRow`/list select), `plugins/fetchHost.ts`, `plugins/store.ts` (+ prune), `db/schema.ts` (indexes + variant kind), **the one new generated migration**, `startup/index.ts` and the one-shot boot tasks it names, `media/{variants,thumbnail}.ts`, `scripts/{run,engine}.ts` + `plugins/RuntimeManager.ts` deletions with tests re-pointed, `docs/lorebooks.md`, `docs/plugins*.md` | Only this lane runs `db:generate`. Second-boot-changes-nothing test for the migration and every marker. Entry wire keeps `embeddingModel`/vectorised flag. |
| **perf-L** | E-4b thumbnail codecs on a worker thread | `media/thumbnail.ts`, new `media/thumbnailWorker.ts`, `vite.config.ts` (server worker input) | Pool of one; falls back to in-thread if the worker fails to start, and says so in the log. Starts after J and K because it shares `vite.config.ts` with J. |

W9 (write gate) stays measurement-first and starts after L.

**Round-2 challenger (2026-11-13), five objections:**

| # | objection | answer |
|---|---|---|
| [C6] | P10 pointer row would own a path; `removeVariant` (`variants.ts:186`), cull precondition 1 (`cull.ts:104`) and backfill's stale re-cut (`backfill.ts:133`) would unlink the original. | **accept** — pointer row has no path; cull/backfill added to perf-K's files; tests that the source bytes survive. |
| [C7] | For streamed replies the queue lane is freed before the request is sent (`dispatch.ts:1450` vs `:1525`; adapters' lazy `completionResult`), so the "single global lane" never serialised session replies, and P2's widths would not govern them. | **needs owner → ★P2-b** (below). |
| [C8] | The re-entry set is read at `pump` time, so the next item inherits the previous run's lanes; the drafted cycle check does not close X↔Y. | **accept** — capture at `enqueue`, keep on the Run; test for nested enqueues first; fixed lane order if any exist. |
| [C9] | perf-H's file list missed `shared/sockets/interest.ts` (`SCOPED_EVENTS:80`, `GATED_EVENTS:581`), `gatedEvents.test.ts`, and the handler in `sessionPageData.svelte.ts:1170`; a gated event with no subscriber is dropped silently. | **accept** — brief corrected; peer released those files. |
| [C10] | SvelteKit overrides `build.rollupOptions.input`, so perf-L's server worker entry cannot work; every server worker here is inline source with `eval: true`. | **accept** — perf-L follows `compile.ts:323`; `vite.config.ts` untouched; L no longer waits for J. |

**★P2-b (open, from [C7]):** should a *streamed* session reply hold its host lane for the whole stream? (a) Yes:
dispatch reads the stream inside `execute`, so width 1 on a local or managed host means two members' replies
queue instead of overlapping, and a managed model load can no longer start mid-stream; cloud width 4 caps a busy
pub's concurrent replies at four per host. This is a behaviour change on the main path. (b) No: widths govern
preflight and non-streamed calls only, as today; replies keep overlapping; the P2 payoff is then small. ★ Recommend
(a) — it is what "one at a time on a local server" already claims to mean, and the lane width is the only guard
against two generations on one GPU.

**Ruled (owner, 2026-11-13): ★P2-b = (a), "but offer admin controls over these pools."** Follow-up ruled the same
day: the control is **per host, in Admin → Connections** — a table of every host in use (scheme, host, port) with its
derived default width (1 local/managed, 4 cloud) and an admin override, stored in a new small table keyed by host so
connections sharing a host share the width; one sentence of purpose on the card; members never see it; migration
`0159` generated by perf-I after perf-K's `0158`. This is the first piece of the Servers direction
(`project_model_lane_lifecycle`, 2026-09-07) and must not block the rest of it (a queue never owns model lifecycle).

**★K-3 ruled (owner, 2026-11-14): fix the date pin and the log cap only** — pin `new Date()` to the run start and cap a log line in the production script host (`pipelines/scripts/host.ts`), each with a test; the four other cases are already enforced by the chain (`chains.ts:516-548`: undeclared subject → read-only, value kept; `validShape` refuses a scalar where an object is declared) and are listed as `it.todo` pointing there. Lead builds it (two files). **BUILT 2026-11-14:** `host.ts` guest prelude pins a bare `new Date()` / `Date()` to the run start beside `Date.now` (explicit dates untouched) and cuts a log line at `SCRIPT_LOG_LINE_MAX = 1024`; `abuse.test.ts` gains the two tests and four `it.todo`s pointing at `chains.ts`; host + abuse + budgets green (58 passed, 4 todo), the two `wiring.test` failures are the baseline `oracle/speak` ports; tsc clean.

**Round-2 grouped verification (lead, 2026-11-13 evening):** `tsc` clean; `svelte-check` 11,433 files, 0 errors; `sdk:test` 4,704/4,708 (the 4 are round-1 baseline: catalogue string allowances, an untagged export, a guide vocabulary link); `npm run build` green (perf-L's build, after ★J1); full `npm test` 25,284 passed, 28 failed in 21 files — 19 files are the morning baseline, and the two new ones were tests pinned to the old frame shape or load-order: `sessions.lairCastRows.int` now counts `sessionMessageDelta` frames (lead-updated), `sessions.enabledWhen.int` passes 3/3 in isolation (its "last run" assertion is order-sensitive under full-suite load; left as is, noted). Four comment-ratchet hits from this round rewritten (`llmLaneWidths.ts`, `variants.ts`, `entries.ts`, `types.ts`); the ratchet is back at its 9 baseline files. Nothing committed.

**Bundle after ★J1 (lead, perf-J's script, build of 2026-11-13 evening):** entry static graph 176 files, **1,843,463 B raw / 571,616 B gz** (round start: 7,736,539 / 1,919,271 — −76 % raw, −70 % gz); the 2.26 MB lucide chunk is no longer reachable from the entry; largest entry chunk 369 KB.

**Ruled (owner, 2026-11-13, third batch):** ★I-1 — **allow** the override on a managed host (as built). ★I-2 — card copy accepted as written. ★J3 — "This field did not load." (lead applied in `SchemaForm.svelte`). ★K-3 — the owner asked whether it is still worth doing; the lead's answer: yes for the `new Date()` pin (P1) and a log-line cap, as a small follow-up; the other four are design choices and stay withdrawn unless asked. **perf-L report (2026-11-13):** thumbnail worker built (inline source, `eval: true`, pool of one, in-thread fallback with one warning); main-thread stall per 2,000² thumbnail ~230 ms → under 2 ms; production check: the built server made a thumbnail through the worker; no ★. Lead fixed `DeclaredIconPlaceholder.svelte` (`title` prop) for svelte-check.

**perf-I report (2026-11-13):** lane key = base-URL origin; width 1 local/managed, 4 cloud (`CLOUD_LLM_LANE_WIDTH`); [C8] fixed (held lanes captured at enqueue, test fails on the old line); no nested enqueue exists in production, so no cycle check; ★P2-b built — `dispatch.ts` reads the stream inside `execute`, `generating` spans the stream; `llm_lane_widths` table, migration `0159_odd_cable`, boot task `llm-lane-widths`, admin card **Requests at once** in Admin → Connections, a save reaches the live queue at once. **Open:** ★I-1 — as built an admin may raise a *managed* host above 1; ★ recommend refusing (managed = one at a time, no field) since the brief called width 1 the only GPU guard, trade-off `--multiuser` KoboldCPP. ★I-2 — the card's copy (title, purpose sentence, four helper sentences, **Saved** toast, docs paragraph) is unruled. ★I-3 names stand.

**perf-K report (2026-11-13):** all seven steps built; migration `0158_sweet_nightshade` (indexes, `variants.path` nullable + `same_as_variant_id` + CHECK, `system_settings.boot_markers` jsonb). ★K-1 (`boot_markers` column as ★P9's storage) and ★K-2 ("same-as variant") accepted by the lead, reversible until 0158 reaches a user. **★K-3 (open):** six abuse cases withdrawn with `scripts/run.ts` describe production-host gaps — `host.ts:357` pins `Date.now` but not `new Date()` (P1), `ctx.log` uncapped, undeclared return keys and scalar transforms not refused; ★ recommend a small lane making the `new Date()` pin and the log cap true of `runScriptSource` and keeping the other four as `it.todo`. Lead applied the lane's five queued one-liners and deleted `plugins/RuntimeManager.ts` (★P11 complete).

**perf-J report (2026-11-13):** entry static graph 7.74 MB / 1.92 MB gz → 3.98 MB / 0.71 MB gz; 16 views lazy;
curated set of 148 names; `declaredIconOf` resolver (no name-taking component: a component value cannot carry a name
through Svelte 5's public API — scope reviewer accepted). ★J1: three more open lookups perf-F's count missed
(`hostElements/SpIcon.svelte`, `sessionPage/ActionLegend.svelte`, `sessionPage/CollectSuggestions.svelte`) kept the
lucide set in the entry — **lead switched them the same day** (inside ★P15 as ruled; two-line changes each; build
confirmation in the grouped verification). ★J2: 10 `CodeField` and 3 TipTap mounts stay unwrapped inside now-lazy
views — recommend leave. ★J3 (open, copy): a SchemaForm JSON field whose chunk fails shows AdminView's "This page
did not load… Reload" sentence; ★ recommend "This field did not load" with the same Reload.

### 4.2c Round 3 — the widget path (owner: "Get to work on those", 2026-11-14)

The lead's assessment (2026-11-14) of what still costs per streaming frame on the widget path, and the owner's go. No new ruling is needed: ★P14 (2026-11-13) allowed the `{ t: 'message' }` member and a peer-declared option; round 3 extends the same contract to iframes and finishes the identity skip perf-F began.

| lane | steps | files owned | notes |
|---|---|---|---|
| **perf-M** | Iframe plugin frames take the one-row post. A frame declares it on its `ready` (`FrameHostMessage`, `sdk/src/surfaces.ts:367`) — the only channel a frame has to say what it understands; `PluginFrame.svelte` turns `peerTakesOneMessage` on for that frame when the declaration arrives. The SDK CLI test harness (`cli/src/testing.ts:854`) handles `message` so plugin authors' tests exercise the path. | `src/lib/client/components/frames/PluginFrame.svelte` (+ dom tests), `widgetWire.svelte.ts` only if `ready` must carry data to the option (prefer none), SDK `sdk/src/surfaces.ts` (the `ready` member + protocol doc), `cli/src/testing.ts`, `sdk-tests/*frame*` + a new test, the SDK guide page that documents the frame protocol, `docs/plugins*.md` if it describes frames, `NOMENCLATURE.md` §25 | The field on `ready` is a new name (🚧, per §24, flagged **★M-1** in the report — the lead builds it under ★P14's "peer declares it understands it"). A frame that says nothing keeps full lists forever. `sdk:build` at the end, lead-coordinated. |
| **perf-N** | (a) Session, settings and scoped sections take the identity skip (`postChangedFrom`) — their owners (`RemoteWidget.svelte` `sessionV1`, `surfaces/Panel.svelte` `resolved.settings` / `grantedScoped` / `session`) must hand a stable reference while nothing changed and a new one when something did; the lane proves both. (b) **Measure first:** `SessionContainer.svelte:164` `msgOrderKey` and `conversation.svelte.ts`'s per-channel re-filter per streamed frame on a 500-row window; build a skip only if the measured cost is material (> 1 ms per frame on the lead's machine) and only where the skip is provably exact (same rows array length and ids). | `src/lib/client/components/frames/widgetWire.svelte.ts` (`push` section posts), `host/RemoteWidget.svelte`, `surfaces/Panel.svelte` (the three derived inputs only), SDK `core-catalog/components/shared/messages/SessionContainer.svelte`, `conversation.svelte.ts`, `sdk/src/componentWire.ts` only if a "same order" fact must cross; their tests | Target: 150 → ~0 stringifies per 50 frames on the three sections (perf-F's number). `sdk:build` only if (b) edits the SDK. |

**Round-3 challenger (2026-11-14), five objections:** [C11] perf-M exceeds ★P14 as ruled ("`PluginFrame` keeps full lists") and its `ready` field is a new name → **needs owner: ★M-1** (below); [C12] `cli/src/testing.ts` is the component harness (it posts; `componentWire` receives) → step 3 reworded: the harness posts `message`; the frame preview harness `ui-preview/framePort.ts` is noted, not owned; [C13] `ready` is handled in `widgetWire.svelte.ts:564`, not `PluginFrame`, and `attach()` resets wire state → the declaration (if ruled) is one `widgetWire` hunk, perf-M runs after perf-N; [C14] perf-N(a) missed the hottest wire — `SessionLayoutRender.svelte:208-221`'s `session_full` dossier is rebuilt every frame (`dossierFor`, `conversationDossier`) → added to perf-N's owners with real-mount counts and nested-mutation tests; [C15] perf-N(b)'s exact-skip condition must include `anchorMessageId`, round and kind; reuse keys only, never filtered arrays; the O(1) "same shape" wire fact is a new name → ★N-1 if measured material; gate stated with a ×4 phone factor. All accepted; briefs updated.

**★M-1 (open):** may a plugin *frame* (iframe) opt into the one-row streamed post by declaring it on its `ready`
message, which gains one optional field for that? ★P14 (2026-11-13) said frames keep full lists because they have no
receiver; a declaration is the receiver saying it exists. ★ Recommend yes: a frame that says nothing is unchanged; the
field is `@experimental` beside the member it enables; the plugin author's harness exercises it. Trade-off: one more
protocol field for authors to learn.

**perf-M report (2026-11-14):** a frame declares `takes: ['message']` on `ready` and receives one streamed row per frame; a silent frame is byte-identical to before (snapshot-tested both ways); the declaration is read in `widgetWire`'s `ready` handler and reset on every `ready` and in `attach()`; `PluginFrame.svelte` unchanged; the SDK component harness now posts `message` as `ComponentMount` does; `guides/frames.md` documents it; `sdk:build` run by the lead. Name `takes` stands (the owner's word). No ★.

**Round-3 grouped verification (lead, 2026-11-14):** `tsc` clean; `svelte-check` 11,443 files, 0 errors; `sdk:test` 4,711/4,716 (same 4 baseline + the new bench's sanity passes); full `npm test` 25,387 passed, 30 failed in 23 files — the round-2 baseline minus the two session tests fixed earlier, plus four new: `avatarPicker.dom` (FileReader timing under full-suite load; 5/5 twice in isolation; component untouched since 11-12) and three in the peer's live lore/scene lanes (`sessions.retraction.int:336`, `sceneSummaries.routine.int:476`, `scenes.routineSummary.int:355`; `schema.ts` and `host.ts` edited by the peer during the run) — handed to the peer. Nothing ours fails. Nothing committed.

**perf-N report (2026-11-14):** `session`/`settings`/scoped sections skip by reference; the `session_full` dossier was rebuilt every reasoning frame (`projectConversationDossier`) and now keeps its reference when equal; real mount, 3 conversation mounts, 50 frames: 150 → 0 dossier stringifies (≈55 ms saved per 50 frames), 150 → 0 settings; wall clock per reasoning frame ~6 → ~2.2 ms. Part (b) measured 0.08–0.30 ms/frame for the SDK order work on 500 rows; nothing built; **★N-1** (O(1) "same shape" wire fact, a new name) recommended not now. Noticed: `strings` posted per frame on translating mounts; `grants`/`layout`/`viewer` still JSON-compared per push (small).

**★M-1 ruled (owner, 2026-11-14): yes** — a frame may declare on `ready` that it takes single-row posts; a frame that says nothing is unchanged. perf-N runs now; perf-M after perf-N reports.

### 4.3 Verification

- **Grouped at the end**, not per step: `npm run check`, `npm test` in the capped scope, `npm run sdk:test` after W1-e,
  `npm run test:budgets` after W3-f (now measuring the production host).
- **Each cache** names its key and its invalidation in the lane report and has one test that a write invalidates it.
- **Migration and markers:** a test that a second boot changes nothing (W7-a, W7-b).
- **Re-measure** M0 after W1, W4, W5, W6, W3; the plan's payoff column is replaced by the measured figures.
- **Walk owed** after W1 and W6: one session streamed on a phone over LAN, one lorebook edit in a 200-entry book.

### 4.4 Not in this plan

Anything that changes an answer: no new settings (P3 has nothing to ask a user), no genre opt-ins, no SDK name
removals beyond P6, no SQLite, no second database connection. Items the review listed as "suspicious, unconfirmed"
stay out until a lane confirms them.

## Part 5 — Round 4 measurements (lead, 2026-11-14; production build, loopback, 16-core host)

Measured, not estimated. Method: `node build/index.js` on a scratch data dir, polled to `/api/launcher/health`
`ready`; a `--import` preload wrapping `PGlite.prototype.query/exec` counted statements (awaited time overcounts
concurrent batches); `--cpu-prof` for CPU categories; Playwright with CDP 4× CPU throttle, 40 Mbps, 8 ms RTT as the
"phone over LAN" stand-in. Scripts: scratchpad `perfwalk/{boot,bootq,bootprof}.sh`, `qlog.mjs`, `prof.mjs`.

| measure | value |
|---|---|
| Cold boot, fresh data dir, to `ready` | **26.3–27.2 s**: PGlite initdb 3.7 s · 161 migrations 4.3 s · defaults 0.5 s · `pipelines` task + publish **15.5 s** · rest 1.3 s |
| Warm boot (second start) to `ready` | **9.5 s**: open + migration check 0.5 s · `pipelines` task **7.5 s** · services/sockets 1.5 s |
| Warm boot queries | **6,228** statements, 96k rows, 6.1 s awaited |
| Cold boot queries | **8,595** statements, 116k rows (≈1,000 single-row inserts at ~5 ms each) |
| Warm CPU (10.7 s sampled) | PGlite JS 3.1 s + wasm 1.3 s + fs 1.0 s · **ESM module loading 1.6 s** (`package_json_reader` 0.8 s) · drizzle 0.5 s · app code 0.4 s · idle 1.6 s |
| First page (wizard), loopback | 250 requests, **221 `modulepreload`**, 722 KB gz / 3.1 MB raw, load 107 ms, HTTP/1.1 |
| First page, phone stand-in | network done 1.7 s · first paint 2.0 s · **wizard text visible 3.5 s** (1.8 s is JS parse+run after the last byte) |
| Requests before `ready` | held (hooks await `appReady`): first page waits the full boot |

**Where the `pipelines` task's time goes** (call stacks on the hot statements, warm boot):

- The 193-row `pipeline_definition_registry` is read whole **258×**: `declarationsAndVariableKeys`
  (`config/panel/declarations.ts:816`) and `chainNodesFor` (`config/chainAddresses.ts:90`) each read it once **per
  spec**, from two callers (`reconcileConfigs` via `seedCoreSpecs`, and `scanContextTemplateFits`); `listSessionGenres`
  reads it 18×. 1.3 s awaited.
- `loadDocument` (`boot/store.ts:1023`, 6–7 statements per call) runs **~300×** for 79 specs: `unservedPipelines`
  via `reconcilePresetBindings` 125×, `refitRegistrations` 65×, `templateScopeDetailFor` 70×, `scanContextTemplateFits`
  35×. Each published version is loaded four to five times.
- `layoutByReference` (`entities/variableTemplates.ts:113`) **557×** from `variableLayoutOffersOf` inside
  `scanContextTemplateFits`, one `select id` per variable per spec.
- `recordLastSeen` writes 73 `attribute_declarations` rows one statement each; publishing inserts registry rows,
  declarations, registrations, prompts, scripts one row per statement (~1,000 on a cold boot).

### Round 4 proposals — **GO (owner, 2026-11-14: "Go for it. Play nice")**, challenger objections [C16]–[C20] folded in

Cold-read by a `plan-challenger` 2026-11-14: five objections, all accepted.

- **[C16] (high)** "A published version is immutable" is false *inside the task*: pass 1 of `seedCoreSpecs` heals
  present versions in place (`seed.ts:345` `healNodeExpose` → `pipeline_nodes.expose` `:616`; `seed.ts:349`
  `healClauseChains` → `pipeline_clauses.parent_clause_chain` `:637`). Nothing loads a document before pass 1, and the
  registry's only writer in the task (`syncDefinitionRegistry`, `bootstrap.ts:283`) runs before every reader. **Fix:**
  the memo starts *after* pass 1, in `reconcilePublishedConfigs`; no invalidation machinery (there are no writes to
  react to); one test pins the order.
- **[C17] (medium)** Thread, never cache on the db handle (`bootstrap.ts:551` already turns a cache down; 34 call sites
  of `declarationsAndVariableKeys`/`chainNodesFor` include runtime paths). Reuse what exists: `publishedDocuments(db,
  slugs, into)` + `DoorOptions.docs` (`door.ts:56-76`) is a threaded document memo already; `unservedPipelines` rebuilds
  its map per preset (`unserved.ts:163`, loop `presetReconcile.ts:98`); `contextTemplateFit.ts:184` already takes a
  passed `byPin`, while `scanContextTemplateFits` builds `byPin` at `:344` and then calls `declarations(db, …)` at
  `:356`, which reads the registry again. **Fix:** optional `byPin` on `declarationsAndVariableKeys` and `chainNodesFor`,
  built once per loop in `reconcilePublishedConfigs` (`seed.ts:428`) and in the scan; optional `docs` map on
  `unservedPipelines`, created once in `reconcilePresetBindings`.
- **[C18] (medium)** R4-2 as written was wrong: `saveDocument` is already one transaction per spec with multi-row
  inserts (`store.ts:100,199,219,265,291,317`; only `pipelinePresets` `:302` is row-by-row). Registry rows are per
  definition, not per spec; `syncDefinitionRegistry` runs on `db` and its map is kept truthful as the loop writes
  (duplicate pins, `registrySync.ts:335-337`). Prompt names depend on insertion order (`seedPrompts.ts` ~185-201,
  `namesTakenBesides`). No try/catch exists today: a failing row already fails the task (`failsHealth`). `recordLastSeen`
  runs every boot (`state/declarations.ts:260`) as an upsert with `setWhere origin <> 'stored'` (`:337,:366`).
  **Fix, table by table:** registry sync in one transaction (`tx` threaded, entries de-duplicated by pin first);
  `recordLastSeen` as two multi-row upserts (`excluded.*` in `set`); prompts: names computed in memory, one insert
  `returning (id, seedKey)`; `pipelinePresets` batched; `registrations` projection batched where it inserts row by row
  (`registrations/write.ts:75,104`). Map returned rows by `seedKey`/pin, never by position.
- **[C19] (medium)** The 557× `layoutByReference` is the cheapest cut: `(variableId, reference)` is unique
  (`schema.ts:6754-6757`), so `layoutByReference(...) === row.id` only means "not withdrawn"; offers are
  "independent of the step" (`contextTemplateFit.ts:76-79`) yet recomputed per call (`:134`). **Fix:** compute the
  offers once per scan, one select per variable that returns `withdrawnAt`.
- **[C20] (low)** R4-3 would need to be client-only and guarded by the bundle gate; moot — dropped after measurement
  (see above).

**Lanes (4.2d):** `perf-O` reads (R4-1 + [C16] [C17] [C19]) — owns `config/panel/declarations.ts`,
`config/chainAddresses.ts`, `boot/seed.ts` (the `reconcilePublishedConfigs` loop only), `boot/unserved.ts`,
`boot/presetReconcile.ts`, `entities/contextTemplateFit.ts`, new `boot/bootstrap.queries.int.test.ts`. `perf-P` writes
(R4-2 + [C18]) — owns `boot/registrySync.ts`, `state/declarations.ts` (`recordLastSeen` only), `boot/seedPrompts.ts`,
`boot/store.ts` (`pipelinePresets` insert only), `registrations/write.ts`, their tests. Neither touches `bootstrap.ts`
or `startup/index.ts` (the peer's `timeline-switch` task stays after `plugins`). Expected: warm boot 9.5 → ~4 s,
cold −6 to −9 s; re-measured with the Part 5 scripts at the end (result: warm 6.4 s, cold 23.9 s — see "Verification + re-measure").

- **Not proposed:** the 1.6 s of ESM resolution (`package_json_reader`) is Node's cost across `node_modules`; a
  bundled server or a startup snapshot would move it, both outside this plan. PGlite initdb (3.7 s) and migrations
  (4.3 s) are one-off per install.

### Round 4 reports (lead, 2026-11-14)

- **perf-O (reads once) — built, scope-reviewed: no objection.** `declarations`/`declarationsAndVariableKeys` take an
  optional `read: { byPin?, docOf? }`; `chainNodesFor` an optional registry index; `reconcileConfigs` threads `byPin`;
  `reconcilePublishedConfigs` builds the index once after pass 1 ([C16] comment at the site); `unservedPipelines` takes an
  optional `docs` map, created once per `reconcilePresetBindings` run; the scan passes its index and one lazy document per
  spec and computes layout offers once per variable ([C19]: `layoutByReference` filtered only `withdrawnAt IS NULL`, so
  "no `withdrawnAt`" is the same answer). New `boot/bootstrap.queries.int.test.ts` pins full-registry selects ≤ 6
  (measured 4), per-row layout selects 0, and holds a mock-based [C16] order test. Second boot: statements 6,050 → 3,840;
  full-registry selects 240 → 4; document loads 295 → 173. Reviewer's low findings (absolute node pin of 600 tied to 79
  specs; measured numbers not in the test) go to perf-O2. Report: `plans/REPORT-perf-O-2026-11-14.md`.
- **perf-P (writes batched) — built, scope-reviewed: no objection.** Registry sync in one transaction (`tx` only),
  registry and archive rows inserted 100 at a time, duplicate pins flush first and rows map back by pin;
  `recordLastSeen` is one upsert per table with the `origin <> 'stored'` guard kept; prompts are named in memory and
  inserted once per pass (and read once by seed key — beyond the brief, accepted); presets in `saveDocument` inserted
  once, mapped by slug; `replaceRows` inserts once; scripts seeded in one transaction. First boot writes 1,848 → 1,196;
  first-boot wall on the file-backed test db 14.3 → 8.9 s. Two stale comments reworded by the lead. Reviewer's note:
  `attic/restore.ts:92` calls the sync inside its own transaction (now a savepoint) — the attic tests join the grouped
  verification. Report: `plans/REPORT-perf-P-2026-11-14.md`.
- **perf-O2 (one document map after the heals) — built, scope-reviewed: no objection.** An empty slug-keyed map is
  created in `bootstrapPipelines` right before `seedCoreSpecs(db, { docs })`; its first entry lands in pass 4
  (`reconcilePublishedConfigs`) after pass 1's heals; `reconcileConfigs`, `refitRegistrations`, `reconcilePresetBindings`
  and `scanContextTemplateFits` take it; runtime callers get a per-run map. Writer check with file:line in the comment at
  the creation site (no step between writes a document table or moves `active_version_id`). `seedCoreScripts` reads its
  seed-key rows once. Second boot: statements 3,840 → 2,973; documents loaded 173 → 66 (each version once); node selects
  573 → 466. Reviewer's low findings fixed by the lead: script-read pin is `published.length + 1`, registry pin states its
  measured 4, "pass 2" → "pass 4" and the readers named in the comment. Report: `plans/REPORT-perf-O2-2026-11-14.md`.
- **Not continued (lead):** the next cut is a node map (−316 statements of 2,973; each spec's nodes are read five times);
  below the line for this round. Carried over: 79 no-op `update pipeline_specs set name`, 158 `pipeline_config_values`
  selects, 44 per-type script name-pool reads, 5 untraced node selects.
- **Verification + re-measure (lead, 2026-11-14 evening):** tsc 1 error and svelte-check 4 errors, all in the peer's
  in-flight files or pre-existing (`CharacterForm.svelte:854`); full `npm test` 25,734 passed, 36 failed in 23 files, every
  one in the committed baseline list or the peer's redlines / edit-history / timeline work — no lane-touched file failed.
  `npm run build` clean. Same method as the table above (fresh data dir, loopback, `ready` from the health route):

  | measure | before (Part 5 table) | after round 4 |
  |---|---|---|
  | Cold boot to `ready` | 26.3–27.2 s | **23.9 s** (initdb + module load 6.0 · migrations 5.0 · defaults 0.9 · `pipelines` task + rest **11.6 s**) |
  | Warm boot to `ready` | 9.5 s | **6.4 s** (migration check 0.5 · `pipelines` task + services **5.4 s**) |
  | Warm boot statements / rows | 6,228 / 96k | **3,103 / 25.7k**, 3.0 s awaited |
  | Cold boot statements / rows | 8,595 / 116k | **4,817 / 47k**, 9.5 s awaited |

  The "~4 s warm" expectation above was not reached: the remaining 3,100 statements are the node map, clause chain
  reads (303 + 224 selects, 0.5 s) and the carried-over items. Noticed on the cold boot, not done: the 24 `widget_styles`
  inserts take 1.47 s (61 ms each — the rows carry whole stylesheets), the single largest statement by time.

## Part 6 — Round 5: the first page's client path (lead, 2026-11-14; owner "Go for it" = measure, then propose)

**Method.** Production build (`build/`), warm server on 127.0.0.1:5301, fresh profile per run, Playwright Chromium at
390×844 with CDP throttling: 4× CPU, 40 Mbps / 8 ms, HTTP cache off. Page state: the setup wizard ("Step 1 of 3 ·
Get started"). Per-module sizes come from one metadata-only build (`generateBundle` → `chunk.modules`, scratchpad
`perfwalk/meta/client.json`); those are Rollup's *rendered* lengths, before minification — minified bytes on the wire
are about half, gzip about a quarter.

| measure | value |
|---|---|
| JS files on the first page | **224** (580 KB encoded, 2,130 KB decoded); 189 requested in the first 100 ms via the `Link: …; rel="modulepreload"` response header (the HTML head carries none), 3 request waves, last JS byte at **0.53 s** |
| DOMContentLoaded / first paint | 0.13 s / **2.0 s** (first-contentful-paint = first paint) |
| Executed at network idle | **984 KB of 2,127 KB (46 %)** — CDP precise coverage; 1.15 MB parsed and never run |
| CPU profile of the load | 3.3 s "(program)" (parse, compile, module instantiation; profiler on, so FCP moved to 4.0 s); all JS function self time together **< 0.6 s**, the largest single function 32 ms. No hot function — the cost is bytes and module count |
| Stylesheets | 12 files, 29 KB together; not a factor |
| Static import closure (metadata build) | 222 chunks, **4.17 MB rendered** — lucide curated icons 512 KB · docs manifest 374 + docsIndex 34 · svelte 304 · SDK dist 243 · `Layout.svelte` 155 · `routes/+page.svelte` 170 · pipelines components 149 · skeleton 140 + zag ~300 · zod 133 · dompurify 129 + marked 71 · hostElements 85 · modals 82 · kit 81 · qrcode 52 · connection adapters manifest 49 + defaults 17 + types 20 |

Earlier figure (Part 5, "wizard text visible 3.5 s") was taken on a cold server with the first boot still finishing;
the 2.0 s here is the comparable number for round 5.

**Where the unused half comes from** (static import chains from `routes/+layout.svelte` and `routes/+page.svelte`,
verified in the metadata build):

| # | what loads at first paint | rendered KB | chain | rendered or used when |
|---|---|---|---|---|
| a | docs manifest (161 pages, 2,790 headings) + 162-page import map | 408 | `Layout.svelte:28` (`getDocMeta` in a click guard, `:548`); `JumpOverlay.svelte:84` (static in `Layout.svelte:84`, rendered only `{#if jumpCtx.isOpen}` `:3532`); `shell/docsJump.ts:20` | a help link is clicked / the jump overlay opens |
| b | host-element vocabulary: `hostElements/registry.ts` → 25 `Sp*` components, `@serene-pub/sdk` dist (shapes, capabilities, settings, widgets, rulesets, attributes…), `PluginFrame` + `widgetWire`, `SpMessageBody` → `markdownToHTML` → marked + dompurify | ~550 | `routes/+layout.svelte:329` `registerHostElements()` at startup | an `<sp-…>` element is on the page: every session view (core Messages, Turn order and other catalogue widgets, `TurnPicker`) and plugin UI; never the home/wizard page |
| c | shell modals rendered unconditionally: `RunInspectorModal` (+ `RunInspector` 71, `receiptView` 18), `PipelineReviewModal` (+ `SchemaForm` 33), `CapPauseDialog`, `ConnectionsDialogs`, `ConnectionTimeoutModal` | ~160 | `Layout.svelte:3817–3833` | a run is inspected / a review or cap pause arrives / a connection times out |
| d | home page statics: `CharacterCreatorModal` (+ `AvatarCropEditor` 22, `FileDropzone` → zag file-upload 22), `CharacterSelectModal` 19, `PersonaSelectModal` 13, `BindingLinkerModal`, `LanguagePicker` → `Select` → zag combobox 53 + collection 16, `connectionTypeIcon` → adapters manifest 49 + `connectionDefaults` 17 + `ConnectionTypes` 20 | ~250 | `routes/+page.svelte:40–51`; rendered at `:2331`, `:3766` (persona step only, per its own comment), `:3779`, `:3792`; icons at `:2462`, `:2913` (admin-first-time wizard path) | a wizard step or picker opens |
| e | auth screens: `LoginForm` → zod 133 + `AtmosphereLayer` 20; `SetupGate` → `QrCode` 52 | ~205 | `routes/+layout.svelte:357–371`, the `{:else if}` branches that never render once sockets are up | login / setup only |
| f | lucide curated icon set, 12 % executed at first paint | 512 (108 minified) | P15 as ruled 2026-11-13 | the shell uses ~18 of 148 at first paint |

Together (a)–(e) are about **1.55 MB of the 4.17 MB rendered (37 %)**, roughly 0.75 MB of the 2.13 MB on the wire, and
some 70 of the 224 modules.

### Round 5 proposals — await the owner (challenger objections [C21]–[C25] accepted and folded in, 2026-11-14)

- **R5-1 Docs manifest lazy** (a): `JumpOverlay` becomes `{#await import(…)}` inside its existing `{#if}`; `docsJump.ts`
  follows it. The click guard at `Layout.svelte:548` only asks whether a page exists, which the keys of the *lazy* page
  glob (`docsIndex.ts:108–111`) answer synchronously — a new leaf module `hasDocPage(slug)` with no further imports
  replaces `getDocMeta` there, so the guard stays synchronous and nothing visible changes. `docsIndex.ts` keeps every
  export (peer c4's `bindings.ts:4197` imports it dynamically). No ★. Expected −408 KB rendered (the chunk measured
  369 KB minified / 54 KB gz). [C25]
- **R5-2 Shell modal bodies lazy** (c): the opener stays eager and in place — the `requestWithInterest` lists
  (`PipelineReviewModal.svelte:191`, `CapPauseDialog.svelte:79`) and the `runInspector` store keep telling the user a
  review, pause or inspector is pending exactly as now (sockets ruling untouched: no listener moves). Only the heavy body
  (`RunInspector`, `SchemaForm`) loads on first open, with the shell's existing loading affordance. Expected −140 KB.
- **R5-3 Home page modals lazy** (d): `CharacterCreatorModal`, `CharacterSelectModal`, `PersonaSelectModal` and
  `BindingLinkerModal` load their bodies inside their *own* `{#if open}` (e.g. `CharacterCreatorModal.svelte:397`), so
  each component's script — and the creator's `characters:create` listener (`:376`) — mounts exactly as today; no new
  outer gate. `LanguagePicker` stays eager: it is the first control of the measured "Step 1 of 3" screen (`:2292`,
  `:2331`). `FileDropzone` stays (used by the page itself, `:3385`, `:3562`). The connection adapter catalogue is *not*
  removable here: it also reaches the first load through `Layout.svelte:2301` → `contexts/connections.svelte.ts:51–58` →
  `modelManagement.ts` → `connectionServiceItems.ts:9`, so the icon helper is not the lever — dropped. Expected −100 KB. [C22][C23]
- **R5-4 Host-element bodies lazy** (b): `registerHostElements()` still runs once at startup and defines all 25 tags
  (`+layout.svelte:327` comment preserved); `SpElementDef.component` becomes a loader. **Reach, corrected [C21]:** these
  elements are not plugin-only — the core catalogue's Messages widget (`core-catalog/…/MessagePartsView.svelte:152,170`
  `<sp-message-body>`; `MessagesWidget.svelte:330–479` tabs and icons), Turn order, Stats, Album, Places, LoreEntries and
  PieceList widgets, and the native `sessionPage/TurnPicker.svelte:122–166` all use them, so a plain on-demand load would
  put a round trip in front of every session's message list, and these bodies are content-sized (no fixed placeholder
  applies; the P15 placeholder rule is for icons only). ★ **R5-4**: (a) **keep the tags eager, start the bodies'
  `import()` right after first paint of the shell** — the home/wizard page paints without them; a session opened
  afterwards finds them loaded; a deep link straight to a session loads them in parallel with the session view's own
  lazy chunk (P7), not after it (recommended; −~500 KB off the first paint, nothing visibly changes except on a slow link
  where a message body may mount a beat after its frame); (b) keep the vocabulary eager and lazy-load only
  `SpMessageBody`'s markdown renderer and `SpFrame`'s `PluginFrame` (−230 KB, no visible change anywhere); (c) leave it.
- **R5-5 Auth screens lazy** (e): `LoginForm`, `AccessibleLoginForm` (`+layout.svelte:21`, rendered `:368`, also imports
  zod) and `SetupGate` load lazily, with their `import()` started at the top of `initializeSocketsIfAllowed`
  (`+layout.svelte:189–192`, alongside `checkSystemSettings`), so the login screen — the first paint for every remote user
  when accounts are on (`:193–197`) — gets no added round trip. ★ **R5-5**: (a) **as described** (recommended; no visible
  change) or (b) leave it. zod (133 KB) leaves the first load only if R5-3 and R5-5 both land (`CharacterCreatorModal`
  imports it too). Expected −205 KB. [C24]
- **R5-6 ★ Icons** (f) — a question, not a proposal: P15 (owner 2026-11-13) ruled "curated list static in the entry +
  lazy per-icon import for every other declared name, fixed-size placeholder, no warning". Measured now: the curated
  chunk is 108 KB minified and 12 % of it runs at first paint. Shrinking the curated list to what the shell and home
  page use (the rest falling to the ruled lazy path) would save ~90 KB minified; the cost is a one-frame placeholder on
  the first open of a view on LAN. Default if unanswered: **leave P15 as ruled**.

Revised total for (a)–(e): about **1.35 MB of 4.17 MB rendered (32 %)**, roughly 0.65 MB of the 2.13 MB on the wire.

**Expected result.** Parse/compile time is proportional to bytes and module count: −37 % rendered bytes and −70 modules
should move first paint on the 4× stand-in from 2.0 s to roughly **1.4–1.6 s**; re-measured with the same harness at
the end. Not promised.

**Not proposed.** The `Link`-header preloading already works (189 of 224 requests start in the first 100 ms); svelte,
kit and socket.io are fixed costs; skeleton/zag follow the components that use them; `Layout.svelte` (155 KB, 3,867
lines) and `+page.svelte` (170 KB, 3,799 lines) are large single files but every line in them runs the shell or the
wizard — splitting them is a refactor, not a lazy load.

**Lanes (GO 2026-11-14 for R5-1–R5-3; briefs `plans/briefs/BRIEF-perf-{Q,R}.md`).** `perf-Q` shell (R5-1, R5-2, R5-5): `components/Layout.svelte`, `routes/+layout.svelte` (`:189–192`
and the branches `:357–371`), `shell/JumpOverlay.svelte`, `shell/docsJump.ts`, a new leaf `shared/utils/hasDocPage.ts`
(name per §24; `docsIndex.ts` untouched), `pipelines/inspector/RunInspectorModal.svelte`,
`pipelines/PipelineReviewModal.svelte`, tests. `perf-R` home (R5-3): the four modal files' own `{#if open}` bodies,
tests; `routes/+page.svelte` only if an import line must move. `perf-S` host elements (R5-4): `hostElements/registry.ts`,
`hostElements/spElement.svelte.ts`, `routes/+layout.svelte:329` (after perf-Q lands), tests. Peer c4 owns none of
these (it released `Layout.svelte` on 2026-11-14). Nothing here needs a migration, a setting or an SDK change.

### Round 5 reports (lead, 2026-11-14)

- **perf-Q (R5-1, R5-2) BUILT, scope-reviewed (no objection):** new leaf `shared/utils/docsPages.ts` — `hasDocPage(slug)`
  from the lazy page glob's keys, no imports — replaces `getDocMeta` in the `Layout.svelte` help-link guard (still
  synchronous; parity with the manifest proven by the compiler writing both in one pass and pinned by
  `docsPages.test.ts`); `JumpOverlay` loads inside its `{#if jumpCtx.isOpen}` (nothing drawn while loading; a failed
  load shows the shell's existing reload notice in a fixed frame — lead fix after review); `RunInspector` and
  `SchemaForm` bodies load on first open inside their modals' existing gates, openers and interest requests untouched.
  `docsIndex.ts`, `docsJump.ts`, `JumpOverlay.svelte` not edited. 206 targeted tests green. ★**Q-1** (new): should the two
  modal bodies get a `{:catch}` with the shell's "did not load … Reload" notice? Report `plans/REPORT-perf-Q-2026-11-14.md`.
- **perf-R (R5-3) BUILT, scope-reviewed (no objection, 3 low notes fixed by the lead):** `CharacterCreatorModal` keeps
  its script, props, interest and Dialog frame and loads its five step panes + `AvatarCropEditor` from new
  `CharacterCreatorSteps.svelte` inside its own `{#if open}`; `CharacterSelectModal` keeps frame, heading and search box
  and loads its list from new `CharacterSelectList.svelte` when open (per-opening mount reproduces the old reset effect;
  reopen test added); `PersonaSelectModal` and `BindingLinkerModal` load inside their existing gates on the home page
  (no pending branch — the dialog appears when its chunk lands). `LanguagePicker`, `FileDropzone` and the connection
  icons stay eager. 61 targeted tests green. Noticed: zod stays on the first page through the creator's module-scope
  import (`CharacterCreatorModal.svelte:7`); the picker's one-time spinner reaches every consumer. Report
  `plans/REPORT-perf-R-2026-11-14.md`.
- **Verification (lead):** `tsc` 0 errors; `svelte-check` 0 errors / 9 pre-existing warnings; `npm run build` **blocked**
  at the docs compile by peer c4's in-flight `docs/lorebook-time.md` heading rename (two stale links in
  `summarization.md:97`, `coming-from-sillytavern.md:125`) — handed to the peer and fixed by it; build then clean (`npm run build` via the metadata config +
  `customize-build`). Full vitest (peer serene-pub-72's run, 2026-11-15): 2,467 files, 26 failed — 19 the committed
  baseline, 2 environment (scratchpad cleared by the reboot), 1 load-flaky (`avatarPicker.dom`), **4 ours**: session-form
  dom tests that mount the lazy picker list; fixed in the tests only (49/49 after), see `REPORT-perf-R`.
- **Re-measure (lead, 2026-11-14, after the peer's docs fix; same harness and build config as the Part 6 table, three
  runs each):**

  | measure | before (Part 6) | after R5-1..3 |
  |---|---|---|
  | Static import closure, rendered | 222 chunks, 4.17 MB | **214 chunks, 3.52 MB (−16 %)** |
  | JS files on the first page | 224 | **216** |
  | JS on the wire / decoded | 580 KB / 2,130 KB | **503 KB / 1,663 KB (−13 % / −22 %)** |
  | Executed at network idle | 46 % of 2,127 KB (984 KB) | 36 % of 1,663 KB (599 KB) — the docs manifest counted as "executed" data before |
  | Main-thread busy to network idle (4× CPU, `Performance.getMetrics` TaskDuration) | not taken | **0.83–0.90 s** (script 0.30 s) — the baseline for round 6 |
  | Wizard text visible (wall clock) | — | 1.85–1.96 s |
  | First contentful paint | 2.0 s (one run) | 0.22–1.0 s across six runs |

  **Time claims not made:** first paint on this harness swings between 0.2 s and 2.0 s run to run on *both* builds (font
  and paint timing, not JS), so the "2.0 → 1.4–1.6 s" expectation is neither confirmed nor refuted; the deterministic
  result is the byte and module cut above. Still in the first-page closure, each behind an open ★: lucide curated set
  495 KB (★R5-6), SDK dist 243 KB + hostElements 85 KB + dompurify 129 KB + marked 71 KB (★R5-4), zod 133 KB (★R5-5 +
  the creator's module-scope import) and qrcode 52 KB (★R5-5). Cold boot of the new build to `ready`: 20.6 s.
