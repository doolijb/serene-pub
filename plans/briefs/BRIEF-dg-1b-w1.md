# BRIEF — worker `dg-1b-w1` — the halt helper, and plain words on `sessions:runEnded`

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `dg-1b`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: run no git command that changes the index or the working tree (the lead has staged the repo). No SDK edit or build. No migration. Never `prettier --write`. Comments state the rule, never the history.

## Goal

Owner ruling DG1 (2026-11-17): "Regular users see the error and a basic generic user friendly description of the problem and a suggestion to notify admin." and "Actually we shouldn't allow non admins to see the full diags anyway, could be considered semi sensitive." An administrator still reads the full reason (P1). With accounts off the one person is the administrator (`sockets/auth.ts` attaches the first admin user, so `isAdmin` is true).

This worker adds the ONE helper every surface calls at its emit, and uses it on one surface: the `sessions:runEnded` frame.

## 1. The helper — `src/lib/server/pipelines/runtime/haltExplanation.ts`

Keep `HALT_WITHOUT_REASON` and `haltExplanation` exactly as they are. Add, using the reader test `src/lib/server/connections/visibility.ts` already exports (`connectionsVisibleTo(subject)` = `!!subject?.isAdmin`; type `ConnectionSubject`; do NOT edit visibility.ts):

```ts
/** The suggestion a non-administrator reads after a surface's plain sentence. */
export const ADMINISTRATOR_SUGGESTION = "An administrator can see the details."

/** A surface that shows a non-administrator a plain sentence in place of a run's halt. */
export type HaltSurface = "action" | "summary" | "prompt"

const PLAIN_HALT_SENTENCES: Record<HaltSurface, string> = {
	action: "The action could not finish.",
	summary: "The summary could not be written.",
	prompt: "The prompt could not be compiled."
}

export function haltExplanationFor(
	reader: ConnectionSubject | null | undefined,
	surface: HaltSurface,
	said: string
): string
```

- `said` is exactly the text the surface sends today. An administrator (`connectionsVisibleTo(reader)`) gets `said` unchanged.
- Anyone else (a member, a guest, `null` = "every member at once") gets `` `${PLAIN_HALT_SENTENCES[surface]} ${ADMINISTRATOR_SUGGESTION}` `` and nothing of `said`: no raw reason, no node key, no step name.
- No text matching of any kind on `said`. Pure; no I/O. `visibility.ts` imports only a type, so the module stays pure.
- Extend the module's header doc with the rule in two or three sentences (who reads what, why: the reason is a thrown message the SDK copies verbatim — URLs, model files, node keys — and only an administrator may read it). Keep the existing "Why the step is not named" section.

Tests, in the existing `src/lib/server/pipelines/runtime/haltExplanation.test.ts` (keep the existing cases). Use a `said` that carries a URL, a model file name and a node key, e.g. `"KoboldCPP API error at http://10.0.0.5:5001/api/v1/generate: model 'mistral-7b.Q4_K_M.gguf' not loaded (at 'respond.generate')"`:
- `{ isAdmin: true }` → returns `said` unchanged.
- `{ isAdmin: false }`, `{}` (a guest-shaped subject with no flag), `null`, `undefined` → equals the plain sentence + `" "` + `ADMINISTRATOR_SUGGESTION`, for each of the three surfaces; contains none of `http://`, `.gguf`, `respond.generate`.
- The suggestion appears exactly once in a non-administrator's text.

## 2. `sessions:runEnded` — `src/lib/server/sockets/sessions.pipelines.ts`, inside `finished` (≈ lines 830–842)

Re-read the lines first. Today the frame's `reason` is `explanation` (the raw `haltExplanation(receipt)` text). The frame is broadcast to EVERY member's page, guests included (`broadcastToSessionUsers`), and relayed to widget frames as `run:ended.reason`. Change ONLY that frame:

```ts
...(explanation !== undefined ? { reason: haltExplanationFor(null, "action", explanation) } : {})
```

So every recipient, administrators too, reads the plain words. Static import from `$lib/server/pipelines/runtime/haltExplanation` is fine (the module is pure). Update the comment above the block to state the rule (the frame goes to every member, so it carries the plain words, never the halt's own reason; the presser's own answer and card are unchanged).

Do NOT change anything else in this file: not the `pipelines:progress` terminal frame, not `fail(...)` / the fireAction answer at ≈ :905, not `haltStep` / `haltNodeKey`. Those are deliberately left for a later lane (a member-fixable reason, e.g. a seat-name refusal, reaches them through a receipt).

Test, in `src/lib/server/sockets/sessions.actions.int.test.ts`: the test at ≈ line 1574 ("a press whose run halts answers { halted: true, reason, runId }, and sessions:runEnded carries the halt and its sentence") currently expects the frame's `reason` to equal `res.reason`. Change it: the answer still has `halted: true`, `res.reason === res.error`, `res.reason` matches `/stop/` (unchanged surface); the frame is `{ sessionId, runId, outcome: "halt", reason: "The action could not finish. An administrator can see the details." }` and its reason is not `res.reason`. Rename the test title to say the frame carries plain words. Add one sibling test: the same press by an administrator (`fakeSocket(owner.id, true)`) → the frame's reason is the same plain words. Keep the 60_000 timeouts.

## Files owned

`src/lib/server/pipelines/runtime/haltExplanation.ts`, `src/lib/server/pipelines/runtime/haltExplanation.test.ts`, `src/lib/server/sockets/sessions.pipelines.ts` (the runEnded block and its import only), `src/lib/server/sockets/sessions.actions.int.test.ts` (those two tests only).

## Files readable

`src/lib/server/connections/visibility.ts`, `src/lib/shared/sockets/types.ts` (`Sockets.Sessions.RunEnded.Frame`), anything else for reading.

## Out of scope

Every other surface; `visibility.ts`, `generationStatus.ts`, `activityStore.ts`, `liveRow.ts`, `utils/runReply.ts`; `shared/sockets/types.ts`; docs; NOMENCLATURE; the client. A live lane (`gs-3a2`) owns `sockets/sessions.update.ts`, `sockets/sessions.participants.ts`, `sessions/seats.ts`, `sessions/guestSeats.ts`, `EditSessionForm.svelte`: never touch them.

## Stop and ask when

Anything above does not match the code as you find it; a test you did not list asserts the old runEnded reason; you would need a new name beyond the three exports above.

## Done means

Run, one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/runtime/haltExplanation.test.ts > /home/jody/github/serene-pub/plans/dg-1b-w1-1.log 2>&1"
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/sessions.actions.int.test.ts > /home/jody/github/serene-pub/plans/dg-1b-w1-2.log 2>&1"
```

(Run from `/home/jody/github/serene-pub`. Never pipe vitest into `head`.) Both green; `npx prettier --check` on each file you changed. Then report: files changed, the helper's final signature, tests run with pass/fail counts, anything that did not match this brief.
