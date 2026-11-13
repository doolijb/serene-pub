# BRIEF playtest2-C-w3 — the two local ONNX rows: socket guards, fetch gate, the connection view, docs

Lane `playtest2-C` (supervisor wrote this). Report: put your full report in your final hand-back (changed files, tests run with exact command and pass/fail counts, decisions, every new user-facing string, Noticed-not-done). You are a `lane-worker`.

## Already built (by this lane's earlier workers — read, don't redo)
- `src/lib/server/connections/localOnnxConnections.ts`: `LOCAL_ONNX_CONNECTION_NAME` (`"local-onnx"` → **Local embeddings**, `"local-onnx-ner"` → **Local named entities**) and `ensureLocalOnnxConnections(db)`, run on every boot from `db/defaults.ts` `sync()`: when the ONNX runtime loads (and no 0.5.3 attic is pending), one row per type, hand-made extras folded into the kept one (the one a loadout names, else the oldest), the kept row renamed to the fixed name; never fills a loadout or sets a default. On a machine that can't run ONNX it does nothing (older rows stay).
- `src/lib/server/connections/connectionFold.ts` (`foldConnectionInto`).
- Item 20: the quant picker is inline, **Add a model by name** is a pane of the Models view (`AddModelByNameView.svelte`), `AddModelByNameDialog.svelte` is deleted; the finder's empty card no longer says *Add → A connection…*.

## Owner rulings (2026-11-04, final)
*"17 ONNX rows: two rows, Local embeddings and Local named entities, **undeletable** (remove a model's files instead); extra hand-made rows fold into the kept one …; fresh installs fill no loadout."* · original note (2026-11-03): *"Local onnx connection should be created by default, and name unchangeable."* · *"H: … the list fetch is gated on a model on disk or a loadout naming the row."* · *"20 Models view: quant picker and Add by name inline; Set up chat stays a dialog."*

## Build
### A. `src/lib/server/sockets/connections.ts` (re-read first; touch only these spots)
1. **Delete refused** (`connectionsDelete`, before the `withStarConsequences` delete): read the row; if `onnxModalityOf(row.type)` and `(await localOnnxAvailability()).available`, emit `connections:delete:error` `{ error }` (check how other handlers in this file emit `:error` and that the client listens for it; if `connections:delete:error` has no type in `src/lib/shared/sockets/types.ts`, do NOT edit that file — emit `"error"` the way the admin check above does, and list the type line in your report) and throw. Sentence: `"<name>" comes with Serene Pub and can't be deleted. To free space, remove a model's files instead.` Where the runtime is unavailable, delete is allowed (nothing re-creates the row there, so a leftover row must stay removable) — say so in a comment.
2. **Rename refused** (`connectionsUpdate`, in the `typeof editable.name === "string"` block): if the stored row is a local ONNX type and the trimmed name differs from the stored name, refuse with `"<stored name>" comes with Serene Pub and keeps its name.` (The client round-trips the whole row, so an unchanged name must pass.)
3. **Create refused for a second row** (`connectionsCreate`, after the existing `localOnnxRefusal` check): if the type is local ONNX and a row of that type exists, refuse with `Serene Pub already has "<that row's name>". Download models into it instead.` If none exists, the created row's name is forced to `LOCAL_ONNX_CONNECTION_NAME[type]` (skip the name-required / name-taken checks for it).
4. **Names reserved** (`connectionNameTaken`): a name equal (trim, case-insensitive) to either fixed name counts as taken for any row that is not of that name's type, so no other connection can take *Local embeddings* or *Local named entities*. Pass the type in where needed; keep the existing sentence `A connection named "<name>" already exists.`
### B. `src/lib/server/sockets/localOnnxModels.ts` — the boot warm gate (`warmRecommendedList`, ~line 1094-1132)
Replace "a local ONNX endpoint exists" with: **a local ONNX model on disk** (a `local_models` row with `format = 'onnx'`, `modality` in `('embeddings','ner')`, `status = 'complete'`) **or a loadout naming a local ONNX row** (`loadouts.connection_id` in the ids of connections of the two types). Rewrite its doc comment's ⚠ paragraph to say this and why (the rows now always exist, so their existence no longer says anyone asked). Nothing else in this file changes (the `local_models` per-modality key is NOT in this brief).
### C. `src/lib/client/components/sidebars/ConnectionsSidebar.svelte` (re-read first; touch only these spots)
1. In `endpointSettings` (the **Delete connection** button near line 1214): for a local ONNX connection while the runtime is available (`systemSettingsCtx?.settings?.localOnnxAvailability`, see line ~234 for how it is read; absent reads as available), render no Delete button; render one muted 12px line in its place: *Comes with Serene Pub. To free space, remove a model's files on its Models tab.* (Check the Models tab's actual control word for removing files in `OnnxModelView.svelte` and use it in bold if it is a single control.) Also exclude it from `connectionSaveRow(true)` if that path can render for these rows (check).
2. In `connectionFormFields`, the **Connection name** input is `readonly` (plus `aria-readonly="true"`) for a local ONNX connection; no other change to the form.
Use `isLocalOnnxType` from `$lib/client/components/connections/modelManagement` (exists) for the type test.
### D. Docs (re-read first)
- `docs/connections.md`:
  - § Local ONNX models (~641-660): Serene Pub now makes the two connections itself, named **Local embeddings** and **Local named entities**, the first time it starts on a device that can run them; their names are fixed; they can't be deleted (remove a model's files to free space); a second one made earlier is merged into the one a loadout uses (else the oldest), keeping its models and everything that pointed at it; nothing is put in the Embeddings or Entities loadout for you — you still download a model and press **Use in Embeddings** / **Use in Entities**. On a device that can't run them, none is made, and one made earlier stays (reading **Unavailable**) and can be deleted.
  - Line ~34 / ~47 / ~76 / ~85 and ~151 / ~282 / ~710 wherever they describe **Add a model by name** or the quant picker as a dialog: Add a model by name now opens beside the list like Get a model (Back returns); the list of files/precisions opens under the row you pressed **Get** on (and under **Download** on a local ONNX model). Change only sentences that are now wrong. Set up chat stays a dialog (lines ~51-57 stay).
  - Do **not** change line ~307 (the New connection table) or the § New connection bullets about the picker greying out the ONNX types: the picker change is queued for the lead, and the docs must match the code as it is.
