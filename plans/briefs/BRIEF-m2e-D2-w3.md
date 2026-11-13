# BRIEF m2e-D2-w3 — review fixes: a press is a person's press; refusal echo; attach-helper tidy (2026-11-04)

Worker for lane **m2e-D2** (supervisor reads your report). Work from `/home/jody/github/serene-pub`, absolute paths only. Workers w1 and w2 are finished; their reports are `plans/briefs/REPORT-m2e-D2-w1.md` and `-w2.md` (read them for context).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## A — the run's cause needs a person's press, not just the `action` family
Owner ruling (C5 by cause, 2026-11-04): applet reach goes only to a call *"a mounted frame's own request or a person's press in it caused; event/lifecycle hooks, the schedule tick and pipeline nodes on routine/cadence/schedule runs get none"*. w1's `frameCauseOfRun` (`src/lib/server/pipelines/runtime/runTurn.ts:~556–568`) grants on any non-preview run of the `action` family. But `action` is also the default for runs nobody pressed: auto-advance (`sessions/autoAdvance.ts:233` → `fireTurnEntry` → `fireAction`), core's automatic read-aloud (`speech/onMessageSettled.ts:259`, `automatic: true`), and the action children a run fires (`runTurn.ts:~1421`, with `lineage`). Those must get none.
Fix with a positive marker set only at the person's press door:
1. `src/lib/server/pipelines/runtime/fireAction.ts`: `FireActionRequest` gains `personPress?: boolean` — doc: 🚧 (M2e) a person's press over the `sessions:fireAction` socket started this fire; never set by core's own fires (auto-advance, read-aloud, a run's child fire); the applet's frame-origin cause derives from it (`frameCauseOfRun`). Not `automatic` (which lifts the action's own on/off switch). Forward it into the `runSpec({...})` call at ~1012 as `...(req.personPress ? { personPress: true } : {})` — note the request variable there may be `req` (a routed copy of `pressed`); make sure the flag survives the routing (grep how `req` is built from `pressed`).
2. `runTurn.ts`: `SpecRunRequest` gains `personPress?: boolean` (doc: 🚧 (M2e) see `FireActionRequest.personPress`; absent on every other run). `frameCauseOfRun` becomes: `undefined` when `request.preview`, when `request.lineage` is set, or when `request.personPress !== true`; otherwise `appletOfSession(...)` → `frameCauseFor(id)` or `undefined`. Drop the `triggerFamilyOf(...) !== "action"` test and update the `Pick<…>` and the doc comment accordingly ("a person's press over the session's press door, on a session an applet genre draws; routine, event, automatic and child runs and previews get none").
3. `src/lib/server/sockets/sessions.ts` — **shared file; a story-playtest programme edits it right now. Re-read the exact lines immediately before EACH edit, exact-string replacement only, never reformat, never `prettier --write`.** In `sessionsFireActionHandler` (~2533), the two `fireAction(db, { … })` calls (~2597 and ~2844) each gain one line `personPress: true,` (one-line additive hunks; add a short comment on the first only if the surrounding style allows without reflowing).
4. Tests: update `src/lib/server/pipelines/runtime/frameCauseOfRun.int.test.ts`: applet session + `personPress: true` → `{ pluginId }`; applet session, `triggerFamily: "action"` with no `personPress` → undefined (the auto-advance / read-aloud case); `personPress: true` + `lineage: {...}` → undefined; `personPress: true` + `registration: { family: "routine", … }` — keep a routine case: a routine never sets personPress, so a routine registration with no personPress → undefined; preview → undefined; ordinary session + `personPress: true` → undefined. If `src/lib/server/pipelines/runtime/fireAction*.test.ts` exists with a cheap seam, add one assertion that `personPress` reaches `runSpec`; if not cheap, say so in the report.

## B — the provided-book switch's refusal names its row (coordinator, from lane m2e-C2)
The admin page cannot tie a refusal of `plugins:disableProvidedBook` / `plugins:enableProvidedBook` to its row (two quick presses show the error beside the last row).
5. `src/lib/server/sockets/plugins.ts` `providedBookDisabledHandler` (~680–720): give its `refusable(event, body, fallback)` the 4th arg `undefined` (no translate) and the 5th `echo`: `(raw) => ({ ...(typeof raw?.pluginId === "string" ? { pluginId: raw.pluginId } : {}), ...(typeof raw?.slug === "string" ? { slug: raw.slug } : {}) })` (typed defensively — `echo` is handed unchecked params; see `src/lib/server/sockets/refusable.ts:29–33` and `sockets/pluginActions.ts`'s echo for the pattern). Both events share the factory, so both get it.
6. `src/lib/shared/sockets/types.ts` `Sockets.Plugins.SetProvidedBookDisabled` (~1340): add `interface ErrorResponse { error: string; pluginId?: string; slug?: string }` with a one-line doc (🚧 (M2e) the refusal names the book it was about, so the admin page ties it to its row). This follows the file's existing `ErrorResponse` pattern (e.g. ~4174).
7. Test in `src/lib/server/plugins/providedBooks.int.test.ts` (it already exercises these handlers): a refused toggle (a non-admin socket, and an unknown slug for an admin) emits `plugins:disableProvidedBook:error` (and once `plugins:enableProvidedBook:error`) with `{ error, pluginId, slug }` equal to what was sent; the handler still throws/rejects as `refusable` does.

## C — tidy the attach helper's callers (w2 left dead reads)
8. `isNewAttachOfDisabledBook(db, lorebookId, sessionId?)` (`plugins/providedMarks.ts`) now reads the book itself. The three selects that fetched `uuid` and `extraJson` only for the old inline check — `src/lib/server/library/writes.ts` (~298–304 and ~382–388) and `src/lib/server/sockets/summarize.ts` (~551–556) — no longer use them: remove those two keys from each select ONLY if nothing else in that block reads `book.uuid` / `book.extraJson` (grep the block). Do not touch anything else in those files.
9. Add one direct test of the helper to `providedBooks.int.test.ts`: missing book → false; a provided book not disabled → false; disabled + no sessionId → true; disabled + a session reading another book → true; disabled + the session already reading it → false.

## Run (only these)
`npx vitest run src/lib/server/pipelines/runtime/frameCauseOfRun.int.test.ts src/lib/server/plugins/providedBooks.int.test.ts src/lib/server/plugins/pluginActions.int.test.ts src/lib/server/pipelines/runtime/pluginBindings.int.test.ts src/lib/server/sockets/summarize.setLorebookAnnounce.int.test.ts src/lib/server/library` plus any `fireAction*` test you touched, and `npx tsc --noEmit -p . > <scratch file>` then grep it for your files. Never pipe vitest into `head`. Int tests opening a DB in an `it` need 60 s timeouts.

## Files owned (edit only these)
`src/lib/server/pipelines/runtime/fireAction.ts` (the field + its forward), `src/lib/server/pipelines/runtime/runTurn.ts` (`SpecRunRequest.personPress`, `frameCauseOfRun`), `src/lib/server/sockets/sessions.ts` (the two one-line hunks only), `src/lib/server/sockets/plugins.ts` (the handler's `refusable` call only), `src/lib/shared/sockets/types.ts` (the `ErrorResponse` hunk only), `src/lib/server/library/writes.ts` and `src/lib/server/sockets/summarize.ts` (the select keys only), and the test files named above. Never touch `src/lib/server/auth/actingPerson.ts`, client files, NOMENCLATURE, docs, or the SDK.

## Rules (quoted from CLAUDE.md / NOMENCLATURE — they bind you)
- *"Decide implementation inside the asked scope … name the choice in your report."* *"Propose and wait … on … a new name / setting / flag / abstraction / event …"* — `personPress` and `ErrorResponse` here are approved by the supervisor; any OTHER new name: stop and report.
- *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."*
- NOMENCLATURE R1 *"One word, one meaning"* — `personPress` is not `automatic`, not `ActingVia`'s `press` (say so in its doc).
- *"Sockets: … the only place that toasts …"* — no toaster in server code; you only add an echo.
- *"Inside `db.transaction(async (tx) => …)` use only `tx`."*
- Shared files (`sockets/sessions.ts`, `runtime/host.ts`): re-read immediately before each edit; additive hunks only.

## Report
Write `plans/briefs/REPORT-m2e-D2-w3.md`: changed files (one line each), tests run with pass/fail counts, Noticed-not-done, and the one-line answer to any relayed status question.
