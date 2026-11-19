# BRIEF — worker `gs-2a-w2` (client + docs): an administrator inside someone else's session is a guest (G6); Prompt details is the session owner's (G5)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-2a`. A second worker (`gs-2a-w1`) is changing the server at the same time (`sockets/pipelines.ts`, `sockets/sessions*.ts`, `sessions/annexInspect.ts`, `sockets/utils/broadcastHelpers.ts`, `messages/debugMeta.ts`): never edit those. No SDK change.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` here: don't run one.)

Also: never `git checkout / restore`; never `prettier --write`; no migration. Re-read any file right before editing it (other lanes edit nearby files).

**Tests only like this**, one run at a time, each preceded by the wait:
```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2a-w2-<n>.log 2>&1"
```
Never pipe vitest into `head`. A failing assert on a happy-dom element has OOM-killed VS Code: keep DOM assertions on strings/booleans. `npm run check` with `NODE_OPTIONS=--max-old-space-size=10240` (report errors in your files only). No full test run, no `npm run build`.

## The rulings (owner, 2026-11-16) and the lead's reading

- G6: "In another person's session an administrator is a guest."
- G5: "The session's owner and administrators only." Read with G6 (lead's reading, D64): inside a session, **Prompt details** is the **owner's**; an administrator reads any run, prompt included, from the **administrator** run inspector (R55), not from inside someone else's session.
- Standing: enforce at the server (w1 does), and in the client **a control a person may not use is absent, never disabled**; one socket listener per event family; views never toast.
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`.
- Copy rules (STYLE-GUIDE): sentence case; words a person reads. Every new or changed user-facing sentence is 🚧 provisional: list it verbatim in your report.

## Files owned (edit only these, only where named)

1. `src/lib/client/components/sessionForms/EditSessionForm.svelte` — **only the three `isAdmin` conditions and the comments beside them**:
   - ~580 `seesSessionPipelines`: `!isGuest` (drop `|| !!userCtx.user?.isAdmin`); its comment: the owner's; a guest, administrators included (G6), gets none and the form does not ask `sessions:pipelines`.
   - ~631 `settingsHides`: drop the `(editSessionId != null && !!userCtx.user?.isAdmin)` term; with `seesSessionPipelines` now `!isGuest`, a guest has nothing hidden by the switch, so simplify honestly (e.g. `!isGuest && !!session?.id`) and fix the comment above it (~624).
   - ~3023 the `SessionAnnexPanel` condition: `!isGuest` (drop `|| userCtx.user?.isAdmin`); fix the comment above it (~3011: "the owner's only; the server refuses anyone else, administrators included").
   - Nothing else in that file (other lanes will rework Edit session for guests).
2. `src/lib/client/components/sessionForms/SessionAnnexPanel.svelte` — its header comment (~7) only, if it says administrators read it.
3. **Prompt details is the session owner's:**
   - `src/lib/client/components/sessionPage/requests/promptDetails.ts`: `PromptDetailsDeps.isAdmin` → `isOwner` ("the viewer owns this session"); the refusal becomes `"prompt details are the session owner's, with context debugging on"`; the header comment says the owner's (G5 with G6).
   - `src/lib/client/components/sessionPage/requests/index.ts`: add to `WidgetRequestDeps`, in the "The viewer" block, `isSessionOwner(): boolean` with a one-line doc; `"prompt-details"` passes `isOwner: d.isSessionOwner()`. Leave every other `isAdmin` use there alone (`inspect-run` and `session-runs` are the administrator's run inspector, R55).
   - `src/routes/sessions/[id]/+page.svelte`: in `widgetRequestDeps` (~641–660) only, add `isSessionOwner: () => session != null && session.userId === userCtx.user?.id` (check the names in scope there; use whatever the page already has for the session row and the user). Leave `PromptDetailsModal`'s `isAdmin` prop alone (it gates the receipt-based retrieval explanation, R55).
   - `src/lib/client/components/sessionPage/sessionPageProjections.ts`: the line's `promptDetails` flag (~966–969) becomes `!isGuest && contextDebuggingEnabled && !!debugMeta` (the session's owner); fix the comment, and in `castKey` (~846–849) replace `userCtx.user?.isAdmin` and its comment "`promptDetails` reads both" so the key still holds everything `promptDetails` reads (`isGuest` is already in it). Nothing else in that file.
4. Tests:
   - `src/lib/client/components/sessionPage/requests/promptDetails.test.ts`: re-pin to `isOwner` (owner shows; not owner refused with the new sentence; context debugging off refused; the guard test's sentence).
   - A projection test that the line's `promptDetails` is true for the owner and false for a guest and for an administrator who is a guest (rows carrying a `debugMeta`, context debugging on). Extend the closest existing projection test (`stepTimeLimitsOff.projection.test.ts` or `conversationDossier.identity.dom.test.svelte.ts` show how `projectConversationDossier` is driven) or add `promptDetailsFlag.projection.test.ts` beside them.
   - `src/lib/client/components/sessionForms/editSessionAdvanced.dom.test.svelte.ts`: re-pin (old → new):
     - ~351 "an administrator who is a guest, on, with session pipelines: the card renders (unchanged until G6)" → no Pipelines section, no Session data (`markers().annex` false), and `asked("sessions:pipelines")` is 0;
     - ~359 "an administrator who is a guest, off: one line (the card is hidden by the switch)" → no line (`lines()` 0), no Pipelines section, no Session data;
     - keep the owner cases green; add an owner who is also an administrator: still gets Pipelines and Session data.
5. Docs (only the sentences this lane makes false, plus the one sentence each the lead asked for; plain words, no file paths or code names):
   - `docs/sessions.md`: the actions table row **Prompt details** (~265: "With context debugging on" → the session's owner, with context debugging on); the Guests paragraph (~621: "**Prompt details** on a reply still shows anyone in the session the prompt that reply was written from." → Prompt details is the owner's; a guest's composer statistics show the token counts without the prompt; and one sentence that an administrator who is a guest is a guest here like anyone); **Session data** (~518: "for the session's owner and administrators" → the session's owner); **Pipeline settings in a session** (~593: "the session owner's (and an administrator's)" → the owner's; keep that an administrator who owns the session also sees model and sampling, as ~436 says); **Statistics** (~653–660: say the **Prompt preview** is shown to the session's owner). Check the rest of the file for any other sentence that says an administrator gets more inside someone else's session, and list (don't fix) any outside these.
   - `docs/group-sessions.md` (~20): one sentence: an administrator who is a guest in someone else's session is a guest there.
   - `docs/users-and-accounts.md` §Administrators and members (~91): one sentence after "…every other person's characters and sessions.": inside someone else's session an administrator is a guest like anyone (no settings, session data or prompts there); the run inspector in the admin area still reads every run.
   - `NOMENCLATURE.md` **§25 Change ledger only**: one entry dated 2026-11-16 in the style of the lane gs-1 entry (~4354): "lane gs-2a — an administrator in another person's session is a guest (G6); a reply's compiled prompt is the session owner's (G5); owner rulings G5, G6 2026-11-16 (quote both) and the lead's reading D64; 🚧 provisional copy, not ruled; no migration, no new event". List: *changed* `sessions:pipelines` (empty for every guest, administrators included), `pipelines:get` / `pipelines:promptWording` / the config writes (an administrator with another person's session refused like a guest, nothing stored), `sessions:annexInspect` (the owner's; refusal "Only the session's owner can see its stored data."), `sessions:promptTokenCount` (text to the owner only, counts to every member), message rows' `debugMeta` (null for anyone not the owner, in every read and push), the client **Prompt details** gate (owner). *new internal names (app)* `withoutDebugMeta` (`messages/debugMeta.ts`), `WidgetRequestDeps.isSessionOwner`, `PromptDetailsDeps.isOwner` (replaces `isAdmin`). *not changed* the administrator run inspector and its receipts (R55), `pipelines:eventMap`, the admin session list. Do **not** edit §9's **guest** row (the supervisor queues that).

## Stop and ask (write it in your report and stop that part) when

A guest's page needs something from `debugMeta` to render; a change needs a new setting, event, migration, or a file outside this list; a doc sentence would describe something the lead has not ruled.

## Report

To the supervisor, as your final message: changed files (with what changed), every test run with pass counts and log path, the old → new of each re-pinned test, every new or changed sentence verbatim (docs and code), Noticed-not-done.
