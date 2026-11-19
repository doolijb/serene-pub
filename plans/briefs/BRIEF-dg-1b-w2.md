# BRIEF — worker `dg-1b-w2` — plain halt words on Summarize, the token count error, and the handler fallback

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `dg-1b`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: run no git command that changes the index or the working tree (the lead has staged the repo). No SDK edit or build. No migration. Never `prettier --write`. Comments state the rule, never the history. Inside `db.transaction(async (tx) => …)` use only `tx`.

## Goal

Owner ruling DG1 (2026-11-17): "Regular users see the error and a basic generic user friendly description of the problem and a suggestion to notify admin." and "Actually we shouldn't allow non admins to see the full diags anyway, could be considered semi sensitive." An administrator still reads the full reason. With accounts off the one person is the administrator (`sockets/auth.ts` attaches the first admin user, so `socket.user.isAdmin` is true).

The helper exists already (worker w1), in `src/lib/server/pipelines/runtime/haltExplanation.ts`:

```ts
export const ADMINISTRATOR_SUGGESTION = "An administrator can see the details."
export type HaltSurface = "action" | "summary" | "prompt"
export function haltExplanationFor(
	reader: ConnectionSubject | null | undefined, // { isAdmin?: boolean | null }
	surface: HaltSurface,
	said: string // exactly what the surface sends today
): string
// administrator → `said` unchanged; anyone else → "<surface's plain sentence> An administrator can see the details."
// plain sentences: summary "The summary could not be written.", prompt "The prompt could not be compiled."
```

Do not edit that module. Import it statically (it is pure; note some tests `vi.mock("$lib/server/pipelines/runtime/runTurn")`, which does not touch this module). No text matching on any reason. Re-read every line range before editing; the numbers below are approximate.

## 1. Summarize (world / character lore) — `src/lib/server/sockets/summarize.ts` ≈ 315–322

Today, when the run produced no `synth` content: `failRun(haltNodeKey ? \`${why} (at '${haltNodeKey}')\` : why)` with `why = receipt.haltReason ?? "the pipeline stopped without producing a summary"`. `failRun` writes the Activity card's `errorMessage` and emits `sessions:summarize:error` to the socket that asked. Change only that call: `failRun(haltExplanationFor(socket.user, "summary", <today's text>))`. `socket` is the handler's own. Leave every other `failRun` (the "No messages found…", "registers no … summary" sentences) as written.

## 2. Scene summary — `src/lib/server/sockets/scenes.ts` ≈ 2282–2289, inside `processScene`

The same shape: `failRun(haltNodeKey ? \`${why} (at '${haltNodeKey}')\` : why)`. `failRun` writes the card's `errorMessage`, sets the scene's summary status `failed` and throws `new Error(error)`, which `refusable()` answers on `scenes:process:error` to the asker. `processScene(userId, …)` has no socket: the routine calls it with `{ user: { id: userId } }` (no `isAdmin`). So read the reader's flag from the database by `userId` at this failure only, e.g. `const reader = await db.query.users.findFirst({ where: eq(schema.users.id, userId), columns: { isAdmin: true } })` (use whatever query style the file already uses), then `failRun(haltExplanationFor(reader, "summary", <today's text>))`. One read, on this failure path only. Leave the other `failRun` calls (≈ 2097, 2129, and the save failure ≈ 2360) as written, and the catch's `activityError(err)` path untouched.

## 3. The token count error — `src/lib/server/sockets/sessions.messages.ts` ≈ 2406–2412, `promptTokenCountHandler`

Today: `error: \`The prompt could not be compiled: ${receipt.outcome}\` + (haltNodeKey ? \` at '${haltNodeKey}'\` : "") + (haltReason ? \` — ${haltReason}\` : "")`. Change to `error: haltExplanationFor(socket.user, "prompt", <today's text>)`. Touch nothing else in this file (other lanes own it); not the `readsPrompt` gate, not the catch's "Failed to calculate prompt token count."

## 4. The generic handler fallback — `src/lib/server/sockets/runHandler.ts` ≈ 103

Today every handler that words no refusal answers `"An error occurred while processing your request."`. A non-administrator gets that sentence and the suggestion: `connectionsVisibleTo(socket.user) ? FALLBACK : \`${FALLBACK} ${ADMINISTRATOR_SUGGESTION}\`` (`connectionsVisibleTo` from `$lib/server/connections/visibility`; `ADMINISTRATOR_SUGGESTION` from the helper module). An administrator's text is unchanged. Keep `answerAsker` and everything else as is.

## Tests

