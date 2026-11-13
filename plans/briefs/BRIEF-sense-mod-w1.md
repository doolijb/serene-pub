# BRIEF — worker `sense-mod-w1` — the server fills Reply when the first model arrives

Supervisor: lane `sense-mod`. Repo: `/home/jody/github/serene-pub` (always absolute paths).
This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Today the first downloaded model becomes the **Reply** model (`text->text` default) from a client effect in
`src/lib/client/components/connections/SetupChatFlow.svelte` ("The one side effect" `$effect`, using
`firstModelToRegister` from `setupChatFlow.ts`). It returns early when the dialog is closed, so closing the dialog or
tab during a download leaves Reply empty. Move the write to the server, where the download completes. The client stops
writing (one writer, P2) and its Done step reads server state.

## Files owned (edit only these)

- NEW `src/lib/server/koboldcpp/fillReplyOnArrival.ts` and NEW `src/lib/server/koboldcpp/fillReplyOnArrival.int.test.ts`.
- `src/lib/server/sockets/koboldcpp.ts` — **only** the success path inside `koboldCppDownloadModelHandler`'s detached
  task (from the `status: "complete"` update through the post-download sync and its `connections:list` emit, about
  lines 1720–1760). Another worker edits OTHER regions of this file at the same time: use Edit (never Write) on it,
  never reformat it, and if an Edit fails because the file changed, re-read that region and retry.
- `src/lib/client/components/connections/SetupChatFlow.svelte`, `setupChatFlow.ts`, `setupChatFlow.test.ts`,
  `setupChatFlow.dom.test.svelte.ts`, `setupChatFlow.ssr.test.ts`.
- Optional NEW `src/lib/server/sockets/koboldcpp.fillReply.int.test.ts` (see Tests).
- `docs/connections.md` — **only** the `### Set up chat` section (about lines 61–73) and the sentence at about line 73
  that lists "Set up chat's first model". Another worker edits lines ~560–590 of this file at the same time: Edit only,
  re-read on failure.

Everything else is read-only. In particular never edit `src/lib/client/components/sidebars/ModelsSidebar.svelte`,
`src/lib/server/connections/*`, `db/schema.ts`.

## Design (prescribed — do not change the shape; ask in your report if it cannot work)

### Server: `fillReplyOnArrival.ts`

Export `fillReplyIfEmpty(db: Db, filename: string): Promise<{ connectionId: number; connectionModelId: number; name: string } | null>`:

1. Serialize calls with a module-level promise chain, so two downloads finishing together cannot both see "empty".
2. `capabilityDefault(db, "text->text")` (from `$lib/server/connections/capabilityDefaults`). If its `connectionId != null`
   → return null. **Never overwrite a pair somebody chose.**
3. `managedKoboldCppEndpoint(db)` (from `./managedEndpoint`). None → null.
4. The `connection_models` row on that endpoint whose `model === filename`. None → null.
5. `starRefusal(db, { capability: "text->text", connectionId, connectionModelId: row.id })` (from
   `$lib/server/connections/starRefusal`). Non-null → null. This is the same judge the Use buttons go through; it keeps
   embedding, speech (`tts`), image, switched-off and missing rows out.
6. `setCapabilityDefault(db, "text->text", { connectionId, connectionModelId: row.id })`. Do not touch sampling.
7. Return the pair and the row's display name.

Header comment: say why it exists (review A6, 2026-11-11: the fill used to be a client effect that needed the dialog
open), that it is the ONLY automatic writer of the Reply pair on arrival, that it fills only an empty Reply, and that
the fill is visible on the Loadouts row and in Set up chat's Done step (P1).

### Server: the call site in `koboldCppDownloadModelHandler`

After `syncManyConnectionModels(...)` succeeds, and only when ALL hold: `requestedKind !== "speech"`; the file is not a
queued vision projector (`!projectorPairs.has(filename)`); the final kind is `"text"` (`corrected ? verdict.kind : kind`).
Call `fillReplyIfEmpty(db, filename)` in its **own** try/catch (log `[koboldcpp] filling Reply on arrival:` and carry on;
it must never turn a finished download into a failure). When it filled: `console.log` one line naming the model, then
`await emitToUser("systemSettings:get", () => buildSystemSettingsGet())` **before** the `connections:list` emit, so the
client sees Reply filled no later than it sees the model (otherwise Set up chat flashes its "empty" sentence). Keep the
existing sync error handling.

### Client: `setupChatFlow.ts` and `SetupChatFlow.svelte`

- Delete the auto-register `$effect`, `registerAsked`, `registeredName` and the `firstModelToRegister` import. Delete
  `firstModelToRegister` from `setupChatFlow.ts` after `grep -rn firstModelToRegister /home/jody/github/serene-pub/src`
  confirms no other caller (report what you found).
