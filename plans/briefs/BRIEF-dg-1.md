# BRIEF — build lane `dg-1` — diagnostics are administrators' only; everyone else reads a plain description of a failure and a suggestion to tell an administrator (owner ruling DG1 of 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then the DG1 line and the block "Rulings page, third round, first answers"
in `plans/PLAN-programme-2026-11-15.md`, row D76 in `plans/DISCUSS-LATER.md`,
`plans/REPORT-gs-1-2026-11-16.md`, `plans/REPORT-gs-2a-2026-11-16.md` (who sees prompts, debug meta, Inspect
run; `pipelineReaderOf`, `visibleTo`, `withoutDebugMeta`, `rowShownTo`), `src/lib/server/messages/debugMeta.ts`
(`readsPrompt` / `promptReaders`, written today by task `gs-4`), `docs/sessions.md` and `docs/group-sessions.md`
(who sees what), `docs/users-and-accounts.md`, `docs/system-settings.md` (diagnostics), `STYLE-GUIDE.md` copy
and a11y rules (errors explain what went wrong and what to do; absent, never disabled), `NOMENCLATURE.md` §1,
§24 and rows **Prompt details**, **Inspect run**, **administrator**, **member**, **guest**, **session owner**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only, never `--write`. **No migration.** Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/dg-1-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.
Comments state the rule, never the history. Views never toast (one domain context per event family toasts).
Live lanes, not yours: `ap-1` (`lorebooks/ownBook.ts`, `utils/ownedBook.ts`, `sockets/sessions.overlay.ts`,
`SessionViewPanel.svelte`), `gs-3a2` (`sockets/sessions.update.ts`, `sockets/sessions.participants.ts`,
`sessions/seats.ts`, `sessions/guestSeats.ts`, `EditSessionForm.svelte` and its seat components).
`shared/sockets/types.ts` is shared: re-read right before each edit, add only your own fields.

## Owner

2026-11-17 (D64 note): "Actually we shouldn't allow non admins to see the full diags anyway, could be
considered semi sensitive." 2026-11-17 (DG1, confirming the lead's reading that this takes Prompt details and
Inspect run from an owner who is not an administrator): "Correct on d64. I was not considering the users
permission level. Regular users see the error and a basic generic user friendly description of the problem and
a suggestion to notify admin."
Reversed for owners: G5 (2026-11-16) "The session's owner and administrators only". Quote both in NOMENCLATURE
§25. Standing: members never see or touch model plumbing (connections, models, sampling, loadouts); D58
(2026-11-16) the session's owner picks a prompt and reads its **wording**: that is not diagnostics and stays;
P3 (a fresh install plays after one guided model step: with accounts off the one person is the administrator
and loses nothing).

## Step 0 — a table before any change (in the report)

Every place a person can read something about how a run went. Per surface: what it shows, to whom today
(owner / guest / administrator in the session / administrator elsewhere), where the server decides, where the
client decides. At least: **Prompt details** on a reply; **Inspect run**; the message token count (leave as
is: open question DG2); a failed reply's notice in the session (what text: the provider's raw error? a model
or connection name? a stack?); run-error toasts; the Activity view's entries and the LLM queue; the composer's
"Sessions can't reply yet…" lines; step time-limit notices; the Runs tab; anything in widget envelopes
(`session.…`) that carries run errors; socket `:error` replies that pass a raw message through. Mark each:
diagnostics (administrators only) / a failure a person must be told about (plain words) / neither.

## Build

1. **Administrators only.** Prompt details and Inspect run: the server sends their data only to an
   administrator (in the session as owner or guest; an administrator outside the session keeps the admin run
   inspector as today), and the client shows the controls only then. `readsPrompt` / `promptReaders` is the
   one decision for prompt data: change it there (owner → administrator); find Inspect run's one decision and
   do the same; no `isAdmin` sprinkled at call sites. A session's owner who is not an administrator receives
   no prompt text, no retrieved lore listing, no model output record and no run inspector payload: test the
   serialised payloads.
2. **What a non-administrator reads when something fails.** For each surface Step 0 marks "a person must be
   told": the server sends a non-administrator a **plain description** and no raw provider text, model or
   connection name, URL, key fragment or stack; an administrator still gets the detail. One shared function
   builds the plain form from the failure's kind (use the kinds the code already has: find the existing
   error classification for run failures; **add no new taxonomy**: if none exists, two sentences only, "can't
   reply right now" and "stopped before it finished", and report). Each plain message: what happened in one
   sentence, then **the suggestion to tell an administrator** (one shared sentence; with accounts off, or when
   the reader is the administrator, that sentence is absent and the detail shows). Existing plain sentences
   that already fit (e.g. "Sessions can't reply yet. The Reply loadout has no model.": check whether a member
   should read the word "loadout": members never see model plumbing) are reworded only where they name
   plumbing to a non-administrator. Every new or changed sentence is ★ in the report with one alternative.
3. **Docs and names:** `docs/sessions.md`, `docs/group-sessions.md`, `docs/users-and-accounts.md`,
   `docs/system-settings.md` where they say who sees diagnostics; NOMENCLATURE rows **Prompt details**,
   **Inspect run**, **guest**; §25 with both quotes and dates. Task `gs-4`'s sentences ("the session's owner
   and an administrator who is in the session") become "an administrator".

