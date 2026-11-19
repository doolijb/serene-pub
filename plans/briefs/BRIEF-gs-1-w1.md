# BRIEF — lane `gs-1`, worker 1 (server + server tests) — who reads prompts and pipeline settings

Repo `/home/jody/github/serene-pub` (app). The SDK does not change. Supervisor: lane `gs-1`.
Report path: your final message (the supervisor reads it). Under about 400 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` in this task: don't run one.)

Also: never `git checkout / restore`; never `prettier --write`; no migration; no full test run; no `npm run build`. Inside `db.transaction(async (tx) => …)` use only `tx`. Re-read every file right before editing it: other lanes are working nearby (`sockets/import.ts`, `lorebooks/ownBook.ts`, `sessions/settingsForm.ts`'s knowledge switch, `config/panel/read.ts`): do NOT edit those files.

## The owner's ruling (D58, 2026-11-16) — what you build

"The session's owner picks and may read the wording; a guest sees nothing; outside a session only an administrator."

It narrows the older rule in the `visibleTo` comment (2026-09-30: "Prompts stay visible because wording is the one thing that is genuinely theirs to change for a session; outside a session their panel is a reading surface").

**Not ruled, do not build or pre-empt (G1–G7):** what else a guest sees (Edit session tabs, participants), session notes, a guests-may-add switch, card-less seats, Prompt details (`sessions:promptTokenCount`, still open to guests), an administrator inside someone else's session (G6: keeps exactly today's behaviour), SDK template exposure. Swap cards (`sessions:pipelineCards`) stay as they are.

## Files owned (edit only these)

- `src/lib/server/pipelines/config/panel/scopes.ts` — `visibleTo`, its comment, and one new pure function (below).
- `src/lib/server/sockets/pipelines.ts` — only `buildView`, `pipelinesGet`, `pipelinesPromptWording` and a small helper next to `viewerFor`. **Do not change `viewerFor`'s result or `Viewer`.**
- `src/lib/server/sockets/sessions.pipelines.ts` — only `sessionsPipelinesHandler` (~1088–1112).
- `src/lib/shared/sockets/types.ts` — only `Sockets.Pipelines.PromptWording` (~12156–12177).
- Tests: a new `src/lib/server/sockets/pipelines.promptReaders.int.test.ts`, and re-pins in existing test files that pin the old rule (list each).

Readable: `src/lib/server/pipelines/config/panel/{read.ts,types.ts,groups.ts,declarations.ts}`, `src/lib/server/sessions/settingsForm.ts` (exports `settingsFormBuild`, `formFields`), `src/lib/server/utils/sessionAccess.ts`, `src/lib/server/pipelines/entities/prompts.ts`, the existing tests named below.

## Build

1. **One pure function, beside `Viewer` (never inside it)**, in `config/panel/scopes.ts`:
   ```ts
   /** 🚧 Who reads a pipeline's prompts and settings here (owner ruling D58, 2026-11-16) … */
   export type PipelineReader = "owner" | "administrator"
   export const pipelineReaderOf = (who: { isAdmin: boolean; ownsSession: boolean }): PipelineReader | null =>
   	who.ownsSession ? "owner" : who.isAdmin ? "administrator" : null
   ```
   Comment it: owner = `sessions.user_id` of the session asked about; an administrator who is not the owner is `"administrator"` (unchanged until G6 is ruled); anyone else (a guest, a member outside any session) is `null` and reads nothing.
   **Why not on `Viewer`:** a guest's writes are refused today only because `viewerFor` returns no `sessionId` for a non-owner (`sockets/pipelines.ts` ~143), so `writeScopeFor` picks config scope and `resolveWriteScope` refuses a non-admin (scopes.ts 86). `Viewer.sessionId` stays owner-only.
2. **`visibleTo`** becomes `viewer.isAdmin || (matrixSlot === "prompts" && viewer.sessionId != null)`. Rewrite its comment to state today's rule: a non-admin sees prompts and nothing else, and only in a session they own (the session's owner picks and may read the wording); a guest and a member outside a session are sent no row; outside a session only an administrator. Quote both rulings with dates (2026-09-30 "the test is the ROLE, not the moment" stays for administrators; D58 2026-11-16 narrows it for prompts). Keep the paragraph about roles/locks that still holds.
3. **`sockets/pipelines.ts`**: a helper `readerFor(socket, sessionId?)` = `pipelineReaderOf({ isAdmin, ownsSession: sessionId != null && (await checkSessionAccess(sessionId, userId)).isOwner })` (`checkSessionAccess` is already imported). In **`buildView`**, before `namespaceView`: if `readerFor` is null return `{ error }` with
   - no `sessionId`: `"Access denied. Only admin users can manage pipelines."` (the sentence the sibling admin-only events use: `pipelines:library`, `pipelines:detail`, `libraryGate`);
   - with a `sessionId`: `"Only the session's owner sees its settings."` (the sentence `sessions/settingsForm.ts` ~1211 already uses).
   Same reply shape and event as today's "no such pipeline" error (`{ error }` on `pipelines:get`), so the client's handling is unchanged. The reply carries nothing else.
   **`pipelines:list` is NOT gated** (it carries no prompts; `PipelineReviewModal` needs it for members).
4. **`pipelines:promptWording`** checks the rule itself at the top (`readerFor`, same two sentences, on `pipelines:promptWording:error`), then accepts **two addresses**:
   - `optionId` (today's: a panel option, checked against the rebuilt view, unchanged);
   - **new `fieldId`**: the session settings form's field id (`addressId` JSON) for a prompt row. Requires `sessionId` and reader `"owner"` (anything else: the session sentence). Build the asker's form with `settingsFormBuild(db, sessionId, { userId, isAdmin })` (from `$lib/server/sessions/settingsForm`; import it lazily); `form.error` → refuse with it. Find the field among the group whose `pipeline === params.slug`; it must be `address.kind === "pipeline"` and its declaration (`published(db, slug)` + `declarations(db, at.specVersionId)` from `config/panel/declarations`, matched on `nodeKey` + `slot`) must have `control === "prompts-ref"`; else `"That setting does not choose a prompt."`. The prompt must be one of the field's `members` (`key === String(promptId)`) — that pool already leaves out an administrator's hidden prompts for a non-admin unless one is in force (R54) — else `"That prompt is not one this step offers here."`. Declared fields = that decl's `promptFields` (fallback `Object.keys(fields)`, as today).
   Share the "read the row and answer" tail between both paths (one local function). Echo `fieldId` beside `optionId`.
   Types (`Sockets.Pipelines.PromptWording`): `Params` → `optionId?: string; fieldId?: string` (exactly one; doc both), `Response` → add `fieldId?: string`. A request with neither or both → `"That setting does not choose a prompt."`.
   Update the handler's comment: who reads (the ruling), the two addresses.
5. **`sessionsPipelinesHandler`**: the list is sent only when `access.hasAccess && (access.isOwner || socket.user!.isAdmin)` (today: `hasAccess`). A guest who is not an administrator gets `pipelines: []` and no `presetFallbacks` — same event, same shape. An administrator who is a guest keeps the list (G6); an administrator with no access keeps getting none (as today). One comment line citing D58.

## Tests (new file `pipelines.promptReaders.int.test.ts`; borrow the harness of `sockets/pipelines.promptWording.int.test.ts` and, for the session settings form's Story reply prompt row, `sessions/settingsForm.int.test.ts`)

Assert on `JSON.stringify(reply)` where a test says "nothing leaked": no prompt id, name, description or wording of the pool appears.
- `pipelines:get`: admin outside a session → rows (as today); non-admin outside → refused with the admin sentence, nothing leaked; owner in own session → prompt rows only, no `connection-ref` / sampling / loadout rows; guest (a `session_guests` row) → refused with the session sentence, nothing leaked; **"administrator in someone else's session — unchanged until G6 is ruled"** → today's config-scope view with every row.
- `pipelines:promptWording` by `optionId`: owner reads; guest with an option id minted from the owner's view → refused, nothing leaked; non-admin outside a session → refused; forged prompt id → refused.
- `pipelines:promptWording` by `fieldId`: owner reads a pool prompt of the Story reply's prompt row; a prompt outside the row's pool → refused; a prompt hidden from owners and not in force → refused; guest with the owner's field id → refused, nothing leaked; neither / both addresses → refused.
- Writes stay refused for a guest: `pipelines:setOption`, `pipelines:setOptions`, `pipelines:clearOption` (option ids minted from the owner's or an admin's view). An administrator who is not the owner still writes at configuration scope (**unchanged until G6**).
- `pipelines:list` still answers a non-admin outside a session (pin it: not gated).
- `sessions:pipelines`: owner → list; guest → `pipelines: []`; administrator who is a guest → list.

**Re-pin** tests that pin the old "any member reads prompts" rule, old → new, and list each in your report. Known: `config/panel/index.int.test.ts` ~337 ("offers a non-admin prompts…" loops over `{}` and `{ sessionId }`: outside a session a non-admin now gets no row), ~643 ("refuses a global edit to a non-admin" finds its prompt id in a non-admin's out-of-session view: take it from the admin's view, as ~406 does), `sockets/pipelines.promptWording.int.test.ts`, `sockets/presetFallback.int.test.ts` ~308. Grep the other files that call `namespaceView` / `pipelinesGet` / `pipelinesPromptWording` with a non-admin viewer and no `sessionId` (`groups.int.test.ts`, `sessionValues.int.test.ts`, `pipelines.scoping.int.test.ts`, `prompts.int.test.ts`, `ganged.int.test.ts`, `loadoutRow.int.test.ts`, `slotAddress.int.test.ts`) and re-pin only what the new rule breaks. Don't weaken an assertion to make it pass; say why each changed.

## How to run tests (exactly this; one run at a time)

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-1-w1-<n>.log 2>&1"
```
Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Run: your new file, every file you re-pinned, plus `config/panel/index.int.test.ts`, `pipelines.promptWording.int.test.ts`, `pipelines.scoping.int.test.ts`, `presetFallback.int.test.ts`, `sessions/settingsForm.int.test.ts`. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report errors in your files; another worker edits client files at the same time and will use the new `fieldId` param). `npx prettier --check` on your changed files (report, don't `--write`).

## Stop and ask (in your report, don't decide) when

A new user-facing sentence seems needed beyond the three quoted above; a non-admin flow outside a session turns out to need `pipelines:get` or `promptWording`; closing the guest's read would also hide the session detail view or their own cast; anything outside the files owned.

## Report

Changed files; the rule per event as built (who → what); tests run with pass counts and log paths; re-pins (old → new, why); open questions; Noticed, not done.
