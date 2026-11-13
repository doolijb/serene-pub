# BRIEF playtest3-A4-w1 — move the form-answer gate from the event to the answer spec's door

Lane `playtest3-A4` · worker 1 · supervisor reads your diff. Report in your final hand-back (no report file).

## Goal
Today `dispatchAddressedForms` (`src/lib/server/pipelines/runtime/runTurn.ts` ~1539-1640) returns BEFORE `dispatchSessionEvent` when the session's genre does not opt into `forms.modelAnswers`, so every registration on `core:event/form-addressed@1` (a plugin's logging/notifying listener too) is suppressed. The owner's ruling (2026-11-04, P1) gates the AI's ANSWER, never the event. Build:

1. **`dispatchAddressedForms`**: delete the whole `if (!optedIn) { … return }` block. The dispatch loop below it now runs in every genre. Keep the `optedIn` value but read it through the new helper (step 3): `const optedIn = await sessionModelAnswersForms(request.db, request.sessionId)`, and use it ONLY to gate the progress frame: `if (answerSpec && optedIn) await announceChildRun(request, receipt, answerSpec)` (off, the answer spec halts before its first node, so a frame naming it would stand on the card for a run that never ran). Rewrite the 3-line `// 🚧 P1:` comment above it to say: the event dispatches in every genre; the AI's answer is gated at the answer spec's door (`runSpecOnce`); `optedIn` only decides whether the card announces the answer run. Update the function's JSDoc if it says otherwise.

2. **The door — `runSpecOnce`** (same file, ~683). Immediately after `const doc = await applyNodeRebinds(request.db, loaded, { … })` (~703-707) and before `specOwnerPluginId`, insert:

```ts
	// 🚧 P1 (owner 2026-11-04): the AI's form answer is off until the genre
	// opts in (`forms.modelAnswers`). The gate is the answer's own door, not
	// the event's: `form-addressed` dispatches in every genre and its other
	// registrations run. A document that commits an AI's answer — it holds
	// `core:outlet/answer-form`, which `validate()` places only under the
	// form-addressed inlet — halts here, before its first node and any model
	// call, on a receipt under its own spec that says why.
	if (
		request.lineage &&
		doc.nodes.some((n: { definitionId: string }) => n.definitionId === "core:outlet/answer-form") &&
		!(await sessionModelAnswersForms(request.db, request.sessionId))
	) {
		const { refusalReceipt } = await import("$lib/server/pipelines/runtime/sessionEvents")
		return refusalReceipt(request.db, {
			runId: request.runId ?? uuidv4(),
			specId,
			sessionId: request.sessionId,
			userId: request.userId,
			lineage: request.lineage,
			reason: MODEL_ANSWERS_OFF_REASON
		})
	}
```
   Check the exact `definitionId` spelling the host matches (`host.ts` ~9817 `case "core:outlet/answer-form":` — no version suffix) and that `doc.nodes` elements carry `definitionId` (see `inletDefinitionIdOf`, ~1512). If `doc.nodes` is already typed, drop the inline annotation. `MODEL_ANSWERS_OFF_REASON` is the existing module const (~1521); keep it where it is (module scope, initialised before any run).

3. **The helper**, placed directly under `genreModelAnswersForms` (~1529):

```ts
/** 🚧 Does this session's genre opt in to the AI answering forms? Its genre as the press door reads it (`sessionGenreOf`). */
async function sessionModelAnswersForms(db: Db, sessionId: number): Promise<boolean> {
	const { sessionGenreOf } = await import("$lib/server/sessions/annexFields")
	return genreModelAnswersForms((await getSessionGenre(db, await sessionGenreOf(db, sessionId)))?.shape)
}
```
   NOT exported. `getSessionGenre` is already imported at the top of runTurn.ts (line ~78); `Db` is already the type `SpecRunRequest.db` uses — use that same import. **R1: `genreModelAnswersForms` stays the only reader of `shape.forms.modelAnswers`** — never read the shape field anywhere else.

4. **`/home/jody/github/serene-pub-sdk/INTEGRATING.md`** ~402-407: replace exactly the text from `— **only when the session's genre opts in**` through `(forms.modelAnswers)."*` (keep the following `A person or nobody: the block waits. Four things a host wired by hand should know:`) with:

```
— in every genre. 🚧 2026-11-04: what a genre opts into is the AI's **answer**, never the event
(`shape.forms.modelAnswers === true`): without it, a dispatched run whose document commits an
answer (`core:outlet/answer-form`) halts at `runSpec`'s door before its first node — no model
call — on a halted receipt under that spec (`refusalReceipt`), reason *"The AI does not answer
forms in this genre: the genre does not opt in (forms.modelAnswers)."*; the event's other
registrations run as before.
```
   Keep the surrounding line-wrapping style (~100 cols). Touch nothing else in that file.

## Files owned (re-read each immediately before editing; use Edit, never Write)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/runTurn.ts` — only `dispatchAddressedForms`, the new helper, the door in `runSpecOnce`.
- `/home/jody/github/serene-pub-sdk/INTEGRATING.md` — the one sentence.

Other lanes edit the same trees right now (lane S7 in `sockets/scenes.ts` and scene files). Never touch any other file: not `sessionEvents.ts`, not `fireAction.ts` (its `modelAnswersFormsHere` press door is the lead's), not `bindings.ts`, not `host.ts`, not `NOMENCLATURE.md`, not anything under the SDK's `sdk/src`. Tests are worker 2's.

## Out of scope — never built
Any change to who may answer a form (the press door); any setting; a cause mark on the answered block (★A3); any new exported name, payload field or dispatch option. If the code does not fit as written (types, a missing import), make the smallest fix and say so; if it needs a new field anywhere, stop and report.

## Check, then report
- `cd /home/jody/github/serene-pub && npx prettier --check src/lib/server/pipelines/runtime/runTurn.ts` (report the result; if it fails only on lines you did not touch, say so and leave them).
- Typecheck only your file's errors: `cd /home/jody/github/serene-pub && npx tsc --noEmit -p . 2>&1 | grep "runtime/runTurn.ts"` is NOT allowed (whole-project tsc is banned). Instead read your edit back and check the types by eye against `SpecRunRequest` (~264) and `refusalReceipt`'s signature (`sessionEvents.ts` ~1148). Run no tests; worker 2 does.
- Hand back: the exact diff (`cd /home/jody/github/serene-pub && git diff -- src/lib/server/pipelines/runtime/runTurn.ts`, and `cd /home/jody/github/serene-pub-sdk && git diff -- INTEGRATING.md` — read-only git only), anything you changed beyond this brief and why.

## Standing rules (verbatim from the lead)
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`: INTEGRATING.md is docs.)
- CLAUDE.md Hard rules that touch this: inside `db.transaction(async (tx) => …)` use only `tx`; never `prettier --write`.