## Tests

Server, per surface: administrator-owner, administrator-guest, non-administrator owner, non-administrator
guest → what the serialised payload carries (prompt text / raw error absent for both non-administrators;
present for both administrators). The plain-description function per failure kind. With accounts off the one
person gets everything as before. Client DOM: controls absent for a non-administrator owner; the failed-reply
notice shows the plain sentence and the suggestion for a non-administrator, the detail for an administrator.
Existing tests that assert an owner sees Prompt details are changed to the new rule and listed in the report.
`tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`src/lib/server/messages/debugMeta.ts` and its callers' use of it; the Inspect run decision and payload; the
failure-text path Step 0 finds (server and the one client context that shows it); `shared/sockets/types.ts`
(own fields); the client controls for Prompt details and Inspect run; their tests; the docs; NOMENCLATURE.

## Stop and ask when

CLAUDE.md §Decisions applies; Step 0 finds a surface where hiding detail would leave a non-administrator
owner unable to fix something only they can fix (list it, change nothing there); a plain description needs a
failure taxonomy that does not exist; the admin run inspector would have to change; the token count would
have to move (DG2 is open).

## Report

Final message = the report (lead saves `plans/REPORT-dg-1-<date>.md`), under about 650 words: the Step 0
table; the two decisions (file:line); the plain-description function and its sentences (each ★ with one
alternative); tests changed; **Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

**The lane is cut in two: `dg-1a` (this brief: the Prompt details gates) and `dg-1b` (failure wording: a
read-only audit first, briefed separately). Build nothing of "Build 2" here.**

1. **Inspect run is already administrators' only and is not touched.** R55 / E1d (2026-09-23,
   `NOMENCLATURE.md:2394`): "Receipts are an administrator's … Inspect / Inspect run render for admins only."
   (`sockets/pipelines.ts` 679–688 `receiptsAdminOnly`; client `requests/inspectRun.ts`, `runInspection.ts:2`;
   the Runs tab gate in `SessionViewPanel.svelte:79`, lane `ap-1`'s file.) Any administrator inspects any
   session's runs, in the session or not: unchanged. G5 only ever covered Prompt details.
2. **Prompt data is decided in four places, all in this lane:**
   - `messages/debugMeta.ts` `readsPrompt` / `promptReaders`: owner-or-administrator-guest → **administrator
     who is in the session (as owner or guest)**. An administrator outside the session is unchanged.
   - `sockets/utils/broadcastHelpers.ts` ~306–330: `if (r.userId === owner?.userId) return r` hands the owner
     the raw row. The owner keeps scene text (`withoutSceneText` is theirs alone); `debugMeta` follows
     `promptReaders`.
   - `sockets/sessions.messages.ts` ~2425–2439 `promptTokenCountHandler`: a non-administrator owner gets the
     guest's shape, `{ meta: { tokenCounts } }` (the count itself is unchanged: DG2 stays open); an
     administrator in the session gets the compiled prompt and report as the owner does today.
   - Client: `sessionPage/sessionPageProjections.ts` ~966–972 and `sessionPage/requests/index.ts` ~416–422 with
     `requests/promptDetails.ts`: read the administrator flag only; the refusal sentence names administrators.
3. **Do not touch `pipelineReaderOf` / `readerFor`** (`sockets/pipelines.ts` 170–177, `config/panel/scopes.ts`):
   choosing a prompt and **Read the wording** stay the session owner's (D58, 2026-11-16).
4. **Accounts off:** the session is signed in as the first administrator (`sockets/auth.ts` 163–175) and
   `promptReaders` reads `users.isAdmin`: pin with one test that the single user keeps Prompt details.
5. **Tests** assert the **broadcast payload** per recipient as well as the reads: administrator-owner yes,
   administrator-guest yes, non-administrator owner **no prompt text anywhere in the serialised payload** (page,
   get, by id, push, refresh, regenerate / extend, `promptTokenCount`), non-administrator guest no; the owner
   still receives scene text. Tests that assert an owner sees Prompt details change to the new rule; list
   them.
6. **Docs / names:** sentences written today by task `gs-4` ("the session's owner and an administrator who is
   in the session") become "an administrator who is in the session"; NOMENCLATURE rows **Prompt details**,
   **guest**; §25 with both quotes (G5 2026-11-16; D64 + DG1 2026-11-17) and a line that Inspect run was
   already administrators' only (R55).

Files owned (`dg-1a`): `messages/debugMeta.ts`, `sockets/utils/broadcastHelpers.ts` (that block),
`sockets/sessions.messages.ts` (`promptTokenCountHandler` and the calls of `readsPrompt`), `sockets/sessions.ts`
and `sessions.shared.ts` (their `readsPrompt` call sites only), the two client files and `promptDetails.ts`,
their tests, `docs/sessions.md`, `docs/group-sessions.md`, `docs/users-and-accounts.md`, NOMENCLATURE.
`docs/sessions.md` and NOMENCLATURE §25 are shared with live lanes: re-read before each edit.