A reason that carries a URL, a model file name and a node key, e.g. haltReason `"KoboldCPP API error at http://10.0.0.5:5001/api/v1/generate: model 'mistral-7b.Q4_K_M.gguf' not loaded"`, haltNodeKey `"drafting.item.draft"` (or `"respond.render"` for the prompt).

- **Summarize** — `src/lib/server/sockets/summarize.int.test.ts` (it mocks `runSpec` via `runSpecMock`): `runSpecMock` resolves a receipt with no `synth` content, `outcome: "err"`, the reason above. A non-administrator owner's socket → the `sessions:summarize:error` payload's `error` and the Activity card's `errorMessage` (read it however the file already reads the card, e.g. `activityStore`) both equal `"The summary could not be written. An administrator can see the details."` and contain none of `http://`, `.gguf`, the node key. An administrator owner → the error is today's text (`${reason} (at 'drafting.item.draft')`). (A guest is refused before any run: summarize needs the owner; say so in a comment, no test.)
- **Scene summary** — `src/lib/server/sockets/scenes.notes.int.test.ts` mocks `runSpec` and calls `processScene(owner.id, …)` directly; add a test there (or, if its fixtures fight you, a new file `src/lib/server/sockets/scenes.haltWording.int.test.ts` copying its setup): a run with no `synth` content and the reason above → for a non-administrator owner the thrown error's message and the card's `errorMessage` are the plain words and contain none of the three; for an owner whose `users.is_admin` is true, today's text. This also covers the routine (no `isAdmin` on its socket).
- **Token count** — the error branch needs a preview receipt with no `preview.context.rendered`. If `src/lib/server/sockets/promptTokenCount.int.test.ts` cannot force that, add a new file `src/lib/server/sockets/sessions.promptTokenCount.haltWording.int.test.ts` that `vi.mock`s `$lib/server/pipelines/runtime/runTurn`'s `runTurn` to resolve `{ outcome: "halt", haltNodeKey: "respond.render", haltReason: <the reason>, nodes: [] }` (copy the minimum setup from the existing file). Assert: non-administrator owner and a guest (`session_guests` row, as the existing file seeds `ptc-guest`) → `error === "The prompt could not be compiled. An administrator can see the details."`, none of the three substrings; an administrator → today's text including the reason.
- **Fallback** — `src/lib/server/sockets/index.interestGate.test.ts` asserts `GENERIC_ERROR` for a `NON_ADMIN` in two places (≈ 486, 506): those now expect `` `${GENERIC_ERROR} ${ADMINISTRATOR_SUGGESTION}` ``. Add one case: the same failing handler fired by `ADMIN` answers `GENERIC_ERROR` alone. List every existing assertion you changed in your report.

## Files owned

`src/lib/server/sockets/summarize.ts` (that one call), `src/lib/server/sockets/scenes.ts` (that one call and its reader read), `src/lib/server/sockets/sessions.messages.ts` (the token-count error only), `src/lib/server/sockets/runHandler.ts` (the fallback sentence), and the test files named above (new ones allowed with exactly those names).

## Files readable

Everything.

## Out of scope

`haltExplanation.ts`, `connections/visibility.ts`, `generationStatus.ts`, `activityStore.ts`, `liveRow.ts`, `utils/runReply.ts`, `sockets/sessions.pipelines.ts`, `routines/log.ts`, `sockets/routines.ts`, `offerMessage.ts`, `deletion.ts`, `shared/sockets/types.ts`, docs, NOMENCLATURE, the client, the SDK. A live lane (`gs-3a2`) owns `sockets/sessions.update.ts`, `sockets/sessions.participants.ts`, `sessions/seats.ts`, `sessions/guestSeats.ts`, `EditSessionForm.svelte`: never touch them.

## Stop and ask when

The code does not match this brief; a test you did not expect asserts one of the old texts; you would need a new exported name or a new parameter on `processScene`.

## Done means

From `/home/jody/github/serene-pub`, one run at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, always naming the paths:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > /home/jody/github/serene-pub/plans/dg-1b-w2-<n>.log 2>&1"
```

Run: `index.interestGate.test.ts`; `summarize.int.test.ts`; the scenes test file you changed or added; the token-count test file. Also re-run `summarize.registrations.int.test.ts` and `scenes.notes.int.test.ts` (unchanged neighbours). Never pipe vitest into `head`. All green; `npx prettier --check` on each file you changed (report pre-existing drift as such). Report: files changed, each surface's before → after text for a non-administrator, tests run with pass/fail counts, every existing assertion changed, anything that did not match.
