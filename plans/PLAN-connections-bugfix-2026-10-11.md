# Connections bug-fix plan — 2026-10-11

Source: deep review of the connections sidebar, configuration forms, index view,
server handlers and managed/ONNX views (session 2026-10-11). Every item was
verified by reading the code path. Fixes are grouped by the files they touch so
batches can run in parallel without colliding. Status marks: ☐ todo · ◐ in
progress · ☑ done · ✗ dropped (reason).

## Batch A — server: connections.ts, koboldcpp.ts, subprocessManager, modelManager

- A1 ☑ **Test must not sync the saved row from an unsaved draft.**
  `connections:test` (connections.ts ~1126-1166): only call
  `syncConnectionModels` + `persistCapabilities` when the draft's
  `type`, `preset`, `baseUrl` and credential equal the stored row's. Otherwise
  return the models in the reply only. Never stamp `modelsSyncedAt` for a draft
  test. Test: a `connections.testHandler.int.test.ts` case — draft with a
  different baseUrl leaves stored `missingSince` and `modelsSyncedAt` untouched.
- A2 ☑ **Rate-limit replies carry `connectionId`** (test + syncModels) so
  clients can clear `testing`. Separate the forced-sync budget from the
  refresh budget, and key both per user (`${userId}:connections:refresh`).
  Do not rate-limit the sync a save triggers (pass a flag from update).
- A3 ☑ **Create ack goes to the asker** via `answerAsker`, list broadcast
  stays `emitToUser`. Sidebar `handleConnectionsCreate` then only reacts to
  its own ack. (Client half in Batch C.)
- A4 ☑ **Create strips client `capabilities`** like update does (keep only
  `resolved`).
- A5 ☑ **Test: passing test + failed listing reported once** — drop the bare
  `error` emit at ~1105; the `connections:test` ok:false reply suffices.
- A6 ☑ **KoboldCPP download start is single-flight per filename**: claim
  `activeDownloads[filename]` (and the concurrency slot) synchronously before
  the first await; release on failure.
- A7 ☑ **`loadedSignature`/resident cleared on stop, crash and restart**
  (modelManager + subprocessManager exit handler).
- A8 ☑ **Stop during `starting` ends as `stopped`, not `crashed`**:
  in the `doStart` catch, if a stop was requested (flag set by `stop()`),
  keep `stopped` and no `lastError`.
- A9 ☑ **`ollamaHost()` accepts `OLLAMA_EMBEDDINGS`** (ollama.ts:58).
- A10 ☑ **Defaults sampling half validated** against
  `samplingShapeForCapability` in `connectionDefaults:set`.
- A11 ☑ **setCapability / update push `connectionDefaults:list`** as
  syncModels already does.

## Batch B — client forms: src/lib/client/connectionForms/*

- B1 ☑ **Forms merge, never replace, `extraJson`**: every
  `connection.extraJson = next` becomes
  `connection.extraJson = { ...connection.extraJson, ...next }`
  (KoboldCppManaged, KoboldCpp, LlamaCpp, OpenAI, Ollama, Anthropic,
  Embedding, Ner). Test: a unit/dom test that a managed KCPP text edit keeps
  `extraJson.profile`.
- B2 ☑ **Image form must not dirty the draft on open**: materialise profile
  defaults into a local `$derived` view for rendering
  (`{ ...defaults, ...profile }`) and write to `extraJson.profile` only on a
  user edit; same for the `extraJson = {}` effect (write only when a field is
  edited). Bind through a setter.
- B3 ☑ **Anthropic form gets the skip-first-write guard** and merges (B1).
- B4 ☑ **Ollama keepAlive**: empty number → omit `keepAlive` (adapter
  fallback "5m"); parse `"0m"` and `"-1"` losslessly (number 0 allowed, unit
  list includes "" for bare -1). Server-side guard in OllamaAdapter: a value
  not matching `/^-?\d+(ms|s|m|h)?$/` falls back to "5m".