- `docs/embeddings-and-rag.md`: line ~34 (*"Add it in the Connections view, then pick, download …"* → it is already there; pick, download and **Use in Embeddings** a model) and line ~171 (*Named entities … one service, **Local named entities (ONNX)***): say Serene Pub makes the **Local named entities** connection itself, so the Entities loadout's **Get a model…** lands there; download one and **Use in Entities**.
- Plain, short sentences in the house docs voice (read a few paragraphs around each spot first). Never "chat" for a session.
### E. Tests
- New `src/lib/server/sockets/connections.localOnnxRows.int.test.ts` (follow `connections.names.int.test.ts`'s harness; mock `$lib/server/localModels/onnxRuntime` so availability is controlled; DB in `beforeEach` with 60 s timeout): delete of a `local-onnx` row refused with the sentence while available, row still there; allowed while unavailable; delete of a non-ONNX row unaffected; rename refused, unchanged-name update passes; second create refused; first create (no row) gets the fixed name whatever was sent; another connection can't be created or renamed to "local EMBEDDINGS".
- `src/lib/server/sockets/localOnnxModels.int.test.ts` (or a new `localOnnxModels.warmGate.int.test.ts` beside it if the existing harness doesn't fit): with `$lib/server/localModels/onnxList` mocked, `reconcileOnnxDownloadsOnBoot()` calls neither `recommendedEmbeddingModels` nor `recommendedNerModels` when both ONNX rows exist but no model is on disk and no loadout names them; calls them when a complete onnx `embeddings` row is in `local_models`; calls them when a loadout names the NER row. (The warm is `void`-ed: await a tick / `vi.waitFor`.)
- Run also: `connections.names.int.test.ts`, `localOnnxModels.cacheDir.int.test.ts`, `connections.onnxNotDownloaded.int.test.ts`, and any `ConnectionsSidebar` DOM test that renders the endpoint settings (grep `ConnectionsSidebar` in `*.test.*`) — add one case there if a harness exists: a local ONNX row shows no **Delete connection** and a read-only name.

## Files owned (edit only these)
`src/lib/server/sockets/connections.ts` (the four spots), `src/lib/server/sockets/localOnnxModels.ts` (`warmRecommendedList` + its comment), `src/lib/client/components/sidebars/ConnectionsSidebar.svelte` (the two spots), `docs/connections.md`, `docs/embeddings-and-rag.md`, the new test files above, and additions to the existing test files named above.

## Out of scope (never build)
`src/lib/shared/utils/connectionServiceItems.ts` (the New connection picker — queued for the lead), `src/lib/shared/sockets/types.ts` (queue type lines), the `local_models` per-modality key / any schema change / migration, `NOMENCLATURE.md`, `STYLE-GUIDE.md`, generated docs under `src/lib/generated/`, any loadout file, `serene-pub-sdk/core-catalog/src/loadouts.ts`, `src/lib/server/loadouts/seed.ts`, Set up chat.

## Stop and ask when
A string beyond the ones quoted is needed; the delete error event has no client listener and no type (report it, use `"error"`); CLAUDE.md §Decisions applies.

## Rules you work under (quoted from CLAUDE.md and the lead)
- *"Sockets: one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`. An event in `SCOPED_EVENTS` must carry its scope key … in the payload, or `emitToUser` silently sends nothing."*
- *"`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler."*
- *"Inside `db.transaction(async (tx) => …)` use only `tx`."* *"Never seed a row at a hardcoded id."*
- *"Members never see or touch model plumbing — connections, models, sampling, loadouts."* (All of this is admin-only already; keep the admin checks first.)
- *"It is a **session**, never a *chat* — except in chat-completions wire vocabulary."*
- Docs: *"`docs/<area>.md` … user-facing behaviour … update it in the same change when behaviour moves."*
- Another programme and lane S2 are building in the same trees: **re-read every file immediately before editing it; use Edit, never Write, on an existing file.**
- Tests: run only your files. Command (n = 1, 2, …):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-C-w3-<n>.log 2>&1; echo exit=$?'` then read the log. **Never pipe vitest into `head`.** DB-in-`it`/`beforeEach` → 60 s timeout. DOM assertions on strings/booleans only, never `expect(element)`.
- Never a full `npm test`, `npm run check`, or project-wide `tsc`. `npx prettier --check <file>` is fine (don't `--write` a file whose existing failures are other lanes').

## Verbatim from the guide
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should need no sdk:build.)

## Done means
Green, each with pass/fail counts: `connections.localOnnxRows.int.test.ts` (new), `connections.names.int.test.ts`, `localOnnxModels.int.test.ts` (+ warm-gate cases), `localOnnxModels.cacheDir.int.test.ts`, `connections.onnxNotDownloaded.int.test.ts`, and the ConnectionsSidebar DOM test(s) you touched.
