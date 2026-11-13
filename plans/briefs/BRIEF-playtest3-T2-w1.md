# BRIEF playtest3-T2-w1 — the host stamps the narrator's unprompted line with `turnCause`

Lane `playtest3-T2`, worker 1 (server). Supervisor reads your report. Report path: put your full report in your final message (changed files, diff summary, tests run with exact command and pass/fail counts, anything you could not do, Noticed-not-done).

## Goal
A narration written on an **unprompted NARRATOR turn** carries `metadata.turnCause = { via: "unprompted", every: n }`, stamped by the host at insert. Nothing else gets it.

1. **`src/lib/server/pipelines/runtime/host.ts` — `HostScope` (interface at ~line 177; neighbours `auto?: boolean` ~396):** add one optional field
   ```ts
   /**
    * How this turn was reached — the fired entry's `via` (`runTurn`'s request; `strategy`,
    * `script`, `voice`, `pick`, `narrate`, `unprompted`…). Read by the message write, which
    * stamps an unprompted narrator line's `turnCause` (★T-1). Absent on a host wired by hand.
    */
   via?: string
   ```
2. **`src/lib/server/pipelines/runtime/runTurn.ts` (~line 896, the scope literal beside `auto: request.auto`):** add `via: request.via,` with a one-line comment. `request.via` already exists (~line 188). Do not change anything else in runTurn.
3. **`host.ts` insert (~7308-7370, the `create-message` commit):**
   - The strip, exactly as `answersForm` is stripped (~7312-7315): `const { answersForm: _claimed, turnCause: _cause, ...givenMetadata } = (p.metadata ?? {}) …` — and extend the comment above it: `turnCause` is the host's fact too; a spec's or a client's copy is dropped.
   - The stamp: only on a FRESH insert (not the claimed-row branch, not the person's-line branch) AND `scope.via === "unprompted"` AND `narration` (`p.narration === true`, which becomes `isNarratorResponse`) AND no `speakerRef` AND no `sideCharacter`. Then `metadata.turnCause = { via: "unprompted", every: n }`.
     ⚠ `speakerRotation.ts:818` gives a *Let others speak up* side-cast pick the SAME `via: "unprompted"`; that row is a character's reply (`characterId`, no narration) and must get NO stamp. The conditions above exclude it; keep them all.
     Simplest placement: compute it where `metadata` is built (the object literal ~7316), guarded by the conditions; the claimed branch never writes `metadata` (it only writes `withFoldedSections(existing.metadata…)`), and the person's-line branch is `personLine` — make sure the stamp cannot land on a `personLine` row (add `!personLine` to the guard).
   - `n` = the session's resolved cadence: `genreFieldsFor(db, sessionId)` (lazy `await import("$lib/server/pipelines/entities/sessionGenres")`, the pattern at host.ts ~1946) → `.narratorInterjections` → `narratorCadenceKey(...)` from `$lib/shared/sessions/narratorCadence` (read-only import; do NOT edit that file) → `"every-2nd-round"` → 2, `"every-3rd-round"` → 3, anything else (incl. `"every-round"`, and a value that reads off by a race) → 1. This mirrors `UNPROMPTED_MODES_SCRIPT` (`../serene-pub-sdk/core-catalog/src/factories/turnOrder.ts:75`) and `unpromptedEntries`' "a positive integer, else 1". A small local helper in host.ts is fine; read the field only when the guard holds (no extra read on every insert).
4. **Verify, do not change:** a claimed row (regenerate / swipe / extend, host.ts ~7417-7443) keeps its stored metadata, so the stamp survives; the streaming write (`liveRow.ts` ~303-313, `jsonb_set` of `reasoning` only) and the final save (`host.ts` ~7863+, `buildReasoningMetadata(current.metadata, …)` in `messages/reasoningMetadata.ts`) merge rather than replace. Read them and say in the report, with line numbers, whether `turnCause` survives each. If one of them DROPS it, do not fix it — report it.

## Tests — `src/lib/server/sockets/sessions.taskVoices.int.test.ts` (add to it; keep every existing case unchanged)
- In the existing case "every 2nd round under Whole round": the second round's narration row has `metadata.turnCause` **toEqual** `{ via: "unprompted", every: 2 }`; and no row of the first round has `turnCause`.
- In the existing case "on: …": the narration row has `turnCause` `{ via: "unprompted", every: 1 }` (legacy `full` reads as every round); the **side-cast** line (the third character line, `ids[0]`) has **no** `turnCause` (`toBeUndefined()`), nor do the first two cast lines.
- New case "a pressed Narrate carries no turnCause": on a fresh session (`minimalWithTwo` with `narratorInterjections: "every-round"` is fine, or off), press Narrate the way a person does — `runReply({ … turn: { kind: "narrate" } })` from `$lib/server/utils/runReply` without `via` (or `via: "narrate"`), see `sockets/sessions.ts` ~10255 for the handler's call — then the new narration row has no `turnCause`. Settle afterwards.
- New case "a spec-supplied turnCause is stripped; the host's stands": use `createHost(db, { sessionId, userId: ownerId, via })` from `$lib/server/pipelines/runtime/host` and its `commit!({ sessionId, text, narration: true, metadata: { turnCause: { via: "unprompted", every: 9 } } }, { key: "save", definitionId: "core:outlet/create-message" } as any)` (the pattern in `pipelines/runtime/unclaimedSpeaker.int.test.ts:35-42`). With `via: "pick"` → the row has no `turnCause`. With `via: "unprompted"` on a session whose `narratorInterjections` is `"every-3rd-round"` → `turnCause` is `{ via: "unprompted", every: 3 }` (the host's, not the 9). Also an unprompted commit with `characterId` (a character's line, no narration) → no `turnCause`.
- Every `it` that opens or writes the DB gets a 240_000 timeout like its neighbours.
- Also run unchanged: `src/lib/server/pipelines/runtime/speakerRotation.unprompted.test.ts` (must stay green, untouched).

Run exactly (one at a time, read the log after; never pipe vitest into `head`):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/sessions.taskVoices.int.test.ts src/lib/server/pipelines/runtime/speakerRotation.unprompted.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-T2-w1-1.log 2>&1; echo exit=$?'
```
(increment the `-1` suffix per run). Then `npx prettier --check` on each file you changed (report the result; pre-existing prettier failures are not yours to fix — say so).

## Files owned (edit only these)
- `src/lib/server/pipelines/runtime/host.ts` — ONLY the `HostScope.via` field and the insert's strip + stamp. Nothing else in this 11k-line file.
- `src/lib/server/pipelines/runtime/runTurn.ts` — ONLY the `via: request.via` line on the scope.
- `src/lib/server/sockets/sessions.taskVoices.int.test.ts` — the tests above; you may also change its header comment's *Narrator asides* to *Narrator's turn* (the setting's label is being renamed; the stored key `narratorInterjections` stays).

## Files readable
Everything. Never edit: `speakerRotation.ts`, `shared/sessions/narratorCadence.ts`, `sessions/settingsForm.ts`, `db/defaults.ts`, `NOMENCLATURE.md`, anything in `../serene-pub-sdk`, any scenes file.

## Out of scope — never build
A new request kind; a *Spoke up* badge or any stamp on side-cast lines; a setting; renaming the stored key; a migration or column; a new parameter on any exported function other than the optional `HostScope.via` field.

## Stop and report (do not decide) when
The stamp would need a column; `via` cannot reach the insert through `HostScope`; you would need any name beyond `turnCause` and `HostScope.via`; a claimed-row or save path drops `turnCause`; an existing test fails for a reason outside your change.

## Rules you work under (quoted from CLAUDE.md / the lane brief)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "0.6 is in users' hands. A change to stored data or ids ships with a forward migration…" — `turnCause` is an additive optional metadata key: every reader must still work on rows that lack it (old rows simply have no badge). No migration.
- "Stored data. … an additive field is fine only if every reader still works on rows that lack it."
- "An int test that opens a DB inside an `it` gets a 60 s timeout" (this file uses 240 s; keep that).
- Never `kill -9` anything. Never start a dev server.
- Do what was asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need `sdk:build` at all.)