- B5 ☑ **Managed KCPP numeric fields**: empty → delete the key from
  `managedConfig` so adapter defaults apply; adapter also drops `null`.
- B6 ☑ **Forms filter `connections:test` by `connectionId`** (Anthropic,
  LMStudio, Ollama, LlamaCpp, KoboldCpp).
- B7 ☑ **Forms re-seed local fields when the bound `connection` is replaced
  by an external save** (admin IdPage adoptSaved): key the form on a
  `connection.updatedAt`-style token, or expose `$effect` on
  `connection.extraJson` identity that re-runs `extraJsonToExtraFields`
  without marking dirty.

## Batch C — sidebar + index + chrome (client)

- C1 ☑ **Sidebar Reset deep-clones**: `connection = structuredClone($state.snapshot(originalConnection))`;
  same for the get/update handlers (snapshot both copies independently).
- C2 ☑ **Update's follow-up sync not forced when the key or address is
  missing** (mirror create's rule).
- C3 ☑ **Create ack guard**: react only to the ack with the name this tab
  submitted (or the asker reply from A3).
- C4 ☑ **Index only asks Ollama status for `type === OLLAMA`** — belt and
  braces with A9; embeddings rows get the API status path.
- C5 ☑ **onnxStatus checks lane target belongs to this row**: server
  `vectorization:status`/`ner:status` add `connectionId`; client compares.
- C6 ☑ **Index re-asks pushed status on reconnect** via `onConnect`.
- C7 ☑ **"Needs attention" filter keeps a syncing row's last state**
  (compute attention on the non-syncing status).
- C8 ☑ **Ollama rows honour `chatSet` and `modelsSync.error`** like API rows.
- C9 ☑ **Star badge vs strip**: badge only when `connectionModelId` resolves
  (follow `resolvePair`). Flag in ledger — owner may rule the other way.
- C10 ☑ **useStarConfirm releases `ner:status` interest on unmount**.
- C11 ☑ **Stop scripts stop toasting `:error`** (Layout toasts centrally).

## Batch D — managed/ONNX/downloads (client) + admin

- D1 ☑ **Finder Ollama id match**: compare against
  `ollama:${connectionId}:${tag}` when a connection is scoped.
- D2 ☑ **Cleared ids are forgotten when an item with that id goes in-flight
  again** (drop from `#cleared` on any non-done/failed patch).
- D3 ☑ **Cancelled downloads map to a `cancelled`/`failed` state**, not
  `done`.
- D4 ☑ **Downloads "Use for chat" only for `modality === "text-gen"`**.
- D5 ☑ **ONNX view clears `busy` on `connections:downloadModel:error`**.
- D6 ☑ **OnnxEndpointView shows Unload/queue only when this endpoint holds
  the active model** (needs C5's `connectionId`).
- D7 ☑ **Managed view clears `resident` on stopped/crashed** (pairs A7).
- D8 ☑ **Finder percent clamped 0–100**.
- D9 ☑ **Job picker "N hidden" counts after the capability filter**.
- D10 ☑ **Admin: delete of one managed KCPP row only turns the manager off
  with the last one**, and only after the delete ack.
- D11 ☑ **Admin modelEdits keyed by model id, not display name**.
- D12 ☑ **ConnectionTimeoutModal re-arms callbacks** after reconnect; reset
  clears the 30 s timer.
- D13 ☑ **credentials.looksLikeCloud**: single-label hosts, 100.64/10,
  169.254/16 are private.

## Verification (once, at the end)

`npm run check`, `npx tsc --noEmit -p .`, then `npm test` once after all
batches. Agents run only the targeted test files for their batch.

## Ledger

(filled as batches land)

- **Batch B ☑ 2026-10-11** — new helper `src/lib/client/connectionForms/extraJsonSync.svelte.ts`
  (identity-keyed seed + merge write-back, `reseed()` for late defaults);
  image form binds a derived `profileView`, writes only on edit; Ollama
  keep-alive parsed losslessly (`bare` unit sentinel), adapter guards the
  format; managed numeric fields omit the key when empty. Tests:
  `connectionForms.dom.test.svelte.ts` (12). Owner follow-up: none.

- **Batch D ☑ 2026-10-11 (D6 moved to Batch C)** — finder Ollama id uses the
  scoped `ollama:<connId>:<tag>`; downloads store forgets a cleared id when it
  goes in-flight again, maps the server's `cancelled` to its own state (new
  neutral section, NOMENCLATURE §25 row); D9 reworded: disabled/missing models
  count as hidden unless their own modality names another job (server returns
  `[]` for switched-off models, so a post-filter count would always be 0);
  admin KCPP flag released only with the last managed row and only on the
  delete ack; modelEdits keyed by `enabled:<id>`; timeout modal re-arms;
  private-network ranges widened. New tests: `connectionTimeout.test.ts`,
  `credentials.test.ts`. Sidebar `removeManager` is "remove the whole install"
  by design, so it keeps deleting every managed row.

- **Batch C ☑ 2026-10-11 (incl. D6)** — sidebar deep-clones draft/baseline
  (`cloneConnection`), `syncMayForce()` shared by create and update,
  `pendingCreateNames` guards the create ack (a managed-KCPP ack is also
  accepted while the finder is open, since the finder calls `enableManager`);
  index asks Ollama status only for `type === OLLAMA`, re-asks pushed status
  on `onConnect`, keeps a syncing row's last state in Needs attention; lane
  status payloads carry `connectionId` (server + `shared/sockets/types.ts`),
  ONNX rows read **Not in use** when the lane is held elsewhere; Ollama rows
  honour listing errors and unset chat; gold mark follows `resolvePair` (🚧
  ruling choice, test reversed); `ner:status` interest released on unmount;
  stop scripts no longer toast. No test for C1 deep copy or C6 (forms mocked
  in the sidebar test). NOMENCLATURE §25 rows added for C5/C8/C9.

- **Batch A ☑ 2026-10-11** — `draftMatchesStored()` gates the test handler's
  writes; per-user rate-limit keys, forced sync on its own key, rate-limited
  replies carry `connectionId` (`SyncModels.Response.connectionId` added);
  create ack to the asker via a local `replyToAsker()`; create strips client
  capabilities; `forgetResidency()` on stop/crash/spawn; `stopRequested` flag
  makes a stop during start end `stopped`; `ollamaHost()` accepts
  OLLAMA_EMBEDDINGS; `samplingRefusal()` on defaults set; update and
  setCapability push `connectionDefaults:list`. New test:
  `koboldcpp.downloadSingleFlight.int.test.ts`. Deviation: no "skip the limit"
  flag from update — the follow-up sync is client-started, so it got its own
  budget instead. Open follow-up: sidebar `handleSyncModelsError` could clear
  only the named id (today it clears all, harmless).

## Verification — 2026-10-11

- `npx tsc --noEmit -p .`: clean.
- `svelte-check --threshold error`: one error, pre-existing, in the untracked
  `sessionPage/remoteActions.dom.test.ts` (core-widgets work in progress).
- `npm test` (full, twice): first run 8 failures incl. the two lane-status
  shape expectations (now include `connectionId: null`); second run 5
  failures. Of those: `commentHistory` ratchet (seven history-phrased
  comments from the batches — rewritten, ratchet re-recorded, counts only
  go down) and `socketEgress` (the new `replyToAsker` in connections.ts —
  excused in `REDACTING_EMITTERS` with its reason) were ours and are fixed.
  `components.int` (expects the in-progress core widget ids) is pre-existing.
  `lair.int` and `characterLoreRendered.int` pass when run alone — load
  flakes under the 1,000 s full run.
- Touched-directory re-run after fixes: 368 files, 4,191 tests, only the
  pre-existing `components.int` failing.