- Keep `onChooseJobModel` in the `Props` interface (ModelsSidebar, not ours, still passes it) but stop destructuring
  it; mark it `⏳ unused since 2026-11-11 — the server fills Reply on arrival (fillReplyOnArrival.ts); removal from
  ModelsSidebar queued`.
- `doneSentence(facts)` (drop the `registeredName` parameter) reads only server state:
  - Reply's pair is on `facts.connection` and its `connectionModelId` matches a model in `facts.connection.models` →
    `chosenSentence(model.name, [CHAT])` (existing words: "Gemma 3 is now in the Reply loadout.").
  - Reply set otherwise → `"The Reply loadout is filled — sessions can reply."` (existing words).
  - No Reply pair → 🚧 `"The Reply loadout is still empty. Open KoboldCPP and press Use in Reply on a model."`
- Add a pure `replyFilled(facts): boolean` (or reuse `facts.chatDefault != null`) and make the Done heading
  `Chat is set up` (existing) when filled, 🚧 `KoboldCPP is ready` when not. Nothing else in the markup changes.
- Rewrite the header comments ("The one side effect" section in the `.svelte`; the module header in the `.ts`) so they
  say: the server fills Reply when a downloaded model lands and Reply is empty (`fillReplyOnArrival.ts`); this dialog
  only reads and says what happened. Keep "Derived, never stored".

### Docs: `docs/connections.md` §Set up chat

Only the sentences made untrue. Step 3 (Done) must say: when a download finishes and the Reply loadout is empty,
Serene Pub puts that model in it whether or not the dialog is still open; a pub that already replies is never switched;
the step names it (_Gemma 3 is now in the Reply loadout._); and with Reply still empty (a model that was already on disk,
or a KoboldCPP you run yourself) the step says so and points at **Use in Reply**. In the line-73 list, replace "and Set up
chat's first model" with words for the new cause (a downloaded KoboldCPP model landing while Reply is empty). User-facing
words: "session", never "chat" (except the dialog's name **Set up chat**); a "pub", never "instance/server".

## Rules you work under (quoted from CLAUDE.md and the lane brief)

- "P1 Deterministic, never hidden. … every automatic action shows its cause and how to undo or switch it off."
- "P2 Modular. A module owns its data and every write to it … Two writers of one thing is a bug."
- "Members never see or touch model plumbing" — the download handler is admin-only already; keep it so.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "Sockets: one domain context per event family … is the only listener, and the only place that toasts; views register
  listeners for local state and never call `toaster`." — do not add a toast anywhere.
- "Browser code runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`."
- "`$state(new Set())` is not reactive: use `SvelteSet`." "`socket.off(event)` always passes the handler."
- "Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- No new socket event, setting, column, table or migration. If you think one is needed, stop and say so in your report.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need `sdk:build` at all.)
- Never `prettier --write` on a directory or on a file that already failed `--check` before you touched it
  (`sockets/koboldcpp.ts`, `SetupChatFlow.svelte` already fail at baseline — leave their formatting alone). New files must
  pass `npx prettier --check`. `setupChatFlow.ts` passes today and must still pass.
- Never `git checkout` / `restore`. Never `kill -9` anything. Do not start a dev server or a KoboldCPP process.

## Tests (must fail before your change and pass after, where the behaviour is new)

- `fillReplyOnArrival.int.test.ts` — real PGlite via `createTestDb()` from `$lib/server/utils/testDb` (see
  `src/lib/server/connections/pairResolution.int.test.ts` for the pattern, including its `vi.mock("$lib/server/embedding")`).
  Use `ensureManagedKoboldCppEndpoint(db, "http://localhost:5001")` for the endpoint and insert `connection_models` rows
  with `modality: "text-gen"` / `"embeddings"`. Cases: (1) Reply empty → filled with the arriving text model; (2) Reply
  already set to another pair → unchanged, returns null; (3) an embeddings row → not filled; (4) no row for the filename
  → null. Any `it` that opens a DB needs a 60 s timeout (`beforeAll(..., 120_000)` as in the pattern).
- The call site: if a download int test can be extended cheaply (see `koboldcpp.parallelChunkedDownload.int.test.ts`
  for how the handler is driven with a test DB and mocked http), add `koboldcpp.fillReply.int.test.ts` asserting a
  finished text download fills an empty Reply and leaves a set one. If that costs more than ~150 lines, skip it and say so.
- Update `setupChatFlow.test.ts` (drop `firstModelToRegister` cases; `doneSentence` cases for all three branches; the
  heading helper), and the dom/ssr tests if they assert the old effect (assert instead that `onChooseJobModel` is never
  called).

Run only these, in a capped scope (never pipe vitest into `head`):

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <files>"`

Also run `npx prettier --check` on each file you created or changed and report the result per file.

## Report

Reply with: files changed (absolute paths), tests run with pass/fail counts, the exact new copy strings, what the grep
for `firstModelToRegister` found, anything you could not do, and **Noticed, not done**.
